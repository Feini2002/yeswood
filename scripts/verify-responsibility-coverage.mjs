#!/usr/bin/env node
import { getConfig } from '../src/backend/config.mjs';
import { openInitializedDatabase } from '../src/backend/database.mjs';
import { readSnapshotFromDatabase } from '../src/backend/projectRepository.mjs';
import { verifyResponsibilityCoverage } from '../src/backend/responsibilityRepository.mjs';

const config = getConfig();
if (!config.databaseFile) {
  console.error('DATABASE_FILE not configured');
  process.exit(1);
}

const database = openInitializedDatabase(config.databaseFile);
try {
  const snapshot = readSnapshotFromDatabase(database, {});
  const report = verifyResponsibilityCoverage(snapshot.projects || []);
  console.log(JSON.stringify(report, null, 2));
  if (report.issues.length > 0) {
    process.exitCode = 1;
  }
} finally {
  database.close();
}
