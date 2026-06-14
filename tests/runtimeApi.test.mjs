import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../src/backend/server.mjs';
import { READ_MODEL_SCHEMA_VERSION } from '../src/backend/readModelRepository.mjs';

const rootDir = process.cwd();

function testConfig(tempDir) {
  return {
    port: 0,
    host: '127.0.0.1',
    mode: 'empty',
    dataDir: tempDir,
    publicDir: join(rootDir, 'public'),
    cacheFile: join(tempDir, 'dashboard-cache.json'),
    databaseFile: '',
    personnelDatabaseFile: join(tempDir, 'personnel-database.json'),
    precomputeDir: join(tempDir, 'precomputed'),
    readModelDir: join(tempDir, 'read-model'),
    dashboardAutoUpdateEnabled: false,
    dashboardSyncEnabled: false,
    devReloadEnabled: false,
    precomputeEnabled: false,
    syncState: { lastSyncAt: 0 },
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('runtime endpoint exposes non-sensitive process identity and stable startedAt', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'yeswood-runtime-api-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));

  const server = createServer(testConfig(tempDir));
  const port = await listen(server);
  t.after(() => close(server));

  const [first, second] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/runtime`).then((response) => response.json()),
    fetch(`http://127.0.0.1:${port}/api/runtime`).then((response) => response.json()),
  ]);

  assert.equal(first.app, 'yeswood-dashboard');
  assert.equal(first.pid, process.pid);
  assert.equal(first.port, port);
  assert.equal(first.host, '127.0.0.1');
  assert.equal(first.cwd, rootDir);
  assert.match(first.entry, /src[\\/]backend[\\/]server\.mjs$/);
  assert.equal(first.startedAt, second.startedAt);
  assert.match(first.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(first.uptimeMs >= 0);
  assert.equal(first.nodeVersion, process.version);
  assert.equal(first.precomputeActive, false);
  assert.ok(first.readModel);
  assert.match(first.readModel.status, /missing|incomplete|ready|schema-mismatch/);
  assert.equal(first.readModel.gzipSidecars.skipped, true);
  assert.equal(Object.hasOwn(first, 'env'), false);
});

function requestRaw(port, requestPath, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method: 'GET',
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

test('runtime endpoint remains plain JSON for PowerShell service checks', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'yeswood-runtime-plain-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));

  const currentReadModelDir = join(tempDir, 'read-model', 'current');
  await mkdir(currentReadModelDir, { recursive: true });
  await writeFile(
    join(currentReadModelDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: READ_MODEL_SCHEMA_VERSION,
      readModel: true,
      snapshotHash: 'runtime-large',
      generatedAt: '2026-06-14T00:00:00.000Z',
      features: ['dashboard-session'],
      years: Array.from({ length: 80 }, (_, index) => 2000 + index),
      excludedYears: Array.from({ length: 80 }, (_, index) => ({ year: 2101 + index, reason: 'diagnostic' })),
    }),
    'utf8'
  );

  const server = createServer(testConfig(tempDir));
  const port = await listen(server);
  t.after(() => close(server));

  const payload = await requestRaw(port, '/api/runtime', {
    headers: { 'accept-encoding': 'gzip' },
  });

  assert.equal(payload.status, 200);
  assert.equal(payload.headers['content-encoding'], undefined);
  assert.equal(JSON.parse(payload.body.toString('utf8')).app, 'yeswood-dashboard');
});

test('direct server startup refuses to shadow an active registered service', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'yeswood-runtime-guard-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  const statePath = join(tempDir, 'dashboard-service.json');
  await writeFile(
    statePath,
    JSON.stringify(
      {
        app: 'yeswood-dashboard',
        root: rootDir,
        pid: process.pid,
        port: 4200,
        host: '127.0.0.1',
        url: 'http://localhost:4200/',
      },
      null,
      2
    )
  );

  const child = spawn(process.execPath, [join(rootDir, 'src', 'backend', 'server.mjs')], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      DASHBOARD_DEV_RELOAD: '0',
      YESWOOD_SERVICE_STATE_FILE: statePath,
    },
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  const result = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ timedOut: true, code: null });
    }, 2_500);
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ timedOut: false, code });
    });
  });

  assert.equal(result.timedOut, false, 'server should exit instead of continuing as a second instance');
  assert.notEqual(result.code, 0);
  assert.match(stderr, /dashboard-service\.json|active yeswood dashboard service/i);

  const allowed = spawn(process.execPath, [join(rootDir, 'src', 'backend', 'server.mjs')], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      DASHBOARD_DEV_RELOAD: '0',
      YESWOOD_SERVICE_STATE_FILE: statePath,
      YESWOOD_ALLOW_MULTIPLE: '1',
    },
    windowsHide: true,
  });
  t.after(() => allowed.kill('SIGTERM'));
  const allowedOutput = await new Promise((resolve) => {
    let stderrText = '';
    allowed.stderr.on('data', (chunk) => {
      stderrText += String(chunk);
    });
    const timeout = setTimeout(() => {
      resolve({ exited: false, stderr: stderrText });
    }, 1_000);
    allowed.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ exited: true, code, stderr: stderrText });
    });
  });

  assert.equal(allowedOutput.exited, false, allowedOutput.stderr);
});
