import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { openInitializedDatabase } from '../src/backend/database.mjs';
import { readCachedFieldBindings, saveFieldBindings } from '../src/backend/fieldBindingRepository.mjs';

test('saveFieldBindings persists and upserts canonical field bindings', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-field-bindings-'));
  const databaseFile = path.join(tempDir, 'app.sqlite');
  const database = openInitializedDatabase(databaseFile);

  saveFieldBindings(database, [
    {
      canonicalKey: 'name',
      sourceFieldKey: '项目名称（不要自己添加/删除任何项目）',
      matchMethod: 'prefix',
      confidence: 0.95,
    },
  ]);

  saveFieldBindings(database, [
    {
      canonicalKey: 'name',
      sourceFieldKey: '项目名称（不要自己添加/删除任何项目）',
      matchMethod: 'cache',
      confidence: 1,
    },
  ]);

  const bindings = readCachedFieldBindings(database);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].canonicalKey, 'name');
  assert.equal(bindings[0].sourceFieldKey, '项目名称（不要自己添加/删除任何项目）');
  assert.equal(bindings[0].matchMethod, 'cache');
  assert.equal(bindings[0].confidence, 1);

  database.close();
});
