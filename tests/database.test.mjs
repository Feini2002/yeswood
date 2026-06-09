import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeDatabase, openInitializedDatabase } from '../src/backend/database.mjs';

test('initializeDatabase creates the SQLite master-data schema idempotently', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-sqlite-schema-'));
  const databaseFile = path.join(tempDir, 'app.sqlite');
  const db = openInitializedDatabase(databaseFile);

  initializeDatabase(db);

  const tables = db
    .prepare("select name from sqlite_master where type = 'table' order by name")
    .all()
    .map((row) => row.name);

  assert.deepEqual(
    tables.filter((name) => !name.startsWith('sqlite_')),
    [
      'agent_analysis_runs',
      'agent_risk_items',
      'dingtalk_raw_records',
      'field_aliases',
      'field_source_bindings',
      'personnel_people',
      'personnel_role_members',
      'personnel_team_members',
      'personnel_teams',
      'project_change_logs',
      'project_difficulty_rules',
      'project_field_overrides',
      'project_responsibilities',
      'projects',
      'responsibility_slots',
      'schema_migrations',
      'source_differences',
      'sync_runs',
    ]
  );

  assert.equal(db.prepare('select count(*) as count from schema_migrations').get().count, 6);
  const projectColumns = db
    .prepare('pragma table_info(projects)')
    .all()
    .map((row) => row.name);
  assert.ok(projectColumns.includes('cd_owner_text'));
  assert.ok(projectColumns.includes('vm_owner_text'));
  assert.equal(db.prepare('select count(*) as count from project_difficulty_rules').get().count >= 13, true);
  assert.equal(db.prepare("select discipline from responsibility_slots where slot_key = 'point_designer'").get().discipline, 'soft');
  assert.equal(db.prepare("select discipline from responsibility_slots where slot_key = 'display_designer'").get().discipline, '');
  db.close();
});

test('openInitializedDatabase waits briefly for SQLite locks before failing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-sqlite-timeout-'));
  const databaseFile = path.join(tempDir, 'app.sqlite');
  const db = openInitializedDatabase(databaseFile);

  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout >= 5000, true);
  db.close();
});
