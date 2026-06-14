import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  hasCompletePrecompute,
  hasPrecomputedTeamBundle,
  ownersFromSnapshot,
  precomputeSnapshotHash,
  precomputeTeamDashboards,
  readPrecomputedDashboardSession,
  readPrecomputedTeamMetricsBatch,
  readPrecomputedTeamResponsibilityReview,
  readPrecomputedTeamWorkCompletion,
  readPrecomputedTeamWorkCompletionDetail,
} from '../src/backend/precomputeTeamDashboards.mjs';
import { buildTeamResponsibilityReview } from '../src/backend/teamResponsibilityReview.mjs';
import { buildTeamWorkCompletionReview } from '../src/backend/teamWorkCompletionReview.mjs';

function raw(display) {
  return { display };
}

const personnelArchitecture = {
  people: {
    '苏:佳*蕾': { name: '苏:佳*蕾', displayName: '苏佳蕾' },
    陈菲菲: { name: '陈菲菲', displayName: '陈菲菲' },
  },
  teams: [
    {
      owner: '苏:佳*蕾',
      groups: [{ name: '直营1组', members: ['陈菲菲'] }],
    },
  ],
};

function project(id, fields = {}) {
  return {
    id,
    name: id,
    province: '浙江',
    businessType: '旗舰店',
    storeStatus: '新店',
    status: '推进中',
    owner: '苏:佳*蕾',
    cdOwner: '苏:佳*蕾',
    vmOwner: '',
    startDate: id.includes('2025') ? '2025-01-15' : '2026-01-15',
    updatedAt: id.includes('2025') ? '2025-06-15T00:00:00.000Z' : '2026-06-15T00:00:00.000Z',
    rawFields: {
      项目名称: raw(id),
      组别: raw('直营新店'),
      店态: raw('新店'),
      业态: raw('旗舰店'),
      省份: raw('浙江'),
      负责人: raw('苏:佳*蕾'),
      CD组长: raw('周丹阳'),
      CD设计师: raw('陈菲菲'),
      VM组长: raw('张情'),
      VM设计师: raw('陈燕玲'),
      硬装项目进度: raw('闭环'),
      软装项目进度: raw('闭环'),
      上会时间: raw(id.includes('2025') ? '2025-05-20' : '2026-05-20'),
      闭环周期: raw('26'),
      项目闭环时间: raw('2026-06-15'),
      attachmentUrl: raw('https://example.test/file?Expires=1781147357&Signature=keep-out-of-summary'),
      ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, raw(value)])),
    },
  };
}

function snapshot(overrides = {}) {
  return {
    version: 1,
    source: 'test',
    readOnly: true,
    syncedAt: '2026-06-11T08:00:00.000Z',
    sourceRecords: 2,
    totalRecords: 2,
    ignoredRecords: 0,
    projects: [project('direct-2026'), project('direct-2025', { 项目闭环时间: '2025-06-15' })],
    personnelArchitecture,
    metrics: {
      personnel: {
        roles: [
          {
            key: 'cdOwner',
            people: [{ name: '苏:佳*蕾' }],
          },
        ],
      },
    },
    ...overrides,
  };
}

test('precomputeSnapshotHash changes when content hash or data revision changes', () => {
  const baseSnapshot = snapshot({ contentHash: 'content-a', dataRevision: 'revision-a' });
  const numericRevisionSnapshot = snapshot({ contentHash: 0, dataRevision: 0 });

  assert.notEqual(
    precomputeSnapshotHash(baseSnapshot, personnelArchitecture),
    precomputeSnapshotHash({ ...baseSnapshot, contentHash: 'content-b' }, personnelArchitecture)
  );
  assert.notEqual(
    precomputeSnapshotHash(baseSnapshot, personnelArchitecture),
    precomputeSnapshotHash({ ...baseSnapshot, dataRevision: 'revision-b' }, personnelArchitecture)
  );
  assert.notEqual(
    precomputeSnapshotHash(numericRevisionSnapshot, personnelArchitecture),
    precomputeSnapshotHash({ ...numericRevisionSnapshot, contentHash: 1 }, personnelArchitecture)
  );
  assert.notEqual(
    precomputeSnapshotHash(numericRevisionSnapshot, personnelArchitecture),
    precomputeSnapshotHash({ ...numericRevisionSnapshot, dataRevision: 1 }, personnelArchitecture)
  );
});

test('precomputeTeamDashboards writes work completion payloads that match live calculation', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  assert.equal(result.snapshotHash, precomputeSnapshotHash(sourceSnapshot, personnelArchitecture));
  assert.ok(result.features.includes('team-work-completion'));
  assert.ok(result.features.includes('team-metrics'));

  const actualSummary = readPrecomputedTeamWorkCompletion(config, sourceSnapshot, personnelArchitecture, {
    owner,
    requestedOwner: owner,
    dashboardContext: 'direct',
    year: 2026,
  });
  const actual = readPrecomputedTeamWorkCompletionDetail(config, sourceSnapshot, personnelArchitecture, {
    owner,
    requestedOwner: owner,
    dashboardContext: 'direct',
    year: 2026,
  });
  const expected = buildTeamWorkCompletionReview(sourceSnapshot.projects, personnelArchitecture.teams[0], {
    requestedOwner: owner,
    dashboardContext: 'direct',
    personnelArchitecture,
    year: 2026,
    today: '2026-06-11',
  });

  assert.deepEqual(actual, expected);
  assert.equal(actualSummary.asOfDate, '2026-06-11');
  assert.equal(actualSummary.projectsById, undefined);
  assert.ok(Object.keys(actual.projectsById).length > 0);
  assert.equal(actualSummary.monthly.months[5].lifecycleCompleted, 1);
  assert.equal(actualSummary.monthly.months[5].projectIds, undefined);
  assert.deepEqual(actual.monthly.months[5].projectIds.lifecycle, ['direct-2026']);
});

test('precomputeTeamDashboards force overwrites an existing complete same-hash bundle', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = {
    precomputeDir: path.join(tempDir, 'precomputed'),
    readModelDir: path.join(tempDir, 'read-model'),
  };
  const sourceSnapshot = snapshot();

  await precomputeTeamDashboards(sourceSnapshot, {
    config,
    now: new Date('2026-06-11T08:00:00.000Z'),
  });
  const forced = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    force: true,
    now: new Date('2026-06-12T08:00:00.000Z'),
  });

  const manifestPath = path.join(config.precomputeDir, forced.snapshotHash, 'manifest.json');
  const currentManifestPath = path.join(config.readModelDir, 'current', 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const currentManifest = JSON.parse(await fs.readFile(currentManifestPath, 'utf8'));

  assert.equal(forced.generatedAt, '2026-06-12T08:00:00.000Z');
  assert.equal(manifest.generatedAt, '2026-06-12T08:00:00.000Z');
  assert.equal(currentManifest.generatedAt, '2026-06-12T08:00:00.000Z');
});

test('precomputeTeamDashboards keeps processing queues in the summary payload sorted by planned opening risk date', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const activeProject = (id, { status = '一般', startDate = '2026-06-01', deliveryDate = '', dueDate = '' } = {}) => ({
    ...project(id, {
      项目状态: status,
      硬装项目进度: '施工中',
      软装项目进度: '软装方案',
      启动时间: startDate,
      商场交付时间: deliveryDate,
      计划开业时间: dueDate,
      项目闭环时间: '',
      闭环周期: '',
    }),
    status,
    startDate,
    dueDate,
  });
  const sourceSnapshot = snapshot({
    sourceRecords: 11,
    totalRecords: 11,
    projects: [
      activeProject('urgent-window-2', {
        status: '紧急',
        startDate: '2026-06-01',
        deliveryDate: '2026-05-20',
        dueDate: '2026-06-03',
      }),
      activeProject('urgent-due-fallback', {
        status: '紧急',
        startDate: '2026-06-01',
        dueDate: '2026-06-05',
      }),
      activeProject('urgent-window-7', {
        status: '紧急插队',
        startDate: '2026-06-01',
        deliveryDate: '2026-05-25',
        dueDate: '2026-06-08',
      }),
      activeProject('normal-window-1', {
        status: '一般',
        startDate: '2026-06-01',
        deliveryDate: '2026-05-20',
        dueDate: '2026-06-02',
      }),
      activeProject('normal-window-3', {
        status: '不紧急',
        startDate: '2026-06-01',
        deliveryDate: '2026-05-21',
        dueDate: '2026-06-04',
      }),
      activeProject('normal-window-4', {
        status: '一般',
        startDate: '2026-06-01',
        deliveryDate: '2026-05-22',
        dueDate: '2026-06-05',
      }),
      activeProject('normal-window-5', {
        status: '一般',
        startDate: '2026-06-01',
        deliveryDate: '2026-05-23',
        dueDate: '2026-06-06',
      }),
      activeProject('normal-window-6', {
        status: '一般',
        startDate: '2026-06-01',
        deliveryDate: '2026-05-24',
        dueDate: '2026-06-07',
      }),
      activeProject('normal-window-7', {
        status: '一般',
        startDate: '2026-06-01',
        deliveryDate: '',
        dueDate: '2026-06-08',
      }),
      activeProject('normal-nonurgent-literal', {
        status: '非紧急',
        startDate: '2026-06-01',
        deliveryDate: '2026-05-26',
        dueDate: '2026-06-09',
      }),
      project('closed-urgent', { 项目状态: '紧急', 商场交付时间: '2026-06-02' }),
    ],
  });
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  const summary = readPrecomputedTeamWorkCompletion(config, sourceSnapshot, personnelArchitecture, {
    owner,
    requestedOwner: owner,
    dashboardContext: 'direct',
    year: 2026,
    today: '2026-06-11',
  });
  const staleDailySummary = readPrecomputedTeamWorkCompletion(config, sourceSnapshot, personnelArchitecture, {
    owner,
    requestedOwner: owner,
    dashboardContext: 'direct',
    year: 2026,
    today: '2026-06-12',
  });

  assert.equal(summary.projectsById, undefined);
  assert.equal(staleDailySummary, null);
  assert.equal(summary.asOfDate, '2026-06-11');
  assert.equal(summary.processingQueues.urgent.totalCount, 3);
  assert.deepEqual(summary.processingQueues.urgent.topProjects.map((item) => item.id), [
    'urgent-window-2',
    'urgent-due-fallback',
    'urgent-window-7',
  ]);
  assert.equal(summary.processingQueues.normal.totalCount, 7);
  assert.deepEqual(summary.processingQueues.normal.topProjects.map((item) => item.id), [
    'normal-window-1',
    'normal-window-3',
    'normal-window-4',
    'normal-window-5',
    'normal-window-6',
  ]);
  assert.equal(summary.processingQueues.normal.projects, undefined);
  assert.equal(summary.processingQueues.normal.topProjects[1].urgent, false);
  assert.equal(summary.processingQueues.urgent.topProjects[0].riskLabel, '逾期8天');
  assert.equal(summary.processingQueues.urgent.topProjects[0].targetDeltaDays, -8);
  assert.equal(summary.processingQueues.urgent.topProjects[0].windowDays, 2);
  assert.equal(summary.processingQueues.urgent.topProjects[0].targetDateSource, '计划开业时间');
  assert.equal(summary.processingQueues.urgent.topProjects[1].targetDateSource, '计划开业时间');
  assert.equal(summary.processingQueues.normal.topProjects.at(-1).targetDateSource, '计划开业时间');
});

test('precomputeTeamDashboards writes unified procurement action stages into processing queues', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const activeProject = (id, { status = '一般', purchaseTime = '', purchaseStatus = '' } = {}) => ({
    ...project(id, {
      项目状态: status,
      硬装项目进度: '施工中',
      软装项目进度: '待采购',
      启动时间: '2026-06-01',
      商场交付时间: '2026-05-25',
      计划开业时间: '2026-06-05',
      项目闭环时间: '',
      闭环周期: '',
      采购时间: purchaseTime,
      采购完成情况: purchaseStatus,
    }),
    status,
    startDate: '2026-06-01',
    dueDate: '2026-06-05',
  });
  const sourceSnapshot = snapshot({
    sourceRecords: 2,
    totalRecords: 2,
    projects: [
      activeProject('purchase-time-only', { status: '紧急', purchaseTime: '2026-05-30' }),
      activeProject('purchase-completed-stale-progress', { status: '一般', purchaseStatus: '已完成' }),
    ],
  });
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  const summary = readPrecomputedTeamWorkCompletion(config, sourceSnapshot, personnelArchitecture, {
    owner,
    requestedOwner: owner,
    dashboardContext: 'direct',
    year: 2026,
  });

  const urgentById = Object.fromEntries(summary.processingQueues.urgent.topProjects.map((item) => [item.id, item]));
  const normalById = Object.fromEntries(summary.processingQueues.normal.topProjects.map((item) => [item.id, item]));
  assert.equal(urgentById['purchase-time-only'].actionStage, '待采购完成');
  assert.equal(normalById['purchase-completed-stale-progress'].actionStage, '待摆场');
});

test('readPrecomputedTeamWorkCompletion rejects summary payloads without processing queues', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });
  const summaryDir = path.join(config.precomputeDir, result.snapshotHash, 'team-work-completion-summary');
  const [summaryFile] = await fs.readdir(summaryDir);
  const summaryPath = path.join(summaryDir, summaryFile);
  const staleSummary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
  delete staleSummary.processingQueues;
  await fs.writeFile(summaryPath, `${JSON.stringify(staleSummary)}\n`, 'utf8');

  const summary = readPrecomputedTeamWorkCompletion(config, sourceSnapshot, personnelArchitecture, {
    owner,
    requestedOwner: owner,
    dashboardContext: 'direct',
    year: 2026,
  });

  assert.equal(summary, null);
});

test('readPrecomputedTeamWorkCompletion rejects stale cached manifests after a schema bump', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });
  const manifestPath = path.join(config.precomputeDir, result.snapshotHash, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  config.precomputeIndex = new Map([[result.snapshotHash, { ...manifest, schemaVersion: manifest.schemaVersion - 1 }]]);
  await fs.writeFile(manifestPath, `${JSON.stringify({ ...manifest, schemaVersion: manifest.schemaVersion - 1 })}\n`, 'utf8');

  const summary = readPrecomputedTeamWorkCompletion(config, sourceSnapshot, personnelArchitecture, {
    owner,
    requestedOwner: owner,
    dashboardContext: 'direct',
    year: 2026,
  });

  assert.equal(summary, null);
  assert.equal(config.precomputeIndex.has(result.snapshotHash), false);
});

test('precomputeTeamDashboards splits work completion summary from detail payloads', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  const summaryFiles = (await fs.readdir(path.join(config.precomputeDir, result.snapshotHash, 'team-work-completion-summary'))).filter(
    (fileName) => fileName.endsWith('.json')
  );
  const detailFiles = (await fs.readdir(path.join(config.precomputeDir, result.snapshotHash, 'team-work-completion-detail'))).filter(
    (fileName) => fileName.endsWith('.json')
  );
  assert.ok(summaryFiles.length >= 1);
  assert.ok(detailFiles.length >= 1);

  const summary = readPrecomputedTeamWorkCompletion(config, sourceSnapshot, personnelArchitecture, {
    owner,
    requestedOwner: owner,
    dashboardContext: 'direct',
    year: 2026,
  });
  const detail = readPrecomputedTeamWorkCompletionDetail(config, sourceSnapshot, personnelArchitecture, {
    owner,
    requestedOwner: owner,
    dashboardContext: 'direct',
    year: 2026,
  });

  assert.equal(summary.owner, owner);
  assert.equal(summary.summary.lifecycle.completedCount, detail.summary.lifecycle.completedCount);
  assert.equal(typeof summary.dataQualitySummary.missingDateCompletionCount, 'number');
  assert.equal(summary.dataQuality, undefined);
  assert.equal(summary.projectsById, undefined);
  assert.equal(summary.members.some((member) => Array.isArray(member.projectIds)), false);
  assert.ok(Object.keys(detail.projectsById).length > 0);
  assert.equal(detail.members.some((member) => Array.isArray(member.projectIds)), true);
});

test('precomputeTeamDashboards keeps default work completion detail scoped to active years', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  const baseDir = path.join(config.precomputeDir, result.snapshotHash);
  const manifest = JSON.parse(await fs.readFile(path.join(baseDir, 'manifest.json'), 'utf8'));
  const summaryFiles = (await fs.readdir(path.join(baseDir, 'team-work-completion-summary'))).filter(
    (fileName) => fileName.endsWith('.json') && !fileName.endsWith('.json.gz')
  );
  const detailFiles = (await fs.readdir(path.join(baseDir, 'team-work-completion-detail'))).filter(
    (fileName) => fileName.endsWith('.json') && !fileName.endsWith('.json.gz')
  );

  assert.deepEqual(manifest.detailYears, [2026]);
  assert.ok(summaryFiles.some((fileName) => fileName.endsWith('__2025.json')));
  assert.ok(summaryFiles.some((fileName) => fileName.endsWith('__2026.json')));
  assert.equal(detailFiles.some((fileName) => fileName.endsWith('__2025.json')), false);
  assert.ok(detailFiles.some((fileName) => fileName.endsWith('__2026.json')));
  assert.ok(summaryFiles.length > detailFiles.length);
});

test('precomputeTeamDashboards writes team metrics payloads for batch reads', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  assert.ok(result.features.includes('team-work-completion'));
  assert.ok(result.features.includes('team-metrics'));

  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);
  const actual = readPrecomputedTeamMetricsBatch(config, sourceSnapshot, personnelArchitecture, {
    owners: [owner],
    dashboardContext: 'direct',
  });

  assert.equal(actual.readOnly, true);
  assert.deepEqual(actual.owners, [owner]);
  assert.equal(actual.metricsByOwner[owner].owner, owner);
  assert.equal(actual.metricsByOwner[owner].dashboardContext, 'direct');
  assert.equal(actual.metricsByOwner[owner].team.groups.length, 1);
  assert.deepEqual(actual.metricsByOwner[owner].team.groups[0].memberNames, ['陈菲菲']);
  assert.ok(actual.metricsByOwner[owner].summary);
  assert.ok(actual.metricsByOwner[owner].riskHealthAnalysis);
});

test('precomputeTeamDashboards writes dashboard session and responsibility review payloads', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  assert.ok(result.features.includes('dashboard-session'));
  assert.ok(result.features.includes('team-responsibility-review'));

  const sessionFile = await fs.readFile(
    path.join(config.precomputeDir, result.snapshotHash, 'dashboard-session', 'core.json'),
    'utf8'
  );
  const sessionFromFile = JSON.parse(sessionFile);
  assert.equal(sessionFromFile.schemaVersion, 11);
  assert.equal(sessionFromFile.snapshotHash, result.snapshotHash);
  assert.equal(sessionFromFile.projectCatalog, undefined);
  assert.equal(sessionFromFile.profileDashboards, undefined);
  assert.equal(sessionFromFile.team.owner, owner);
  assert.equal(sessionFromFile.team.dashboardContext, 'direct');
  assert.equal(sessionFromFile.team.year, 2026);
  assert.ok(sessionFromFile.team.metrics);
  assert.ok(sessionFromFile.team.workCompletion);
  assert.ok(sessionFromFile.team.responsibilityReview);

  const session = readPrecomputedDashboardSession(config, sourceSnapshot, personnelArchitecture, {
    owner,
    dashboardContext: 'direct',
    year: 2026,
  });
  assert.equal(session.snapshot.source, 'test');
  assert.equal(session.team.owner, owner);
  assert.equal(session.team.metrics.owner, owner);
  assert.equal(session.team.workCompletion.owner, owner);
  assert.equal(session.team.workCompletion.detailReady, true);
  assert.equal(session.team.workCompletion.detailStatus, 'ready');
  assert.ok(Object.keys(session.team.workCompletion.projectsById || {}).length > 0);
  assert.equal(session.team.responsibilityReview.owner, owner);

  const responsibility = readPrecomputedTeamResponsibilityReview(config, sourceSnapshot, personnelArchitecture, {
    owner,
    dashboardContext: 'direct',
  });
  const expected = buildTeamResponsibilityReview(sourceSnapshot.projects, personnelArchitecture.teams[0], {
    dashboardContext: 'direct',
    personnelArchitecture,
  });
  assert.deepEqual(responsibility, JSON.parse(JSON.stringify(expected)));
});

test('readPrecomputedDashboardSession rejects sessions with missing team work completion detail', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  const detailDir = path.join(config.precomputeDir, result.snapshotHash, 'team-work-completion-detail');
  const [detailFile] = await fs.readdir(detailDir);
  await fs.rm(path.join(detailDir, detailFile));

  const session = readPrecomputedDashboardSession(config, sourceSnapshot, personnelArchitecture, {
    owner,
    dashboardContext: 'direct',
    year: 2026,
  });

  assert.equal(session, null);
});

test('precomputed team sidecar readers reject payloads with mismatched scope', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  const baseDir = path.join(config.precomputeDir, result.snapshotHash);
  const summaryDir = path.join(baseDir, 'team-work-completion-summary');
  const detailDir = path.join(baseDir, 'team-work-completion-detail');
  const responsibilityDir = path.join(baseDir, 'team-responsibility-review');
  const [summaryFile] = await fs.readdir(summaryDir);
  const [detailFile] = await fs.readdir(detailDir);
  const [responsibilityFile] = await fs.readdir(responsibilityDir);

  const summaryPath = path.join(summaryDir, summaryFile);
  const detailPath = path.join(detailDir, detailFile);
  const responsibilityPath = path.join(responsibilityDir, responsibilityFile);
  const summaryPayload = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
  const detailPayload = JSON.parse(await fs.readFile(detailPath, 'utf8'));
  const responsibilityPayload = JSON.parse(await fs.readFile(responsibilityPath, 'utf8'));

  await fs.writeFile(summaryPath, `${JSON.stringify({ ...summaryPayload, owner: 'Wrong Owner' })}\n`, 'utf8');
  await fs.writeFile(detailPath, `${JSON.stringify({ ...detailPayload, dashboardContext: 'franchise' })}\n`, 'utf8');
  await fs.writeFile(responsibilityPath, `${JSON.stringify({ ...responsibilityPayload, owner: 'Wrong Owner' })}\n`, 'utf8');

  assert.equal(
    readPrecomputedTeamWorkCompletion(config, sourceSnapshot, personnelArchitecture, {
      owner,
      requestedOwner: owner,
      dashboardContext: 'direct',
      year: 2026,
    }),
    null
  );
  assert.equal(
    readPrecomputedTeamWorkCompletionDetail(config, sourceSnapshot, personnelArchitecture, {
      owner,
      requestedOwner: owner,
      dashboardContext: 'direct',
      year: 2026,
    }),
    null
  );
  assert.equal(
    readPrecomputedTeamResponsibilityReview(config, sourceSnapshot, personnelArchitecture, {
      owner,
      dashboardContext: 'direct',
    }),
    null
  );
  assert.equal(
    readPrecomputedDashboardSession(config, sourceSnapshot, personnelArchitecture, {
      owner,
      dashboardContext: 'direct',
      year: 2026,
    }),
    null
  );
});

test('readPrecomputedDashboardSession rejects stale team work completion sidecars when today is provided', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  const session = readPrecomputedDashboardSession(config, sourceSnapshot, personnelArchitecture, {
    owner,
    dashboardContext: 'direct',
    year: 2026,
    today: '2026-06-12',
  });

  assert.equal(session, null);
});

test('precomputeTeamDashboards publishes hard read model current bundle', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = {
    precomputeDir: path.join(tempDir, 'precomputed'),
    readModelDir: path.join(tempDir, 'read-model'),
  };
  const sourceSnapshot = snapshot();
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  const currentDir = path.join(config.readModelDir, 'current');
  const manifest = JSON.parse(await fs.readFile(path.join(currentDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.snapshotHash, result.snapshotHash);
  assert.equal(manifest.readModel, true);
  assert.ok(manifest.features.includes('project-catalog-summary'));
  assert.ok(manifest.features.includes('project-detail'));
  assert.ok(manifest.features.includes('profile-dashboard'));
  assert.deepEqual(manifest.contexts, ['all', 'franchise', 'direct']);
  assert.ok(manifest.years.includes(2025));
  assert.ok(manifest.years.includes(2026));
  assert.deepEqual(manifest.detailYears, [2026]);
  assert.equal(manifest.years.includes(2094), false);
  assert.equal(manifest.years.includes(2080), false);

  const session = JSON.parse(await fs.readFile(path.join(currentDir, 'dashboard-session', 'core.json'), 'utf8'));
  assert.equal(session.readModel, true);
  assert.equal(session.profileDashboards, undefined);
  assert.equal(session.projectCatalog, undefined);

  const profile = JSON.parse(await fs.readFile(path.join(currentDir, 'profile-dashboard', 'direct.json'), 'utf8'));
  assert.equal(profile.metrics.profile, 'direct');
  assert.ok(Array.isArray(profile.projects));
  assert.equal(profile.projects.some((item) => item.rawFields), false);

  const catalog = JSON.parse(await fs.readFile(path.join(currentDir, 'project-catalog', 'summary.json'), 'utf8'));
  assert.ok(Array.isArray(catalog.items));
  assert.ok(catalog.items.length > 0);
  assert.ok(catalog.items[0].rawFields);
  assert.equal(catalog.items[0].rawFields.CD组长.display, '周丹阳');
  assert.equal(catalog.items[0].rawFields.CD设计师.display, '陈菲菲');
  assert.equal(catalog.items[0].rawFields.VM组长.display, '张情');
  assert.equal(catalog.items[0].rawFields.VM设计师.display, '陈燕玲');
  assert.equal(catalog.items[0].rawFields.闭环周期, undefined);
  assert.equal(catalog.items[0].rawFields.attachmentUrl, undefined);
  assert.equal(catalog.items[0].hardProgressStage, '闭环');
  assert.equal(catalog.items[0].stageReminder.currentStage.label, '闭环完成');
  assert.equal(typeof catalog.items[0].stageReminder.dataGapCount, 'number');
  assert.equal(typeof catalog.items[0].workflowFacts.lifecycleClosed, 'boolean');
  assert.equal(catalog.items[0].softProgressStage, '闭环');
  assert.equal(catalog.items[0].franchiseScope, 'direct');
  assert.equal(JSON.stringify(catalog).includes('Expires=1781147357'), false);

  const projectDetailDir = path.join(currentDir, 'project-detail');
  const projectDetailIndex = JSON.parse(await fs.readFile(path.join(projectDetailDir, 'index.json'), 'utf8'));
  assert.ok(projectDetailIndex.projectIds.includes('direct-2026'));
  const projectDetailFiles = (await fs.readdir(projectDetailDir)).filter(
    (fileName) => fileName !== 'index.json' && fileName.endsWith('.json') && !fileName.endsWith('.json.gz')
  );
  assert.ok(projectDetailFiles.length > 0);
  const projectDetail = JSON.parse(await fs.readFile(path.join(projectDetailDir, projectDetailFiles[0]), 'utf8'));
  assert.ok(projectDetail.id);
  assert.ok(projectDetail.name);
  assert.ok(projectDetail.rawFields);
  assert.equal(JSON.stringify(projectDetail).includes('Expires=1781147357'), false);

  const workCompletionSummary = await fs.readdir(path.join(currentDir, 'team-work-completion-summary'));
  const workCompletionDetail = await fs.readdir(path.join(currentDir, 'team-work-completion-detail'));
  assert.ok(workCompletionSummary.some((fileName) => fileName.endsWith('__2025.json')));
  assert.ok(workCompletionSummary.some((fileName) => fileName.endsWith('__2026.json')));
  assert.equal(workCompletionDetail.some((fileName) => fileName.endsWith('__2025.json')), false);
  assert.ok(workCompletionDetail.some((fileName) => fileName.endsWith('__2026.json')));
  const workCompletionDetail2026 = JSON.parse(
    await fs.readFile(
      path.join(
        currentDir,
        'team-work-completion-detail',
        workCompletionDetail.find((fileName) => fileName.endsWith('__2026.json'))
      ),
      'utf8'
    )
  );
  assert.ok(workCompletionDetail2026.projectDetailsById?.['direct-2026']);

  const sessionOwner = session.team.owner || owner;
  assert.equal(sessionOwner, owner);
});

test('precomputeTeamDashboards excludes outlier discovered years from the default matrix', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = {
    precomputeDir: path.join(tempDir, 'precomputed'),
    readModelDir: path.join(tempDir, 'read-model'),
  };
  const sourceSnapshot = snapshot({
    projects: [
      project('direct-2026', {
        异常日期: '2000-01-01',
        远期日期: '2094-01-01',
      }),
      project('direct-2025', { 项目闭环时间: '2025-06-15' }),
    ],
  });

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  assert.ok(result.years.includes(2025));
  assert.ok(result.years.includes(2026));
  assert.equal(result.years.includes(2000), false);
  assert.equal(result.years.includes(2094), false);
  assert.deepEqual(result.excludedYears, [2000, 2094]);

  const currentManifest = JSON.parse(
    await fs.readFile(path.join(config.readModelDir, 'current', 'manifest.json'), 'utf8')
  );
  assert.deepEqual(currentManifest.years, result.years);
  assert.deepEqual(currentManifest.excludedYears, [2000, 2094]);
});

test('precomputeTeamDashboards republishes read model when precompute is complete but current read model is missing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = {
    precomputeDir: path.join(tempDir, 'precomputed'),
    readModelDir: path.join(tempDir, 'read-model'),
  };
  const sourceSnapshot = snapshot();

  const manifest = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });
  const currentDir = path.join(config.readModelDir, 'current');
  await fs.rm(currentDir, { recursive: true, force: true });

  const republished = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  assert.deepEqual(republished, manifest);
  const currentManifest = JSON.parse(await fs.readFile(path.join(currentDir, 'manifest.json'), 'utf8'));
  assert.equal(currentManifest.snapshotHash, manifest.snapshotHash);
  const session = JSON.parse(await fs.readFile(path.join(currentDir, 'dashboard-session', 'core.json'), 'utf8'));
  assert.equal(session.snapshotHash, manifest.snapshotHash);
  assert.equal(session.readModel, true);
});

test('precomputeTeamDashboards republishes read model when current gzip sidecars are missing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = {
    precomputeDir: path.join(tempDir, 'precomputed'),
    readModelDir: path.join(tempDir, 'read-model'),
  };
  const sourceSnapshot = snapshot();

  const manifest = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });
  const currentDir = path.join(config.readModelDir, 'current');
  const coreGzipPath = path.join(currentDir, 'dashboard-session', 'core.json.gz');
  await fs.rm(coreGzipPath, { force: true });

  const republished = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  assert.deepEqual(republished, manifest);
  await assert.doesNotReject(fs.access(coreGzipPath));
});

test('precomputed work completion reads only the current snapshot hash', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const staleSnapshot = snapshot({ syncedAt: '2026-06-12T08:00:00.000Z' });

  await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
  });

  assert.equal(
    readPrecomputedTeamWorkCompletion(config, staleSnapshot, personnelArchitecture, {
      owner: '苏:佳*蕾',
      dashboardContext: 'direct',
      year: 2026,
    }),
    null
  );
});

test('hasCompletePrecompute returns manifest only for the current snapshot hash', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const staleSnapshot = snapshot({ syncedAt: '2026-06-12T08:00:00.000Z' });

  assert.equal(hasCompletePrecompute(sourceSnapshot, config), null);

  const manifest = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
  });

  assert.deepEqual(hasCompletePrecompute(sourceSnapshot, config), manifest);
  assert.equal(hasCompletePrecompute(staleSnapshot, config), null);
});

test('hasCompletePrecompute verifies indexed project detail files', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();

  const manifest = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
  });
  assert.deepEqual(hasCompletePrecompute(sourceSnapshot, config), manifest);

  const detailDir = path.join(config.precomputeDir, manifest.snapshotHash, 'project-detail');
  const [detailFile] = (await fs.readdir(detailDir)).filter((fileName) => fileName !== 'index.json');
  await fs.rm(path.join(detailDir, detailFile));

  assert.equal(hasCompletePrecompute(sourceSnapshot, config), null);
});

test('hasPrecomputedTeamBundle verifies files for the requested owner context and year', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const [owner] = ownersFromSnapshot(sourceSnapshot, personnelArchitecture);

  const manifest = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
  });
  assert.deepEqual(
    hasPrecomputedTeamBundle(sourceSnapshot, config, { owner, dashboardContext: 'direct', year: 2026 }),
    manifest
  );

  const summaryDir = path.join(config.precomputeDir, manifest.snapshotHash, 'team-work-completion-summary');
  const [summaryFile] = await fs.readdir(summaryDir);
  await fs.rm(path.join(summaryDir, summaryFile));

  assert.equal(hasCompletePrecompute(sourceSnapshot, config), null);
  assert.equal(hasPrecomputedTeamBundle(sourceSnapshot, config, { owner, dashboardContext: 'direct', year: 2026 }), null);
});

test('precomputed work completion filenames are safe on Windows', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
  });

  const summaryFiles = (
    await fs.readdir(path.join(config.precomputeDir, result.snapshotHash, 'team-work-completion-summary'))
  ).filter((fileName) => fileName.endsWith('.json') && !fileName.endsWith('.json.gz'));
  const detailFiles = (
    await fs.readdir(path.join(config.precomputeDir, result.snapshotHash, 'team-work-completion-detail'))
  ).filter((fileName) => fileName.endsWith('.json') && !fileName.endsWith('.json.gz'));
  assert.equal(summaryFiles.length, 1);
  assert.equal(detailFiles.length, 1);
  assert.doesNotMatch(summaryFiles[0], /[<>:"/\\|?*\x00-\x1f]/);
  assert.doesNotMatch(detailFiles[0], /[<>:"/\\|?*\x00-\x1f]/);
});
