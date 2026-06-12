import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createProjectSnapshot, clearSnapshotCache, getSnapshot, syncProjects } from '../src/backend/syncService.mjs';
import { resolveFieldMap } from '../src/backend/fieldResolver.mjs';
import {
  precomputeTeamDashboards,
  ownersFromSnapshot,
  readPrecomputedTeamMetricsBatch,
  readPrecomputedTeamWorkCompletion,
  readPrecomputedTeamWorkCompletionDetail,
} from '../src/backend/precomputeTeamDashboards.mjs';

test('createProjectSnapshot excludes accidental rows from metrics, filters, and details', () => {
  const fieldMap = {
    name: '项目名称（不要自己添加任何项目）',
    province: '省份',
    businessType: '业态',
    storeStatus: '店态',
    owner: '负责人',
    startDate: '启动时间',
    dueDate: '计划开业时间',
  };

  const snapshot = createProjectSnapshot({
    source: 'test',
    fieldMap,
    personnelArchitecture: {
      roleDisciplines: {
        cdLead: 'hard',
      },
    },
    records: [
      {
        recordId: 'valid-1',
        fields: {
          '项目名称（不要自己添加任何项目）': '太原万柏林七美店',
          组别: { name: '加盟老店' },
          店态: { name: '高标店' },
          业态: { name: '家居卖场' },
          省份: '陕西省',
          面积: 450,
          启动时间: 1771862400000,
          计划开业时间: 1782777600000,
          CD组长: '张宸瑞',
        },
      },
      {
        recordId: 'accidental-name-only',
        fields: {
          '项目名称（不要自己添加任何项目）': '太原万柏林七美店',
          软装项目进度: { name: '未开始' },
        },
      },
      {
        recordId: 'accidental-blank',
        fields: {
          负责人: [{ name: '苏佳蕾' }],
        },
      },
    ],
  });

  assert.equal(snapshot.sourceRecords, 3);
  assert.equal(snapshot.totalRecords, 1);
  assert.equal(snapshot.ignoredRecords, 2);
  assert.deepEqual(snapshot.projects.map((project) => project.id), ['valid-1']);
  assert.equal(snapshot.metrics.summary.totalProjects, 1);
  assert.deepEqual(snapshot.filters.storeStatuses, ['高标店']);
  assert.equal(snapshot.metrics.personnel.roles.find((role) => role.key === 'cdLead').disciplineLabel, '硬装');
});

test('syncProjects seeds SQLite and getSnapshot reads the SQLite final project view', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-sqlite-sync-'));
  const config = {
    mode: 'mock',
    cacheFile: path.join(tempDir, 'dashboard-cache.json'),
    databaseFile: path.join(tempDir, 'app.sqlite'),
    precomputeDir: path.join(tempDir, 'precomputed'),
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
  };

  const synced = await syncProjects({ config, source: 'mock' });
  const snapshot = await getSnapshot(config);
  const cachedSnapshot = JSON.parse(await fs.readFile(config.cacheFile, 'utf8'));

  assert.equal(synced.totalRecords > 0, true);
  assert.equal(synced.storage, 'sqlite');
  assert.equal(synced.databaseReady, true);
  assert.equal(cachedSnapshot.storage, 'sqlite');
  assert.equal(cachedSnapshot.databaseReady, true);
  assert.equal(snapshot.storage, 'sqlite');
  assert.equal(snapshot.databaseReady, true);
  assert.equal(snapshot.totalRecords, synced.totalRecords);
  assert.equal(cachedSnapshot.totalRecords, snapshot.totalRecords);
  assert.equal(snapshot.metrics.summary.totalProjects, synced.totalRecords);
  assert.ok(snapshot.filters.provinces.length > 0);
});

test('syncProjects schedules dashboard precompute after returning the SQLite refreshed snapshot', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-sqlite-precompute-'));
  let queuedPrecompute = null;
  const config = {
    mode: 'mock',
    cacheFile: path.join(tempDir, 'dashboard-cache.json'),
    databaseFile: path.join(tempDir, 'app.sqlite'),
    precomputeDir: path.join(tempDir, 'precomputed'),
    precomputeScheduler: (task) => {
      queuedPrecompute = task;
    },
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
  };

  const synced = await syncProjects({ config, source: 'mock' });
  const [owner] = ownersFromSnapshot(synced, synced.personnelArchitecture);
  assert.equal(typeof queuedPrecompute, 'function');
  assert.equal(config.precomputeScheduledHashes?.size, 1);
  assert.equal(
    readPrecomputedTeamWorkCompletion(config, synced, synced.personnelArchitecture, {
      owner,
      dashboardContext: 'all',
      year: new Date().getFullYear(),
    }),
    null
  );
  assert.equal(
    readPrecomputedTeamMetricsBatch(config, synced, synced.personnelArchitecture, {
      owners: [owner],
      dashboardContext: 'all',
    }),
    null
  );

  await queuedPrecompute();
  assert.equal(config.precomputeScheduledHashes?.size || 0, 0);
  const payload = readPrecomputedTeamWorkCompletion(config, synced, synced.personnelArchitecture, {
    owner,
    dashboardContext: 'all',
    year: new Date().getFullYear(),
  });
  const detailPayload = readPrecomputedTeamWorkCompletionDetail(config, synced, synced.personnelArchitecture, {
    owner,
    dashboardContext: 'all',
    year: new Date().getFullYear(),
  });
  const metricsPayload = readPrecomputedTeamMetricsBatch(config, synced, synced.personnelArchitecture, {
    owners: [owner],
    dashboardContext: 'all',
  });

  assert.ok(owner);
  assert.equal(payload?.readOnly, true);
  assert.equal(payload?.owner, owner);
  assert.equal(payload?.projectsById, undefined);
  assert.equal(typeof detailPayload?.projectsById, 'object');
  assert.equal(metricsPayload?.readOnly, true);
  assert.equal(metricsPayload?.metricsByOwner?.[owner]?.owner, owner);
});

test('getSnapshot schedules dashboard precompute when reading an existing SQLite snapshot', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-sqlite-existing-precompute-'));
  const baseConfig = {
    mode: 'mock',
    cacheFile: path.join(tempDir, 'dashboard-cache.json'),
    databaseFile: path.join(tempDir, 'app.sqlite'),
    precomputeDir: path.join(tempDir, 'precomputed'),
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
  };
  await syncProjects({
    config: {
      ...baseConfig,
      precomputeEnabled: false,
    },
    source: 'mock',
  });

  let queuedPrecompute = null;
  const config = {
    ...baseConfig,
    precomputeScheduler: (task) => {
      queuedPrecompute = task;
    },
  };

  const snapshot = await getSnapshot(config);
  const [owner] = ownersFromSnapshot(snapshot, snapshot.personnelArchitecture);
  assert.ok(owner);
  assert.equal(typeof queuedPrecompute, 'function');
  assert.equal(config.precomputeScheduledHashes?.size, 1);
  assert.equal(
    readPrecomputedTeamMetricsBatch(config, snapshot, snapshot.personnelArchitecture, {
      owners: [owner],
      dashboardContext: 'all',
    }),
    null
  );

  await queuedPrecompute();
  assert.equal(config.precomputeScheduledHashes?.size || 0, 0);
  const metricsPayload = readPrecomputedTeamMetricsBatch(config, snapshot, snapshot.personnelArchitecture, {
    owners: [owner],
    dashboardContext: 'all',
  });

  assert.equal(metricsPayload?.metricsByOwner?.[owner]?.owner, owner);
});

test('getSnapshot skips dashboard precompute scheduling when complete read model already exists', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-sqlite-precompute-complete-'));
  const config = {
    mode: 'mock',
    cacheFile: path.join(tempDir, 'dashboard-cache.json'),
    databaseFile: path.join(tempDir, 'app.sqlite'),
    precomputeDir: path.join(tempDir, 'precomputed'),
    readModelDir: path.join(tempDir, 'read-model'),
    precomputeEnabled: false,
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
  };
  await syncProjects({ config, source: 'mock' });
  const snapshot = await getSnapshot(config);
  await precomputeTeamDashboards(snapshot, { config });
  clearSnapshotCache(config);

  let queuedPrecompute = null;
  config.precomputeEnabled = true;
  config.precomputeScheduler = (task) => {
    queuedPrecompute = task;
  };

  await getSnapshot(config);

  assert.equal(queuedPrecompute, null);
});

test('clearSnapshotCache clears the precompute manifest index', () => {
  const config = {
    precomputeIndex: new Map([['hash', { snapshotHash: 'hash' }]]),
  };

  clearSnapshotCache(config);

  assert.equal(config.precomputeIndex, null);
});

test('getSnapshot reuses the current in-process snapshot for unchanged data files', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-snapshot-cache-'));
  const config = {
    mode: 'mock',
    cacheFile: path.join(tempDir, 'dashboard-cache.json'),
    databaseFile: path.join(tempDir, 'app.sqlite'),
    precomputeDir: path.join(tempDir, 'precomputed'),
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
  };

  await syncProjects({ config, source: 'mock' });
  const first = await getSnapshot(config);
  const second = await getSnapshot(config);

  assert.equal(second, first);
});

test('createProjectSnapshot resolves stale env field names through auto field mapping', () => {
  const records = [
    {
      recordId: 'valid-1',
      fields: {
        '项目名称（不要自己添加/删除任何项目）': '太原万柏林七美店',
        组别: { name: '加盟老店' },
        店态: { name: '高标店' },
        业态: { name: '家居卖场' },
        省份: '陕西省',
        面积: 450,
        启动时间: 1771862400000,
        计划开业时间: 1782777600000,
      },
    },
  ];

  const fieldResolution = resolveFieldMap(Object.keys(records[0].fields), {
    envFieldMap: {
      name: '项目名称（不要自己添加任何项目）',
      province: '省份',
      businessType: '业态',
      storeStatus: '店态',
      owner: '负责人',
      startDate: '启动时间',
      dueDate: '计划开业时间',
    },
  });

  const snapshot = createProjectSnapshot({
    source: 'test',
    records,
    fieldMap: fieldResolution.fieldMap,
    fieldMapping: fieldResolution.fieldMap,
    fieldMappingWarnings: fieldResolution.fieldMappingWarnings,
  });

  assert.equal(fieldResolution.fieldMap.name, '项目名称（不要自己添加/删除任何项目）');
  assert.equal(snapshot.totalRecords, 1);
  assert.equal(snapshot.ignoredRecords, 0);
  assert.equal(snapshot.fieldMapping.name, '项目名称（不要自己添加/删除任何项目）');
});
