import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterProjectsLocally,
  fetchProjectCatalog,
  fetchProjectDetail,
  hasComplexProjectFilters,
  invalidateProjectCaches,
  peekDrillProjectsCache,
  projectsFromIdList,
  resolveDrillProjects,
} from '../public/domain/project-catalog.mjs';

test('filterProjectsLocally applies basic list filters', () => {
  const projects = [
    { id: '1', name: '杭州店', province: '浙江', businessType: '餐饮', storeStatus: '常规店', status: '正常', rawFields: {} },
    { id: '2', name: '上海店', province: '上海', businessType: '零售', storeStatus: '旗舰店', status: '紧急', rawFields: {} },
  ];

  assert.equal(
    filterProjectsLocally(projects, { search: '杭州', province: '', businessType: '', storeStatus: '', status: '' }).length,
    1
  );
  assert.equal(
    filterProjectsLocally(projects, { search: '', province: '上海', businessType: '', storeStatus: '', status: '' })[0]?.id,
    '2'
  );
});

test('hasComplexProjectFilters detects drill-only filters', () => {
  assert.equal(hasComplexProjectFilters({ search: 'abc' }), false);
  assert.equal(hasComplexProjectFilters({ metric: 'openDelayed' }), true);
  assert.equal(hasComplexProjectFilters({ tier: 'flagship' }), true);
});

test('projectsFromIdList maps catalog entries by id', async () => {
  const { state } = await import('../public/lib/state.mjs');
  state.allProjects = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ];
  const items = projectsFromIdList(['b', 'missing', 'a']);
  assert.deepEqual(items.map((item) => item.id), ['b', 'a']);
});

test('resolveDrillProjects caches results and reuses drill ids path', async () => {
  const { state } = await import('../public/lib/state.mjs');
  const { runtimeStore } = await import('../public/lib/runtime-flags.mjs');
  const { snapshotSignature } = await import('../public/realtime.js');
  state.snapshot = { syncedAt: '2026-06-11T00:00:00.000Z', totalRecords: 2 };
  state.allProjects = [
    { id: 'a', name: 'Alpha', province: '浙江', businessType: '餐饮', storeStatus: '常规店', status: '正常', rawFields: {} },
    { id: 'b', name: 'Beta', province: '上海', businessType: '零售', storeStatus: '旗舰店', status: '紧急', rawFields: {} },
  ];
  state.projectsCatalogLoaded = true;
  state.projectsCatalogSignature = snapshotSignature(state.snapshot);

  let idRequests = 0;
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('fields=ids')) {
      idRequests += 1;
      return {
        ok: true,
        json: async () => ({ ids: ['a'], total: 1, readOnly: true }),
      };
    }
    throw new Error(`unexpected fetch ${path}`);
  };

  const filters = { owner: 'Owner A', metric: 'openDelayed', dashboardContext: 'direct' };
  const first = await resolveDrillProjects(filters);
  const second = await resolveDrillProjects(filters);
  assert.equal(first.length, 1);
  assert.equal(first[0].id, 'a');
  assert.equal(second, first);
  assert.equal(idRequests, 1);
  assert.equal(peekDrillProjectsCache(filters)?.length, 1);

  invalidateProjectCaches({ catalog: false, drill: true, details: false });
  runtimeStore.drillResolvePromises = new Map();
  assert.equal(peekDrillProjectsCache(filters), null);
});

test('resolveDrillProjects resolves lifecycle drills locally from a fresh catalog', async () => {
  const { state } = await import('../public/lib/state.mjs');
  const { runtimeStore } = await import('../public/lib/runtime-flags.mjs');
  const { snapshotSignature } = await import('../public/realtime.js');
  state.snapshot = { syncedAt: '2026-06-11T00:00:00.000Z', totalRecords: 2 };
  state.allProjects = [
    {
      id: 'plan-1',
      name: 'Plan Project',
      province: '浙江',
      businessType: '购物中心',
      storeStatus: '常规店',
      status: '正常',
      stageReminder: { currentStage: { key: 'floorPlanDone', label: '平面方案完成', rank: 480 } },
      workflowFacts: { lifecycleClosed: false },
    },
    {
      id: 'purchase-1',
      name: 'Purchase Project',
      province: '上海',
      businessType: '购物中心',
      storeStatus: '常规店',
      status: '正常',
      stageReminder: { currentStage: { key: 'purchaseInProgress', label: '采购中', rank: 800 } },
      workflowFacts: { lifecycleClosed: false, purchaseStarted: true },
    },
  ];
  state.projectsCatalogLoaded = true;
  state.projectsCatalogSignature = snapshotSignature(state.snapshot);
  runtimeStore.drillProjectsCache = new Map();
  runtimeStore.drillResolvePromises = new Map();

  globalThis.fetch = async (url) => {
    throw new Error(`lifecycle drill should not request ${url}`);
  };

  const result = await resolveDrillProjects({ lifecycleStage: 'plan' });

  assert.deepEqual(result.map((item) => item.id), ['plan-1']);
  assert.equal(peekDrillProjectsCache({ lifecycleStage: 'plan' })?.[0]?.id, 'plan-1');
});

test('stale summary catalog does not become fresh for current snapshot', async () => {
  const { state } = await import('../public/lib/state.mjs');
  const { runtimeStore } = await import('../public/lib/runtime-flags.mjs');
  const { snapshotSignature } = await import('../public/realtime.js');
  state.snapshot = { syncedAt: '2026-06-11T00:00:00.000Z', totalRecords: 2 };
  state.allProjects = [];
  state.projectsCatalogLoaded = false;
  state.projectsCatalogSignature = '';
  runtimeStore.projectCatalogPromise = null;
  runtimeStore.projectDetailCache = new Map([
    ['stale-1', { signature: snapshotSignature(state.snapshot), project: { id: 'stale-1', name: 'Old detail' } }],
  ]);
  runtimeStore.projectDetailPromises = new Map();

  const requests = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    requests.push(path);
    assert.match(path, /\/api\/projects\?view=summary/);
    return {
      ok: true,
      json: async () => ({
        stale: true,
        items: [{ id: `stale-${requests.length}`, name: 'Stale catalog item' }],
        fieldCatalog: [],
      }),
    };
  };

  const first = await fetchProjectCatalog();
  const second = await fetchProjectCatalog();

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(requests.length, 2);
  assert.notEqual(state.projectsCatalogSignature, snapshotSignature(state.snapshot));
  assert.equal(runtimeStore.projectDetailCache.size, 0);
});

test('late summary catalog response keeps its request signature instead of the current snapshot', async () => {
  const { state } = await import('../public/lib/state.mjs');
  const { runtimeStore } = await import('../public/lib/runtime-flags.mjs');
  const { snapshotSignature } = await import('../public/realtime.js');
  const snapshotA = { syncedAt: '2026-06-11T00:00:00.000Z', totalRecords: 1 };
  const snapshotB = { syncedAt: '2026-06-12T00:00:00.000Z', totalRecords: 2 };
  const signatureA = snapshotSignature(snapshotA);
  const signatureB = snapshotSignature(snapshotB);
  state.snapshot = snapshotA;
  state.allProjects = [];
  state.projectsCatalogLoaded = false;
  state.projectsCatalogSignature = '';
  runtimeStore.projectCatalogPromise = null;

  let resolvePayload;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () =>
      new Promise((resolve) => {
        resolvePayload = resolve;
      }),
  });

  const request = fetchProjectCatalog();
  await Promise.resolve();
  state.snapshot = snapshotB;
  resolvePayload({
    items: [{ id: 'from-a', name: 'Old snapshot catalog' }],
    fieldCatalog: [],
  });
  const result = await request;

  assert.deepEqual(result.map((item) => item.id), ['from-a']);
  assert.equal(state.projectsCatalogSignature, signatureA);
  assert.notEqual(state.projectsCatalogSignature, signatureB);
});

test('resolveDrillProjects does not compose ids against a preserved stale catalog', async () => {
  const { state } = await import('../public/lib/state.mjs');
  const { runtimeStore } = await import('../public/lib/runtime-flags.mjs');
  const { snapshotSignature } = await import('../public/realtime.js');
  const oldSnapshot = { syncedAt: '2026-06-11T00:00:00.000Z', totalRecords: 1 };
  const newSnapshot = { syncedAt: '2026-06-12T00:00:00.000Z', totalRecords: 1 };
  state.snapshot = newSnapshot;
  state.allProjects = [{ id: 'shared', name: 'Old Catalog Project' }];
  state.projectsCatalogLoaded = false;
  state.projectsCatalogSignature = snapshotSignature(oldSnapshot);
  runtimeStore.projectCatalogPromise = null;
  runtimeStore.drillProjectsCache = new Map();
  runtimeStore.drillResolvePromises = new Map();
  runtimeStore.drillPreloadKeys = new Set();

  const requested = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    requested.push(path);
    if (path === '/api/projects?view=summary') {
      return {
        ok: true,
        json: async () => ({
          stale: true,
          items: [{ id: 'shared', name: 'Old Catalog Project' }],
          fieldCatalog: [],
          snapshotSignature: snapshotSignature(oldSnapshot),
        }),
      };
    }
    if (path.includes('fields=ids')) {
      throw new Error('stale catalog must not be used for id composition');
    }
    if (path.includes('view=summary')) {
      return {
        ok: true,
        json: async () => ({
          items: [{ id: 'shared', name: 'Fresh Filtered Project' }],
          fieldCatalog: [],
        }),
      };
    }
    throw new Error(`unexpected fetch ${path}`);
  };

  const result = await resolveDrillProjects({ metric: 'openDelayed' }, { useCache: false });

  assert.deepEqual(result.map((item) => item.name), ['Fresh Filtered Project']);
  assert.equal(requested.some((path) => path.includes('fields=ids')), false);
});

test('fetchProjectDetail uses read model fallback and caches returned detail', async () => {
  const { state } = await import('../public/lib/state.mjs');
  const { runtimeStore } = await import('../public/lib/runtime-flags.mjs');
  const { snapshotSignature } = await import('../public/realtime.js');
  state.snapshot = { syncedAt: '2026-06-11T00:00:00.000Z', totalRecords: 1 };
  state.projectsCatalogSignature = snapshotSignature(state.snapshot);
  runtimeStore.projectDetailCache = new Map();
  runtimeStore.projectDetailPromises = new Map();

  const requested = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    requested.push(path);
    return {
      ok: true,
      json: async () => ({
        item: {
          id: 'p1',
          name: 'Project One',
          province: 'Zhejiang',
          rawFields: { usefulNote: { display: 'Ready for detail', kind: 'text' } },
        },
      }),
    };
  };

  const project = await fetchProjectDetail('p1');

  assert.equal(project.name, 'Project One');
  assert.match(requested[0], /\/api\/projects\?id=p1&view=full&fallback=readModel/);
  assert.equal(runtimeStore.projectDetailCache.get('p1')?.project.name, 'Project One');
});

test('fetchProjectDetail does not compute detail when read model is still preparing', async () => {
  const { state } = await import('../public/lib/state.mjs');
  const { runtimeStore } = await import('../public/lib/runtime-flags.mjs');
  const { snapshotSignature } = await import('../public/realtime.js');
  state.snapshot = { syncedAt: '2026-06-11T00:00:00.000Z', totalRecords: 1 };
  state.projectsCatalogSignature = snapshotSignature(state.snapshot);
  runtimeStore.projectDetailCache = new Map();
  runtimeStore.projectDetailPromises = new Map();

  const requested = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    requested.push(path);
    if (path.includes('fallback=readModel')) {
      return {
        ok: true,
        json: async () => ({ status: 'preparing', readModel: true }),
      };
    }
    throw new Error(`unexpected fetch ${path}`);
  };

  const project = await fetchProjectDetail('p1');

  assert.equal(project, null);
  assert.match(requested[0], /fallback=readModel/);
  assert.equal(requested.length, 1);
  assert.equal(runtimeStore.projectDetailCache.has('p1'), false);
});

test('fetchProjectDetail remembers canonical and record id aliases', async () => {
  const { state } = await import('../public/lib/state.mjs');
  const { runtimeStore } = await import('../public/lib/runtime-flags.mjs');
  const { snapshotSignature } = await import('../public/realtime.js');
  state.snapshot = { syncedAt: '2026-06-11T00:00:00.000Z', totalRecords: 1 };
  state.projectsCatalogSignature = snapshotSignature(state.snapshot);
  runtimeStore.projectDetailCache = new Map();
  runtimeStore.projectDetailPromises = new Map();

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      item: {
        id: 'canonical-1',
        recordMeta: { id: 'record-1', lastModifiedTime: '2026-06-11T00:00:00.000Z' },
        name: 'Project One',
        province: 'Zhejiang',
      },
    }),
  });

  const project = await fetchProjectDetail('record-1');

  assert.equal(project.id, 'canonical-1');
  assert.equal(runtimeStore.projectDetailCache.get('record-1')?.project.id, 'canonical-1');
  assert.equal(runtimeStore.projectDetailCache.get('canonical-1')?.project.id, 'canonical-1');
});

test('invalidateProjectCaches clears catalog freshness while preserving visible catalog rows', async () => {
  const { state } = await import('../public/lib/state.mjs');
  state.projectsCatalogLoaded = true;
  state.projectsCatalogSignature = 'stale';
  state.allProjects = [{ id: 'x' }];
  invalidateProjectCaches({ catalog: true, drill: true, details: true });
  assert.equal(state.projectsCatalogLoaded, false);
  assert.equal(state.projectsCatalogSignature, '');
  assert.deepEqual(state.allProjects, [{ id: 'x' }]);
});
