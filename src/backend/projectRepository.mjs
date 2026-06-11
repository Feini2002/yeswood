import crypto from 'node:crypto';

import { getConfig } from './config.mjs';
import { openInitializedDatabase } from './database.mjs';
import {
  calculateDashboardMetrics,
  createFieldCatalog,
  createFilterOptions,
  enrichProjectsForDisplay,
  normalizeRisk,
  scheduleStatusFor,
} from './projectData.mjs';
import { logger } from './logger.mjs';
import { provinceDisplayName } from '../../public/dashboard/province-display.mjs';
import { normalizePriorityStatus, readPrioritySourceRaw } from './metrics/fieldSemantics.mjs';
import {
  CD_OWNER_FIELDS,
  VM_OWNER_FIELDS,
  readNamesFromRawField,
  readProjectOwnerNames,
} from './personnelNames.mjs';
import { PROJECT_DIFFICULTY_SCHEMA_VERSION, scoreProjectDifficulty } from './projectDifficulty.mjs';
import { applySleepStoreHardOnlyProjectRule, applySoleDualOwnerProjectRule } from './projectOwnerRules.mjs';
import { isTerminalProjectStatus, readProjectStatusFromRawFields } from './projectStatus.mjs';
import { syncPersonnelFromProjects } from './personnelRepository.mjs';
import {
  aggregatePersonnelStatsFromDatabase,
  extractAssignmentsFromProject,
  rebuildProjectResponsibilities,
} from './responsibilityRepository.mjs';

const PROJECT_FIELD_COLUMNS = [
  ['name', 'name'],
  ['province', 'province'],
  ['businessType', 'business_type'],
  ['storeStatus', 'store_status'],
  ['status', 'status'],
  ['owner', 'owner_text'],
  ['cdOwner', 'cd_owner_text'],
  ['vmOwner', 'vm_owner_text'],
  ['progress', 'progress'],
  ['hardProgressStage', 'hard_progress_stage'],
  ['softProgressStage', 'soft_progress_stage'],
  ['startDate', 'start_date'],
  ['dueDate', 'due_date'],
  ['riskLevel', 'risk_level'],
  ['riskNotes', 'risk_notes'],
];

const SPLIT_OWNER_FIELD_NAMES = [...CD_OWNER_FIELDS, ...VM_OWNER_FIELDS];

function nowIso() {
  return new Date().toISOString();
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hashText(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function syncRunId(snapshot) {
  const source = snapshot.source || 'unknown';
  const timestamp = snapshot.syncedAt || nowIso();
  return `${source}-${timestamp}-${crypto.randomUUID()}`;
}

function splitOwnerText(project, fieldNames) {
  const names = new Set();
  for (const fieldName of fieldNames) {
    for (const name of readNamesFromRawField(project, fieldName)) {
      names.add(name);
    }
  }
  return Array.from(names).join('、');
}

function projectValue(project, fieldKey) {
  if (fieldKey === 'owner') {
    return projectOwnerText(project, project.owner);
  }
  if (fieldKey === 'cdOwner') {
    return project.cdOwner ?? splitOwnerText(project, CD_OWNER_FIELDS);
  }
  if (fieldKey === 'vmOwner') {
    return project.vmOwner ?? splitOwnerText(project, VM_OWNER_FIELDS);
  }
  return project[fieldKey] ?? '';
}

function sourceValueJson(project, fieldKey) {
  return json(projectValue(project, fieldKey));
}

function projectDifficultyPayload(project) {
  const difficulty = project?.difficulty || scoreProjectDifficulty(project);
  return {
    difficulty,
    score: Number(difficulty.score || 0),
    level: difficulty.level || '',
    weight: Number(difficulty.weight || 0),
    workdays: Number(difficulty.workdays || 0),
    ruleKey: (difficulty.ruleKeys || []).join(','),
    json: JSON.stringify(difficulty || {}),
  };
}

function projectOwnerText(project, fallback = '') {
  const ownerNames = readProjectOwnerNames(project);
  if (ownerNames.length) {
    return ownerNames.join('、');
  }
  return fallback || '未分配';
}

function hasSplitOwnerFields(projects) {
  return projects.some((project) =>
    SPLIT_OWNER_FIELD_NAMES.some((fieldName) => readNamesFromRawField(project, fieldName).length > 0)
  );
}

function splitOwnerAssignmentKey({ projectId, project_id, slotKey, slot_key, personNameRaw, person_name_raw, personName, person_name }) {
  return `${projectId || project_id}\0${slotKey || slot_key}\0${personNameRaw || person_name_raw || personName || person_name}`;
}

function splitOwnerAssignmentsComplete(database, projects) {
  const splitOwnerSlots = new Set(['cd_owner', 'vm_owner']);
  const expectedKeys = new Set();
  for (const project of projects) {
    for (const assignment of extractAssignmentsFromProject(project)) {
      if (splitOwnerSlots.has(assignment.slotKey)) {
        expectedKeys.add(splitOwnerAssignmentKey({ projectId: project.id, ...assignment }));
      }
    }
  }
  if (!expectedKeys.size) {
    return true;
  }

  const existingKeys = new Set(
    database
      .prepare(
        `select project_id, slot_key, coalesce(nullif(person_name_raw, ''), person_name) as person_name_raw
         from project_responsibilities
         where slot_key in ('cd_owner', 'vm_owner')`
      )
      .all()
      .map(splitOwnerAssignmentKey)
  );

  return Array.from(expectedKeys).every((key) => existingKeys.has(key));
}

function refreshSplitOwnerResponsibilitiesIfNeeded(database, projects) {
  if (!projects.length || !hasSplitOwnerFields(projects) || splitOwnerAssignmentsComplete(database, projects)) {
    return;
  }
  rebuildProjectResponsibilities(database, projects, `local-responsibility-refresh-${nowIso()}`);
}

export function scheduleSplitOwnerResponsibilityRefresh(config = getConfig(), projects = []) {
  if (!config?.databaseFile || !Array.isArray(projects) || !projects.length || config.splitOwnerRefreshInFlight) {
    return;
  }
  if (!hasSplitOwnerFields(projects)) {
    return;
  }

  config.splitOwnerRefreshInFlight = true;
  setImmediate(() => {
    let database;
    try {
      database = openInitializedDatabase(config.databaseFile);
      if (splitOwnerAssignmentsComplete(database, projects)) {
        return;
      }
      rebuildProjectResponsibilities(database, projects, `local-responsibility-refresh-${nowIso()}`);
    } catch (error) {
      logger.warn(`Split owner responsibility refresh failed: ${error.message}`);
    } finally {
      database?.close();
      config.splitOwnerRefreshInFlight = false;
    }
  });
}

function existingProjectByRecordId(database, dingtalkRecordId) {
  return database.prepare('select * from projects where dingtalk_record_id = ?').get(dingtalkRecordId);
}

function overridesByProject(database, projectId) {
  const rows = database.prepare('select field_key, local_value_json from project_field_overrides where project_id = ?').all(projectId);
  return new Map(rows.map((row) => [row.field_key, row.local_value_json]));
}

function insertChangeLog(database, { projectId, fieldKey, oldValue, newValue, changeType, note = '' }) {
  database
    .prepare(
      `insert into project_change_logs
        (id, project_id, field_key, old_value_json, new_value_json, change_type, changed_by, changed_at, note)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(crypto.randomUUID(), projectId, fieldKey, json(oldValue), json(newValue), changeType, 'system', nowIso(), note);
}

function recordSourceDifference(database, { projectId, fieldKey, sourceValue, localValueJson }) {
  database
    .prepare("delete from source_differences where project_id = ? and field_key = ? and status = 'open'")
    .run(projectId, fieldKey);
  database
    .prepare(
      `insert into source_differences
        (id, project_id, field_key, source_value_json, local_value_json, status, detected_at)
       values (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(crypto.randomUUID(), projectId, fieldKey, json(sourceValue), localValueJson, 'open', nowIso());
}

function insertRawRecord(database, { runId, project }) {
  const rawFieldsJson = JSON.stringify(project.rawFields || {});
  const rawJson = JSON.stringify(project);
  database
    .prepare(
      `insert into dingtalk_raw_records
        (id, sync_run_id, dingtalk_record_id, raw_json, raw_fields_json, field_hash,
         source_created_time, source_modified_time, imported_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      runId,
      project.id,
      rawJson,
      rawFieldsJson,
      hashText(rawFieldsJson),
      project.recordMeta?.createdTime || '',
      project.recordMeta?.lastModifiedTime || project.updatedAt || '',
      nowIso()
    );
}

function insertProject(database, project) {
  const difficulty = projectDifficultyPayload(project);
  database
    .prepare(
      `insert into projects
        (id, dingtalk_record_id, raw_fields_json, name, province, business_type, store_status, status,
         owner_text, cd_owner_text, vm_owner_text, progress, hard_progress_stage, soft_progress_stage,
         start_date, due_date, risk_level, risk_notes, local_notes,
         difficulty_score, difficulty_level, difficulty_weight, difficulty_workdays, difficulty_rule_key, difficulty_json,
         source_updated_at, local_updated_at, created_at, archived_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      project.id,
      project.id,
      JSON.stringify(project.rawFields || {}),
      project.name,
      project.province,
      project.businessType,
      project.storeStatus,
      project.status,
      projectValue(project, 'owner'),
      projectValue(project, 'cdOwner'),
      projectValue(project, 'vmOwner'),
      Number(project.progress || 0),
      projectValue(project, 'hardProgressStage'),
      projectValue(project, 'softProgressStage'),
      project.startDate || '',
      project.dueDate || '',
      project.riskLevel || '',
      project.riskNotes || '',
      '',
      difficulty.score,
      difficulty.level,
      difficulty.weight,
      difficulty.workdays,
      difficulty.ruleKey,
      difficulty.json,
      project.updatedAt || '',
      '',
      nowIso(),
      null
    );

  for (const [fieldKey] of PROJECT_FIELD_COLUMNS) {
    insertChangeLog(database, {
      projectId: project.id,
      fieldKey,
      oldValue: null,
      newValue: projectValue(project, fieldKey),
      changeType: 'import',
      note: 'initial import',
    });
  }
}

function updateProject(database, existingProject, project) {
  const overrides = overridesByProject(database, existingProject.id);
  const difficulty = projectDifficultyPayload(project);
  const updates = {
    raw_fields_json: JSON.stringify(project.rawFields || {}),
    source_updated_at: project.updatedAt || '',
    difficulty_score: difficulty.score,
    difficulty_level: difficulty.level,
    difficulty_weight: difficulty.weight,
    difficulty_workdays: difficulty.workdays,
    difficulty_rule_key: difficulty.ruleKey,
    difficulty_json: difficulty.json,
    archived_at: null,
  };

  for (const [fieldKey, column] of PROJECT_FIELD_COLUMNS) {
    const nextValue = projectValue(project, fieldKey);
    const nextValueJson = sourceValueJson(project, fieldKey);
    const localOverrideJson = overrides.get(fieldKey);
    if (localOverrideJson) {
      if (localOverrideJson !== nextValueJson) {
        recordSourceDifference(database, {
          projectId: existingProject.id,
          fieldKey,
          sourceValue: fieldKey === 'status' ? readPrioritySourceRaw(project) : nextValue,
          localValueJson: localOverrideJson,
        });
      }
      continue;
    }

    updates[column] = column === 'progress' ? Number(nextValue || 0) : String(nextValue ?? '');
    if (String(existingProject[column] ?? '') !== String(updates[column] ?? '')) {
      insertChangeLog(database, {
        projectId: existingProject.id,
        fieldKey,
        oldValue: existingProject[column],
        newValue: updates[column],
        changeType: 'import',
        note: 'source import update',
      });
    }
  }

  const assignments = Object.keys(updates)
    .map((column) => `${column} = ?`)
    .join(', ');
  database
    .prepare(`update projects set ${assignments} where id = ?`)
    .run(...Object.values(updates), existingProject.id);
}

function archiveProjectsMissingFromSnapshot(database, snapshot) {
  // 仅当被忽略记录占比超过 50% 时才跳过归档——防止同步大面积失败时误归档。
  // 少量无效记录不应阻止已删除项目的正常归档。
  const totalSourceRecords = Number(snapshot.sourceRecords || 0);
  const ignoredRecords = Number(snapshot.ignoredRecords || 0);
  if (totalSourceRecords > 0 && ignoredRecords / totalSourceRecords > 0.5) {
    return;
  }

  const currentRecordIds = new Set((snapshot.projects || []).map((project) => project.id));
  if (currentRecordIds.size === 0) {
    return;
  }

  const activeProjects = database
    .prepare('select id, dingtalk_record_id from projects where archived_at is null')
    .all();
  const archivedAt = nowIso();
  const archive = database.prepare(
    `update projects
     set archived_at = ?, local_updated_at = ?
     where id = ? and archived_at is null`
  );

  for (const project of activeProjects) {
    const recordId = project.dingtalk_record_id || project.id;
    if (!currentRecordIds.has(recordId)) {
      archive.run(archivedAt, archivedAt, project.id);
    }
  }
}

export function importSnapshotToDatabase(database, snapshot) {
  const runId = syncRunId(snapshot);
  const startedAt = nowIso();

  database.exec('BEGIN');
  try {
    database
      .prepare(
        `insert into sync_runs
          (id, source, status, started_at, source_records, imported_records, ignored_records)
         values (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        runId,
        snapshot.source || 'unknown',
        'running',
        startedAt,
        Number(snapshot.sourceRecords || 0),
        0,
        Number(snapshot.ignoredRecords || 0)
      );

    for (const project of snapshot.projects || []) {
      insertRawRecord(database, { runId, project });
      const existingProject = existingProjectByRecordId(database, project.id);
      if (existingProject) {
        updateProject(database, existingProject, project);
      } else {
        insertProject(database, project);
      }
    }

    archiveProjectsMissingFromSnapshot(database, snapshot);
    syncPersonnelFromProjects(database, snapshot.projects || []);
    rebuildProjectResponsibilities(database, snapshot.projects || [], runId, { useTransaction: false });

    database
      .prepare(
        `update sync_runs
         set status = ?, finished_at = ?, imported_records = ?
         where id = ?`
      )
      .run('success', snapshot.syncedAt || nowIso(), Number(snapshot.totalRecords || 0), runId);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function databaseHasProjects(database) {
  return database.prepare('select count(*) as count from projects where archived_at is null').get().count > 0;
}

function projectFromRow(row) {
  const rawFields = parseJson(row.raw_fields_json, {});
  const sourceStatus = readProjectStatusFromRawFields(rawFields, row.status);
  const persistedDifficulty = parseJson(row.difficulty_json, null);
  const fallbackProject = {
    rawFields,
    name: row.name,
    province: provinceDisplayName(row.province) || row.province,
    businessType: row.business_type,
    storeStatus: row.store_status,
    status: normalizePriorityStatus(row.status),
    owner: row.owner_text,
  };
  fallbackProject.cdOwner = row.cd_owner_text || splitOwnerText(fallbackProject, CD_OWNER_FIELDS);
  fallbackProject.vmOwner = row.vm_owner_text || splitOwnerText(fallbackProject, VM_OWNER_FIELDS);
  applySleepStoreHardOnlyProjectRule(fallbackProject);
  fallbackProject.owner = projectOwnerText(fallbackProject, row.owner_text);
  applySoleDualOwnerProjectRule(fallbackProject);
  const usePersistedDifficulty =
    persistedDifficulty &&
    Number(persistedDifficulty.score || 0) > 0 &&
    Number(persistedDifficulty.schemaVersion || 0) === PROJECT_DIFFICULTY_SCHEMA_VERSION;
  const difficulty = usePersistedDifficulty ? persistedDifficulty : scoreProjectDifficulty(fallbackProject);
  const delayed = isProjectDelayed(row.due_date, sourceStatus);
  return {
    id: row.id,
    recordMeta: {
      id: row.dingtalk_record_id || row.id,
      createdTime: row.created_at,
      lastModifiedTime: row.source_updated_at,
    },
    rawFields,
    name: row.name,
    province: provinceDisplayName(row.province) || row.province,
    businessType: row.business_type,
    storeStatus: row.store_status,
    status: normalizePriorityStatus(row.status),
    owner: fallbackProject.owner,
    cdOwner: fallbackProject.cdOwner,
    vmOwner: fallbackProject.vmOwner,
    derivedOwners: fallbackProject.derivedOwners,
    progress: Number(row.progress || 0),
    hardProgressStage: row.hard_progress_stage || fallbackProject.hardProgressStage || '',
    softProgressStage: row.soft_progress_stage || fallbackProject.softProgressStage || '',
    startDate: row.start_date,
    dueDate: row.due_date,
    riskLevel: normalizeRisk(row.risk_level),
    riskNotes: row.risk_notes,
    localNotes: row.local_notes,
    updatedAt: row.source_updated_at || row.local_updated_at || row.created_at,
    isDelayed: delayed,
    scheduleStatus: scheduleStatusFor(row.due_date, delayed),
    source: 'local-sqlite',
    difficulty,
    difficultyScore: Number(usePersistedDifficulty ? row.difficulty_score : difficulty.score || 0),
    difficultyLevel: usePersistedDifficulty ? row.difficulty_level || difficulty.level || '' : difficulty.level || '',
    difficultyWeight: Number(usePersistedDifficulty ? row.difficulty_weight : difficulty.weight || 0),
    difficultyWorkdays: Number(usePersistedDifficulty ? row.difficulty_workdays : difficulty.workdays || 0),
  };
}

function isProjectDelayed(dueDate, status) {
  if (!dueDate || isTerminalProjectStatus(status)) {
    return false;
  }
  const date = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

export function readSnapshotFromDatabase(database, { personnelArchitecture = {} } = {}) {
  const run = database
    .prepare("select * from sync_runs where status = 'success' order by finished_at desc, started_at desc limit 1")
    .get();
  const canonicalProjects = database
    .prepare('select * from projects where archived_at is null order by created_at, id')
    .all()
    .map(projectFromRow);
  const projects = enrichProjectsForDisplay(canonicalProjects, personnelArchitecture);

  return {
    version: 1,
    source: run?.source || 'sqlite',
    storage: 'sqlite',
    databaseReady: true,
    readOnly: true,
    syncedAt: run?.finished_at || '',
    sourceRecords: Number(run?.source_records || projects.length),
    totalRecords: projects.length,
    ignoredRecords: Number(run?.ignored_records || 0),
    projects,
    personnelArchitecture,
    fieldCatalog: createFieldCatalog(projects),
    metrics: enrichMetricsFromDatabase(database, projects, { personnelArchitecture }),
    filters: createFilterOptions(projects),
  };
}

function enrichMetricsFromDatabase(database, projects, { personnelArchitecture = {} } = {}) {
  const metrics = calculateDashboardMetrics(projects, { personnelArchitecture });
  try {
    const databasePersonnel = aggregatePersonnelStatsFromDatabase(database, { personnelArchitecture });
    const hasDatabaseAssignments =
      Number(databasePersonnel.summary?.coveredProjects || 0) > 0 ||
      Number(databasePersonnel.summary?.totalAssignments || 0) > 0;
    if (projects.length === 0 || hasDatabaseAssignments) {
      metrics.personnel = databasePersonnel;
    }
  } catch (error) {
    // responsibility 表为空或数据库异常时，保留内存中的 personnel stats 作为降级方案。
    // 非空表错误（如 SQL 损坏、字段缺失）需要记录日志以便排查。
    if (error?.message && !String(error.message).includes('no such table')) {
      logger.warn(`Personnel stats from database unavailable, using in-memory fallback: ${error.message}`);
    }
  }
  return metrics;
}
