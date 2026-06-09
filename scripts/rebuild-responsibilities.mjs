#!/usr/bin/env node
import { getConfig } from '../src/backend/config.mjs';
import { openInitializedDatabase } from '../src/backend/database.mjs';
import { readSnapshotFromDatabase } from '../src/backend/projectRepository.mjs';
import { rebuildProjectResponsibilities } from '../src/backend/responsibilityRepository.mjs';

const config = getConfig();
if (!config.databaseFile) {
  console.error('DATABASE_FILE not configured');
  process.exit(1);
}

const database = openInitializedDatabase(config.databaseFile);
try {
  const snapshot = readSnapshotFromDatabase(database, {});
  const runId = `rebuild-${new Date().toISOString()}`;
  const result = rebuildProjectResponsibilities(database, snapshot.projects || [], runId);
  console.log(JSON.stringify(result, null, 2));
} finally {
  database.close();
}
