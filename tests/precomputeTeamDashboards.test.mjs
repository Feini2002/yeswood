import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  hasCompletePrecompute,
  ownersFromSnapshot,
  precomputeSnapshotHash,
  precomputeTeamDashboards,
  readPrecomputedDashboardSession,
  readPrecomputedTeamMetricsBatch,
  readPrecomputedTeamResponsibilityReview,
  readPrecomputedTeamWorkCompletion,
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
    rawFields: {
      项目名称: raw(id),
      组别: raw('直营新店'),
      店态: raw('新店'),
      业态: raw('旗舰店'),
      省份: raw('浙江'),
      负责人: raw('苏:佳*蕾'),
      CD设计师: raw('陈菲菲'),
      硬装项目进度: raw('闭环'),
      软装项目进度: raw('闭环'),
      项目闭环时间: raw('2026-06-15'),
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

test('precomputeTeamDashboards writes work completion payloads that match live calculation', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();

  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
    now: new Date('2026-06-11T00:00:00.000Z'),
  });

  assert.equal(result.snapshotHash, precomputeSnapshotHash(sourceSnapshot, personnelArchitecture));
  assert.ok(result.features.includes('team-work-completion'));
  assert.ok(result.features.includes('team-metrics'));

  const actual = readPrecomputedTeamWorkCompletion(config, sourceSnapshot, personnelArchitecture, {
    owner: '苏:佳*蕾',
    requestedOwner: '苏:佳*蕾',
    dashboardContext: 'direct',
    year: 2026,
  });
  const expected = buildTeamWorkCompletionReview(sourceSnapshot.projects, personnelArchitecture.teams[0], {
    requestedOwner: '苏:佳*蕾',
    dashboardContext: 'direct',
    personnelArchitecture,
    year: 2026,
  });

  assert.deepEqual(actual, expected);
  assert.ok(Object.keys(actual.projectsById).length > 0);
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
  assert.equal(sessionFromFile.schemaVersion, 1);
  assert.equal(sessionFromFile.snapshotHash, result.snapshotHash);
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

test('precomputed work completion filenames are safe on Windows', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'precompute-team-dashboard-'));
  const config = { precomputeDir: path.join(tempDir, 'precomputed') };
  const sourceSnapshot = snapshot();
  const result = await precomputeTeamDashboards(sourceSnapshot, {
    config,
    contexts: ['direct'],
    years: [2026],
  });

  const files = await fs.readdir(path.join(config.precomputeDir, result.snapshotHash, 'team-work-completion'));
  assert.equal(files.length, 1);
  assert.doesNotMatch(files[0], /[<>:"/\\|?*\x00-\x1f]/);
});
