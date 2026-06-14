import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createServer } from '../src/backend/server.mjs';
import { syncProjects } from '../src/backend/syncService.mjs';

async function withBootServer(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-boot-warmup-'));
  let fullPrecomputeSchedules = 0;
  const config = {
    port: 0,
    mode: 'mock',
    cacheFile: path.join(tempDir, 'dashboard-cache.json'),
    precomputeDir: path.join(tempDir, 'precomputed'),
    readModelDir: path.join(tempDir, 'read-model'),
    syncApiKey: 'server-only-secret',
    syncMinIntervalMs: 0,
    dashboardSyncEnabled: false,
    databaseFile: '',
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
    precomputeScheduler() {
      fullPrecomputeSchedules += 1;
    },
  };
  await syncProjects({
    config: {
      ...config,
      precomputeEnabled: false,
      precomputeScheduler: undefined,
    },
    source: 'mock',
  });

  const server = createServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(port, config, () => fullPrecomputeSchedules);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
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

test('/api/dashboard-warmup?scope=boot publishes only the dashboard shell read model', async () => {
  await withBootServer(async (port, config, fullPrecomputeSchedules) => {
    const warmup = await getJson(port, '/api/dashboard-warmup?scope=boot');

    assert.equal(warmup.status, 200);
    assert.equal(warmup.body.ok, true);
    assert.equal(warmup.body.scope, 'boot');
    assert.deepEqual(warmup.body.features, ['dashboard-session']);
    assert.equal(fullPrecomputeSchedules(), 0);

    const manifest = JSON.parse(
      await fs.readFile(path.join(config.readModelDir, 'current', 'manifest.json'), 'utf8')
    );
    assert.deepEqual(manifest.features, ['dashboard-session']);
    await assert.rejects(
      () => fs.access(path.join(config.readModelDir, 'current', 'team-work-completion-summary')),
      /ENOENT/
    );
  });
});

test('/api/dashboard-session shell miss repairs boot shell without scheduling full precompute', async () => {
  await withBootServer(async (port, config, fullPrecomputeSchedules) => {
    const payload = await getJson(port, '/api/dashboard-session?context=direct&year=2026');

    assert.equal(payload.status, 200);
    assert.equal(payload.body.shellOnly, true);
    assert.equal(payload.body.readModel, true);
    assert.deepEqual(payload.body.features, ['dashboard-session']);
    assert.equal(fullPrecomputeSchedules(), 0);

    const manifest = JSON.parse(
      await fs.readFile(path.join(config.readModelDir, 'current', 'manifest.json'), 'utf8')
    );
    assert.deepEqual(manifest.features, ['dashboard-session']);
  });
});
