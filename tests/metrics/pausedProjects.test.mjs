import assert from 'node:assert/strict';
import test from 'node:test';

import { composeDashboardMetrics } from '../../src/backend/metrics/composeDashboard.mjs';
import {
  isCanceledProject,
  isPausedOrCanceledProject,
  isCurrentPausedWorkflowStage,
  isPausedProject,
  partitionProjectsByPaused,
} from '../../src/backend/metrics/pausedProjects.mjs';
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

test('isPausedProject only treats current pause labels as paused', () => {
  assert.equal(isCurrentPausedWorkflowStage('暂停'), true);
  assert.equal(isCurrentPausedWorkflowStage('软装暂停中'), true);
  assert.equal(isCurrentPausedWorkflowStage('暂停后恢复'), false);
  assert.equal(isCurrentPausedWorkflowStage('曾暂停，现施工图推进'), false);
  assert.equal(isCurrentPausedWorkflowStage('恢复后再次暂停'), true);
  assert.equal(isCurrentPausedWorkflowStage('暂停后恢复又暂停'), true);

  const recovered = sampleProject({
    rawFields: {
      硬装项目进度: { display: '暂停后恢复' },
      软装项目进度: { display: '软装方案' },
    },
  });
  const historicalNote = sampleProject({
    rawFields: {
      硬装项目进度: { display: '施工图' },
      软装项目进度: { display: '曾暂停，现待采购' },
    },
  });

  assert.equal(isPausedProject(recovered), false);
  assert.equal(isPausedProject(historicalNote), false);
});

test('canceled workflow on either track is terminal and distinct from pause', () => {
  const hardCanceled = sampleProject({
    rawFields: {
      硬装项目进度: { display: '取消' },
      软装项目进度: { display: '软装方案' },
    },
  });
  const softCanceled = sampleProject({
    rawFields: {
      硬装项目进度: { display: '施工图' },
      软装项目进度: { display: '取消后恢复推进' },
    },
  });
  const statusCanceled = sampleProject({ status: '已取消' });

  assert.equal(isCanceledProject(hardCanceled), true);
  assert.equal(isCanceledProject(softCanceled), true);
  assert.equal(isCanceledProject(statusCanceled), true);
  assert.equal(isPausedProject(hardCanceled), false);
  assert.equal(isPausedOrCanceledProject(hardCanceled), true);
  assert.equal(isPausedOrCanceledProject(statusCanceled), true);
});

test('partitionProjectsByPaused keeps pause and cancel buckets while excluding both from active projects', () => {
  const active = sampleProject({ id: 'active', rawFields: { 硬装项目进度: { display: '施工图' } } });
  const paused = sampleProject({ id: 'paused', rawFields: { 软装项目进度: { display: '暂停' } } });
  const canceled = sampleProject({ id: 'canceled', rawFields: { 硬装项目进度: { display: '取消' } } });

  const partitioned = partitionProjectsByPaused([active, paused, canceled]);

  assert.deepEqual(partitioned.active.map((project) => project.id), ['active']);
  assert.deepEqual(partitioned.paused.map((project) => project.id), ['paused']);
  assert.deepEqual(partitioned.canceled.map((project) => project.id), ['canceled']);
  assert.deepEqual(partitioned.stopped.map((project) => project.id), ['paused', 'canceled']);
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

test('composeDashboardMetrics reports canceled projects separately and excludes them from active scope', () => {
  const projects = [
    sampleProject({
      id: 'paused',
      rawFields: { 组别: { display: '直营新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '暂停' } },
    }),
    sampleProject({
      id: 'canceled',
      rawFields: { 组别: { display: '直营新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '取消' } },
    }),
    sampleProject({
      id: 'active',
      rawFields: { 组别: { display: '直营新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '施工图' } },
    }),
  ];
  const metrics = composeDashboardMetrics(projects, 'direct');
  assert.equal(metrics.totalScopeCount, 3);
  assert.equal(metrics.pausedCount, 1);
  assert.equal(metrics.canceledCount, 1);
  assert.equal(metrics.pausedOrCanceledCount, 2);
  assert.equal(metrics.scopeCount, 1);
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

test('composeDashboardMetrics publishes backend projectBoard with paused and canceled projects excluded from progress counts', () => {
  const projects = [
    sampleProject({
      id: 'direct-current',
      startDate: '2026-03-01',
      rawFields: { 组别: { display: '直营新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '施工图' }, 软装项目进度: { display: '软装方案' } },
    }),
    sampleProject({
      id: 'franchise-current',
      startDate: '2026-04-01',
      rawFields: { 组别: { display: '加盟新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '施工图' }, 软装项目进度: { display: '软装方案' } },
    }),
    sampleProject({
      id: 'paused-current',
      startDate: '2026-05-01',
      rawFields: { 组别: { display: '直营新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '暂停' } },
    }),
    sampleProject({
      id: 'canceled-current',
      startDate: '2026-05-02',
      rawFields: { 组别: { display: '加盟新店' }, 店铺性质: { display: '新店' }, 店态: { display: '常规店' }, 软装项目进度: { display: '取消' } },
    }),
    sampleProject({
      id: 'closed-direct',
      startDate: '2025-11-01',
      rawFields: { 组别: { display: '直营老店' }, 店铺性质: { display: '老店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '闭环' } },
    }),
    sampleProject({
      id: 'unclosed-franchise-previous',
      startDate: '2025-12-01',
      rawFields: { 组别: { display: '加盟老店' }, 店铺性质: { display: '老店' }, 店态: { display: '常规店' }, 硬装项目进度: { display: '施工图' } },
    }),
  ];

  const metrics = composeDashboardMetrics(projects, 'department', { now: new Date('2026-06-01T00:00:00.000Z') });

  assert.deepEqual(metrics.projectBoard, {
    year: 2026,
    previousYear: 2025,
    currentYearEntryTotal: 2,
    currentYearEntryDirect: 1,
    currentYearEntryFranchise: 1,
    pausedOrCanceled: 2,
    pausedProjectTotal: 1,
    canceledProjectTotal: 1,
    closedProjectTotal: 1,
    closedProjectDirect: 1,
    closedProjectFranchise: 0,
    previousYearUnclosedTotal: 1,
    previousYearUnclosedDirect: 0,
    previousYearUnclosedFranchise: 1,
  });
});
