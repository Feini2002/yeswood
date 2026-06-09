import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTeamBenchmark,
  buildTeamComparisons,
  buildTeamInsights,
  enrichTeamDashboardMetrics,
} from '../src/backend/teamInsights.mjs';
import { calculateTeamDashboardMetrics } from '../src/backend/projectData.mjs';

const team = { owner: '苏佳蕾', cdLeads: ['陈菲菲'], vmLeads: [] };

function sampleProject(overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    name: overrides.name || '测试项目',
    status: overrides.status || '推进中',
    owner: overrides.owner || '苏佳蕾',
    province: '浙江',
    businessType: overrides.businessType || '旗舰店',
    storeStatus: overrides.storeStatus || '新店',
    progress: overrides.progress ?? 40,
    startDate: overrides.startDate || '2026-03-01',
    dueDate: overrides.dueDate || '2026-04-01',
    updatedAt: overrides.updatedAt || '2026-03-15T00:00:00.000Z',
    riskLevel: overrides.riskLevel || '低',
    isDelayed: overrides.isDelayed ?? true,
    rawFields: overrides.rawFields || {},
    ...overrides,
  };
}

test('buildTeamInsights returns judgment sentences for high delay teams', () => {
  const projects = [
    sampleProject({ id: '1' }),
    sampleProject({ id: '2', owner: '其他人', rawFields: { CD组长: { display: '陈菲菲' } } }),
    sampleProject({ id: '3', owner: '其他人', isDelayed: false, status: '未开始' }),
  ];
  const teamMetrics = calculateTeamDashboardMetrics(projects, team, { teams: [team] });
  const benchmark = buildTeamBenchmark(projects, teamMetrics, { teams: [team] });
  const comparisons = buildTeamComparisons(teamMetrics);
  const insights = buildTeamInsights(teamMetrics, benchmark, comparisons);

  assert.match(insights.headline, /总看盘|暂无匹配/);
  assert.ok(insights.modules.summary);
  assert.ok(insights.modules.leadLoad);
  assert.ok(insights.modules.riskProjects);
});

test('buildTeamComparisons computes month-over-month delta for store entry', () => {
  const teamMetrics = {
    summary: { totalProjects: 2 },
    monthlyEntry: {
      newStore: [
        { label: '2026-03', value: 2 },
        { label: '2026-04', value: 5 },
      ],
      oldStore: [],
      byStoreTier: {},
    },
  };
  const comparisons = buildTeamComparisons(teamMetrics);
  assert.equal(comparisons.newStoreLatestMonth.value, 5);
  assert.equal(comparisons.newStoreLatestMonth.delta, 3);
});

test('buildTeamBenchmark compares delay rate with the same soft-owner open-delay definition', () => {
  const softTeam = { owner: '杨锦帆' };
  const projects = [
    sampleProject({
      id: '1',
      owner: '杨锦帆',
      dueDate: '2026-01-01',
      isDelayed: true,
      rawFields: { 软装项目进度: { display: '点位已完成' }, 软装完成情况: { display: '延期中' }, 店态: { display: '黑标店' } },
    }),
    sampleProject({
      id: '2',
      owner: '其他人',
      dueDate: '2026-01-01',
      isDelayed: true,
      rawFields: { 软装项目进度: { display: '闭环' }, 店态: { display: '黑标店' } },
    }),
    sampleProject({
      id: '3',
      owner: '其他人',
      dueDate: '2026-01-01',
      isDelayed: true,
      rawFields: { 软装项目进度: { display: '摆场' }, 软装完成情况: { display: '延期中' }, 店态: { display: '黑标店' } },
    }),
    sampleProject({
      id: '4',
      owner: '其他人',
      dueDate: '2026-08-01',
      isDelayed: false,
      rawFields: { 软装项目进度: { display: '摆场' }, 店态: { display: '黑标店' } },
    }),
  ];
  const architecture = {
    people: {
      杨锦帆: { name: '杨锦帆', position: 'owner', discipline: 'soft' },
    },
    teams: [softTeam],
  };

  const teamMetrics = calculateTeamDashboardMetrics(projects, softTeam, architecture);
  const benchmark = buildTeamBenchmark(projects, teamMetrics, architecture);

  assert.equal(teamMetrics.summary.delayedProjects, 1);
  assert.equal(benchmark.departmentDelayedRate, 50);
});

test('buildTeamBenchmark keeps comparisons in the selected dashboard context', () => {
  const directTeam = { owner: '苏佳蕾' };
  const otherTeam = { owner: '其他人' };
  const projects = [
    sampleProject({
      id: 'direct-owner',
      owner: '苏佳蕾',
      dueDate: '2026-01-01',
      isDelayed: true,
      rawFields: { 组别: { display: '直营新店' }, 软装项目进度: { display: '摆场' }, 软装完成情况: { display: '延期中' } },
    }),
    sampleProject({
      id: 'direct-other',
      owner: '其他人',
      dueDate: '2036-08-01',
      isDelayed: false,
      rawFields: { 组别: { display: '直营老店' }, 软装项目进度: { display: '摆场' } },
    }),
    sampleProject({
      id: 'franchise-other',
      owner: '其他人',
      dueDate: '2026-01-01',
      isDelayed: true,
      rawFields: { 组别: { display: '加盟新店' }, 软装项目进度: { display: '摆场' }, 软装完成情况: { display: '延期中' } },
    }),
    sampleProject({
      id: 'paused-direct-other',
      owner: '其他人',
      dueDate: '2026-01-01',
      isDelayed: true,
      rawFields: { 组别: { display: '直营新店' }, 软装项目进度: { display: '暂停' } },
    }),
  ];
  const architecture = { teams: [directTeam, otherTeam] };

  const teamMetrics = calculateTeamDashboardMetrics(projects, directTeam, architecture, { dashboardContext: 'direct' });
  const benchmark = buildTeamBenchmark(projects, teamMetrics, architecture);

  assert.equal(teamMetrics.summary.totalProjects, 1);
  assert.equal(benchmark.dashboardContext, 'direct');
  assert.equal(benchmark.departmentTotal, 2);
  assert.equal(benchmark.teamShareOfDepartment, 50);
  assert.equal(benchmark.departmentDelayedRate, 50);
  assert.equal(benchmark.ownerTeamCount, 2);
});

test('buildTeamBenchmark reuses precomputed owner rates for batch metrics', () => {
  const teamMetrics = {
    owner: 'Alpha',
    dashboardContext: 'all',
    ownerDiscipline: '',
    summary: { totalProjects: 5, delayedProjects: 1 },
  };
  const benchmark = buildTeamBenchmark([], teamMetrics, { teams: [{ owner: 'Alpha' }, { owner: 'Beta' }] }, {
    ownerRates: [
      { owner: 'Beta', delayedRate: 50, total: 4 },
      { owner: 'Alpha', delayedRate: 20, total: 5 },
    ],
  });

  assert.equal(benchmark.teamDelayedRate, 20);
  assert.equal(benchmark.ownerTeamCount, 2);
  assert.equal(benchmark.rankAmongOwners, 2);
});

test('enrichTeamDashboardMetrics adds benchmark, insights, and tooltip catalog', () => {
  const projects = [sampleProject({ id: '1' }), sampleProject({ id: '2', owner: '其他人', isDelayed: false })];
  const base = calculateTeamDashboardMetrics(projects, team, { teams: [team] });
  const enriched = enrichTeamDashboardMetrics(projects, base, { teams: [team] });

  assert.ok(enriched.benchmark);
  assert.ok(enriched.insights?.headline);
  assert.ok(enriched.tooltipCatalog?.delayedProjects);
  assert.ok(enriched.comparisons);
  assert.ok(enriched.collaborationSimulation);
  assert.equal(enriched.collaborationSimulation.context.owner, '苏佳蕾');
});

test('buildTeamInsights explains data quality limitations without turning them into risk blame', () => {
  const teamMetrics = {
    team,
    summary: { totalProjects: 3, activeProjects: 2, notStarted: 1 },
    totals: { inProgress: 2, notStarted: 1 },
    alerts: {},
    fieldCoverage: {},
    monthlyEntry: { byStoreTier: {} },
    statusCounts: [],
    leadLoad: [],
    weightedLeadLoad: [],
    difficultySummary: { responsibleWeightedWorkload: 2, avgScore: 1.5, byLevel: [], byStoreTier: [] },
    riskProjects: [],
    yearSummary: {},
    dataHealth: {
      qualityLevel: 'low',
      lowCoverageFields: 1,
      warningCount: 2,
      limitations: ['软装完成时间覆盖率 0%，对应指标仅供参考'],
      riskPolicy: 'data_quality_only',
    },
  };

  const insights = buildTeamInsights(teamMetrics, { teamDelayedRate: 0, departmentDelayedRate: 0 }, buildTeamComparisons(teamMetrics));

  assert.match(insights.modules.dataQuality, /数据可信度受限/);
  assert.match(insights.modules.dataQuality, /仅供辅助判断/);
  assert.match(insights.modules.dataQuality, /不作为风险追责依据/);
});

test('buildTeamInsights explains responsibility-column load when no collaborator appears', () => {
  const emptyTeam = { owner: '王吉祥', cdLeads: [], vmLeads: [] };
  const teamMetrics = calculateTeamDashboardMetrics([], emptyTeam, { teams: [emptyTeam] });
  const benchmark = buildTeamBenchmark([], teamMetrics, { teams: [emptyTeam] });
  const insights = buildTeamInsights(teamMetrics, benchmark, buildTeamComparisons(teamMetrics));

  assert.match(insights.modules.leadLoad, /责任列|协作人/);
  assert.match(insights.modules.teamStructure, /责任列|自动聚合/);
});
