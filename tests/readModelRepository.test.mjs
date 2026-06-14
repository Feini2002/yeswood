import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  READ_MODEL_SCHEMA_VERSION,
  publishReadModelDirectory,
  readDashboardSessionShellReadModel,
  readDashboardSessionReadModel,
  readProjectCatalogSummaryReadModel,
  readProjectDetailReadModel,
  readTeamWorkCompletionDetailReadModel,
} from '../src/backend/readModelRepository.mjs';

function ownerKey(owner) {
  return crypto.createHash('sha1').update(String(owner || '')).digest('hex').slice(0, 16);
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

async function seedReadModel(
  baseDir,
  {
    owner = 'Owner A',
    context = 'direct',
    year = 2026,
    schemaVersion = READ_MODEL_SCHEMA_VERSION,
    projectDetail = true,
    processingQueues = true,
    projectBoard = true,
    projectBoardSplitFields = true,
    catalogWorkflowFields = true,
    catalogStageReminderFields = true,
    catalogRawFields = false,
    asOfDate = '2026-06-11',
    summaryAsOfDate = asOfDate,
    detailAsOfDate = asOfDate,
  } = {}
) {
  const currentDir = path.join(baseDir, 'current');
  const processingQueuesPayload = {
    urgent: { totalCount: 0, topProjects: [] },
    normal: { totalCount: 0, topProjects: [] },
  };
  await writeJson(path.join(currentDir, 'manifest.json'), {
    schemaVersion,
    readModel: true,
    snapshotHash: 'hash-1',
    generatedAt: '2026-06-11T08:00:00.000Z',
    asOfDate,
    features: [
      'dashboard-session',
      'project-catalog-summary',
      ...(projectDetail ? ['project-detail'] : []),
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
  const projectBoardPayload = {
    year: 2026,
    previousYear: 2025,
    currentYearEntryTotal: 1,
    currentYearEntryDirect: 1,
    currentYearEntryFranchise: 0,
    pausedOrCanceled: 0,
    ...(projectBoardSplitFields ? { pausedProjectTotal: 0, canceledProjectTotal: 0 } : {}),
    closedProjectTotal: 0,
    closedProjectDirect: 0,
    closedProjectFranchise: 0,
    previousYearUnclosedTotal: 0,
    previousYearUnclosedDirect: 0,
    previousYearUnclosedFranchise: 0,
  };
  const catalogProject = {
    id: 'p1',
    name: 'P1',
    ...(catalogRawFields ? { rawFields: { Note: { display: 'large detail field', kind: 'text' } } } : {}),
    ...(catalogWorkflowFields
      ? { franchiseScope: 'direct', hardProgressStage: '施工图', softProgressStage: '未开始' }
      : {}),
    ...(catalogStageReminderFields
      ? {
          stageReminder: {
            currentStage: { key: 'displayInProgress', label: '摆场中', rank: 880 },
            primaryReminder: { label: '摆场结束', formatted: '--', message: '等待摆场结束', kind: 'stage_action' },
            dataGapCount: 0,
          },
          workflowFacts: {
            displayStarted: true,
            displayStartedAt: '2026-06-07',
            displayEnded: false,
            displayEndedAt: '',
            lifecycleClosed: false,
          },
        }
      : {}),
  };
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
    departmentMetrics: { profile: 'department', ...(projectBoard ? { projectBoard: projectBoardPayload } : {}) },
    profileDashboards: {
      direct: { metrics: { profile: 'direct' }, projects: [{ id: 'p1', name: 'P1' }] },
      franchise: { metrics: { profile: 'franchise' }, projects: [] },
    },
    projectCatalog: { items: [catalogProject], fieldCatalog: [] },
    team: { owner, dashboardContext: context, year },
  });
  await writeJson(path.join(currentDir, 'project-catalog', 'summary.json'), {
    items: [catalogProject],
    fieldCatalog: [],
    view: 'summary',
    readOnly: true,
  });
  if (projectDetail) {
    await writeJson(path.join(currentDir, 'project-detail', 'index.json'), {
      projectIds: ['p1'],
      total: 1,
      readOnly: true,
    });
    await writeJson(path.join(currentDir, 'project-detail', `${ownerKey('p1')}.json`), {
      id: 'p1',
      name: 'P1',
      province: 'Zhejiang',
      rawFields: {
        usefulNote: { display: 'Ready for detail', kind: 'text' },
      },
      readOnly: true,
    });
  }
  await writeJson(path.join(currentDir, 'profile-dashboard', 'department.json'), {
    profile: 'department',
    metrics: { profile: 'department', ...(projectBoard ? { projectBoard: projectBoardPayload } : {}) },
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
    asOfDate: summaryAsOfDate,
    summary: {},
    ...(processingQueues ? { processingQueues: processingQueuesPayload } : {}),
  });
  await writeJson(path.join(currentDir, 'team-work-completion-detail', `${ownerKey(owner)}__${context}__${year}.json`), {
    owner,
    requestedOwner: owner,
    dashboardContext: context,
    year,
    asOfDate: detailAsOfDate,
    summary: {},
    ...(processingQueues ? { processingQueues: processingQueuesPayload } : {}),
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

test('readDashboardSessionShellReadModel serves core without team sidecars', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir);
  await fs.rm(path.join(tempDir, 'current', 'team-work-completion-detail'), { recursive: true, force: true });

  const result = readDashboardSessionShellReadModel(
    { readModelDir: tempDir, devReloadEnabled: true },
    { dashboardContext: 'direct', year: 2026 }
  );

  assert.equal(result.status, 'ready');
  assert.equal(result.payload.shellOnly, true);
  assert.equal(result.payload.snapshot.dashboardDisplayMode, 'development');
  assert.equal(result.payload.metrics.summary.totalProjects, 1);
  assert.equal(result.payload.team.owner, '');
  assert.equal(result.payload.team.metrics, null);
  assert.equal(result.payload.team.workCompletion, null);
  assert.equal(result.payload.team.responsibilityReview, null);
  assert.equal(Object.hasOwn(result.payload, 'profileDashboards'), false);
  assert.equal(Object.hasOwn(result.payload, 'projectCatalog'), false);
});

test('readProjectCatalogSummaryReadModel serves catalog without dashboard sidecars', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir);

  const result = readProjectCatalogSummaryReadModel({ readModelDir: tempDir });

  assert.equal(result.status, 'ready');
  assert.equal(result.payload.items.length, 1);
  assert.equal(result.payload.items[0].id, 'p1');
  assert.equal(result.payload.view, 'summary');
  assert.equal(Object.hasOwn(result.payload.items[0], 'rawFields'), false);
});

test('readProjectCatalogSummaryReadModel rejects summary catalog raw fields', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir, { catalogRawFields: true });

  const result = readProjectCatalogSummaryReadModel({ readModelDir: tempDir });

  assert.equal(result.status, 'incomplete');
  assert.equal(result.payload, null);
  assert.match(result.reason, /raw fields/i);
});

test('readDashboardSessionReadModel rejects dashboard sessions without project board metrics', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir, { projectBoard: false });

  const result = readDashboardSessionReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026 }
  );

  assert.equal(result.status, 'incomplete');
  assert.equal(result.payload, null);
  assert.match(result.reason, /project board/i);
});

test('readDashboardSessionReadModel rejects project board metrics without pause and cancel splits', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir, { projectBoardSplitFields: false });

  const result = readDashboardSessionReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026 }
  );

  assert.equal(result.status, 'incomplete');
  assert.equal(result.payload, null);
  assert.match(result.reason, /project board/i);
});

test('readDashboardSessionReadModel keeps base catalog ready when base workflow fields are missing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir, { catalogWorkflowFields: false });

  const result = readDashboardSessionReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026 }
  );

  assert.equal(result.status, 'ready');
  assert.equal(result.payload.projectCatalog.interactionStatus, 'ready');
});

test('readDashboardSessionReadModel keeps base catalog ready when stage reminder fields are missing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir, { catalogStageReminderFields: false });

  const result = readDashboardSessionReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026 }
  );

  assert.equal(result.status, 'ready');
  assert.equal(result.payload.projectCatalog.interactionStatus, 'partial');
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

test('readTeamWorkCompletionDetailReadModel rejects stale asOfDate when today is provided', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir, { asOfDate: '2026-06-11' });

  const dateObjectResult = readTeamWorkCompletionDetailReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026, today: new Date('2026-06-10T16:00:00.000Z') }
  );
  const result = readTeamWorkCompletionDetailReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026, today: '2026-06-12' }
  );

  assert.equal(dateObjectResult.status, 'ready');
  assert.equal(result.status, 'incomplete');
  assert.equal(result.payload, null);
  assert.match(result.reason, /asOfDate is stale/);
});

test('readDashboardSessionReadModel rejects stale team work completion asOfDate when today is provided', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir, { asOfDate: '2026-06-11' });

  const result = readDashboardSessionReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026, today: '2026-06-12' }
  );

  assert.equal(result.status, 'incomplete');
  assert.equal(result.payload, null);
  assert.match(result.reason, /asOfDate is stale/);
});

test('readDashboardSessionReadModel rejects stale team work completion summary when detail is current', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir, {
    summaryAsOfDate: '2026-06-11',
    detailAsOfDate: '2026-06-12',
  });

  const result = readDashboardSessionReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026, today: '2026-06-12' }
  );

  assert.equal(result.status, 'incomplete');
  assert.equal(result.payload, null);
  assert.match(result.reason, /asOfDate is stale/);
});

test('readDashboardSessionReadModel rejects team sidecars with mismatched scope', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir);

  const summaryPath = path.join(
    tempDir,
    'current',
    'team-work-completion-summary',
    `${ownerKey('Owner A')}__direct__2026.json`
  );
  const responsibilityPath = path.join(
    tempDir,
    'current',
    'team-responsibility-review',
    `${ownerKey('Owner A')}__direct.json`
  );
  const summaryPayload = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
  const responsibilityPayload = JSON.parse(await fs.readFile(responsibilityPath, 'utf8'));
  await fs.writeFile(summaryPath, `${JSON.stringify({ ...summaryPayload, owner: 'Owner B' })}\n`, 'utf8');
  await fs.writeFile(
    responsibilityPath,
    `${JSON.stringify({ ...responsibilityPayload, dashboardContext: 'franchise' })}\n`,
    'utf8'
  );

  const result = readDashboardSessionReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026, today: '2026-06-11' }
  );

  assert.equal(result.status, 'incomplete');
  assert.equal(result.payload, null);
  assert.match(result.reason, /scope is mismatched/);
});

test('readTeamWorkCompletionDetailReadModel rejects detail sidecars with mismatched scope', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir);

  const detailPath = path.join(
    tempDir,
    'current',
    'team-work-completion-detail',
    `${ownerKey('Owner A')}__direct__2026.json`
  );
  const detailPayload = JSON.parse(await fs.readFile(detailPath, 'utf8'));
  await fs.writeFile(detailPath, `${JSON.stringify({ ...detailPayload, year: 2025 })}\n`, 'utf8');

  const result = readTeamWorkCompletionDetailReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026, today: '2026-06-11' }
  );

  assert.equal(result.status, 'incomplete');
  assert.equal(result.payload, null);
  assert.match(result.reason, /scope is mismatched/);
});

test('readTeamWorkCompletionDetailReadModel only returns stale detail when explicitly allowed', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir);
  await fs.rename(path.join(tempDir, 'current'), path.join(tempDir, 'last-known-good'));
  await seedReadModel(tempDir);
  await fs.rm(path.join(tempDir, 'current', 'team-work-completion-detail'), { recursive: true, force: true });

  const params = { owner: 'Owner A', dashboardContext: 'direct', year: 2026 };
  const currentOnly = readTeamWorkCompletionDetailReadModel({ readModelDir: tempDir }, params);
  const staleAllowed = readTeamWorkCompletionDetailReadModel({ readModelDir: tempDir }, params, { allowStale: true });

  assert.equal(currentOnly.status, 'incomplete');
  assert.equal(currentOnly.payload, null);
  assert.match(currentOnly.reason, /detail read model is missing/i);
  assert.equal(staleAllowed.status, 'stale');
  assert.equal(staleAllowed.payload.detailReady, true);
  assert.deepEqual(staleAllowed.payload.projectsById, { p1: { id: 'p1', name: 'P1' } });
});

test('readProjectDetailReadModel reads project detail by id without a snapshot', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir);

  const result = readProjectDetailReadModel({ readModelDir: tempDir }, { projectId: 'p1' });

  assert.equal(result.status, 'ready');
  assert.equal(result.payload.id, 'p1');
  assert.equal(result.payload.province, 'Zhejiang');
  assert.equal(result.payload.rawFields.usefulNote.display, 'Ready for detail');
});

test('readProjectDetailReadModel distinguishes nonexistent projects from preparing details', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir);
  const currentDir = path.join(tempDir, 'current');
  await writeJson(path.join(currentDir, 'project-detail', 'index.json'), {
    projectIds: ['p1', 'p2'],
    total: 2,
    readOnly: true,
  });

  const notFound = readProjectDetailReadModel({ readModelDir: tempDir }, { projectId: 'missing' });
  const preparing = readProjectDetailReadModel({ readModelDir: tempDir }, { projectId: 'p2' });

  assert.equal(notFound.status, 'not_found');
  assert.equal(preparing.status, 'incomplete');
  assert.match(preparing.reason, /missing/i);
});

test('readDashboardSessionReadModel serves compatible core while new detail models are warming', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir, {
    schemaVersion: 5,
    projectDetail: false,
    processingQueues: false,
  });

  const result = readDashboardSessionReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026 }
  );
  const detail = readProjectDetailReadModel({ readModelDir: tempDir }, { projectId: 'p1' });

  assert.equal(result.status, 'ready');
  assert.equal(result.payload.readModel, true);
  assert.equal(result.payload.schemaVersion, 5);
  assert.equal(result.payload.team.workCompletion.owner, 'Owner A');
  assert.equal(result.payload.team.workCompletion.processingQueues, undefined);
  assert.equal(detail.status, 'incomplete');
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

test('readDashboardSessionReadModel tolerates missing processing queues while detail reader rejects them', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir, { processingQueues: false });

  const session = readDashboardSessionReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026 }
  );
  const detail = readTeamWorkCompletionDetailReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026 }
  );

  assert.equal(session.status, 'ready');
  assert.equal(session.payload.team.workCompletion.processingQueues, undefined);
  assert.equal(detail.status, 'incomplete');
  assert.equal(detail.payload, null);
  assert.match(detail.reason, /processing queue/i);
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

test('readDashboardSessionReadModel does not serve last-known-good stale team details', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-model-repository-'));
  await seedReadModel(tempDir);
  await fs.rename(path.join(tempDir, 'current'), path.join(tempDir, 'last-known-good'));
  await writeJson(path.join(tempDir, 'current', 'manifest.json'), {
    schemaVersion: READ_MODEL_SCHEMA_VERSION,
    readModel: true,
    snapshotHash: 'hash-current',
    generatedAt: '2026-06-12T08:00:00.000Z',
    features: ['dashboard-session'],
    owners: [{ owner: 'Owner A', key: ownerKey('Owner A') }],
  });

  const result = readDashboardSessionReadModel(
    { readModelDir: tempDir },
    { owner: 'Owner A', dashboardContext: 'direct', year: 2026 }
  );

  assert.equal(result.status, 'incomplete');
  assert.equal(result.payload, null);
  assert.doesNotMatch(JSON.stringify(result), /projectsById|detailReady|stale/);
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
