import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  calculateTeamDashboardMetrics,
  cleanProjectRecord,
  filterProjects,
  filterProjectsForTeam,
} from '../src/backend/projectData.mjs';
import {
  ownersFromSnapshot,
  precomputeSnapshotHash,
  precomputeTeamDashboards,
  readPrecomputedTeamMetricsBatch,
  readPrecomputedTeamResponsibilityReview,
  readPrecomputedTeamWorkCompletion,
} from '../src/backend/precomputeTeamDashboards.mjs';
import { createServer } from '../src/backend/server.mjs';
import { syncProjects } from '../src/backend/syncService.mjs';

async function withTestServer(run, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-team-metrics-'));
  const config = {
    port: 0,
    mode: 'mock',
    cacheFile: path.join(tempDir, 'dashboard-cache.json'),
    precomputeDir: path.join(tempDir, 'precomputed'),
    syncApiKey: 'server-only-secret',
    syncMinIntervalMs: 0,
    dashboardSyncEnabled: false,
    databaseFile: '',
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
  };
  await options.beforeListen?.({ config, tempDir });

  const server = createServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${pathname}`, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, body: JSON.parse(body) });
          } catch (error) {
            resolve({ status: response.statusCode, body });
          }
        });
      })
      .on('error', reject);
  });
}

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
    dueDate: overrides.dueDate || '2026-06-01',
    updatedAt: overrides.updatedAt || '2026-03-15T00:00:00.000Z',
    riskLevel: overrides.riskLevel || '低',
    isDelayed: overrides.isDelayed ?? false,
    rawFields: overrides.rawFields || {},
    ...overrides,
  };
}

function sampleDifficulty({
  score,
  level,
  hardWorkdays,
  hardWeight,
  softWorkdays,
  softWeight,
  designWorkdays = 0,
  designWeight = 0,
} = {}) {
  const hard = { score: Math.round(hardWorkdays || 0), workdays: hardWorkdays || 0, weight: hardWeight || 0 };
  const soft = { score: Math.round(softWorkdays || 0), workdays: softWorkdays || 0, weight: softWeight || 0 };
  const design = { score: Math.round(designWorkdays || 0), workdays: designWorkdays, weight: designWeight };
  const workdays = Number((hard.workdays + soft.workdays + design.workdays).toFixed(1));
  const weight = Number((hard.weight + soft.weight + design.weight).toFixed(2));
  return {
    schemaVersion: 4,
    score,
    level,
    workdays,
    weight,
    hard,
    soft,
    design,
    ruleKeys: [],
    components: [],
  };
}

const team = {
  owner: '苏佳蕾',
  cdLeads: ['陈菲菲'],
  vmLeads: ['郜娇营'],
};

test('filterProjectsForTeam scopes by project owner responsibility, not lead hierarchy', () => {
  const projects = [
    sampleProject({ id: '1', owner: '苏佳蕾' }),
    sampleProject({ id: '2', owner: '其他人', rawFields: { CD组长: { display: '陈菲菲' } } }),
    sampleProject({ id: '3', owner: '其他人', rawFields: { VM组长: { display: '郜娇营' } } }),
    sampleProject({ id: '4', owner: '苏佳蕾,陈菲菲', rawFields: { CD组长: { display: '陈菲菲' } } }),
    sampleProject({ id: '5', owner: '无关负责人' }),
  ];

  const matched = filterProjectsForTeam(projects, team);
  assert.deepEqual(
    matched.map((project) => project.id),
    ['1', '4']
  );
});

test('filterProjectsForTeam returns empty array without team owner', () => {
  assert.equal(filterProjectsForTeam([sampleProject()], { owner: '' }).length, 0);
});

test('calculateTeamDashboardMetrics summarizes team kpis, monthly entry, and lead load', () => {
  const projects = [
    sampleProject({
      id: '1',
      owner: '苏佳蕾',
      storeStatus: '常规店',
      businessType: '超一线',
      rawFields: {
        店态: { display: '常规店' },
        店铺性质: { display: '新店' },
        硬装方案情况: { display: '延期完成' },
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-03-01' },
        软装项目进度: { display: '摆场' },
        CD组长: { display: '陈菲菲' },
      },
      difficulty: sampleDifficulty({
        score: 46,
        level: '难',
        hardWorkdays: 27.3,
        hardWeight: 1.24,
        softWorkdays: 18.9,
        softWeight: 0.86,
      }),
      isDelayed: true,
    }),
    sampleProject({
      id: '1b',
      owner: '苏佳蕾',
      status: '紧急',
      storeStatus: '超一线',
      businessType: '超一线',
      rawFields: {
        店态: { display: '超一线' },
        店铺性质: { display: '新店' },
        硬装方案情况: { display: '进行中' },
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-03-01' },
        软装项目进度: { display: '施工图' },
        VM组长: { display: '项目责任人' },
      },
      difficulty: sampleDifficulty({
        score: 58,
        level: '重',
        hardWorkdays: 44,
        hardWeight: 2,
        softWorkdays: 22,
        softWeight: 1,
      }),
    }),
    sampleProject({
      id: '1c',
      owner: '苏佳蕾',
      storeStatus: '旗舰店',
      businessType: '旗舰店',
      rawFields: {
        店态: { display: '旗舰店' },
        店铺性质: { display: '老店' },
        硬装方案情况: { display: '进行中' },
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-03-01' },
        软装项目进度: { display: '施工图' },
      },
      difficulty: sampleDifficulty({
        score: 20,
        level: '中',
        hardWorkdays: 11,
        hardWeight: 0.5,
        softWorkdays: 11,
        softWeight: 0.5,
      }),
    }),
    sampleProject({
      id: '2',
      owner: '其他人',
      status: '一般',
      storeStatus: '常规店',
      businessType: '常规',
      startDate: '2026-04-10',
      rawFields: {
        店态: { display: '常规店' },
        店铺性质: { display: '老店' },
        硬装项目进度: { display: '未开始' },
        VM组长: { display: '郜娇营' },
      },
    }),
    sampleProject({ id: '3', owner: '无关负责人' }),
  ];

  const metrics = calculateTeamDashboardMetrics(projects, team, {
    people: {
      苏佳蕾: { name: '苏佳蕾', displayName: '苏佳蕾', position: 'owner', discipline: 'hard' },
      陈菲菲: { name: '陈菲菲', position: 'lead', discipline: 'hard' },
      郜娇营: { name: '郜娇营', position: 'lead', discipline: 'soft' },
    },
    teams: [team],
  });

  assert.equal(metrics.owner, '苏佳蕾');
  assert.equal(metrics.summary.totalProjects, 3);
  assert.equal(metrics.summary.activeProjects, 3);
  assert.equal(metrics.summary.notStarted, 0);
  assert.equal(metrics.alerts.unscheduled, 0);
  assert.ok(metrics.tiers);
  assert.deepEqual(metrics.tierOrder, ['regular', 'super', 'flagship']);
  assert.equal(metrics.tierLabels.super, '超一线');
  assert.equal(metrics.tiers.regular.projectCount, 1);
  assert.equal(metrics.tiers.super.projectCount, 1);
  assert.equal(metrics.tiers.flagship.projectCount, 1);
  assert.equal(Object.hasOwn(metrics.tiers, 'sinking'), false);
  assert.ok(metrics.monthlyOps);
  assert.ok(metrics.monthlyEntry.newStore.length >= 1);
  assert.ok(Array.isArray(metrics.monthlyEntry.oldStore));
  const marchDifficulty = metrics.monthlyEntry.difficultyByMonth.find((item) => item.label === '2026-03');
  assert.equal(marchDifficulty.projectCount, 3);
  assert.equal(marchDifficulty.responsibleWeightedWorkload, 3.74);
  assert.equal(marchDifficulty.weightedWorkload, 6.1);
  assert.equal(marchDifficulty.avgScore, 41);
  assert.equal(marchDifficulty.highDifficultyCount, 2);
  assert.ok(marchDifficulty.pressureScore > 0);
  const marchPressure = metrics.monthlyEntry.pressureByMonth.find((item) => item.label === '2026-03');
  assert.equal(marchPressure.owner, '苏佳蕾');
  assert.equal(marchPressure.totalEntryCount, 3);
  assert.equal(marchPressure.newStoreCount, 2);
  assert.equal(marchPressure.oldStoreCount, 1);
  assert.ok(marchPressure.pressureScore > 0);
  assert.ok(marchPressure.newStoreDifficulty.responsibleWeightedWorkload > 0);
  assert.equal(metrics.monthlyEntry.rhythmAdvice.status, 'ready');
  assert.equal(metrics.monthlyEntry.rhythmAdvice.channel, 'entryRhythm');
  assert.equal(metrics.monthlyEntry.rhythmAdvice.agentName, '进店节奏分析 Agent');
  assert.equal(metrics.monthlyEntry.rhythmAdvice.modelName, 'deterministic-js');
  assert.ok(metrics.monthlyEntry.rhythmAdvice.promptHash);
  assert.match(metrics.monthlyEntry.rhythmAdvice.headline, /3月|03/);
  assert.ok(metrics.monthlyEntry.rhythmAdvice.interpretations.length >= 2);
  assert.ok(metrics.monthlyEntry.rhythmAdvice.interpretations.every((item) => item.text && item.evidence?.length && item.action));
  assert.match(metrics.monthlyEntry.rhythmAdvice.interpretations.map((item) => item.action).join(' '), /错峰|评审|缓冲|补齐/);
  assert.ok(Array.isArray(metrics.leadLoad));
  assert.equal(metrics.leadLoad.find((item) => item.name === '陈菲菲')?.value, 1);
  assert.equal(metrics.leadLoad.some((item) => item.name === '项目责任人'), false);
  assert.equal(metrics.leadLoad.some((item) => item.name === '郜娇营'), false);
  assert.equal(metrics.difficultySummary.projectCount, 3);
  assert.equal(metrics.difficultySummary.weightedWorkload, 6.1);
  assert.equal(metrics.difficultySummary.responsibleWeightedWorkload, 3.74);
  assert.equal(metrics.difficultySummary.byDiscipline.hard.weightedWorkload, 3.74);
  assert.equal(metrics.difficultySummary.byDiscipline.soft.weightedWorkload, 2.36);
  assert.equal(metrics.difficultySummary.byStoreTier.find((item) => item.key === 'regular')?.responsibleWeightedWorkload, 1.24);
  assert.equal(
    metrics.difficultySummary.matrixByStoreTierAndLevel.find((item) => item.storeTier === 'super' && item.level === '重')
      ?.projectCount,
    1
  );
  assert.equal(metrics.weightedLeadLoad.find((item) => item.name === '陈菲菲')?.weightedWorkload, 1.24);
  assert.equal(metrics.weightedLeadLoad.some((item) => item.name === '项目责任人'), false);
  assert.ok(metrics.riskProjects.length >= 1);
  assert.ok(metrics.openDelayedProjects.length >= 1);
  assert.deepEqual(metrics.urgentStatusProjects.map((project) => project.id), ['1b']);
});

test('calculateTeamDashboardMetrics uses company workflow definitions for owner total view', () => {
  const softTeam = { owner: '杨锦帆' };
  const projects = [
    sampleProject({
      id: 'soft-1',
      owner: '杨锦帆',
      storeStatus: '黑标店',
      dueDate: '2026-01-01',
      isDelayed: true,
      rawFields: {
        店态: { display: '黑标店' },
        组别: { display: '直营新店' },
        软装项目进度: { display: '未开始' },
        软装完成情况: { display: '' },
      },
    }),
    sampleProject({
      id: 'soft-2',
      owner: '杨锦帆',
      storeStatus: '黑标店',
      dueDate: '2026-01-01',
      isDelayed: true,
      rawFields: {
        店态: { display: '黑标店' },
        组别: { display: '直营新店' },
        软装项目进度: { display: '未安排摆场' },
        点位完成情况: { display: '已完成' },
        点位完成时间: { display: '2026-05-16' },
        软装方案开始时间: { display: '2026-05-18' },
        软装完成情况: { display: '准时完成' },
      },
    }),
    sampleProject({
      id: 'soft-3',
      owner: '杨锦帆',
      storeStatus: '睡眠店',
      dueDate: '2026-08-01',
      isDelayed: false,
      rawFields: {
        店态: { display: '睡眠店' },
        组别: { display: '加盟新店' },
        软装项目进度: { display: '点位已完成' },
        软装完成情况: { display: '延期完成' },
      },
    }),
    sampleProject({
      id: 'soft-4',
      owner: '杨锦帆',
      storeStatus: '睡眠店',
      dueDate: '2026-08-01',
      isDelayed: false,
      rawFields: {
        店态: { display: '睡眠店' },
        组别: { display: '加盟老店' },
        软装项目进度: { display: '暂停' },
        软装完成情况: { display: '' },
      },
    }),
    sampleProject({
      id: 'soft-5',
      owner: '杨锦帆',
      storeStatus: '睡眠店',
      dueDate: '2026-01-01',
      isDelayed: true,
      rawFields: {
        店态: { display: '睡眠店' },
        组别: { display: '加盟老店' },
        软装项目进度: { display: '闭环' },
        软装完成情况: { display: '延期完成' },
      },
    }),
    sampleProject({
      id: 'soft-6',
      owner: '杨锦帆',
      storeStatus: '睡眠店',
      dueDate: '2026-01-01',
      isDelayed: true,
      rawFields: {
        店态: { display: '睡眠店' },
        组别: { display: '加盟老店' },
        软装项目进度: { display: '软装方案中' },
        软装完成情况: { display: '延期中' },
      },
    }),
  ];

  const metrics = calculateTeamDashboardMetrics(projects, softTeam, {
    people: {
      杨锦帆: { name: '杨锦帆', displayName: '杨锦帆', position: 'owner', discipline: 'both' },
    },
    teams: [softTeam],
  });

  assert.equal(metrics.dashboardContext, 'all');
  assert.equal(metrics.totalScopeCount, 6);
  assert.equal(metrics.pausedCount, 0);
  assert.equal(metrics.summary.totalProjects, 6);
  assert.equal(metrics.totals.projectCount, 6);
  assert.equal(metrics.totals.notStarted, 5);
  assert.equal(metrics.totals.inProgress, 0);
  assert.equal(metrics.totals.schemeDoneYtd, 1);
  assert.equal(metrics.totals.schemeDelayDoneYtd, 0);
  assert.equal(metrics.totals.schemeDelayDoneMonth, 0);
  assert.equal(metrics.totals.openDelayed, 0);
  assert.ok(metrics.dataHealth);
  assert.equal(metrics.dataHealth.totalProjects, 6);
  assert.equal(metrics.dataHealth.fieldCoverage.find((item) => item.key === 'softCompletion')?.rate, 50);
  assert.equal(metrics.dataHealth.fieldCoverage.find((item) => item.key === 'softDoneTime')?.rate, 0);
  assert.equal(metrics.dataHealth.qualityLevel, 'low');
  assert.equal(metrics.dataHealth.riskPolicy, 'data_quality_only');
  assert.match(metrics.dataHealth.limitations.join(' '), /软装完成时间覆盖率 0%/);
  assert.equal(metrics.dataHealth.fieldCoverage.find((item) => item.key === 'softDoneTime')?.warnAt, 50);
  assert.equal(metrics.dataHealth.fieldCoverage.find((item) => item.key === 'softDoneTime')?.scope, 'data_quality');
  assert.equal(metrics.dataHealth.checks.find((item) => item.key === 'softCompletionStageConflict')?.count, 1);
  assert.equal(metrics.dataHealth.checks.find((item) => item.key === 'softCompletionStageConflict')?.scope, 'data_quality');
  assert.equal(metrics.dataHealth.checks.find((item) => item.key === 'softDelayDoneMissingDate')?.count, 0);
});

test('calculateTeamDashboardMetrics excludes fully closed design projects from team risk queues', () => {
  const ownerTeam = { owner: '苏佳蕾' };
  const projects = [
    sampleProject({
      id: 'closed-risk',
      name: '北京北四居然店',
      owner: '苏佳蕾',
      status: '紧急',
      storeStatus: '常规店',
      dueDate: '2026-05-30',
      isDelayed: true,
      riskLevel: '高',
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '闭环' },
        躺平内部审核结束时间: { display: '2026-05-12' },
        软装项目进度: { display: '闭环' },
        点位完成情况: { display: '已完成' },
        点位完成时间: { display: '2026-05-16' },
        软装完成情况: { display: '准时完成' },
        硬装方案情况: { display: '延期' },
      },
    }),
    sampleProject({
      id: 'open-delay',
      name: '上海待采购店',
      owner: '苏佳蕾',
      storeStatus: '常规店',
      dueDate: '2026-05-29',
      isDelayed: true,
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-05-01' },
        软装项目进度: { display: '待采购' },
        硬装方案情况: { display: '延期' },
      },
    }),
  ];

  const metrics = calculateTeamDashboardMetrics(projects, ownerTeam, {
    people: {
      苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
    },
    teams: [ownerTeam],
  });

  assert.equal(metrics.totals.openDelayed, 1);
  assert.equal(metrics.summary.delayedProjects, 1);
  assert.deepEqual(metrics.openDelayedProjects.map((project) => project.id), ['open-delay']);
  assert.deepEqual(metrics.riskProjects.map((project) => project.id), ['open-delay']);
  assert.deepEqual(metrics.urgentStatusProjects, []);
});

test('data health does not treat unfinished hard scheme text as done', () => {
  const metrics = calculateTeamDashboardMetrics(
    [
      sampleProject({
        id: 'hard-scheme-unfinished',
        owner: '苏佳蕾',
        rawFields: {
          店态: { display: '常规店' },
          硬装项目进度: { display: '施工图' },
          硬装方案情况: { display: '未完成' },
        },
      }),
    ],
    { owner: '苏佳蕾' },
    {
      people: {
        苏佳蕾: { name: '苏佳蕾', displayName: '苏佳蕾', position: 'owner', discipline: 'hard' },
      },
      teams: [{ owner: '苏佳蕾' }],
    }
  );

  assert.equal(metrics.dataHealth.checks.find((item) => item.key === 'hardStageSchemeConflict')?.count, 0);
});

test('data health tracks completed-node evidence gaps without changing risk policy', () => {
  const metrics = calculateTeamDashboardMetrics(
    [
      sampleProject({
        id: 'hard-scheme-time-missing',
        owner: '苏佳蕾',
        rawFields: {
          店态: { display: '常规店' },
          硬装方案情况: { display: '准时完成' },
        },
      }),
      sampleProject({
        id: 'point-time-missing',
        owner: '苏佳蕾',
        rawFields: {
          店态: { display: '常规店' },
          软装项目进度: { display: '点位已完成' },
          点位完成情况: { display: '准时完成' },
        },
      }),
      sampleProject({
        id: 'point-status-missing',
        owner: '苏佳蕾',
        rawFields: {
          店态: { display: '常规店' },
          软装项目进度: { display: '点位已完成' },
          点位完成时间: { display: '2026-05-09' },
        },
      }),
    ],
    { owner: '苏佳蕾' },
    {
      people: {
        苏佳蕾: { name: '苏佳蕾', displayName: '苏佳蕾', position: 'owner', discipline: 'hard' },
      },
      teams: [{ owner: '苏佳蕾' }],
    }
  );

  assert.equal(metrics.dataHealth.riskPolicy, 'data_quality_only');
  assert.equal(metrics.dataHealth.checks.find((item) => item.key === 'hardSchemeDoneMissingDate')?.count, 1);
  assert.equal(metrics.dataHealth.checks.find((item) => item.key === 'pointDoneMissingTime')?.count, 1);
  assert.equal(metrics.dataHealth.checks.find((item) => item.key === 'pointTimeMissingStatus')?.count, 1);
  assert.equal(metrics.openDelayedProjects.length, 0);
});

test('completed-node evidence gap reminders do not downgrade overall data health quality', () => {
  const commonRawFields = {
    组别: { display: '华北组' },
    店态: { display: '常规店' },
    上会情况: { display: '准时完成' },
    启动时间: { display: '2026-03-01' },
    计划开业时间: { display: '2026-06-01' },
  };
  const metrics = calculateTeamDashboardMetrics(
    [
      sampleProject({
        id: 'hard-scheme-only-gap',
        owner: 'OwnerA',
        rawFields: {
          ...commonRawFields,
          硬装项目进度: { display: '施工图' },
          硬装方案情况: { display: '准时完成' },
          软装项目进度: { display: '闭环' },
          点位完成情况: { display: '准时完成' },
          点位完成时间: { display: '2026-05-08' },
          软装完成情况: { display: '准时完成' },
          软装完成时间: { display: '2026-05-20' },
        },
      }),
      sampleProject({
        id: 'point-time-only-gap',
        owner: 'OwnerA',
        rawFields: {
          ...commonRawFields,
          硬装项目进度: { display: '施工图' },
          硬装方案情况: { display: '未完成' },
          软装项目进度: { display: '点位已完成' },
          点位完成情况: { display: '准时完成' },
        },
      }),
      sampleProject({
        id: 'point-status-only-gap',
        owner: 'OwnerA',
        rawFields: {
          ...commonRawFields,
          硬装项目进度: { display: '施工图' },
          硬装方案情况: { display: '未完成' },
          软装项目进度: { display: '闭环' },
          点位完成时间: { display: '2026-05-09' },
          软装完成情况: { display: '准时完成' },
          软装完成时间: { display: '2026-05-22' },
        },
      }),
    ],
    { owner: 'OwnerA' },
    {
      people: {
        OwnerA: { name: 'OwnerA', displayName: 'OwnerA', position: 'owner', discipline: 'hard' },
      },
      teams: [{ owner: 'OwnerA' }],
    }
  );

  assert.equal(metrics.dataHealth.qualityLevel, 'high');
  for (const key of ['hardSchemeDoneMissingDate', 'pointDoneMissingTime', 'pointTimeMissingStatus']) {
    const check = metrics.dataHealth.checks.find((item) => item.key === key);
    assert.equal(check?.count, 1);
    assert.equal(check?.affectsQuality, false);
    assert.equal(check?.suppressRiskItem, true);
  }
  assert.equal(metrics.openDelayedProjects.length, 0);
});

test('calculateTeamDashboardMetrics uses company workflow stages for team overview project statistics', () => {
  const hardTeam = { owner: '硬装负责人' };
  const softTeam = { owner: '软装负责人' };
  const projects = [
    sampleProject({
      id: 'hard-done-product-list',
      owner: '硬装负责人',
      isDelayed: true,
      riskLevel: '高',
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '施工图' },
        躺平内部审核结束时间: { display: '2026-05-12' },
        产品清单发出时间: { display: '2026-05-15' },
      },
    }),
    sampleProject({
      id: 'soft-open-under-hard-owner',
      owner: '硬装负责人',
      isDelayed: true,
      riskLevel: '高',
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '闭环' },
        躺平内部审核结束时间: { display: '2026-05-12' },
        软装项目进度: { display: '软装方案中' },
        软装方案开始时间: { display: '2026-05-18' },
        软装完成情况: { display: '延期中' },
      },
    }),
    sampleProject({
      id: 'hard-open-delay',
      owner: '硬装负责人',
      isDelayed: true,
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-05-01' },
        硬装方案情况: { display: '延期' },
      },
    }),
    sampleProject({
      id: 'product-list-only-soft-owner',
      owner: '软装负责人',
      isDelayed: true,
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '闭环' },
        躺平内部审核结束时间: { display: '2026-05-12' },
        产品清单发出时间: { display: '2026-05-15' },
      },
    }),
    sampleProject({
      id: 'soft-open-delay',
      owner: '软装负责人',
      isDelayed: true,
      rawFields: {
        店态: { display: '常规店' },
        软装项目进度: { display: '软装方案中' },
        软装方案开始时间: { display: '2026-05-18' },
        软装完成情况: { display: '延期中' },
      },
    }),
  ];
  const architecture = {
    people: {
      硬装负责人: { name: '硬装负责人', position: 'owner', discipline: 'hard' },
      软装负责人: { name: '软装负责人', position: 'owner', discipline: 'soft' },
    },
    teams: [hardTeam, softTeam],
  };

  const hardMetrics = calculateTeamDashboardMetrics(projects, hardTeam, architecture);
  assert.equal(hardMetrics.summary.activeProjects, 3);
  assert.equal(hardMetrics.totals.inProgress, 3);
  assert.equal(hardMetrics.summary.delayedProjects, 1);
  assert.deepEqual(hardMetrics.openDelayedProjects.map((project) => project.id), ['hard-open-delay']);
  assert.deepEqual(hardMetrics.riskProjects.map((project) => project.id), [
    'hard-done-product-list',
    'soft-open-under-hard-owner',
    'hard-open-delay',
  ]);

  const softMetrics = calculateTeamDashboardMetrics(projects, softTeam, architecture);
  assert.equal(softMetrics.summary.activeProjects, 2);
  assert.equal(softMetrics.totals.inProgress, 2);
  assert.equal(softMetrics.summary.delayedProjects, 1);
  assert.deepEqual(softMetrics.openDelayedProjects.map((project) => project.id), ['soft-open-delay']);
});

test('calculateTeamDashboardMetrics exposes hard owner top form metrics', () => {
  const ownerTeam = { owner: '硬装负责人' };
  const baseRawFields = {
    店态: { display: '常规店' },
    复尺时间: { display: '2026-05-20' },
    面积: { display: '280' },
    CD设计师: { display: '设计师A' },
  };
  const projects = [
    sampleProject({
      id: 'not-started',
      owner: '硬装负责人',
      dueDate: '2026-08-01',
      rawFields: {
        ...baseRawFields,
        硬装项目进度: { display: '未开始' },
        软装项目进度: { display: '未开始' },
      },
    }),
    sampleProject({
      id: 'measure',
      owner: '硬装负责人',
      dueDate: '2026-08-02',
      rawFields: {
        ...baseRawFields,
        硬装项目进度: { display: '完成复尺' },
        软装项目进度: { display: '未开始' },
      },
    }),
    sampleProject({
      id: 'floor-open-delay',
      owner: '硬装负责人',
      dueDate: '2026-09-01',
      rawFields: {
        ...baseRawFields,
        复尺时间: { display: '2026-05-28' },
        硬装项目进度: { display: '平面躺平' },
        平面开始时间: { display: '2026-06-01' },
        软装项目进度: { display: '未开始' },
      },
    }),
    sampleProject({
      id: 'drawing',
      owner: '硬装负责人',
      dueDate: '2026-09-02',
      rawFields: {
        ...baseRawFields,
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-05-21' },
        躺平内部审核结束时间: { display: '2026-05-29' },
        软装项目进度: { display: '点位已完成' },
      },
    }),
    sampleProject({
      id: 'hard-done',
      owner: '硬装负责人',
      dueDate: '2026-09-03',
      rawFields: {
        ...baseRawFields,
        硬装项目进度: { display: '（施工中）施工图完成审核' },
        平面开始时间: { display: '2026-05-21' },
        躺平内部审核结束时间: { display: '2026-05-29' },
        '施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）': { display: '2026-06-05' },
        软装项目进度: { display: '待采购' },
      },
    }),
    sampleProject({
      id: 'past-due-closed',
      owner: '硬装负责人',
      dueDate: '2026-06-01',
      rawFields: {
        ...baseRawFields,
        复尺时间: { display: '2026-01-02' },
        硬装项目进度: { display: '闭环' },
        平面开始时间: { display: '2026-01-03' },
        躺平内部审核结束时间: { display: '2026-01-15' },
        '施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）': { display: '2026-01-25' },
        软装项目进度: { display: '闭环' },
      },
    }),
    sampleProject({
      id: 'past-due-open',
      owner: '硬装负责人',
      dueDate: '2026-05-30',
      rawFields: {
        ...baseRawFields,
        硬装项目进度: { display: '摆场' },
        躺平内部审核结束时间: { display: '2026-05-20' },
        '施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）': { display: '2026-05-28' },
        软装项目进度: { display: '摆场' },
      },
    }),
    sampleProject({
      id: 'soft-explicit-delay-note',
      owner: '硬装负责人',
      dueDate: '2026-08-10',
      rawFields: {
        ...baseRawFields,
        复尺时间: { display: '2026-02-01' },
        硬装项目进度: { display: '闭环' },
        平面开始时间: { display: '2026-02-02' },
        躺平内部审核结束时间: { display: '2026-02-06' },
        '施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）': { display: '2026-02-18' },
        软装项目进度: { display: '闭环' },
        '项目情况 / 延期说明': { display: '软装延期情况说明：漏发项目群' },
      },
    }),
  ];

  const metrics = calculateTeamDashboardMetrics(
    projects,
    ownerTeam,
    {
      people: {
        硬装负责人: { name: '硬装负责人', position: 'owner', discipline: 'hard' },
      },
      teams: [ownerTeam],
    },
    { today: '2026-06-10', year: 2026, month: '2026-06' }
  );

  assert.deepEqual(metrics.hardOwnerMetrics.values, {
    notStarted: 1,
    hardStageInProgress: 3,
    hardSchemeDelayMonth: 1,
    hardSchemeDelayYtd: 6,
    delayedProjects: 2,
    hardStageCompletedYtd: 4,
    projectClosed: 2,
  });
  assert.equal(metrics.hardOwnerMetrics.rows.length, 1);
  assert.deepEqual(metrics.hardOwnerMetrics.rows[0].values, metrics.hardOwnerMetrics.values);
  assert.deepEqual(
    metrics.hardOwnerMetrics.rows[0].items.map((item) => item.key),
    metrics.hardOwnerMetrics.items.map((item) => item.key)
  );
  assert.deepEqual(metrics.hardOwnerMetrics.items.map((item) => item.key), [
    'notStarted',
    'hardStageInProgress',
    'hardSchemeDelayMonth',
    'hardSchemeDelayYtd',
    'delayedProjects',
    'hardStageCompletedYtd',
    'projectClosed',
  ]);

  const filtered = filterProjects(
    projects,
    {
      owner: '硬装负责人',
      metric: 'hardStageCompletedYtd',
      excludePaused: '1',
    },
    {
      personnelArchitecture: {
        people: {
          硬装负责人: { name: '硬装负责人', position: 'owner', discipline: 'hard' },
        },
      },
    }
  );
  assert.deepEqual(
    filtered.map((project) => project.id).sort(),
    ['hard-done', 'past-due-closed', 'past-due-open', 'soft-explicit-delay-note']
  );
  const schemeDelayedYtd = filterProjects(
    projects,
    {
      owner: '硬装负责人',
      metric: 'hardSchemeDelayYtd',
      excludePaused: '1',
    },
    {
      personnelArchitecture: {
        people: {
          硬装负责人: { name: '硬装负责人', position: 'owner', discipline: 'hard' },
        },
      },
    }
  );
  assert.deepEqual(
    schemeDelayedYtd.map((project) => project.id).sort(),
    ['drawing', 'floor-open-delay', 'hard-done', 'measure', 'not-started', 'past-due-closed']
  );
});

test('calculateTeamDashboardMetrics does not expose hard owner top form metrics for soft owners', () => {
  const ownerTeam = { owner: '软装负责人' };
  const metrics = calculateTeamDashboardMetrics(
    [sampleProject({ owner: '软装负责人' })],
    ownerTeam,
    {
      people: {
        软装负责人: { name: '软装负责人', position: 'owner', discipline: 'soft' },
      },
      teams: [ownerTeam],
    }
  );

  assert.equal(metrics.hardOwnerMetrics, null);
});

test('calculateTeamDashboardMetrics counts deadline evidence when explicit hard delay note has stale update date', () => {
  const ownerTeam = { owner: '硬装负责人' };
  const metrics = calculateTeamDashboardMetrics(
    [
      sampleProject({
        id: 'deadline-delay-with-old-note-date',
        owner: '硬装负责人',
        dueDate: '2026-09-01',
        updatedAt: '2025-12-31T00:00:00.000Z',
        rawFields: {
          店态: { display: '常规店' },
          复尺时间: { display: '2026-05-28' },
          面积: { display: '280' },
          硬装项目进度: { display: '完成复尺' },
          '项目情况 / 延期说明': { display: '方案延期一天，继续推进' },
        },
      }),
    ],
    ownerTeam,
    {
      people: {
        硬装负责人: { name: '硬装负责人', position: 'owner', discipline: 'hard' },
      },
      teams: [ownerTeam],
    },
    { today: '2026-06-10', year: 2026, month: '2026-06' }
  );

  assert.equal(metrics.hardOwnerMetrics.values.hardSchemeDelayMonth, 1);
  assert.equal(metrics.hardOwnerMetrics.values.hardSchemeDelayYtd, 1);
});

test('calculateTeamDashboardMetrics keeps Yang Jinfan hard owner unsplit across direct and franchise', () => {
  const ownerTeam = { owner: '杨锦帆（硬装）' };
  const projects = [
    sampleProject({
      id: 'yang-direct-hard',
      owner: '杨锦帆',
      rawFields: {
        CD负责人: { display: '杨锦帆' },
        组别: { display: '直营一组' },
        店态: { display: '常规店' },
        硬装项目进度: { display: '未开始' },
      },
    }),
    sampleProject({
      id: 'yang-franchise-hard',
      owner: '杨锦帆',
      rawFields: {
        CD负责人: { display: '杨锦帆' },
        组别: { display: '加盟一组' },
        店态: { display: '常规店' },
        硬装项目进度: { display: '未开始' },
      },
    }),
    sampleProject({
      id: 'yang-soft-only',
      owner: '杨锦帆',
      rawFields: {
        VM负责人: { display: '杨锦帆' },
        组别: { display: '加盟一组' },
        店态: { display: '常规店' },
        软装项目进度: { display: '点位已完成' },
      },
    }),
  ];

  const metrics = calculateTeamDashboardMetrics(
    projects,
    ownerTeam,
    { teams: [ownerTeam] },
    { dashboardContext: 'direct', today: '2026-06-10', year: 2026 }
  );

  assert.equal(metrics.dashboardContext, 'all');
  assert.equal(metrics.summary.totalProjects, 2);
  assert.equal(metrics.hardOwnerMetrics.values.notStarted, 2);
});

test('calculateTeamDashboardMetrics reports scoped closed projects outside active buckets', () => {
  const ownerTeam = { owner: '范围负责人' };
  const projects = [
    sampleProject({
      id: 'in-progress',
      owner: '范围负责人',
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '施工图' },
        硬装方案情况: { display: '进行中' },
        平面开始时间: { display: '2026-03-01' },
        软装项目进度: { display: '未开始' },
      },
    }),
    sampleProject({
      id: 'not-started',
      owner: '范围负责人',
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '未开始' },
        软装项目进度: { display: '未开始' },
      },
    }),
    sampleProject({
      id: 'closed',
      owner: '范围负责人',
      progress: 100,
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '闭环' },
        软装项目进度: { display: '闭环' },
        '方案完成/审核结束时间': { display: '2026-03-20' },
        点位完成情况: { display: '已完成' },
        软装完成情况: { display: '准时完成' },
      },
    }),
    sampleProject({
      id: 'design-closed-still-active',
      owner: '范围负责人',
      progress: 65,
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-02-01' },
        躺平内部审核结束时间: { display: '2026-02-10' },
        软装项目进度: { display: '未开始' },
      },
    }),
    sampleProject({
      id: 'paused',
      owner: '范围负责人',
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '暂停' },
        软装项目进度: { display: '暂停' },
      },
    }),
  ];

  const metrics = calculateTeamDashboardMetrics(projects, ownerTeam, {
    people: {
      范围负责人: { name: '范围负责人', position: 'owner', discipline: 'hard' },
    },
    teams: [ownerTeam],
  });

  assert.equal(metrics.summary.totalProjects, 4);
  assert.equal(metrics.totals.inProgress, 2);
  assert.equal(metrics.totals.notStarted, 1);
  assert.equal(metrics.pausedCount, 1);
  assert.deepEqual(metrics.scopeBreakdown, {
    closedInScope: 1,
    unbucketedInScope: 0,
  });
});

test('calculateTeamDashboardMetrics uses open responsibility projects for remaining difficulty pressure', () => {
  const ownerTeam = { owner: '苏佳蕾' };
  const projects = [
    sampleProject({
      id: 'closed',
      owner: '苏佳蕾',
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '闭环' },
        躺平内部审核结束时间: { display: '2026-05-12' },
        软装项目进度: { display: '闭环' },
        点位完成情况: { display: '已完成' },
        点位完成时间: { display: '2026-05-16' },
        软装完成情况: { display: '准时完成' },
      },
      difficulty: sampleDifficulty({
        score: 80,
        level: '重',
        hardWorkdays: 44,
        hardWeight: 2,
        softWorkdays: 22,
        softWeight: 1,
      }),
    }),
    sampleProject({
      id: 'open',
      owner: '苏佳蕾',
      rawFields: {
        店态: { display: '常规店' },
        硬装方案情况: { display: '进行中' },
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-05-01' },
        软装项目进度: { display: '未开始' },
      },
      difficulty: sampleDifficulty({
        score: 30,
        level: '中',
        hardWorkdays: 22,
        hardWeight: 1,
        softWorkdays: 11,
        softWeight: 0.5,
      }),
    }),
  ];

  const metrics = calculateTeamDashboardMetrics(projects, ownerTeam, {
    people: {
      苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
    },
    teams: [ownerTeam],
  });

  assert.equal(metrics.summary.totalProjects, 2);
  assert.equal(metrics.summary.activeProjects, 1);
  assert.equal(metrics.difficultySummary.projectCount, 1);
  assert.equal(metrics.difficultySummary.weightedWorkload, 1.5);
  assert.equal(metrics.difficultySummary.responsibleWeightedWorkload, 1);
});

test('weighted lead load de-duplicates same person and ignores closed discipline work', () => {
  const ownerTeam = { owner: '苏佳蕾' };
  const projects = [
    sampleProject({
      id: 'same-person-hard',
      owner: '苏佳蕾',
      rawFields: {
        店态: { display: '常规店' },
        硬装方案情况: { display: '进行中' },
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-05-01' },
        软装项目进度: { display: '未开始' },
        CD组长: { display: '陈菲菲' },
        CD设计师: { display: '陈菲菲' },
      },
      difficulty: sampleDifficulty({
        score: 46,
        level: '难',
        hardWorkdays: 27.3,
        hardWeight: 1.24,
        softWorkdays: 18.9,
        softWeight: 0.86,
      }),
    }),
    sampleProject({
      id: 'closed-soft-open-hard',
      owner: '苏佳蕾',
      rawFields: {
        店态: { display: '常规店' },
        硬装方案情况: { display: '进行中' },
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-05-01' },
        软装项目进度: { display: '闭环' },
        VM组长: { display: '郜娇营' },
      },
      difficulty: sampleDifficulty({
        score: 58,
        level: '重',
        hardWorkdays: 44,
        hardWeight: 2,
        softWorkdays: 22,
        softWeight: 1,
      }),
    }),
  ];

  const metrics = calculateTeamDashboardMetrics(projects, ownerTeam, {
    people: {
      苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
      陈菲菲: { name: '陈菲菲', position: 'lead', discipline: 'hard' },
      郜娇营: { name: '郜娇营', position: 'lead', discipline: 'soft' },
    },
    teams: [ownerTeam],
  });

  const hardLead = metrics.weightedLeadLoad.find((item) => item.name === '陈菲菲');
  const softLead = metrics.weightedLeadLoad.find((item) => item.name === '郜娇营');

  assert.equal(hardLead.value, 1);
  assert.equal(hardLead.weightedWorkload, 1.24);
  assert.equal(hardLead.measuredProjectCount, 1);
  assert.equal(softLead, undefined);
});

test('team collaboration load only includes collaborators matching owner discipline', () => {
  const hardTeam = { owner: 'HardOwner' };
  const softTeam = { owner: 'SoftOwner' };
  const dualTeam = { owner: 'DualOwner' };
  const baseFields = {
    店态: { display: '常规店' },
    硬装方案情况: { display: '进行中' },
    硬装项目进度: { display: '施工图' },
    平面开始时间: { display: '2026-05-01' },
    软装项目进度: { display: '软装方案' },
    软装方案开始时间: { display: '2026-05-10' },
  };
  const hardRawFields = {
    ...baseFields,
    CD组长: { display: 'HardLead、HardOwner' },
    CD设计师: { display: 'HardDesigner、HardOwner' },
    VM组长: { display: 'SoftLead' },
    VM设计师: { display: 'SoftDesigner' },
  };
  const softRawFields = {
    ...baseFields,
    CD组长: { display: 'HardLead' },
    CD设计师: { display: 'HardDesigner' },
    VM组长: { display: 'SoftLead、SoftOwner' },
    VM设计师: { display: 'SoftDesigner、SoftOwner' },
  };
  const dualRawFields = {
    ...baseFields,
    CD组长: { display: 'HardLead' },
    CD设计师: { display: 'HardDesigner' },
    VM组长: { display: 'SoftLead、DualOwner' },
    VM设计师: { display: 'SoftDesigner、DualOwner' },
  };
  const difficulty = sampleDifficulty({
    score: 42,
    level: '中',
    hardWorkdays: 24,
    hardWeight: 1.1,
    softWorkdays: 18,
    softWeight: 0.8,
  });
  const architecture = {
    people: {
      HardOwner: { name: 'HardOwner', position: 'owner', discipline: 'hard', categoryLabel: '硬装负责人' },
      SoftOwner: { name: 'SoftOwner', position: 'owner', discipline: 'soft', categoryLabel: '软装负责人' },
      DualOwner: { name: 'DualOwner', position: 'owner', discipline: 'both', categoryLabel: '创意负责人' },
      HardLead: { name: 'HardLead', position: 'lead', discipline: 'hard' },
      HardDesigner: { name: 'HardDesigner', position: 'designer', discipline: 'hard' },
      SoftLead: { name: 'SoftLead', position: 'lead', discipline: 'soft' },
      SoftDesigner: { name: 'SoftDesigner', position: 'designer', discipline: 'soft' },
    },
    teams: [hardTeam, softTeam, dualTeam],
  };
  const projects = [
    sampleProject({ id: 'hard-owner-project', owner: 'HardOwner', rawFields: hardRawFields, difficulty }),
    sampleProject({ id: 'soft-owner-project', owner: 'SoftOwner', rawFields: softRawFields, difficulty }),
    sampleProject({ id: 'dual-owner-project', owner: 'DualOwner', rawFields: dualRawFields, difficulty }),
  ];

  const hardMetrics = calculateTeamDashboardMetrics(projects, hardTeam, architecture);
  const softMetrics = calculateTeamDashboardMetrics(projects, softTeam, architecture);
  const dualMetrics = calculateTeamDashboardMetrics(projects, dualTeam, architecture);
  const names = (items) => items.map((item) => item.name).sort();

  assert.deepEqual(names(hardMetrics.leadLoad), ['HardDesigner', 'HardLead', 'HardOwner']);
  assert.deepEqual(names(hardMetrics.weightedLeadLoad), ['HardDesigner', 'HardLead', 'HardOwner']);
  assert.equal(
    hardMetrics.leadLoad.find((item) => item.name === 'HardOwner')?.roleLabel,
    '硬装负责人、硬装组长、硬装设计师'
  );
  assert.equal(
    hardMetrics.weightedLeadLoad.find((item) => item.name === 'HardOwner')?.roleLabel,
    '硬装负责人、硬装组长、硬装设计师'
  );
  assert.deepEqual(names(softMetrics.leadLoad), ['SoftDesigner', 'SoftLead', 'SoftOwner']);
  assert.deepEqual(names(softMetrics.weightedLeadLoad), ['SoftDesigner', 'SoftLead', 'SoftOwner']);
  assert.equal(
    softMetrics.leadLoad.find((item) => item.name === 'SoftOwner')?.roleLabel,
    '软装负责人、软装组长、软装设计师'
  );
  assert.deepEqual(names(dualMetrics.leadLoad), ['DualOwner', 'HardDesigner', 'HardLead', 'SoftDesigner', 'SoftLead']);
  assert.deepEqual(names(dualMetrics.weightedLeadLoad), ['DualOwner', 'HardDesigner', 'HardLead', 'SoftDesigner', 'SoftLead']);
  assert.equal(
    dualMetrics.leadLoad.find((item) => item.name === 'DualOwner')?.roleLabel,
    '创意负责人、软装组长、软装设计师'
  );
});

test('monthly entry pressure uses absolute pressure and shared store nature semantics', () => {
  const ownerTeam = { owner: '王吉祥' };
  const metrics = calculateTeamDashboardMetrics(
    [
      sampleProject({
        id: 'low-new',
        owner: '王吉祥',
        startDate: '2026-02-03',
        storeStatus: '常规店',
        rawFields: {
          店铺性质: { display: '新店' },
          硬装项目进度: { display: '施工图' },
        },
        difficulty: sampleDifficulty({
          score: 4,
          level: '轻',
          hardWorkdays: 2.2,
          hardWeight: 0.1,
          softWorkdays: 0,
          softWeight: 0,
        }),
      }),
      sampleProject({
        id: 'old-relocation',
        owner: '王吉祥',
        startDate: '2026-03-03',
        storeStatus: '常规店',
        rawFields: {
          店铺性质: { display: '老店换址' },
          硬装项目进度: { display: '施工图' },
        },
        difficulty: sampleDifficulty({
          score: 18,
          level: '中',
          hardWorkdays: 8.8,
          hardWeight: 0.4,
          softWorkdays: 0,
          softWeight: 0,
        }),
      }),
    ],
    ownerTeam,
    {
      people: {
        王吉祥: { name: '王吉祥', position: 'owner', discipline: 'hard' },
      },
      teams: [ownerTeam],
    }
  );

  const lowMonth = metrics.monthlyEntry.pressureByMonth.find((item) => item.label === '2026-02');
  assert.equal(lowMonth.newStoreCount, 1);
  assert.equal(lowMonth.pressureLevel, '低压');
  assert.ok(lowMonth.pressureScore < 36);
  assert.equal(metrics.monthlyEntry.oldStore.find((item) => item.label === '2026-03')?.value, 1);
});

test('monthly entry records fallback months without treating invalid start dates as covered', () => {
  const ownerTeam = { owner: '王吉祥' };
  const metrics = calculateTeamDashboardMetrics(
    [
      sampleProject({
        id: 'invalid-start',
        owner: '王吉祥',
        startDate: '待定',
        updatedAt: '2026-04-15T08:00:00.000Z',
        storeStatus: '常规店',
        rawFields: {
          店铺性质: { display: '新店' },
          硬装项目进度: { display: '施工图' },
        },
      }),
    ],
    ownerTeam,
    {
      people: {
        王吉祥: { name: '王吉祥', position: 'owner', discipline: 'hard' },
      },
      teams: [ownerTeam],
    }
  );

  assert.equal(metrics.fieldCoverage.entryDate, 0);
  assert.equal(metrics.monthlyEntry.usesUpdatedAtFallback, true);
  assert.equal(metrics.monthlyEntry.newStore.find((item) => item.label === '2026-04')?.value, 1);
  assert.equal(metrics.yearSummary.totalAssignedYtd, 1);
  assert.match(metrics.monthlyEntry.rhythmAdvice.warnings.join(' '), /更新时间兜底/);
});

test('unclassified difficulty-only months do not generate zero-zero pressure peaks', () => {
  const ownerTeam = { owner: '王吉祥' };
  const metrics = calculateTeamDashboardMetrics(
    [
      sampleProject({
        id: 'unknown-nature',
        owner: '王吉祥',
        startDate: '2026-05-03',
        storeStatus: '其他',
        businessType: '其他',
        rawFields: {
          店态: { display: '其他' },
          硬装项目进度: { display: '施工图' },
        },
        difficulty: sampleDifficulty({
          score: 40,
          level: '难',
          hardWorkdays: 22,
          hardWeight: 1,
          softWorkdays: 0,
          softWeight: 0,
        }),
      }),
    ],
    ownerTeam,
    {
      people: {
        王吉祥: { name: '王吉祥', position: 'owner', discipline: 'hard' },
      },
      teams: [ownerTeam],
    }
  );

  assert.equal(metrics.monthlyEntry.newStore.length, 0);
  assert.equal(metrics.monthlyEntry.oldStore.length, 0);
  assert.equal(metrics.monthlyEntry.pressureByMonth.length, 0);
  assert.doesNotMatch(metrics.monthlyEntry.rhythmAdvice.headline, /压力峰值/);
});

test('calculateTeamDashboardMetrics uses cleaned dingtalk start time for monthly entry', () => {
  const project = cleanProjectRecord({
    recordId: 'rec-team-1',
    fields: {
      项目名称: '进店测试店',
      省份: '浙江',
      业态: '旗舰店',
      店态: '新店',
      项目状态: '推进中',
      负责人: '苏佳蕾',
      启动时间: 1764547200000,
      计划完成日期: '2026-06-01',
      店铺性质: '新店',
    },
  });

  const metrics = calculateTeamDashboardMetrics([project], team, { teams: [team] });
  assert.equal(metrics.summary.totalProjects, 1);
  assert.ok(metrics.monthlyEntry.newStore.some((item) => item.value === 1));
});

test('/api/team-metrics requires owner and returns team metrics payload', async () => {
  await withTestServer(async (port) => {
    const missingOwner = await getJson(port, '/api/team-metrics');
    assert.equal(missingOwner.status, 400);
    assert.match(missingOwner.body.error, /owner/i);

    const invalidContext = await getJson(
      port,
      `/api/team-metrics?owner=${encodeURIComponent('苏佳蕾')}&context=unknown`
    );
    assert.equal(invalidContext.status, 400);
    assert.match(invalidContext.body.error, /context/);

    const payload = await getJson(port, `/api/team-metrics?owner=${encodeURIComponent('苏佳蕾')}`);

    assert.equal(payload.status, 200);
    assert.equal(payload.body.owner, '苏佳蕾');
    assert.equal(payload.body.dashboardContext, 'all');
    assert.ok(payload.body.summary);
    assert.ok(payload.body.tiers);
    assert.ok(payload.body.monthlyOps);
    assert.ok(payload.body.monthlyEntry);
    assert.ok(payload.body.difficultySummary);
    assert.ok(Array.isArray(payload.body.weightedLeadLoad));
    assert.ok(payload.body.insights?.headline);
    assert.ok(payload.body.benchmark);
    assert.ok(payload.body.dataHealth);
    assert.ok(Array.isArray(payload.body.dataHealth.fieldCoverage));
    assert.ok(payload.body.riskHealthAnalysis);
    assert.ok(Array.isArray(payload.body.riskHealthAnalysis.riskItems));
    assert.ok(payload.body.riskHealthAnalysis.summary);
    assert.ok(payload.body.tooltipCatalog);
    assert.ok(payload.body.metricDefinitions);
    assert.equal(payload.body.readOnly, true);
  });
});

test('/api/team-metrics-batch preloads metrics for multiple owners in one payload', async () => {
  await withTestServer(async (port) => {
    const payload = await getJson(
      port,
      `/api/team-metrics-batch?owner=${encodeURIComponent('苏佳蕾')}&owner=${encodeURIComponent('杨锦帆')}`
    );

    assert.equal(payload.status, 200);
    assert.equal(payload.body.dashboardContext, 'all');
    assert.deepEqual(payload.body.owners, ['苏佳蕾', '杨锦帆']);
    assert.equal(payload.body.metricsByOwner['苏佳蕾'].owner, '苏佳蕾');
    assert.equal(payload.body.metricsByOwner['杨锦帆'].owner, '杨锦帆');
    assert.ok(payload.body.metricsByOwner['苏佳蕾'].summary);
    assert.ok(payload.body.metricsByOwner['杨锦帆'].benchmark);
    assert.ok(payload.body.metricsByOwner['苏佳蕾'].riskHealthAnalysis);
    assert.equal(payload.body.departmentOperations.channel, 'departmentOperations');
    assert.ok(payload.body.departmentOperations.inputSnapshotHash);
    assert.ok(payload.body.departmentOperations.ownerRecommendations['苏佳蕾']);
    assert.ok(payload.body.metricsByOwner['苏佳蕾'].departmentOperations.ownerRecommendation);
    assert.equal(payload.body.metricsByOwner['苏佳蕾'].agentWorker.channels.departmentOperations.status, 'ready');
  });
});

test('/api/team-metrics-batch prefers matching precomputed metrics payloads', async () => {
  let precomputedOwner = '';

  await withTestServer(
    async (port) => {
      const payload = await getJson(
        port,
        `/api/team-metrics-batch?owner=${encodeURIComponent(precomputedOwner)}&dashboardContext=all`
      );

      assert.equal(payload.status, 200);
      assert.equal(payload.body.dashboardContext, 'all');
      assert.deepEqual(payload.body.owners, [precomputedOwner]);
      assert.equal(payload.body.metricsByOwner[precomputedOwner].precomputedHit, true);
      assert.equal(payload.body.departmentOperations.channel, 'departmentOperations');
      assert.ok(payload.body.metricsByOwner[precomputedOwner].departmentOperations.ownerRecommendation);
    },
    {
      beforeListen: async ({ config }) => {
        const sourceSnapshot = await syncProjects({
          config: {
            ...config,
            precomputeEnabled: false,
          },
          source: 'mock',
        });
        precomputedOwner = ownersFromSnapshot(sourceSnapshot, sourceSnapshot.personnelArchitecture)[0];
        assert.ok(precomputedOwner);
        await precomputeTeamDashboards(sourceSnapshot, {
          config,
          contexts: ['all'],
          years: [2026],
          now: new Date('2026-06-11T00:00:00.000Z'),
        });

        const snapshotHash = precomputeSnapshotHash(sourceSnapshot, sourceSnapshot.personnelArchitecture);
        const teamMetricsDir = path.join(config.precomputeDir, snapshotHash, 'team-metrics');
        const [fileName] = await fs.readdir(teamMetricsDir);
        const filePath = path.join(teamMetricsDir, fileName);
        const precomputed = JSON.parse(await fs.readFile(filePath, 'utf8'));
        precomputed.metricsByOwner[precomputedOwner].precomputedHit = true;
        await fs.writeFile(filePath, `${JSON.stringify(precomputed)}\n`, 'utf8');
      },
    }
  );
});

test('/api/dashboard-warmup prepares team completion and metrics precompute before first teams navigation', async () => {
  let configRef = null;
  let sourceSnapshot = null;
  let precomputedOwner = '';

  await withTestServer(
    async (port) => {
      const warmup = await getJson(port, '/api/dashboard-warmup');

      assert.equal(warmup.status, 200);
      assert.equal(warmup.body.ok, true);
      assert.ok(warmup.body.features.includes('dashboard-session'));
      assert.ok(warmup.body.features.includes('team-responsibility-review'));
      assert.ok(warmup.body.features.includes('team-work-completion'));
      assert.ok(warmup.body.features.includes('team-metrics'));

      const completion = readPrecomputedTeamWorkCompletion(configRef, sourceSnapshot, sourceSnapshot.personnelArchitecture, {
        owner: precomputedOwner,
        dashboardContext: 'all',
        year: new Date().getFullYear(),
      });
      const metrics = readPrecomputedTeamMetricsBatch(configRef, sourceSnapshot, sourceSnapshot.personnelArchitecture, {
        owners: [precomputedOwner],
        dashboardContext: 'all',
      });
      const responsibility = readPrecomputedTeamResponsibilityReview(
        configRef,
        sourceSnapshot,
        sourceSnapshot.personnelArchitecture,
        {
          owner: precomputedOwner,
          dashboardContext: 'all',
        }
      );

      assert.equal(completion?.owner, precomputedOwner);
      assert.equal(metrics?.metricsByOwner?.[precomputedOwner]?.owner, precomputedOwner);
      assert.equal(responsibility?.owner, precomputedOwner);
    },
    {
      beforeListen: async ({ config }) => {
        configRef = config;
        sourceSnapshot = await syncProjects({
          config: {
            ...config,
            precomputeEnabled: false,
          },
          source: 'mock',
        });
        precomputedOwner = ownersFromSnapshot(sourceSnapshot, sourceSnapshot.personnelArchitecture)[0];
        assert.ok(precomputedOwner);
      },
    }
  );
});

test('/api/dashboard-session returns a precomputed local browsing bundle', async () => {
  let sourceSnapshot = null;
  let precomputedOwner = '';

  await withTestServer(
    async (port) => {
      const payload = await getJson(port, '/api/dashboard-session?context=all&year=2026');

      assert.equal(payload.status, 200);
      assert.equal(payload.body.schemaVersion, 1);
      assert.equal(payload.body.readOnly, true);
      assert.equal(payload.body.snapshotHash, precomputeSnapshotHash(sourceSnapshot, sourceSnapshot.personnelArchitecture));
      assert.equal(payload.body.snapshot.source, sourceSnapshot.source);
      assert.equal(Object.hasOwn(payload.body.snapshot, 'projects'), false);
      assert.ok(payload.body.filters);
      assert.ok(payload.body.metrics);
      assert.ok(payload.body.departmentMetrics);
      assert.equal(payload.body.team.owner, precomputedOwner);
      assert.equal(payload.body.team.dashboardContext, 'all');
      assert.equal(payload.body.team.year, 2026);
      assert.equal(payload.body.team.metrics.owner, precomputedOwner);
      assert.equal(payload.body.team.workCompletion.owner, precomputedOwner);
      assert.equal(payload.body.team.responsibilityReview.owner, precomputedOwner);
      assert.equal(payload.body.team.responsibilityReview.precomputedHit, true);
    },
    {
      beforeListen: async ({ config }) => {
        sourceSnapshot = await syncProjects({
          config: {
            ...config,
            precomputeEnabled: false,
          },
          source: 'mock',
        });
        precomputedOwner = ownersFromSnapshot(sourceSnapshot, sourceSnapshot.personnelArchitecture)[0];
        assert.ok(precomputedOwner);
        const manifest = await precomputeTeamDashboards(sourceSnapshot, {
          config,
          contexts: ['all'],
          years: [2026],
          now: new Date('2026-06-11T00:00:00.000Z'),
        });
        const responsibilityDir = path.join(config.precomputeDir, manifest.snapshotHash, 'team-responsibility-review');
        const [fileName] = await fs.readdir(responsibilityDir);
        const filePath = path.join(responsibilityDir, fileName);
        const precomputed = JSON.parse(await fs.readFile(filePath, 'utf8'));
        await fs.writeFile(filePath, `${JSON.stringify({ ...precomputed, precomputedHit: true })}\n`, 'utf8');
      },
    }
  );
});

test('/api/dashboard-metrics supports profile query', async () => {
  await withTestServer(async (port) => {
    const department = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/api/dashboard-metrics?profile=department`, (response) => {
          let body = '';
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
        })
        .on('error', reject);
    });

    assert.equal(department.status, 200);
    assert.equal(department.body.profile, 'department');
    assert.ok(department.body.tiers);

    const invalidContext = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/api/dashboard-metrics?profile=department&context=unknown`, (response) => {
          let body = '';
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
        })
        .on('error', reject);
    });
    assert.equal(invalidContext.status, 400);
    assert.match(invalidContext.body.error, /context/);

    const missingOwner = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/api/dashboard-metrics?profile=ownerMonthly`, (response) => {
          let body = '';
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
        })
        .on('error', reject);
    });
    assert.equal(missingOwner.status, 400);
  });
});
