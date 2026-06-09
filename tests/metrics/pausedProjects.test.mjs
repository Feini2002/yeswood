import assert from 'node:assert/strict';
import test from 'node:test';

import { composeDashboardMetrics } from '../../src/backend/metrics/composeDashboard.mjs';
import { isPausedProject, partitionProjectsByPaused } from '../../src/backend/metrics/pausedProjects.mjs';
import { calculateDashboardMetrics } from '../../src/backend/projectData.mjs';

function sampleProject(overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    owner: overrides.owner || '测试负责人',
    status: overrides.status || '一般',
    storeStatus: overrides.storeStatus || '常规店',
    rawFields: overrides.rawFields || {},
    ...overrides,
  };
}

test('isPausedProject detects pause in hard or soft workflow', () => {
  const paused = sampleProject({ rawFields: { 硬装项目进度: { display: '暂停' } } });
  const active = sampleProject({ rawFields: { 硬装项目进度: { display: '施工图' } } });
  assert.equal(isPausedProject(paused), true);
  assert.equal(isPausedProject(active), false);
});

test('calculateDashboardMetrics excludes paused projects from summary and charts', () => {
  const projects = [
    sampleProject({ id: '1', rawFields: { 硬装项目进度: { display: '暂停' } } }),
    sampleProject({ id: '2', rawFields: { 硬装项目进度: { display: '施工图' }, 平面开始时间: { display: '2026-05-01' } } }),
    sampleProject({ id: '3', status: '紧急' }),
  ];
  const metrics = calculateDashboardMetrics(projects);
  assert.equal(metrics.pausedCount, 1);
  assert.equal(metrics.summary.totalProjects, 2);
  assert.equal(metrics.statusCounts.reduce((sum, item) => sum + item.value, 0), 1);
});

test('composeDashboardMetrics reports pausedCount separately from scopeCount', () => {
  const projects = [
    sampleProject({
      id: '1',
      rawFields: { 组别: { display: '直营新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '暂停' } },
    }),
    sampleProject({
      id: '2',
      rawFields: { 组别: { display: '直营新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '施工图' } },
    }),
  ];
  const metrics = composeDashboardMetrics(projects, 'direct');
  assert.equal(metrics.totalScopeCount, 2);
  assert.equal(metrics.pausedCount, 1);
  assert.equal(metrics.scopeCount, 1);
  assert.equal(metrics.totals.projectCount, 1);
});

test('composeDashboardMetrics reports current-year entry count from non-paused scoped projects', () => {
  const projects = [
    sampleProject({
      id: 'direct-2026',
      startDate: '2026-03-01',
      rawFields: { 组别: { display: '直营新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '施工图' } },
    }),
    sampleProject({
      id: 'franchise-2026',
      startDate: '2026-04-01',
      rawFields: { 组别: { display: '加盟新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '施工图' } },
    }),
    sampleProject({
      id: 'direct-2025',
      startDate: '2025-12-01',
      rawFields: { 组别: { display: '直营老店' }, 店铺性质: { display: '老店扩店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '施工图' } },
    }),
    sampleProject({
      id: 'paused-2026',
      startDate: '2026-05-01',
      rawFields: { 组别: { display: '加盟新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '暂停' } },
    }),
  ];

  const department = composeDashboardMetrics(projects, 'department', { now: new Date('2026-06-01T00:00:00.000Z') });
  const direct = composeDashboardMetrics(projects, 'direct', { now: new Date('2026-06-01T00:00:00.000Z') });

  assert.deepEqual(department.currentYearEntry, { year: 2026, count: 2 });
  assert.deepEqual(direct.currentYearEntry, { year: 2026, count: 1 });
});
