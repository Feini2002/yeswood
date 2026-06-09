import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readSnapshot, writeSnapshot } from '../src/backend/storage.mjs';

test('writeSnapshot falls back to copy and unlink when rename is denied', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'readonly-dashboard-'));
  const cacheFile = path.join(tempDir, 'snapshot.json');
  const calls = [];

  const rename = async () => {
    calls.push('rename');
    const error = new Error('denied');
    error.code = 'EPERM';
    throw error;
  };

  await writeSnapshot(cacheFile, { ok: true }, { rename });

  assert.deepEqual(await readSnapshot(cacheFile), { ok: true });
  assert.deepEqual(calls, ['rename']);
  await assert.rejects(() => fs.stat(`${cacheFile}.tmp`), /ENOENT/);
});

test('writeSnapshot keeps the copied snapshot when temporary cleanup is denied', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'readonly-dashboard-'));
  const cacheFile = path.join(tempDir, 'snapshot.json');

  const rename = async () => {
    const error = new Error('denied');
    error.code = 'EPERM';
    throw error;
  };
  const unlink = async () => {
    const error = new Error('cleanup denied');
    error.code = 'EPERM';
    throw error;
  };

  await writeSnapshot(cacheFile, { copied: true }, { rename, unlink });

  assert.deepEqual(await readSnapshot(cacheFile), { copied: true });
});
