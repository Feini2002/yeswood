import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { splitPersonnelNames } from './personnelNames.mjs';
import { PROJECT_DIFFICULTY_RULES } from './projectDifficulty.mjs';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  source_records INTEGER NOT NULL DEFAULT 0,
  imported_records INTEGER NOT NULL DEFAULT 0,
  ignored_records INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT
);

CREATE TABLE IF NOT EXISTS agent_analysis_runs (
  run_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL DEFAULT '',
  dashboard_context TEXT NOT NULL DEFAULT 'all',
  generated_at TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  input_snapshot_hash TEXT NOT NULL DEFAULT '',
  input_snapshot_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'manual_agent',
  model_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_owner_context ON agent_analysis_runs(owner, dashboard_context, generated_at);

CREATE TABLE IF NOT EXISTS agent_risk_items (
  risk_item_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '',
  dashboard_context TEXT NOT NULL DEFAULT 'all',
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  impact_count INTEGER NOT NULL DEFAULT 0,
  reasoning TEXT NOT NULL DEFAULT '',
  recommended_action TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  related_project_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  closed_at TEXT,
  close_reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (run_id) REFERENCES agent_analysis_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_risk_items_run ON agent_risk_items(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_risk_items_dedupe ON agent_risk_items(owner, dashboard_context, dedupe_key, last_seen_at);

CREATE TABLE IF NOT EXISTS dingtalk_raw_records (
  id TEXT PRIMARY KEY,
  sync_run_id TEXT NOT NULL,
  dingtalk_record_id TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  raw_fields_json TEXT NOT NULL,
  field_hash TEXT NOT NULL,
  source_created_time TEXT,
  source_modified_time TEXT,
  imported_at TEXT NOT NULL,
  FOREIGN KEY (sync_run_id) REFERENCES sync_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_raw_records_record_id ON dingtalk_raw_records(dingtalk_record_id);
CREATE INDEX IF NOT EXISTS idx_raw_records_sync_run ON dingtalk_raw_records(sync_run_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  dingtalk_record_id TEXT UNIQUE,
  raw_fields_json TEXT NOT NULL DEFAULT '{}',
  name TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT '',
  business_type TEXT NOT NULL DEFAULT '',
  store_status TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  owner_text TEXT NOT NULL DEFAULT '',
  cd_owner_text TEXT NOT NULL DEFAULT '',
  vm_owner_text TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0,
  hard_progress_stage TEXT NOT NULL DEFAULT '',
  soft_progress_stage TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT '',
  risk_notes TEXT NOT NULL DEFAULT '',
  difficulty_score REAL NOT NULL DEFAULT 0,
  difficulty_level TEXT NOT NULL DEFAULT '',
  difficulty_weight REAL NOT NULL DEFAULT 0,
  difficulty_workdays REAL NOT NULL DEFAULT 0,
  difficulty_rule_key TEXT NOT NULL DEFAULT '',
  difficulty_json TEXT NOT NULL DEFAULT '{}',
  local_notes TEXT NOT NULL DEFAULT '',
  source_updated_at TEXT NOT NULL DEFAULT '',
  local_updated_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS project_field_overrides (
  project_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  local_value_json TEXT NOT NULL,
  source_value_json TEXT,
  value_type TEXT NOT NULL DEFAULT 'string',
  reason TEXT NOT NULL DEFAULT '',
  edited_by TEXT NOT NULL DEFAULT 'local-admin',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, field_key),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS source_differences (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  source_value_json TEXT NOT NULL,
  local_value_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  detected_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_source_differences_project ON source_differences(project_id);

CREATE TABLE IF NOT EXISTS project_change_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT NOT NULL,
  change_type TEXT NOT NULL,
  changed_by TEXT NOT NULL DEFAULT 'system',
  changed_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_change_logs_project ON project_change_logs(project_id);

CREATE TABLE IF NOT EXISTS project_difficulty_rules (
  rule_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  scope TEXT NOT NULL,
  discipline TEXT NOT NULL,
  store_tier TEXT NOT NULL,
  benchmark_area REAL NOT NULL,
  base_workdays REAL NOT NULL,
  monthly_capacity REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_aliases (
  source_field_key TEXT PRIMARY KEY,
  display_label TEXT NOT NULL,
  field_group TEXT NOT NULL DEFAULT '',
  is_core INTEGER NOT NULL DEFAULT 0,
  is_visible_default INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_source_bindings (
  canonical_key TEXT NOT NULL,
  source_field_key TEXT NOT NULL,
  match_method TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (canonical_key, source_field_key)
);

CREATE INDEX IF NOT EXISTS idx_field_source_bindings_canonical ON field_source_bindings(canonical_key);

CREATE TABLE IF NOT EXISTS personnel_people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT 'member',
  discipline TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'local',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  assignment_note TEXT NOT NULL DEFAULT '',
  source_field TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personnel_role_members (
  role_key TEXT NOT NULL,
  person_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (role_key, person_name),
  FOREIGN KEY (person_name) REFERENCES personnel_people(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS personnel_teams (
  id TEXT PRIMARY KEY,
  owner_name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_name) REFERENCES personnel_people(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS personnel_team_members (
  team_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  role_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, person_name, role_key),
  FOREIGN KEY (team_id) REFERENCES personnel_teams(id) ON DELETE CASCADE,
  FOREIGN KEY (person_name) REFERENCES personnel_people(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS responsibility_slots (
  slot_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  dingtalk_fields_json TEXT NOT NULL DEFAULT '[]',
  discipline TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_responsibilities (
  project_id TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  person_name TEXT NOT NULL,
  person_name_raw TEXT NOT NULL DEFAULT '',
  assignment_index INTEGER NOT NULL DEFAULT 0,
  sync_run_id TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  PRIMARY KEY (project_id, slot_key, person_name),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pr_slot_person ON project_responsibilities(slot_key, person_name);
CREATE INDEX IF NOT EXISTS idx_pr_project ON project_responsibilities(project_id);
`;

const CD_OWNER_FIELD_NAMES = ['CD负责人', '硬装负责人'];
const VM_OWNER_FIELD_NAMES = ['VM负责人', '软装负责人'];
const HARD_PROGRESS_STAGE_FIELD_NAMES = ['硬装项目进度', '硬装进度'];
const SOFT_PROGRESS_STAGE_FIELD_NAMES = ['软装项目进度', '软装进度'];

export function openDatabase(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  return database;
}

export function initializeDatabase(database) {
  database.exec(SCHEMA_SQL);
  ensureProjectOwnerColumns(database);
  ensureProjectProgressStageColumns(database);
  ensureProjectDifficultyColumns(database);
  database
    .prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
       VALUES (?, ?, ?)`
    )
    .run(1, 'initial-sqlite-master-data-schema', new Date().toISOString());
  database
    .prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
       VALUES (?, ?, ?)`
    )
    .run(2, 'field-source-bindings', new Date().toISOString());
  database
    .prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
       VALUES (?, ?, ?)`
    )
    .run(3, 'project-responsibilities', new Date().toISOString());
  database
    .prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
       VALUES (?, ?, ?)`
    )
    .run(4, 'project-difficulty-scoring', new Date().toISOString());
  database
    .prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
       VALUES (?, ?, ?)`
    )
    .run(5, 'split-project-owner-columns', new Date().toISOString());
  database
    .prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
       VALUES (?, ?, ?)`
    )
    .run(6, 'agent-risk-health-analysis', new Date().toISOString());
  seedResponsibilitySlotsIfEmpty(database);
  seedProjectDifficultyRules(database);
  return database;
}

function existingColumns(database, tableName) {
  return new Set(database.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
}

function parseRawFields(value) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function ownerTextFromRawFields(rawFields, fieldNames) {
  const names = new Set();
  for (const fieldName of fieldNames) {
    const display = rawFields?.[fieldName]?.display;
    for (const name of splitPersonnelNames(display)) {
      names.add(name);
    }
  }
  return Array.from(names).join('、');
}

function fieldTextFromRawFields(rawFields, fieldNames) {
  for (const fieldName of fieldNames) {
    const display = rawFields?.[fieldName]?.display;
    if (display) {
      return String(display).trim();
    }
  }
  return '';
}

function backfillProjectOwnerColumns(database) {
  const columns = existingColumns(database, 'projects');
  if (!columns.has('cd_owner_text') || !columns.has('vm_owner_text')) {
    return;
  }

  const rows = database
    .prepare('select id, raw_fields_json, cd_owner_text, vm_owner_text from projects')
    .all();
  if (!rows.length) {
    return;
  }

  const update = database.prepare('update projects set cd_owner_text = ?, vm_owner_text = ? where id = ?');
  for (const row of rows) {
    const rawFields = parseRawFields(row.raw_fields_json);
    const cdOwnerText = ownerTextFromRawFields(rawFields, CD_OWNER_FIELD_NAMES);
    const vmOwnerText = ownerTextFromRawFields(rawFields, VM_OWNER_FIELD_NAMES);
    if (row.cd_owner_text !== cdOwnerText || row.vm_owner_text !== vmOwnerText) {
      update.run(cdOwnerText, vmOwnerText, row.id);
    }
  }
}

function ensureProjectOwnerColumns(database) {
  const columns = existingColumns(database, 'projects');
  const required = [
    ['cd_owner_text', "TEXT NOT NULL DEFAULT ''"],
    ['vm_owner_text', "TEXT NOT NULL DEFAULT ''"],
  ];

  for (const [column, definition] of required) {
    if (!columns.has(column)) {
      database.exec(`ALTER TABLE projects ADD COLUMN ${column} ${definition}`);
    }
  }

  backfillProjectOwnerColumns(database);
}

function backfillProjectProgressStageColumns(database) {
  const columns = existingColumns(database, 'projects');
  if (!columns.has('hard_progress_stage') || !columns.has('soft_progress_stage')) {
    return;
  }

  const rows = database
    .prepare('select id, raw_fields_json, hard_progress_stage, soft_progress_stage from projects')
    .all();
  if (!rows.length) {
    return;
  }

  const update = database.prepare('update projects set hard_progress_stage = ?, soft_progress_stage = ? where id = ?');
  for (const row of rows) {
    const rawFields = parseRawFields(row.raw_fields_json);
    const hardProgressStage = fieldTextFromRawFields(rawFields, HARD_PROGRESS_STAGE_FIELD_NAMES);
    const softProgressStage = fieldTextFromRawFields(rawFields, SOFT_PROGRESS_STAGE_FIELD_NAMES);
    if (row.hard_progress_stage !== hardProgressStage || row.soft_progress_stage !== softProgressStage) {
      update.run(hardProgressStage, softProgressStage, row.id);
    }
  }
}

function ensureProjectProgressStageColumns(database) {
  const columns = existingColumns(database, 'projects');
  const required = [
    ['hard_progress_stage', "TEXT NOT NULL DEFAULT ''"],
    ['soft_progress_stage', "TEXT NOT NULL DEFAULT ''"],
  ];

  for (const [column, definition] of required) {
    if (!columns.has(column)) {
      database.exec(`ALTER TABLE projects ADD COLUMN ${column} ${definition}`);
    }
  }

  backfillProjectProgressStageColumns(database);
}

function ensureProjectDifficultyColumns(database) {
  const columns = existingColumns(database, 'projects');
  const required = [
    ['difficulty_score', 'REAL NOT NULL DEFAULT 0'],
    ['difficulty_level', "TEXT NOT NULL DEFAULT ''"],
    ['difficulty_weight', 'REAL NOT NULL DEFAULT 0'],
    ['difficulty_workdays', 'REAL NOT NULL DEFAULT 0'],
    ['difficulty_rule_key', "TEXT NOT NULL DEFAULT ''"],
    ['difficulty_json', "TEXT NOT NULL DEFAULT '{}'"],
  ];

  for (const [column, definition] of required) {
    if (!columns.has(column)) {
      database.exec(`ALTER TABLE projects ADD COLUMN ${column} ${definition}`);
    }
  }
}

function seedProjectDifficultyRules(database) {
  const updatedAt = new Date().toISOString();
  const statement = database.prepare(
    `insert into project_difficulty_rules
      (rule_key, label, scope, discipline, store_tier, benchmark_area, base_workdays, monthly_capacity, sort_order, notes, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(rule_key) do update set
       label = excluded.label,
       scope = excluded.scope,
       discipline = excluded.discipline,
       store_tier = excluded.store_tier,
       benchmark_area = excluded.benchmark_area,
       base_workdays = excluded.base_workdays,
       monthly_capacity = excluded.monthly_capacity,
       sort_order = excluded.sort_order,
       notes = excluded.notes,
       updated_at = excluded.updated_at`
  );

  for (const rule of PROJECT_DIFFICULTY_RULES) {
    statement.run(
      rule.ruleKey,
      rule.label,
      rule.scope,
      rule.discipline,
      rule.storeTier,
      rule.benchmarkArea,
      rule.baseWorkdays,
      rule.monthlyCapacity,
      rule.sortOrder,
      rule.notes,
      updatedAt
    );
  }
}

function seedResponsibilitySlotsIfEmpty(database) {
  const slots = [
    ['owner', '负责人', '["负责人"]', '', 0],
    ['cd_owner', '硬装负责人', '["CD负责人","硬装负责人"]', 'hard', 1],
    ['vm_owner', '软装负责人', '["VM负责人","软装负责人"]', 'soft', 2],
    ['cd_lead', '硬装组长', '["CD组长"]', 'hard', 3],
    ['vm_lead', '软装组长', '["VM组长"]', 'soft', 4],
    ['cd_designer', '硬装设计师', '["CD设计师"]', 'hard', 5],
    ['vm_designer', '软装设计师', '["VM设计师"]', 'soft', 6],
    ['point_designer', '点位设计师', '["点位设计师"]', 'soft', 7],
    ['display_designer', '摆场设计师', '["摆场设计师"]', '', 8],
  ];
  const statement = database.prepare(
    `insert into responsibility_slots (slot_key, label, dingtalk_fields_json, discipline, sort_order)
     values (?, ?, ?, ?, ?)`
      + ` on conflict(slot_key) do update set
          label = excluded.label,
          dingtalk_fields_json = excluded.dingtalk_fields_json,
          discipline = excluded.discipline,
          sort_order = excluded.sort_order`
  );
  for (const row of slots) {
    statement.run(...row);
  }
}

export function openInitializedDatabase(filePath) {
  return initializeDatabase(openDatabase(filePath));
}
