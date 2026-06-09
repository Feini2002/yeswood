import { readNamesFromRawField, readProjectOwnerNames, splitPersonnelNames } from './personnelNames.mjs';
import { normalizePersonnelArchitecture } from './personnelArchitecture.mjs';
import {
  responsibilityIdentitiesForSourceName,
  responsibilityIdentityFieldNames,
  responsibilityIdentityForAssignment,
  findResponsibilityIdentity,
  responsibilityIdentitySlotKeys,
} from './responsibilityIdentities.mjs';
import { matchSlotForFieldName, RESPONSIBILITY_SLOTS, slotByApiRoleKey, slotByKey } from './responsibilitySlots.mjs';
import {
  hasOpenDesignResponsibility,
  hasOpenHardDesignResponsibility,
  hasOpenPointDesignResponsibility,
  hasOpenSoftDesignResponsibility,
  hasOpenSoftSchemeDesignResponsibility,
  isOpenDesignResponsibilityDelayed,
  isOpenPointDesignResponsibilityDelayed,
  isOpenSoftSchemeDesignResponsibilityDelayed,
} from './metrics/fieldSemantics.mjs';
import { isSleepStoreProject } from './projectTypeRules.mjs';

function isSoftResponsibilitySlot(slot) {
  return slot?.discipline === 'soft' || slot?.slotKey === 'point_designer' || slot?.slotKey === 'display_designer';
}

function normalizeArchitecture(personnelArchitecture = {}) {
  return personnelArchitecture?.responsibilityIdentitiesById
    ? personnelArchitecture
    : normalizePersonnelArchitecture(personnelArchitecture);
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

function buildCanonicalPersonNameLookup(database) {
  const variants = new Map();
  const rows = database
    .prepare('select name, display_name, aliases_json from personnel_people')
    .all();

  for (const row of rows) {
    const names = [row.name, row.display_name, ...parseJson(row.aliases_json, [])]
      .map((name) => String(name || '').trim())
      .filter(Boolean);
    for (const name of names) {
      if (!variants.has(name)) {
        variants.set(name, new Set());
      }
      variants.get(name).add(row.name);
    }
  }

  return new Map(
    Array.from(variants.entries())
      .filter(([, canonicalNames]) => canonicalNames.size === 1)
      .map(([variant, canonicalNames]) => [variant, Array.from(canonicalNames)[0]])
  );
}

function responsibilityStatSeed(personName, slot, personnelArchitecture = {}) {
  const identity = responsibilityIdentityForAssignment(personName, slot, personnelArchitecture);
  if (!identity) {
    return {
      key: personName,
      stat: { name: personName, value: 0, delayed: 0, highRisk: 0 },
    };
  }

  return {
    key: identity.identityId,
    stat: {
      identityId: identity.identityId,
      name: identity.displayName,
      displayName: identity.displayName,
      sourceName: identity.sourceName,
      discipline: identity.discipline,
      scope: identity.scope,
      value: 0,
      delayed: 0,
      highRisk: 0,
    },
  };
}

function addProjectToResponsibilityStat(stat, project, slot) {
  stat.value += 1;
  if (isProjectDelayedForSlot(project, slot)) {
    stat.delayed += 1;
  }
  if (hasOpenResponsibilityForSlot(project, slot) && isProjectHighRisk(project)) {
    stat.highRisk += 1;
  }
}

export function buildOwnerNameIndex(personnelArchitecture = {}) {
  const index = new Map();
  const people = personnelArchitecture.people || {};
  const entries = Array.isArray(people) ? people : Object.entries(people).map(([name, person]) => ({ ...person, name: person.name || name }));

  for (const person of entries) {
    if (!person?.name) {
      continue;
    }
    const variants = new Set([person.name, person.displayName, ...(person.aliases || [])].filter(Boolean));
    for (const variant of variants) {
      if (!index.has(variant)) {
        index.set(variant, new Set());
      }
      variants.forEach((item) => index.get(variant).add(item));
      index.get(variant).add(person.name);
    }
  }

  const globalAliases = personnelArchitecture.aliases || {};
  for (const [canonical, aliases] of Object.entries(globalAliases)) {
    const bucket = index.get(canonical) || new Set([canonical]);
    bucket.add(canonical);
    for (const alias of aliases || []) {
      bucket.add(alias);
      if (!index.has(alias)) {
        index.set(alias, new Set());
      }
      aliases.forEach((item) => index.get(alias).add(item));
      index.get(alias).add(canonical);
    }
    index.set(canonical, bucket);
  }

  return index;
}

export function expandOwnerNames(owner, personnelArchitecture = {}, ownerNameIndex = null) {
  const names = new Set([owner]);
  const index = ownerNameIndex || buildOwnerNameIndex(personnelArchitecture);
  const bucket = index.get(owner);
  if (bucket) {
    for (const name of bucket) {
      names.add(name);
    }
  }
  return names;
}

export function extractAssignmentsFromProject(project) {
  const assignments = [];
  const rawFields = project.rawFields || {};
  const hardOnly = isSleepStoreProject(project);

  for (const fieldName of Object.keys(rawFields)) {
    const slot = matchSlotForFieldName(fieldName);
    if (!slot) {
      continue;
    }
    if (hardOnly && isSoftResponsibilitySlot(slot)) {
      continue;
    }
    const names = readNamesFromRawField(project, fieldName);
    names.forEach((personName, assignmentIndex) => {
      assignments.push({
        slotKey: slot.dynamic ? `dynamic:${fieldName}` : slot.slotKey,
        personName,
        personNameRaw: personName,
        assignmentIndex,
        sourceField: fieldName,
      });
    });
  }

  for (const slot of RESPONSIBILITY_SLOTS) {
    if (!slot.apiRoleKey || slot.slotKey === 'owner') {
      continue;
    }
    if (hardOnly && isSoftResponsibilitySlot(slot)) {
      continue;
    }
    const existingNames = new Set(assignments.filter((item) => item.slotKey === slot.slotKey).map((item) => item.personName));
    let assignmentIndex = existingNames.size;
    for (const personName of splitPersonnelNames(project?.[slot.apiRoleKey])) {
      if (existingNames.has(personName)) {
        continue;
      }
      assignments.push({
        slotKey: slot.slotKey,
        personName,
        personNameRaw: personName,
        assignmentIndex,
        sourceField: `apiRole:${slot.apiRoleKey}`,
      });
      existingNames.add(personName);
      assignmentIndex += 1;
    }
  }

  const existingOwnerNames = new Set(assignments.filter((item) => item.slotKey === 'owner').map((item) => item.personName));
  let ownerAssignmentIndex = existingOwnerNames.size;
  for (const personName of readProjectOwnerNames(project)) {
    if (!existingOwnerNames.has(personName)) {
      assignments.push({
        slotKey: 'owner',
        personName,
        personNameRaw: personName,
        assignmentIndex: ownerAssignmentIndex,
        sourceField: '负责人汇总',
      });
      existingOwnerNames.add(personName);
      ownerAssignmentIndex += 1;
    }
  }

  return assignments;
}

export function seedResponsibilitySlots(database) {
  const statement = database.prepare(
    `insert into responsibility_slots (slot_key, label, dingtalk_fields_json, discipline, sort_order)
     values (?, ?, ?, ?, ?)
     on conflict(slot_key) do update set
       label = excluded.label,
       dingtalk_fields_json = excluded.dingtalk_fields_json,
       discipline = excluded.discipline,
       sort_order = excluded.sort_order`
  );
  RESPONSIBILITY_SLOTS.forEach((slot, index) => {
    statement.run(slot.slotKey, slot.label, JSON.stringify(slot.fields), slot.discipline || '', index);
  });
}

export function rebuildProjectResponsibilities(database, projects, syncRunId, { useTransaction = true } = {}) {
  const importedAt = new Date().toISOString();
  const canonicalPersonName = buildCanonicalPersonNameLookup(database);
  const deleteAll = database.prepare('delete from project_responsibilities');
  const insert = database.prepare(
    `insert into project_responsibilities
      (project_id, slot_key, person_name, person_name_raw, assignment_index, sync_run_id, imported_at)
     values (?, ?, ?, ?, ?, ?, ?)`
  );

  const apply = () => {
    deleteAll.run();
    for (const project of projects) {
      const assignments = extractAssignmentsFromProject(project);
      for (const assignment of assignments) {
        const personName = canonicalPersonName.get(assignment.personName) || assignment.personName;
        insert.run(
          project.id,
          assignment.slotKey,
          personName,
          assignment.personNameRaw,
          assignment.assignmentIndex,
          syncRunId,
          importedAt
        );
      }
    }
  };

  if (useTransaction) {
    database.exec('BEGIN');
    try {
      apply();
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } else {
    apply();
  }

  return {
    projectCount: projects.length,
    assignmentCount: database.prepare('select count(*) as count from project_responsibilities').get().count,
  };
}

export function verifyResponsibilityCoverage(projects) {
  const issues = [];
  const unmappedFields = new Set();

  for (const project of projects) {
    const expected = extractAssignmentsFromProject(project);
    const expectedKeys = new Set(expected.map((item) => `${item.slotKey}\0${item.personName}`));

    for (const fieldName of Object.keys(project.rawFields || {})) {
      const display = project.rawFields[fieldName]?.display;
      if (!display || display === '未填写' || display === '未分配') {
        continue;
      }
      if (!matchSlotForFieldName(fieldName) && /人|组长|负责|设计/.test(fieldName)) {
        unmappedFields.add(fieldName);
      }
    }

    if (expected.length === 0) {
      const hasPersonFields = Object.keys(project.rawFields || {}).some((key) => matchSlotForFieldName(key));
      if (hasPersonFields) {
        issues.push({ type: 'empty_assignments', projectId: project.id, name: project.name });
      }
    }

    for (const key of expectedKeys) {
      if (!key) {
        issues.push({ type: 'invalid_key', projectId: project.id, name: project.name });
      }
    }
  }

  return {
    projectCount: projects.length,
    issues,
    unmappedPersonFields: Array.from(unmappedFields).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
  };
}

function isProjectHighRisk(project) {
  return project.riskLevel === '高';
}

function responsibilityScopeForSlot(slot) {
  if (slot?.slotKey === 'point_designer') {
    return 'point';
  }
  if (slot?.slotKey === 'vm_designer') {
    return 'softScheme';
  }
  if (slot?.discipline === 'hard') {
    return 'hard';
  }
  if (slot?.discipline === 'soft') {
    return 'soft';
  }
  return '';
}

function hasOpenResponsibilityForSlot(project, slot) {
  switch (responsibilityScopeForSlot(slot)) {
    case 'hard':
      return hasOpenHardDesignResponsibility(project);
    case 'point':
      return hasOpenPointDesignResponsibility(project);
    case 'softScheme':
      return hasOpenSoftSchemeDesignResponsibility(project);
    case 'soft':
      return hasOpenSoftDesignResponsibility(project);
    default:
      return hasOpenDesignResponsibility(project);
  }
}

function isProjectDelayedForSlot(project, slot) {
  switch (responsibilityScopeForSlot(slot)) {
    case 'hard':
      return isOpenDesignResponsibilityDelayed(project, { discipline: 'hard' });
    case 'point':
      return isOpenPointDesignResponsibilityDelayed(project);
    case 'softScheme':
      return isOpenSoftSchemeDesignResponsibilityDelayed(project);
    case 'soft':
      return isOpenDesignResponsibilityDelayed(project, { discipline: 'soft' });
    default:
      return isOpenDesignResponsibilityDelayed(project);
  }
}

function parseRawFieldsJson(rawFieldsJson) {
  try {
    return JSON.parse(rawFieldsJson || '{}');
  } catch {
    return {};
  }
}

function projectHasIdentitySlotHit(project, identity) {
  return responsibilityIdentityFieldNames(identity).some((fieldName) =>
    readNamesFromRawField(project, fieldName).includes(identity.sourceName)
  );
}

function routingReviewProjectItem(project, sourceName, identities, reason, channel) {
  return {
    channel,
    reason,
    projectId: project.id || '',
    projectName: project.name || '未命名项目',
    sourceName,
    identityIds: identities.map((identity) => identity.identityId),
    displayNames: identities.map((identity) => identity.displayName),
  };
}

function buildResponsibilityRoutingReview(projects, architecture) {
  const bySourceName = new Map();
  for (const identity of architecture.responsibilityIdentities || []) {
    if (!identity.active || !identity.sourceName) {
      continue;
    }
    if (!bySourceName.has(identity.sourceName)) {
      bySourceName.set(identity.sourceName, []);
    }
    bySourceName.get(identity.sourceName).push(identity);
  }

  const pendingReview = [];
  const inferenceCandidates = [];
  const anomalies = [];

  for (const project of projects || []) {
    const totalOwnerNames = readNamesFromRawField(project, '负责人');
    if (!totalOwnerNames.length) {
      continue;
    }

    for (const sourceName of totalOwnerNames) {
      const identities = bySourceName.get(sourceName) || responsibilityIdentitiesForSourceName(sourceName, architecture);
      if (!identities.length || identities.some((identity) => projectHasIdentitySlotHit(project, identity))) {
        continue;
      }
      if (identities.length > 1) {
        pendingReview.push(
          routingReviewProjectItem(
            project,
            sourceName,
            identities,
            'multi-identity-owner-total-without-discipline-slot',
            'pending_review'
          )
        );
      } else {
        inferenceCandidates.push(
          routingReviewProjectItem(
            project,
            sourceName,
            identities,
            'single-identity-owner-total-without-discipline-slot',
            'inference_candidate'
          )
        );
      }
    }
  }

  return {
    pendingReview,
    inferenceCandidates,
    anomalies,
    summary: {
      pendingReview: pendingReview.length,
      inferenceCandidates: inferenceCandidates.length,
      anomalies: anomalies.length,
    },
  };
}

function projectFromResponsibilityRow(row) {
  return {
    id: row.project_id,
    rawFields: parseRawFieldsJson(row.raw_fields_json),
    storeStatus: row.store_status || '',
    owner: row.owner_text || '',
    status: row.status || '',
    dueDate: row.due_date || '',
    riskLevel: row.risk_level || '',
    hardProgressStage: row.hard_progress_stage || '',
    softProgressStage: row.soft_progress_stage || '',
  };
}

export function aggregatePersonnelStatsFromProjects(projects, { personnelArchitecture = {} } = {}) {
  const architecture = normalizeArchitecture(personnelArchitecture);
  const roles = [];
  const metricsRoles = ['cdOwner', 'vmOwner', 'cdLead', 'vmLead'];

  for (const apiRoleKey of metricsRoles) {
    const slot = slotByApiRoleKey(apiRoleKey);
    if (!slot) {
      continue;
    }
    const people = new Map();

    for (const project of projects) {
      if (isSleepStoreProject(project) && isSoftResponsibilitySlot(slot)) {
        continue;
      }
      const names = Array.from(new Set(slot.fields.flatMap((fieldName) => readNamesFromRawField(project, fieldName))));
      for (const name of names) {
        const seed = responsibilityStatSeed(name, slot, architecture);
        const stat = people.get(seed.key) || seed.stat;
        addProjectToResponsibilityStat(stat, project, slot);
        people.set(seed.key, stat);
      }
    }

    const sorted = Array.from(people.values()).sort((a, b) => {
      if (b.value !== a.value) {
        return b.value - a.value;
      }
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });

    roles.push({
      key: apiRoleKey,
      slotKey: slot.slotKey,
      label: slot.label,
      discipline: slot.discipline || '',
      fieldKeys: slot.fields,
      projectCount: projects.filter((project) => {
        if (isSleepStoreProject(project) && isSoftResponsibilitySlot(slot)) {
          return false;
        }
        return slot.fields.some((fieldName) => readNamesFromRawField(project, fieldName).length > 0);
      }).length,
      uniquePeople: sorted.length,
      totalAssignments: sorted.reduce((sum, person) => sum + person.value, 0),
      people: sorted,
      topPeople: sorted.slice(0, 8),
    });
  }

  const allPeople = new Set();
  let coveredProjects = new Set();
  let totalAssignments = 0;
  for (const role of roles) {
    role.people.forEach((person) => allPeople.add(person.identityId || person.name));
    totalAssignments += role.totalAssignments;
  }
  for (const project of projects) {
    const hasAny = metricsRoles.some((apiRoleKey) => {
      const slot = slotByApiRoleKey(apiRoleKey);
      if (isSleepStoreProject(project) && isSoftResponsibilitySlot(slot)) {
        return false;
      }
      return slot.fields.some((fieldName) => readNamesFromRawField(project, fieldName).length > 0);
    });
    if (hasAny) {
      coveredProjects.add(project.id);
    }
  }

  return {
    summary: {
      roleCount: roles.length,
      uniquePeople: allPeople.size,
      coveredProjects: coveredProjects.size,
      totalAssignments,
    },
    roles,
    designerRoles: buildDesignerRoleStats(projects, architecture),
    routingReview: buildResponsibilityRoutingReview(projects, architecture),
  };
}

function isDesignResponsibilitySlot(slot) {
  return ['hard', 'soft', 'point', 'softScheme'].includes(responsibilityScopeForSlot(slot));
}

function buildDesignerRoleStats(projects, architecture = {}) {
  return RESPONSIBILITY_SLOTS.filter((slot) => slot.slotKey.includes('designer') && isDesignResponsibilitySlot(slot))
    .map((slot) => {
      const people = new Map();
      for (const project of projects) {
        if (isSleepStoreProject(project) && isSoftResponsibilitySlot(slot)) {
          continue;
        }
        for (const name of readNamesFromRawField(project, slot.fields[0])) {
          const { key, stat } = responsibilityStatSeed(name, slot, architecture);
          const current = people.get(key) || stat;
          addProjectToResponsibilityStat(current, project, slot);
          people.set(key, current);
        }
      }
      const sorted = Array.from(people.values()).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-Hans-CN'));
      return {
        key: slot.apiRoleKey,
        slotKey: slot.slotKey,
        label: slot.label,
        people: sorted,
        topPeople: sorted.slice(0, 8),
      };
    })
    .filter((role) => role.people.length > 0);
}

function buildDesignerRoleStatsFromResponsibilityRows(rows, architecture = {}) {
  const designerSlots = RESPONSIBILITY_SLOTS.filter(
    (slot) => slot.slotKey.includes('designer') && isDesignResponsibilitySlot(slot)
  );
  const rolesMap = new Map(
    designerSlots.map((slot) => [
      slot.slotKey,
      {
        key: slot.apiRoleKey,
        slotKey: slot.slotKey,
        label: slot.label,
        people: new Map(),
      },
    ])
  );

  for (const row of rows) {
    const role = rolesMap.get(row.slot_key);
    if (!role) {
      continue;
    }
    const slot = slotByKey(row.slot_key);
    const project = projectFromResponsibilityRow(row);
    if (isSleepStoreProject(project) && isSoftResponsibilitySlot(slot)) {
      continue;
    }
    const { key, stat } = responsibilityStatSeed(row.person_name, slot, architecture);
    const current = role.people.get(key) || stat;
    addProjectToResponsibilityStat(current, project, slot);
    role.people.set(key, current);
  }

  return designerSlots
    .map((slot) => {
      const role = rolesMap.get(slot.slotKey);
      const sorted = Array.from(role.people.values()).sort(
        (a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-Hans-CN')
      );
      return {
        key: role.key,
        slotKey: role.slotKey,
        label: role.label,
        people: sorted,
        topPeople: sorted.slice(0, 8),
      };
    })
    .filter((role) => role.people.length > 0);
}

export function aggregatePersonnelStatsFromDatabase(database, { personnelArchitecture = {} } = {}) {
  const architecture = normalizeArchitecture(personnelArchitecture);
  const rows = database
    .prepare(
      `select pr.slot_key, pr.person_name, pr.project_id,
              p.raw_fields_json, p.store_status, p.owner_text, p.hard_progress_stage, p.soft_progress_stage,
              p.due_date, p.status, p.risk_level
       from project_responsibilities pr
       inner join projects p on p.id = pr.project_id
       where p.archived_at is null`
    )
    .all();

  const slotToApi = Object.fromEntries(RESPONSIBILITY_SLOTS.map((s) => [s.slotKey, s.apiRoleKey]));
  const metricsSlotKeys = ['cd_owner', 'vm_owner', 'cd_lead', 'vm_lead'];
  const rolesMap = new Map();

  for (const slotKey of metricsSlotKeys) {
    rolesMap.set(slotKey, {
      key: slotToApi[slotKey],
      slotKey,
      label: slotByApiRoleKey(slotToApi[slotKey])?.label || slotKey,
      discipline: slotByApiRoleKey(slotToApi[slotKey])?.discipline || '',
      fieldKeys: slotByApiRoleKey(slotToApi[slotKey])?.fields || [],
      people: new Map(),
      projectIds: new Set(),
    });
  }

  for (const row of rows) {
    if (!metricsSlotKeys.includes(row.slot_key)) {
      continue;
    }
    const role = rolesMap.get(row.slot_key);
    const slot = slotByApiRoleKey(role.key);
    const project = projectFromResponsibilityRow(row);
    if (isSleepStoreProject(project) && isSoftResponsibilitySlot(slot)) {
      continue;
    }
    role.projectIds.add(row.project_id);
    const seed = responsibilityStatSeed(row.person_name, slot, architecture);
    const stat = role.people.get(seed.key) || seed.stat;
    addProjectToResponsibilityStat(stat, project, slot);
    role.people.set(seed.key, stat);
  }

  const roles = metricsSlotKeys.map((slotKey) => {
    const role = rolesMap.get(slotKey);
    const sorted = Array.from(role.people.values()).sort(
      (a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-Hans-CN')
    );
    return {
      key: role.key,
      slotKey: role.slotKey,
      label: role.label,
      discipline: role.discipline,
      disciplineLabel: role.discipline === 'hard' ? '硬装' : role.discipline === 'soft' ? '软装' : '',
      fieldKeys: role.fieldKeys,
      projectCount: role.projectIds.size,
      uniquePeople: sorted.length,
      totalAssignments: sorted.reduce((sum, person) => sum + person.value, 0),
      people: sorted,
      topPeople: sorted.slice(0, 8),
    };
  });

  const allPeople = new Set();
  let totalAssignments = 0;
  const coveredProjects = new Set();
  for (const role of roles) {
    role.people.forEach((person) => allPeople.add(person.identityId || person.name));
    totalAssignments += role.totalAssignments;
  }
  rows.forEach((row) => {
    if (metricsSlotKeys.includes(row.slot_key)) {
      coveredProjects.add(row.project_id);
    }
  });

  return {
    summary: {
      roleCount: roles.length,
      uniquePeople: allPeople.size,
      coveredProjects: coveredProjects.size,
      totalAssignments,
    },
    roles,
    designerRoles: buildDesignerRoleStatsFromResponsibilityRows(rows, architecture),
    routingReview: {
      pendingReview: [],
      inferenceCandidates: [],
      anomalies: [],
      summary: { pendingReview: 0, inferenceCandidates: 0, anomalies: 0 },
    },
  };
}

export function listProjectsForOwnerSlot(database, owner, dashboardContext = 'all', personnelArchitecture = {}) {
  const architecture = normalizeArchitecture(personnelArchitecture);
  const ownerIdentity = findResponsibilityIdentity(owner, architecture);
  const ownerNames = expandOwnerNames(ownerIdentity?.sourceName || owner, architecture);
  const nameList = Array.from(ownerNames);
  const slotKeys = ownerIdentity ? responsibilityIdentitySlotKeys(ownerIdentity) : ['owner'];
  const namePlaceholders = nameList.map(() => '?').join(', ');
  const slotPlaceholders = slotKeys.map(() => '?').join(', ');
  const rows = database
    .prepare(
      `select distinct p.*
       from projects p
       inner join project_responsibilities pr on pr.project_id = p.id
       where p.archived_at is null
         and pr.slot_key in (${slotPlaceholders})
         and pr.person_name in (${namePlaceholders})`
    )
    .all(...slotKeys, ...nameList);

  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      raw_fields_json: row.raw_fields_json,
      store_status: row.store_status,
      owner_text: row.owner_text,
      status: row.status,
      due_date: row.due_date,
      risk_level: row.risk_level,
      progress: row.progress,
      start_date: row.start_date,
      source_updated_at: row.source_updated_at,
    }))
    .filter((row) => {
      if (dashboardContext === 'all') {
        return true;
      }
      const project = {
        rawFields: JSON.parse(row.raw_fields_json || '{}'),
        storeStatus: row.store_status,
      };
      return matchesDashboardContextFromRow(project, dashboardContext);
    });
}

function matchesDashboardContextFromRow(project, context) {
  const group = project.rawFields?.['组别']?.display || '';
  if (context === 'franchise') {
    return /加盟/.test(group);
  }
  if (context === 'direct') {
    return /直营/.test(group);
  }
  return true;
}
