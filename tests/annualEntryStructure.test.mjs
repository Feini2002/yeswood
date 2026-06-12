import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAnnualEntryStructure } from '../src/backend/metrics/buildAnnualEntryStructure.mjs';
import { composeDashboardMetrics } from '../src/backend/metrics/composeDashboard.mjs';
import { countYearEntry, isValidYearEntryProject } from '../src/backend/metrics/entryScope.mjs';
import { buildDirectorOverviewModel } from '../public/dashboard/home-director-metrics.mjs';
import { calculateTeamDashboardMetrics } from '../src/backend/projectData.mjs';

function raw(display) {
  return { display };
}

function sampleProject(overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    name: overrides.name || '测试项目',
    province: overrides.province ?? '浙江省',
    storeStatus: overrides.storeStatus || '常规店',
    status: overrides.status || '一般',
    startDate: overrides.startDate,
    updatedAt: overrides.updatedAt,
    rawFields: overrides.rawFields || {},
    ...overrides,
  };
}

function directNew(id, startDate, extras = {}) {
  const { rawFields: extraRawFields = {}, hardStage, storeStatus, ...rest } = extras;
  return sampleProject({
    id,
    startDate,
    rawFields: {
      组别: raw('直营新店'),
      店铺性质: raw('新店'),
      店态: raw(storeStatus || '常规店'),
      硬装项目进度: raw(hardStage || '施工图'),
      ...extraRawFields,
    },
    ...rest,
  });
}

test('unclassified scope projects are excluded from entry and counted in dataQuality', () => {
  const projects = [
    directNew('scoped', '2026-03-01'),
    sampleProject({
      id: 'other-scope',
      startDate: '2026-03-02',
      rawFields: {
        组别: raw('其他组别'),
        店铺性质: raw('新店'),
        店态: raw('常规店'),
        硬装项目进度: raw('施工图'),
      },
    }),
  ];

  const payload = buildAnnualEntryStructure(projects, { year: 2026 });
  assert.equal(payload.totals.entry, 1);
  assert.equal(payload.dataQuality.unclassifiedScope, 1);
});

test('paused and canceled projects are excluded while closed projects still count', () => {
  const projects = [
    directNew('active', '2026-02-01'),
    directNew('closed', '2026-02-02', { hardStage: '闭环', rawFields: { 软装项目进度: raw('闭环') } }),
    directNew('paused', '2026-02-03', { hardStage: '暂停' }),
    sampleProject({
      id: 'canceled',
      startDate: '2026-02-04',
      status: '已取消',
      rawFields: {
        组别: raw('加盟新店'),
        店铺性质: raw('新店'),
        店态: raw('常规店'),
        硬装项目进度: raw('施工图'),
      },
    }),
  ];

  const payload = buildAnnualEntryStructure(projects, { year: 2026 });
  assert.equal(payload.totals.entry, 2);
  assert.equal(payload.dataQuality.excludedPaused, 1);
  assert.equal(payload.dataQuality.excludedCanceled, 1);
});

test('recovered paused projects count back into their original start month', () => {
  const projects = [
    directNew('current-paused', '2026-03-01', { hardStage: '暂停' }),
    directNew('recovered-paused', '2026-03-02', { hardStage: '暂停后恢复' }),
    directNew('historical-paused', '2026-04-03', { hardStage: '曾暂停，现施工图推进' }),
  ];

  const payload = buildAnnualEntryStructure(projects, { year: 2026 });
  const march = payload.months.find((month) => month.month === 3);
  const april = payload.months.find((month) => month.month === 4);

  assert.equal(payload.totals.entry, 2);
  assert.equal(payload.dataQuality.excludedPaused, 1);
  assert.deepEqual(march.projects.map((project) => project.id), ['recovered-paused']);
  assert.deepEqual(april.projects.map((project) => project.id), ['historical-paused']);
});

test('month totals reconcile with annual totals and quadrant breakdown', () => {
  const projects = [
    directNew('d-new-3', '2026-03-05'),
    sampleProject({
      id: 'f-old-3',
      startDate: '2026-03-08',
      rawFields: {
        组别: raw('加盟老店'),
        店铺性质: raw('老店改造'),
        店态: raw('下沉店'),
        硬装项目进度: raw('施工图'),
      },
    }),
    directNew('d-new-4', '2026-04-10'),
  ];

  const payload = buildAnnualEntryStructure(projects, { year: 2026 });
  const monthSum = payload.months.reduce((sum, month) => sum + month.total, 0);
  assert.equal(monthSum, payload.totals.entry);

  const march = payload.months.find((month) => month.month === 3);
  assert.equal(march.total, march.newStore.total + march.oldStore.total);
  assert.equal(march.newStore.total, march.newStore.direct + march.newStore.franchise);
  assert.equal(march.oldStore.total, march.oldStore.direct + march.oldStore.franchise);
  assert.equal(
    march.total,
    march.quadrants.directNew.total +
      march.quadrants.directOld.total +
      march.quadrants.franchiseNew.total +
      march.quadrants.franchiseOld.total
  );

  const statusSum = march.storeStatuses.reduce((sum, item) => sum + item.total, 0);
  const provinceSum = march.provinces.reduce((sum, item) => sum + item.total, 0);
  assert.equal(statusSum, march.total);
  assert.equal(provinceSum, march.total);
});

test('annual entry keeps unfilled store status projects but omits them from store status rankings', () => {
  const projects = [
    directNew('filled', '2026-03-05', { storeStatus: '常规店' }),
    sampleProject({
      id: 'missing-status',
      startDate: '2026-03-08',
      storeStatus: '未填写',
      rawFields: {
        组别: raw('直营新店'),
        店铺性质: raw('新店'),
        店态: raw(''),
        硬装项目进度: raw('施工图'),
      },
    }),
  ];

  const payload = buildAnnualEntryStructure(projects, { year: 2026 });
  const march = payload.months.find((month) => month.month === 3);

  assert.equal(march.total, 2);
  assert.equal(march.projects.length, 2);
  assert.equal(march.projects.some((project) => project.storeStatus === '未填写'), true);
  assert.deepEqual(
    march.storeStatuses.map((item) => item.label),
    ['常规店']
  );
  assert.equal(march.storeStatuses.reduce((sum, item) => sum + item.total, 0), 1);
});

test('month entry payload includes project summaries for drill modals', () => {
  const projects = [
    directNew('d-new-3', '2026-03-05', { name: '杭州直营新店', province: '浙江省', cdOwner: '苏佳蕾' }),
    sampleProject({
      id: 'f-old-3',
      name: '武汉加盟老店',
      startDate: '2026-03-08',
      province: '湖北省',
      vmOwner: '杨晶晶',
      rawFields: {
        组别: raw('加盟老店'),
        店铺性质: raw('老店改造'),
        店态: raw('下沉店'),
        硬装项目进度: raw('施工图'),
      },
    }),
    directNew('paused', '2026-03-10', { hardStage: '暂停' }),
  ];

  const payload = buildAnnualEntryStructure(projects, { year: 2026 });
  const march = payload.months.find((month) => month.month === 3);

  assert.equal(march.projects.length, 2);
  assert.deepEqual(
    march.projects.map((project) => project.id),
    ['d-new-3', 'f-old-3']
  );
  assert.deepEqual(march.projects[0], {
    id: 'd-new-3',
    name: '杭州直营新店',
    startDate: '2026-03-05',
    month: 3,
    province: '浙江省',
    storeStatus: '常规店',
    status: '一般',
    scope: 'direct',
    scopeLabel: '直营',
    storeAge: 'newStore',
    storeAgeLabel: '新店',
    quadrantKey: 'directNew',
    quadrantLabel: '直营新店',
    owner: '苏佳蕾',
  });
  assert.equal(march.quadrants.franchiseOld.projects[0].name, '武汉加盟老店');
  assert.equal(march.quadrants.franchiseOld.projects[0].owner, '杨晶晶');
});

test('missing startDate is excluded from entry and counted in dataQuality', () => {
  const projects = [
    directNew('with-date', '2026-05-01'),
    sampleProject({
      id: 'missing-date',
      rawFields: {
        组别: raw('直营新店'),
        店铺性质: raw('新店'),
        店态: raw('常规店'),
        硬装项目进度: raw('施工图'),
      },
    }),
  ];

  const payload = buildAnnualEntryStructure(projects, { year: 2026 });
  assert.equal(payload.totals.entry, 1);
  assert.equal(payload.dataQuality.missingStartDate, 1);
  assert.equal(isValidYearEntryProject(projects[1], 2026), false);
});

test('field coverage reflects missing entry fields before annual filtering hides them', () => {
  const projects = [
    directNew('with-all-fields', '2026-05-01'),
    sampleProject({
      id: 'missing-date',
      rawFields: {
        组别: raw('直营新店'),
        店铺性质: raw('新店'),
        店态: raw('常规店'),
        硬装项目进度: raw('施工图'),
      },
    }),
    sampleProject({
      id: 'missing-store-nature',
      startDate: '2026-05-02',
      rawFields: {
        组别: raw('加盟新店'),
        店铺性质: raw(''),
        店态: raw('常规店'),
        硬装项目进度: raw('施工图'),
      },
    }),
    sampleProject({
      id: 'missing-province',
      province: '',
      startDate: '2026-05-03',
      rawFields: {
        组别: raw('加盟新店'),
        店铺性质: raw('新店'),
        店态: raw('常规店'),
        硬装项目进度: raw('施工图'),
      },
    }),
    sampleProject({
      id: 'other-scope',
      startDate: '2026-05-04',
      rawFields: {
        组别: raw('其他组别'),
        店铺性质: raw('新店'),
        店态: raw('常规店'),
        硬装项目进度: raw('施工图'),
      },
    }),
  ];

  const payload = buildAnnualEntryStructure(projects, { year: 2026 });

  assert.equal(payload.fieldCoverage.startDate, 75);
  assert.equal(payload.fieldCoverage.storeNature, 67);
  assert.equal(payload.fieldCoverage.province, 50);
  assert.equal(payload.fieldCoverage.businessGroup, 75);
});

test('annual entry structure does not use updatedAt fallback unlike team monthlyEntry', () => {
  const projects = [
    sampleProject({
      id: 'fallback-only',
      owner: '测试负责人',
      cdOwner: '测试负责人',
      updatedAt: '2026-04-18',
      rawFields: {
        组别: raw('直营新店'),
        店铺性质: raw('新店'),
        店态: raw('常规店'),
        硬装项目进度: raw('施工图'),
        CD负责人: raw('测试负责人'),
      },
    }),
  ];
  const team = { owner: '测试负责人', cdLeads: ['测试负责人'], vmLeads: [] };
  const teamMetrics = calculateTeamDashboardMetrics(projects, team, {
    now: new Date('2026-06-01T00:00:00.000Z'),
  });
  const payload = buildAnnualEntryStructure(projects, { year: 2026 });

  assert.equal(teamMetrics.monthlyEntry.usesUpdatedAtFallback, true);
  assert.equal(payload.totals.entry, 0);
  assert.equal(payload.dataQuality.missingStartDate, 1);
});

test('department currentYearEntry aligns with annualEntryStructure totals.entry', () => {
  const projects = [
    directNew('d1', '2026-01-03'),
    sampleProject({
      id: 'f1',
      startDate: '2026-02-08',
      rawFields: {
        组别: raw('加盟新店'),
        店铺性质: raw('新店'),
        店态: raw('旗舰店'),
        硬装项目进度: raw('施工图'),
      },
    }),
    directNew('paused', '2026-03-01', { hardStage: '暂停' }),
    sampleProject({
      id: 'unclassified-age',
      startDate: '2026-03-02',
      rawFields: {
        组别: raw('直营新店'),
        店铺性质: raw(''),
        店态: raw('常规店'),
        硬装项目进度: raw('施工图'),
      },
    }),
  ];

  const metrics = composeDashboardMetrics(projects, 'department', {
    now: new Date('2026-06-01T00:00:00.000Z'),
  });
  const payload = metrics.annualEntryStructure;

  assert.equal(metrics.currentYearEntry.count, payload.totals.entry);
  assert.equal(metrics.currentYearEntry.count, countYearEntry(projects, 2026));

  const model = buildDirectorOverviewModel({
    departmentMetrics: metrics,
    projects,
    now: new Date('2026-06-01T00:00:00.000Z'),
  });
  assert.equal(model.summary.currentYearEntry, payload.totals.entry);
});

test('ownerMonthly annualEntryStructure is scoped by owner and dashboard context', () => {
  const scopedDirect = sampleProject({
    id: 'owner-direct',
    owner: 'Owner A',
    startDate: '2026-03-05',
    rawFields: {
      '\u7ec4\u522b': raw('\u76f4\u8425\u65b0\u5e97'),
      '\u5e97\u94fa\u6027\u8d28': raw('\u65b0\u5e97'),
      '\u5e97\u6001': raw('\u5e38\u89c4\u5e97'),
      '\u786c\u88c5\u9879\u76ee\u8fdb\u5ea6': raw('\u65bd\u5de5\u56fe'),
    },
  });
  const scopedFranchise = sampleProject({
    id: 'owner-franchise',
    owner: 'Owner A',
    startDate: '2026-04-06',
    rawFields: {
      '\u7ec4\u522b': raw('\u52a0\u76df\u65b0\u5e97'),
      '\u5e97\u94fa\u6027\u8d28': raw('\u65b0\u5e97'),
      '\u5e97\u6001': raw('\u5e38\u89c4\u5e97'),
      '\u786c\u88c5\u9879\u76ee\u8fdb\u5ea6': raw('\u65bd\u5de5\u56fe'),
    },
  });
  const otherOwner = sampleProject({
    id: 'other-owner',
    owner: 'Owner B',
    startDate: '2026-05-07',
    rawFields: {
      '\u7ec4\u522b': raw('\u76f4\u8425\u65b0\u5e97'),
      '\u5e97\u94fa\u6027\u8d28': raw('\u65b0\u5e97'),
      '\u5e97\u6001': raw('\u5e38\u89c4\u5e97'),
      '\u786c\u88c5\u9879\u76ee\u8fdb\u5ea6': raw('\u65bd\u5de5\u56fe'),
    },
  });

  const allMetrics = composeDashboardMetrics(
    [scopedDirect, scopedFranchise, otherOwner],
    'ownerMonthly',
    {
      owner: 'Owner A',
      team: { owner: 'Owner A' },
      dashboardContext: 'all',
      now: new Date('2026-06-01T00:00:00.000Z'),
    }
  );
  const directMetrics = composeDashboardMetrics(
    [scopedDirect, scopedFranchise, otherOwner],
    'ownerMonthly',
    {
      owner: 'Owner A',
      team: { owner: 'Owner A' },
      dashboardContext: 'direct',
      now: new Date('2026-06-01T00:00:00.000Z'),
    }
  );

  assert.equal(allMetrics.currentYearEntry.count, 2);
  assert.equal(allMetrics.annualEntryStructure.totals.entry, 2);
  assert.equal(allMetrics.annualEntryStructure.totals.direct, 1);
  assert.equal(allMetrics.annualEntryStructure.totals.franchise, 1);
  assert.deepEqual(
    allMetrics.annualEntryStructure.months.flatMap((month) => month.projects.map((project) => project.id)),
    ['owner-direct', 'owner-franchise']
  );

  assert.equal(directMetrics.currentYearEntry.count, 1);
  assert.equal(directMetrics.annualEntryStructure.totals.entry, 1);
  assert.equal(directMetrics.annualEntryStructure.totals.direct, 1);
  assert.equal(directMetrics.annualEntryStructure.totals.franchise, 0);
  assert.deepEqual(
    directMetrics.annualEntryStructure.months.flatMap((month) => month.projects.map((project) => project.id)),
    ['owner-direct']
  );
});

test('defaultMonth selects latest month with entry greater than zero', () => {
  const projects = [directNew('m3', '2026-03-01'), directNew('m5', '2026-05-01')];
  const payload = buildAnnualEntryStructure(projects, { year: 2026 });
  assert.equal(payload.defaultMonth, 5);
});

test('store status distribution keeps every populated status without merging 其他', () => {
  const projects = Array.from({ length: 10 }, (_, index) =>
    sampleProject({
      id: `p-${index}`,
      startDate: '2026-06-01',
      storeStatus: `店态${index}`,
      rawFields: {
        组别: raw('直营新店'),
        店铺性质: raw('新店'),
        店态: raw(`店态${index}`),
        硬装项目进度: raw('施工图'),
      },
    })
  );

  const payload = buildAnnualEntryStructure(projects, { year: 2026 });
  const june = payload.months.find((month) => month.month === 6);
  assert.equal(june.storeStatuses.length, 10);
  assert.equal(june.storeStatuses.some((item) => item.label === '其他'), false);
  assert.equal(june.storeStatuses.reduce((sum, item) => sum + item.total, 0), 10);
});

test('property: annual entry structure keeps section 8 invariants on random mixes', () => {
  const storeStatuses = ['常规店', '下沉店', '高标店', '旗舰店'];
  const groups = ['直营新店', '加盟老店', '其他组别'];
  const natures = ['新店', '老店改造', ''];
  const stages = ['施工图', '暂停', '闭环', '取消'];

  for (let seed = 0; seed < 30; seed += 1) {
    const projects = Array.from({ length: 12 }, (_, index) =>
      sampleProject({
        id: `seed-${seed}-${index}`,
        startDate: `2026-${String((index % 12) + 1).padStart(2, '0')}-0${(index % 9) + 1}`,
        province: index % 3 === 0 ? '' : `省份${index % 5}`,
        storeStatus: storeStatuses[index % storeStatuses.length],
        status: index % 7 === 0 ? '已取消' : '一般',
        rawFields: {
          组别: raw(groups[index % groups.length]),
          店铺性质: raw(natures[index % natures.length]),
          店态: raw(storeStatuses[index % storeStatuses.length]),
          硬装项目进度: raw(stages[index % stages.length]),
        },
      })
    );

    const payload = buildAnnualEntryStructure(projects, { year: 2026 });
    const monthSum = payload.months.reduce((sum, month) => sum + month.total, 0);
    assert.equal(monthSum, payload.totals.entry);
    assert.equal(payload.totals.entry, payload.totals.newStore + payload.totals.oldStore);
    assert.equal(payload.totals.entry, payload.totals.direct + payload.totals.franchise);

    for (const month of payload.months) {
      assert.equal(month.total, month.newStore.total + month.oldStore.total);
      assert.equal(
        month.total,
        month.quadrants.directNew.total +
          month.quadrants.directOld.total +
          month.quadrants.franchiseNew.total +
          month.quadrants.franchiseOld.total
      );
      if (month.total > 0) {
        assert.equal(
          month.storeStatuses.reduce((sum, item) => sum + item.total, 0),
          month.total
        );
        assert.equal(
          month.provinces.reduce((sum, item) => sum + item.total, 0),
          month.total
        );
      }
    }
  }
});
