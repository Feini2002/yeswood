import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  READ_MODEL_SCHEMA_VERSION,
  publishReadModelDirectory,
  readDashboardSessionReadModel,
  readTeamWorkCompletionDetailReadModel,
} from '../src/backend/readModelRepository.mjs';

function ownerKey(owner) {
  return crypto.createHash('sha1').update(String(owner || '')).digest('hex').slice(0, 16);
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

async function seedReadModel(baseDir, { owner = 'Owner A', context = 'direct', year = 2026, schemaVersion = READ_MODEL_SCHEMA_VERSION } = {}) {
  const currentDir = path.join(baseDir, 'current');
  await writeJson(path.join(currentDir, 'manifest.json'), {
    schemaVersion,
    readModel: true,
    snapshotHash: 'hash-1',
    generatedAt: '2026-06-11T08:00:00.000Z',
    features: [
      'dashboard-session',
      'project-catalog-summary',
      'profile-dashboard',
      'team-metrics',
      'team-work-completion',
      'team-work-completion-summary',
      'team-work-completion-detail',
      'team-responsibility-review',
    ],
    contexts: ['all', 'franchise', 'direct'],
    years: [2025, 2026],
    owners: [{ owner, key: ownerKey(owner) }],
  });
  await writeJson(path.join(currentDir, 'dashboard-session', 'core.json'), {
    schemaVersion,
    readModel: true,
    readOnly: true,
    snapshotHash: 'hash-1',
    snapshot: {
      source: 'test',
      totalRecords: 1,
      readOnly: true,
      developerDocumentationVisible: false,
      dashboardDisplayMode: 'intranet',
    },
    filters: { provinces: [] },
    metrics: { summary: { totalProjects: 1 } },
    departmentMetrics: { profile: 'department' },
    profileDashboards: {
      direct: { metrics: { profile: 'direct' }, projects: [{ id: 'p1', name: 'P1' }] },
      franchise: { metrics: { profile: 'franchise' }, projects: [] },
    },
    projectCatalog: { items: [{ id: 'p1', name: 'P1' }], fieldCatalog: [] },
    team: { owner, dashboardContext: context, year },
  });
  await writeJson(path.join(currentDir, 'project-catalog', 'summary.json'), {
    items: [{ id: 'p1', name: 'P1' }],
    fieldCatalog: [],
    view: 'summary',
    readOnly: true,
  });
  await writeJson(path.join(currentDir, 'profile-dashboard', 'department.json'), {
    profile: 'department',
    metrics: { profile: 'department' },
    projects: [],
    readOnly: true,
  });
  await writeJson(path.join(currentDir, 'profile-dashboard', 'direct.json'), {
    profile: 'direct',
    metrics: { profile: 'direct' },
    projects: [{ id: 'p1', name: 'P1' }],
    readOnly: true,
  });
  await writeJson(path.join(currentDir, 'profile-dashboard', 'franchise.json'), {
    profile: 'franchise',
    metrics: { profile: 'franchise' },
    projects: [],
    readOnly: true,
  });
  await writeJson(path.join(currentDir, 'team-metrics', `${context}.json`), {
    readOnly: true,
    dashboardContext: context,
    owners: [owner],
    metricsByOwner: {
      [owner]: { owner, dashboardContext: context, summary: { totalProjects: 1 } },
    },
  });
  await writeJson(path.join(currentDir, 'team-work-completion-summary', `${ownerKey(owner)}__${context}__${year}.json`), {
    owner,
    requestedOwner: owner,
    dashboardContext: context,
    year,
    summary: {},
  });
  await writeJson(path.join(currentDir, 'team-work-completion-detail', `${ownerKey(owner)}__${context}__${year}.json`), {
    owner,
    requestedOwner: owner,
    dashboardContext: context,
    year,
    summary: {},
    projectsById: { p1: { id: 'p1', name: 'P1' } },
  });
  await writeJson(path.join(currentDir, 'team-responsibility-review', `${ownerKey(owner)}__${context}.json`), {
    owner,
    dashboardContext: context,
    summary: {},
  });
}

test('readDashboardSessionReadModel reads the current hard read model without a snapshot', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir);

  const result = readDashboardSessionReadModel(
    { readModelDir: tempDir, devReloadEnabled: true, dashboardAutoUpdateEnabled: true },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026 }
  );

  assert.equal(result.status, 'ready');
  assert.equal(result.payload.readModel, true);
  assert.equal(result.payload.snapshotHash, 'hash-1');
  assert.equal(result.payload.snapshot.developerDocumentationVisible, true);
  assert.equal(result.payload.snapshot.dashboardDisplayMode, 'development');
  assert.equal(result.payload.team.owner, 'Owner A');
  assert.equal(result.payload.team.metrics.owner, 'Owner A');
  assert.equal(result.payload.team.workCompletion.year, 2026);
  assert.equal(result.payload.team.workCompletion.detailReady, true);
  assert.equal(result.payload.team.workCompletion.detailStatus, 'ready');
  assert.deepEqual(result.payload.team.workCompletion.projectsById, { p1: { id: 'p1', name: 'P1' } });
  assert.equal(result.payload.team.responsibilityReview.dashboardContext, 'direct');
  assert.equal(result.payload.profileDashboards.direct.metrics.profile, 'direct');
  assert.equal(result.payload.projectCatalog.items.length, 1);
});

test('readTeamWorkCompletionDetailReadModel tolerates trimmed owner input on the fast path', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir);

  const result = readTeamWorkCompletionDetailReadModel(
    { readModelDir: tempDir },
    { owner: ' Owner A ', dashboardContext: 'direct', year: 2026 }
  );

  assert.equal(result.status, 'ready');
  assert.equal(result.payload.owner, 'Owner A');
  assert.equal(result.payload.detailReady, true);
  assert.deepEqual(result.payload.projectsById, { p1: { id: 'p1', name: 'P1' } });
});

test('readDashboardSessionReadModel rejects non-current schema read models', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir, { schemaVersion: 1 });

  const result = readDashboardSessionReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026 }
  );

  assert.equal(result.status, 'incomplete');
  assert.equal(result.payload, null);
  assert.match(result.reason, /manifest|schema|incomplete/i);
});

test('readDashboardSessionReadModel reports missing and incomplete states explicitly', async () => {
  const missingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  assert.deepEqual(readDashboardSessionReadModel({ readModelDir: missingDir }, {}), {
    status: 'missing',
    payload: null,
    reason: 'read model manifest is missing',
  });

  const incompleteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(incompleteDir);
  await fs.rm(path.join(incompleteDir, 'current', 'team-work-completion-summary'), { recursive: true, force: true });

  const result = readDashboardSessionReadModel(
    { readModelDir: incompleteDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026 }
  );
  assert.equal(result.status, 'incomplete');
  assert.equal(result.payload, null);
  assert.match(result.reason, /team work completion/i);
});

test('publishReadModelDirectory cleans stale temp directories and preserves last-known-good', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  const sourceDir = path.join(baseDir, 'source');
  const config = { readModelDir: path.join(baseDir, 'read-model') };
  await seedReadModel(sourceDir);
  const staleTempDir = path.join(config.readModelDir, 'current.tmp-stale');
  const activeTempDir = path.join(config.readModelDir, 'current.tmp-active');
  await fs.mkdir(staleTempDir, { recursive: true });
  await fs.mkdir(activeTempDir, { recursive: true });
  const staleTime = new Date('2026-06-11T00:00:00.000Z');
  await fs.utimes(staleTempDir, staleTime, staleTime);

  await publishReadModelDirectory(config, path.join(sourceDir, 'current'));

  const firstManifest = JSON.parse(
    await fs.readFile(path.join(config.readModelDir, 'current', 'manifest.json'), 'utf8')
  );
  assert.equal(firstManifest.snapshotHash, 'hash-1');
  await assert.rejects(
    fs.stat(staleTempDir),
    /ENOENT/
  );
  assert.ok(await fs.stat(activeTempDir));

  const nextSourceDir = path.join(baseDir, 'source-next');
  await seedReadModel(nextSourceDir, { owner: 'Owner B', context: 'all', year: 2025 });
  const nextManifestPath = path.join(nextSourceDir, 'current', 'manifest.json');
  const nextManifest = JSON.parse(await fs.readFile(nextManifestPath, 'utf8'));
  nextManifest.snapshotHash = 'hash-2';
  await fs.writeFile(nextManifestPath, `${JSON.stringify(nextManifest)}\n`, 'utf8');
  const nextSessionPath = path.join(nextSourceDir, 'current', 'dashboard-session', 'core.json');
  const nextSession = JSON.parse(await fs.readFile(nextSessionPath, 'utf8'));
  nextSession.snapshotHash = 'hash-2';
  await fs.writeFile(nextSessionPath, `${JSON.stringify(nextSession)}\n`, 'utf8');

  await publishReadModelDirectory(config, path.join(nextSourceDir, 'current'));

  const current = JSON.parse(
    await fs.readFile(path.join(config.readModelDir, 'current', 'manifest.json'), 'utf8')
  );
  const lastKnownGood = JSON.parse(
    await fs.readFile(path.join(config.readModelDir, 'last-known-good', 'manifest.json'), 'utf8')
  );
  assert.equal(current.snapshotHash, 'hash-2');
  assert.equal(lastKnownGood.snapshotHash, 'hash-1');
});
