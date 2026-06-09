import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compareBenchmark } from '../../src/backend/metrics/calibrate.mjs';
import { countSchemeDelayedActiveMonth, countSiteVolume } from '../../src/backend/metrics/calculators.mjs';
import { composeDashboardMetrics } from '../../src/backend/metrics/composeDashboard.mjs';
import { filterProjectsForTeam } from '../../src/backend/projectData.mjs';
import { readProjectOwnerNames } from '../../src/backend/personnelNames.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '../fixtures/dingtalk-benchmark-fanjiaRui.json');

function matchesOwner(project, ownerToken) {
  return readProjectOwnerNames(project).some((name) => name.includes(ownerToken));
}

test('ownerMonthly dashboard exposes tier and monthlyOps structure', () => {
  const team = { owner: '苏佳蕾', cdLeads: [], vmLeads: [] };
  const projects = [
    {
      id: '1',
      owner: '苏佳蕾',
      status: '一般',
      storeStatus: '常规店',
      dueDate: '2020-01-01',
      isDelayed: true,
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '未开始' },
        软装项目进度: { display: '未开始' },
      },
    },
    {
      id: '2',
      owner: '苏佳蕾',
      status: '紧急',
      storeStatus: '下沉店',
      rawFields: {
        店态: { display: '下沉店' },
        硬装项目进度: { display: '施工图' },
        软装项目进度: { display: '施工图' },
        软装方案开始时间: { display: '2026-05-10' },
      },
    },
  ];

  const metrics = composeDashboardMetrics(projects, 'ownerMonthly', { team });
  assert.equal(metrics.profile, 'ownerMonthly');
  assert.equal(metrics.owner, '苏佳蕾');
  assert.equal(metrics.tiers.regular.notStarted, 1);
  assert.equal(metrics.tiers.sinking.inProgress, 1);
  assert.ok(metrics.monthlyOps.regular);
  assert.equal(metrics.monthlyOpsPerspective.discipline, 'all');
  assert.equal(metrics.monthlyOpsPerspective.metricGroups.hardPlanVolume, 'primary');
  assert.equal(metrics.monthlyOpsPerspective.metricGroups.pointVolume, 'primary');
  assert.ok(metrics.metricDefinitions.openDelayed);
});

test('ownerMonthly monthlyOps perspective uses company-stage groups for every owner discipline', () => {
  const team = { owner: '张嫚炳', cdLeads: [], vmLeads: [] };
  const projects = [
    {
      id: 'soft-owner-1',
      owner: '张嫚炳',
      storeStatus: '常规店',
      rawFields: {
        店态: { display: '常规店' },
        平面开始时间: { display: '2026-05-09' },
        施工图初稿完成时间: { display: '2026-05-12' },
        点位完成情况: { display: '已完成' },
        点位完成时间: { display: '2026-05-10' },
        产品清单发出时间: { display: '2026-05-10' },
        软装方案开始时间: { display: '2026-05-11' },
      },
    },
  ];

  const softMetrics = composeDashboardMetrics(projects, 'ownerMonthly', {
    team,
    ownerDiscipline: 'soft',
    now: new Date('2026-05-20T00:00:00'),
  });
  assert.equal(softMetrics.monthlyOpsPerspective.discipline, 'soft');
  assert.equal(softMetrics.monthlyOps.regular.hardPlanVolume, 1);
  assert.equal(softMetrics.monthlyOps.regular.hardConstructionVolume, 1);
  assert.equal(softMetrics.monthlyOps.regular.pointVolume, 1);
  assert.equal(softMetrics.monthlyOps.regular.productListVolume, 1);
  assert.equal(softMetrics.monthlyOpsPerspective.title, '本月公司阶段运转概览');
  assert.equal(softMetrics.monthlyOpsPerspective.metricGroups.hardPlanVolume, 'primary');
  assert.equal(softMetrics.monthlyOpsPerspective.metricGroups.hardConstructionVolume, 'company');
  assert.equal(softMetrics.monthlyOpsPerspective.metricGroups.schemeVolume, 'primary');
  assert.equal(softMetrics.monthlyOpsPerspective.metricGroups.pointVolume, 'primary');
  assert.equal(softMetrics.monthlyOpsPerspective.metricGroups.productListVolume, 'company');
  assert.equal(softMetrics.monthlyOpsPerspective.metricLabels.hardConstructionVolume, '施工图记录');
  assert.equal(softMetrics.monthlyOpsPerspective.metricLabels.productListVolume, '产品清单接收');

  const hardMetrics = composeDashboardMetrics(projects, 'ownerMonthly', {
    team,
    ownerDiscipline: 'hard',
    now: new Date('2026-05-20T00:00:00'),
  });
  assert.equal(hardMetrics.monthlyOpsPerspective.discipline, 'hard');
  assert.equal(hardMetrics.monthlyOpsPerspective.metricGroups.hardPlanVolume, 'primary');
  assert.equal(hardMetrics.monthlyOpsPerspective.metricGroups.hardConstructionVolume, 'company');
  assert.equal(hardMetrics.monthlyOpsPerspective.metricGroups.pointVolume, 'primary');
  assert.equal(hardMetrics.monthlyOpsPerspective.metricGroups.schemeVolume, 'primary');
  assert.equal(hardMetrics.monthlyOpsPerspective.metricGroups.purchaseVolume, 'company');
});

test('site volume only counts projects that have actually entered the site stage', () => {
  const now = new Date('2026-05-20T00:00:00');
  const projects = [
    {
      id: 'not-scheduled-site',
      storeStatus: '常规店',
      dueDate: '2026-05-30',
      rawFields: {
        店态: { display: '常规店' },
        软装项目进度: { display: '未安排摆场' },
        软装发项目群时间: { display: '2026-05-10' },
      },
    },
    {
      id: 'actual-site',
      storeStatus: '常规店',
      dueDate: '2026-05-30',
      rawFields: {
        店态: { display: '常规店' },
        软装项目进度: { display: '摆场' },
      },
    },
    {
      id: 'soft-send-only',
      storeStatus: '常规店',
      rawFields: {
        店态: { display: '常规店' },
        软装项目进度: { display: '摆场' },
        软装发项目群时间: { display: '2026-05-10' },
      },
    },
  ];

  assert.equal(countSiteVolume(projects, 'regular', { now }), 1);
});

test('hard active delay is not hidden by soft workflow closure', () => {
  const now = new Date('2026-05-20T00:00:00');
  const projects = [
    {
      id: 'hard-delay-soft-closed',
      storeStatus: '常规店',
      updatedAt: '2026-05-12T00:00:00.000Z',
      rawFields: {
        店态: { display: '常规店' },
        硬装项目进度: { display: '闭环' },
        平面开始时间: { display: '2026-05-01' },
        软装项目进度: { display: '闭环' },
        硬装方案情况: { display: '延期中' },
      },
    },
  ];

  assert.equal(countSchemeDelayedActiveMonth(projects, 'regular', { now, ownerDiscipline: 'hard' }), 1);
  assert.equal(
    countSchemeDelayedActiveMonth(projects, 'regular', {
      now,
      profileId: 'ownerMonthly',
      ownerDiscipline: 'soft',
    }),
    0
  );
});

test('ownerMonthly scope can route split owner responsibility identities by discipline slot', () => {
  const projects = [
    {
      id: 'yang-hard-slot',
      owner: '杨锦帆',
      storeStatus: '常规店',
      rawFields: {
        负责人: { display: '杨锦帆' },
        CD负责人: { display: '杨锦帆' },
        组别: { display: '直营新店' },
        店态: { display: '常规店' },
        硬装项目进度: { display: '施工图' },
      },
    },
    {
      id: 'yang-soft-slot',
      owner: '杨锦帆',
      storeStatus: '常规店',
      rawFields: {
        负责人: { display: '杨锦帆' },
        VM负责人: { display: '杨锦帆' },
        组别: { display: '加盟新店' },
        店态: { display: '常规店' },
        软装项目进度: { display: '软装方案中' },
      },
    },
    {
      id: 'yang-total-only',
      owner: '杨锦帆',
      storeStatus: '常规店',
      rawFields: {
        负责人: { display: '杨锦帆' },
        组别: { display: '直营新店' },
        店态: { display: '常规店' },
        硬装项目进度: { display: '施工图' },
      },
    },
  ];
  const personnelArchitecture = {
    responsibilityIdentities: [
      {
        identityId: 'resp-017',
        displayName: '杨锦帆（硬装）',
        sourceName: '杨锦帆',
        discipline: 'hard',
        scope: 'both',
      },
      {
        identityId: 'resp-018',
        displayName: '杨锦帆（软装）',
        sourceName: '杨锦帆',
        discipline: 'soft',
        scope: 'both',
      },
    ],
  };

  const hardMetrics = composeDashboardMetrics(projects, 'ownerMonthly', {
    owner: 'resp-017',
    personnelArchitecture,
  });
  const softMetrics = composeDashboardMetrics(projects, 'ownerMonthly', {
    owner: 'resp-018',
    personnelArchitecture,
  });

  assert.equal(hardMetrics.owner, 'resp-017');
  assert.equal(hardMetrics.ownerIdentity.identityId, 'resp-017');
  assert.equal(hardMetrics.ownerIdentity.sourceName, '杨锦帆');
  assert.equal(hardMetrics.scopeCount, 1);
  assert.equal(softMetrics.ownerIdentity.identityId, 'resp-018');
  assert.equal(softMetrics.scopeCount, 1);
});

test('compareBenchmark runs against fanjiaRui fixture with tolerance metadata', async () => {
  const benchmark = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const cachePath = path.join(__dirname, '../../data/dashboard-cache.json');
  let projects = [];

  try {
    const cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    projects = cache.projects || [];
  } catch {
    projects = [];
  }

  if (!projects.length) {
    projects = [
      {
        id: 'mock-1',
        owner: benchmark.owner,
        storeStatus: '常规店',
        dueDate: '2020-01-01',
        isDelayed: true,
        updatedAt: '2026-05-01T00:00:00.000Z',
        startDate: '2026-01-01',
        rawFields: {
          店态: { display: '常规店' },
          硬装项目进度: { display: '未开始' },
          软装项目进度: { display: '摆场' },
          '硬装方案情况（每周五刷新）': { display: '延期完成' },
        },
      },
    ];
  }

  const teamProjects = filterProjectsForTeam(projects, benchmark.team);
  const hasOwnerScope =
    teamProjects.length > 0 || projects.some((project) => matchesOwner(project, '范嘉瑞'));
  if (!hasOwnerScope) {
    return;
  }

  const result = compareBenchmark(projects, benchmark);
  assert.equal(result.owner, benchmark.owner);
  assert.ok(Array.isArray(result.diffs));
  assert.ok(result.summary.totalChecks > 0);
  assert.equal(typeof result.summary.withinTolerance, 'boolean');
  if (projects.length > 50) {
    assert.ok(result.summary.totalChecks > 0);
  }
});
