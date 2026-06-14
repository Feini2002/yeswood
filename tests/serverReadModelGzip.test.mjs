import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

import { precomputeTeamDashboards } from '../src/backend/precomputeTeamDashboards.mjs';
import { currentReadModelDir, READ_MODEL_SCHEMA_VERSION } from '../src/backend/readModelRepository.mjs';
import { createServer } from '../src/backend/server.mjs';
import { syncProjects } from '../src/backend/syncService.mjs';

async function buildPrecomputedReadModel() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'server-read-model-gzip-'));
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
    today: '2026-06-11',
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
  };
  const snapshot = await syncProjects({
    config: {
      ...config,
      precomputeEnabled: false,
    },
    source: 'mock',
  });
  await precomputeTeamDashboards(snapshot, {
    config,
    contexts: ['all'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });
  return { config, tempDir, snapshot };
}

async function withServer(config, run) {
  const server = createServer(config);
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

function requestRaw(port, requestPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    request.on('error', reject);
    request.end();
  });
}

test('precompute writes gzip sidecars beside read model json files', async () => {
  const { config } = await buildPrecomputedReadModel();
  const corePath = path.join(currentReadModelDir(config), 'dashboard-session', 'core.json');
  const gzipPath = `${corePath}.gz`;

  const [plain, compressed] = await Promise.all([fs.readFile(corePath, 'utf8'), fs.readFile(gzipPath)]);
  assert.equal(gunzipSync(compressed).toString('utf8'), plain);
});

test('dashboard-session shell applies runtime flags instead of stale static shell flags', async () => {
  const { config } = await buildPrecomputedReadModel();
  const shellPath = path.join(currentReadModelDir(config), 'dashboard-session', 'shell.json');
  const staticShell = JSON.parse(await fs.readFile(shellPath, 'utf8'));
  assert.equal(staticShell.snapshot.developerDocumentationVisible, false);
  assert.equal(staticShell.snapshot.dashboardDisplayMode, 'intranet');

  await withServer(config, async (port) => {
    const payload = await requestRaw(port, '/api/dashboard-session?context=all&year=2026', {
      headers: { 'accept-encoding': 'gzip' },
    });

    assert.equal(payload.status, 200);
    assert.equal(payload.headers['content-encoding'], 'gzip');
    assert.equal(payload.headers['x-read-model-transport'], undefined);
    const body = JSON.parse(gunzipSync(payload.body).toString('utf8'));
    assert.equal(body.schemaVersion, READ_MODEL_SCHEMA_VERSION);
    assert.equal(body.shellOnly, true);
    assert.equal(body.snapshot.developerDocumentationVisible, true);
    assert.equal(body.snapshot.dashboardDisplayMode, 'development');

    const head = await requestRaw(port, '/api/dashboard-session?context=all&year=2026', {
      method: 'HEAD',
      headers: { 'accept-encoding': 'gzip' },
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-encoding'], 'gzip');
    assert.equal(head.headers['x-read-model-transport'], undefined);
    assert.equal(head.body.length, 0);
    assert.equal(payload.headers.etag, undefined);
  });
});

test('large owner dashboard-session payloads skip dynamic gzip instead of stalling startup interactions', async () => {
  const { config } = await buildPrecomputedReadModel();
  const manifest = JSON.parse(await fs.readFile(path.join(currentReadModelDir(config), 'manifest.json'), 'utf8'));
  const owner = manifest.owners?.[0]?.owner || '';
  assert.ok(owner, 'precomputed read model should include at least one owner');

  await withServer(config, async (port) => {
    const payload = await requestRaw(
      port,
      `/api/dashboard-session?owner=${encodeURIComponent(owner)}&context=all&year=2026`,
      {
        headers: { 'accept-encoding': 'gzip' },
      }
    );

    assert.equal(payload.status, 200);
    assert.equal(payload.headers['content-encoding'], undefined);
    assert.equal(payload.headers['x-dashboard-gzip-skipped'], 'dynamic-payload-too-large');
    assert.match(payload.headers['x-dashboard-payload-kb'] || '', /^\d/);
    const body = JSON.parse(payload.body.toString('utf8'));
    assert.equal(body.readModel, true);
    assert.equal(body.team.owner, owner);
  });
});

test('read-model status reports current manifest and gzip sidecar coverage', async () => {
  const { config } = await buildPrecomputedReadModel();

  await withServer(config, async (port) => {
    const payload = await requestRaw(port, '/api/read-model/status');

    assert.equal(payload.status, 200);
    const body = JSON.parse(payload.body.toString('utf8'));
    assert.equal(body.readModel, true);
    assert.equal(body.status, 'ready');
    assert.equal(body.current.schemaVersion, READ_MODEL_SCHEMA_VERSION);
    assert.equal(body.current.snapshotHash.length > 0, true);
    assert.equal(body.gzipSidecars.missing, 0);
    assert.equal(body.gzipSidecars.jsonFiles, body.gzipSidecars.gzipFiles);
  });
});
