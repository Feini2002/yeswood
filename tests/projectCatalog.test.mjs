import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterProjectsLocally,
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

test('invalidateProjectCaches clears catalog signature', async () => {
  const { state } = await import('../public/lib/state.mjs');
  state.projectsCatalogLoaded = true;
  state.projectsCatalogSignature = 'stale';
  state.allProjects = [{ id: 'x' }];
  invalidateProjectCaches({ catalog: true, drill: true, details: true });
  assert.equal(state.projectsCatalogLoaded, false);
  assert.equal(state.projectsCatalogSignature, '');
  assert.equal(state.allProjects.length, 0);
});
