import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createServer } from '../src/backend/server.mjs';
import { READ_MODEL_SCHEMA_VERSION } from '../src/backend/readModelRepository.mjs';

function hashToken(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16);
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${pathname}`, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, body: JSON.parse(body) });
          } catch {
            resolve({ status: response.statusCode, body });
          }
        });
      })
      .on('error', reject);
  });
}

async function withProjectDetailServer(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-detail-api-'));
  const readModelDir = path.join(tempDir, 'read-model');
  const currentDir = path.join(readModelDir, 'current');
  await writeJson(path.join(currentDir, 'manifest.json'), {
    schemaVersion: READ_MODEL_SCHEMA_VERSION,
    readModel: true,
    snapshotHash: 'hash-1',
    generatedAt: '2026-06-11T08:00:00.000Z',
    features: [
      'dashboard-session',
      'project-catalog-summary',
      'project-detail',
      'profile-dashboard',
      'team-metrics',
      'team-work-completion',
      'team-work-completion-summary',
      'team-work-completion-detail',
      'team-responsibility-review',
    ],
  });
  await writeJson(path.join(currentDir, 'project-detail', 'index.json'), {
    projectIds: ['p1', 'p2'],
    total: 2,
    readOnly: true,
  });
  await writeJson(path.join(currentDir, 'project-detail', `${hashToken('p1')}.json`), {
    id: 'p1',
    name: 'Project One',
    province: 'Zhejiang',
    rawFields: { usefulNote: { display: 'Ready for detail', kind: 'text' } },
    readOnly: true,
  });

  const server = createServer({
    port: 0,
    mode: 'empty',
    readModelDir,
    precomputeEnabled: false,
    cacheFile: path.join(tempDir, 'missing-dashboard-cache.json'),
    syncApiKey: 'server-only-secret',
    dashboardSyncEnabled: false,
    databaseFile: '',
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('/api/projects full readModel fallback returns ready, preparing, and missing states quickly', async () => {
  await withProjectDetailServer(async (port) => {
    const ready = await getJson(port, '/api/projects?id=p1&view=full&fallback=readModel');
    const preparing = await getJson(port, '/api/projects?id=p2&view=full&fallback=readModel');
    const missing = await getJson(port, '/api/projects?id=missing&view=full&fallback=readModel');

    assert.equal(ready.status, 200);
    assert.equal(ready.body.item.name, 'Project One');
    assert.equal(ready.body.readModel, true);
    assert.equal(preparing.status, 202);
    assert.equal(preparing.body.status, 'preparing');
    assert.equal(missing.status, 404);
  });
});
