import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPublicAppHarness } from '../public/test-harness.mjs';

async function loadHarness({ fetchImpl } = {}) {
  return loadPublicAppHarness({ fetchImpl });
}

test('dashboard payload normalization keeps missing API sections renderable', async () => {
  const app = await loadHarness();

  assert.equal(typeof app.normalizeDashboardPayload, 'function');
  const normalized = app.normalizeDashboardPayload({
    snapshot: null,
    projects: { total: 3 },
    metrics: null,
    fullMetrics: undefined,
    departmentMetrics: null,
  });

  assert.equal(Array.isArray(normalized.projects), true);
  assert.equal(normalized.projects.length, 0);
  assert.equal(Array.isArray(normalized.fieldCatalog), true);
  assert.equal(normalized.fieldCatalog.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.snapshot)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.metrics)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.fullMetrics)), {});
  assert.equal(normalized.departmentMetrics, null);
});

test('details workbench empty states explain the current desktop filter context', async () => {
  const app = await loadHarness();

  assert.equal(typeof app.renderProjectWorkbenchEmptyState, 'function');
  const filtered = app.renderProjectWorkbenchEmptyState('filtered');
  const paused = app.renderProjectWorkbenchEmptyState('paused');
  const incomplete = app.renderProjectWorkbenchEmptyState('incomplete');

  assert.match(filtered, /暂无匹配项目/);
  assert.match(filtered, /调整搜索或筛选条件/);
  assert.match(paused, /暂无暂停项目/);
  assert.match(incomplete, /暂无人员配置待补全项目/);
});

test('refresh renders a recoverable dashboard error state instead of throwing', async () => {
  const app = await loadHarness({
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });

  await assert.doesNotReject(() => app.refresh());
  assert.match(app.elements.kpiGrid.innerHTML, /看板加载失败|刷新失败|dashboard-status-panel/);
  assert.match(app.elements.syncMessage.textContent, /刷新失败|加载失败/);
});

test('refresh renders successful overview data without falling back to the startup error panel', async () => {
  const app = await loadHarness({
    fetchImpl: async (path) => {
      const url = String(path);
      if (url.startsWith('/api/dashboard-session')) {
        return {
          ok: true,
          json: async () => ({
            schemaVersion: 1,
            readOnly: true,
            snapshotHash: 'smoke-session',
            snapshot: {
              source: 'dingtalk',
              syncedAt: '2026-06-09T06:13:02.686Z',
              totalRecords: 1,
              developerDocumentationVisible: true,
              readOnly: true,
            },
            filters: { provinces: [], businessTypes: [], storeStatuses: [], statuses: [] },
            metrics: {
              total: 1,
              pausedCount: 0,
              summary: { totalProjects: 1, scopeCount: 1, pausedProjects: 0 },
              statusCounts: [],
              monthlyTrend: [],
              riskProjects: [],
              urgentStatusProjects: [],
              openDelayedProjects: [],
            },
            departmentMetrics: null,
            team: {
              owner: '',
              dashboardContext: 'all',
              year: 2026,
              metrics: null,
              workCompletion: null,
              responsibilityReview: null,
            },
          }),
        };
      }
      if (url.startsWith('/api/snapshot')) {
        return {
          ok: true,
          json: async () => ({
            source: 'dingtalk',
            syncedAt: '2026-06-09T06:13:02.686Z',
            totalRecords: 1,
            developerDocumentationVisible: true,
          }),
        };
      }
      if (url.startsWith('/api/projects')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                id: 'p-1',
                name: 'Smoke Project',
                owner: 'Owner A',
                province: 'Shanghai',
                status: 'normal',
                storeStatus: 'new',
                businessType: 'direct',
                updatedAt: '2026-06-09',
              },
            ],
            fieldCatalog: [],
          }),
        };
      }
      if (url.startsWith('/api/metrics')) {
        return {
          ok: true,
          json: async () => ({
            total: 1,
            pausedCount: 0,
            summary: { totalProjects: 1, scopeCount: 1, pausedProjects: 0 },
            statusCounts: [],
            monthlyTrend: [],
            riskProjects: [],
            urgentStatusProjects: [],
            openDelayedProjects: [],
          }),
        };
      }
      if (url.startsWith('/api/dashboard-metrics')) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: 'profile metrics unavailable in smoke test' }),
        };
      }
      return {
        ok: true,
        json: async () => ({}),
      };
    },
  });

  await app.refresh();

  assert.doesNotMatch(app.elements.kpiGrid.innerHTML, /dashboard-status-panel/);
  assert.match(app.elements.syncedAt.textContent, /06\/09 14:13/);
});
