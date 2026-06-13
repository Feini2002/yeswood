import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createServer } from '../src/backend/server.mjs';
import { precomputeSnapshotHash, precomputeTeamDashboards } from '../src/backend/precomputeTeamDashboards.mjs';
import { READ_MODEL_SCHEMA_VERSION } from '../src/backend/readModelRepository.mjs';

function hashToken(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16);
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

async function waitForFile(filePath, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assert.fail(`Timed out waiting for file: ${filePath}`);
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
  await writeJson(path.join(currentDir, 'project-catalog', 'summary.json'), {
    items: [
      {
        id: 'catalog-1',
        name: 'Catalog Project',
        province: 'Zhejiang',
        franchiseScope: 'direct',
        hardProgressStage: 'Floor plan',
        softProgressStage: 'Display plan',
        stageReminder: {
          currentStage: { key: 'displayInProgress', label: 'Display', rank: 880 },
          primaryReminder: { label: 'Display done', formatted: '--', message: 'Waiting display done', kind: 'stage_action' },
          dataGapCount: 0,
        },
        workflowFacts: { lifecycleClosed: false },
      },
    ],
    total: 1,
    view: 'summary',
    fieldCatalog: [{ key: 'province', label: 'Province' }],
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

async function withProjectComputeServer(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-detail-api-'));
  const cacheFile = path.join(tempDir, 'dashboard-cache.json');
  await writeJson(cacheFile, {
    version: 1,
    source: 'test',
    syncedAt: '2026-06-12T00:00:00.000Z',
    sourceRecords: 1,
    totalRecords: 1,
    ignoredRecords: 0,
    projects: [
      {
        id: 'p-compute',
        name: 'Compute Detail Project',
        province: 'Zhejiang',
        difficulty: { legacy: true },
        recordMeta: { id: 'record-compute', lastModifiedTime: '2026-06-12T01:00:00.000Z', extra: 'keep-me' },
        rawFields: {
          '项目名称': { display: 'Compute Detail Project', kind: 'text' },
          '省份': { display: 'Zhejiang', kind: 'text' },
          '业态': { display: '旗舰店', kind: 'text' },
          '店态': { display: '新店', kind: 'text' },
          '负责人': { display: 'Owner A', kind: 'text' },
          '启动时间': { display: '2026-05-01', kind: 'date' },
          '计划开业时间': { display: '2026-08-01', kind: 'date' },
          '项目状态': { display: '推进中', kind: 'text' },
          '组别': { display: '直营新店', kind: 'text' },
          '软装完成时间': { display: '2026-06-10', kind: 'date' },
          '附件': { display: 'https://example.invalid/file?token=secret', kind: 'attachment' },
        },
      },
    ],
  });

  const server = createServer({
    port: 0,
    mode: 'empty',
    cacheFile,
    precomputeEnabled: false,
    syncApiKey: 'server-only-secret',
    dashboardSyncEnabled: false,
    databaseFile: '',
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
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

test('/api/projects full readModel fallback schedules scoped project detail repair', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-detail-api-'));
  const cacheFile = path.join(tempDir, 'dashboard-cache.json');
  const readModelDir = path.join(tempDir, 'read-model');
  const precomputeDir = path.join(tempDir, 'precomputed');
  const snapshot = {
    version: 1,
    source: 'test',
    syncedAt: '2026-06-12T00:00:00.000Z',
    sourceRecords: 2,
    totalRecords: 2,
    ignoredRecords: 0,
    projects: [
      {
        id: 'p1',
        name: 'Project One',
        province: 'Zhejiang',
        rawFields: {
          项目名称: { display: 'Project One', kind: 'text' },
          省份: { display: 'Zhejiang', kind: 'text' },
          业态: { display: 'Flagship', kind: 'text' },
          店态: { display: 'New Store', kind: 'text' },
          负责人: { display: 'Owner A', kind: 'text' },
          usefulNote: { display: 'Ready for detail', kind: 'text' },
        },
      },
      {
        id: 'p2',
        name: 'Project Two',
        province: 'Jiangsu',
        recordMeta: { id: 'record-p2', lastModifiedTime: '2026-06-12T01:00:00.000Z' },
        rawFields: {
          项目名称: { display: 'Project Two', kind: 'text' },
          省份: { display: 'Jiangsu', kind: 'text' },
          业态: { display: 'Flagship', kind: 'text' },
          店态: { display: 'New Store', kind: 'text' },
          负责人: { display: 'Owner A', kind: 'text' },
          usefulNote: { display: 'Repair me', kind: 'text' },
        },
      },
    ],
  };
  await writeJson(cacheFile, snapshot);
  const config = {
    port: 0,
    mode: 'empty',
    cacheFile,
    readModelDir,
    precomputeDir,
    syncApiKey: 'server-only-secret',
    dashboardSyncEnabled: false,
    databaseFile: '',
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
  };
  const manifest = await precomputeTeamDashboards(snapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });
  const snapshotHash = precomputeSnapshotHash(snapshot, {});
  assert.equal(manifest.snapshotHash, snapshotHash);

  const fileName = `${hashToken('p2')}.json`;
  const manifestPath = path.join(readModelDir, 'current', 'manifest.json');
  const originalGeneratedAt = JSON.parse(await fs.readFile(manifestPath, 'utf8')).generatedAt;
  const currentDetailPath = path.join(readModelDir, 'current', 'project-detail', fileName);
  const precomputeDetailPath = path.join(precomputeDir, snapshotHash, 'project-detail', fileName);
  await fs.rm(currentDetailPath, { force: true });
  await fs.rm(`${currentDetailPath}.gz`, { force: true });
  await fs.rm(precomputeDetailPath, { force: true });
  await fs.rm(`${precomputeDetailPath}.gz`, { force: true });

  const server = createServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const payload = await getJson(port, '/api/projects?id=p2&view=full&fallback=readModel');
    assert.equal(payload.status, 202);
    assert.equal(payload.body.status, 'preparing');
    await waitForFile(currentDetailPath);
    await waitForFile(precomputeDetailPath);

    const currentManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const repaired = JSON.parse(await fs.readFile(currentDetailPath, 'utf8'));
    assert.equal(currentManifest.generatedAt, originalGeneratedAt);
    assert.equal(repaired.id, 'p2');
    assert.equal(repaired.name, 'Project Two');
    assert.equal(repaired.rawFields.usefulNote.display, 'Repair me');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('/api/projects summary uses project catalog read model without raw fields', async () => {
  await withProjectDetailServer(async (port) => {
    const payload = await getJson(port, '/api/projects?view=summary');

    assert.equal(payload.status, 200);
    assert.equal(payload.body.readModel, true);
    assert.equal(payload.body.view, 'summary');
    assert.equal(payload.body.items.length, 1);
    assert.equal(payload.body.items[0].id, 'catalog-1');
    assert.equal(Object.hasOwn(payload.body.items[0], 'rawFields'), false);
    assert.deepEqual(payload.body.fieldCatalog, [{ key: 'province', label: 'Province' }]);
  });
});

test('/api/projects full compute fallback keeps full project fields and adds stage reminder', async () => {
  await withProjectComputeServer(async (port) => {
    const payload = await getJson(port, '/api/projects?id=record-compute&view=full&fallback=compute');

    assert.equal(payload.status, 200);
    assert.equal(payload.body.item.id, 'p-compute');
    assert.deepEqual(payload.body.item.difficulty, { legacy: true });
    assert.equal(payload.body.item.recordMeta.extra, 'keep-me');
    assert.equal(payload.body.item.rawFields['附件'].kind, 'attachment');
    assert.equal(payload.body.item.detailLite, undefined);
    assert.equal(payload.body.item.stageReminder.currentStage.key, 'softDone');
    assert.equal(payload.body.item.workflowFacts.softDone, true);
  });
});

test('/api/projects full list compute response decorates every item with stage reminder', async () => {
  await withProjectComputeServer(async (port) => {
    const payload = await getJson(port, '/api/projects?view=full&fallback=compute');

    assert.equal(payload.status, 200);
    assert.equal(payload.body.view, 'full');
    assert.equal(payload.body.items.length, 1);
    assert.equal(payload.body.items[0].rawFields['附件'].kind, 'attachment');
    assert.equal(payload.body.items[0].stageReminder.currentStage.key, 'softDone');
    assert.equal(payload.body.items[0].workflowFacts.softDone, true);
  });
});
