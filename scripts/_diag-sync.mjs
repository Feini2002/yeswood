import { readSnapshot } from '../src/backend/storage.mjs';
import { classifyProjectRecord } from '../src/backend/projectData.mjs';
import { getConfig } from '../src/backend/config.mjs';
import { openInitializedDatabase } from '../src/backend/database.mjs';

const config = getConfig();
const snap = await readSnapshot(config.cacheFile);
console.log('cache:', {
  total: snap?.totalRecords,
  ignored: snap?.ignoredRecords,
  source: snap?.sourceRecords,
  sourceMode: snap?.source,
});

const db = openInitializedDatabase(config.databaseFile);
try {
  const row = db.prepare('SELECT raw_json FROM dingtalk_raw_records LIMIT 1').get();
  if (!row) {
    console.log('no raw records in sqlite');
    process.exit(0);
  }
  const rec = JSON.parse(row.raw_json);
  const fields = rec.fields || rec.rawFields || rec;
  const keys = Object.keys(fields).slice(0, 25);
  console.log('sample field keys:', keys);
  console.log('classify:', classifyProjectRecord(rec, { fieldMap: config.dingtalk.fieldMap }));

  const reasons = {};
  const rows = db.prepare('SELECT raw_json FROM dingtalk_raw_records LIMIT 20').all();
  for (const r of rows) {
    const item = JSON.parse(r.raw_json);
    const c = classifyProjectRecord(item, { fieldMap: config.dingtalk.fieldMap });
    reasons[c.reason] = (reasons[c.reason] || 0) + 1;
  }
  console.log('reasons (first 20):', reasons);
} finally {
  db.close();
}
