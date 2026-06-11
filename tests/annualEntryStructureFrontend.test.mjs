import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyChartViewportContext,
  focusEntryStructureMonth,
  buildContext,
  chartViewportFromDataZoom,
  dataZoomMonthLabel,
  getProjectModalContext,
  getProjectModalView,
  mainChartPointerPointFromEvent,
  monthFromMainChartClickParams,
} from '../public/dashboard/annual-entry-structure.mjs';

test('project modal view filters projects by clicked store status', () => {
  const context = {
    projects: [
      { id: 'p-1', name: '常规直营', storeStatus: '常规店', quadrantKey: 'directNew' },
      { id: 'p-2', name: '下沉直营', storeStatus: '下沉店', quadrantKey: 'directNew' },
      { id: 'p-3', name: '常规加盟', storeStatus: '常规店', quadrantKey: 'franchiseOld' },
    ],
  };

  const statusView = getProjectModalView(context, { filter: 'all', storeStatus: '常规店' });
  assert.equal(statusView.filterLabel, '店态：常规店');
  assert.deepEqual(
    statusView.projects.map((project) => project.id),
    ['p-1', 'p-3']
  );

  const quadrantView = getProjectModalView(context, { filter: 'directNew', storeStatus: '常规店' });
  assert.equal(quadrantView.filterLabel, '店态：常规店 · 直营新店');
  assert.deepEqual(
    quadrantView.projects.map((project) => project.id),
    ['p-1']
  );
});

test('project modal renders operational entry detail columns without month badges or status column', async () => {
  const module = await import('../public/dashboard/annual-entry-structure.mjs');
  assert.equal(typeof module.renderProjectModal, 'function');

  const html = module.renderProjectModal(
    { modal: { open: true, filter: 'all', storeStatus: '', month: 2 } },
    {
      caption: '点击月份',
      label: '2026年 2月',
      projects: [
        {
          id: 'p-1',
          name: '白银居然阳明店',
          startDate: '2026-02-01',
          month: 2,
          quadrantKey: 'franchiseNew',
          quadrantLabel: '加盟新店',
          storeStatus: '常规店',
          province: '甘肃省',
          owner: '王吉祥、范嘉瑞',
          status: '未设置',
        },
      ],
    }
  );

  assert.match(html, /<span>项目<\/span>/);
  assert.match(html, /<span>进店日期<\/span>/);
  assert.match(html, /<span>结构<\/span>/);
  assert.match(html, /<span>地区 \/ 店态<\/span>/);
  assert.match(html, /<span>负责人<\/span>/);
  assert.doesNotMatch(html, /<span>状态<\/span>/);
  assert.doesNotMatch(html, /entry-structure-project-status/);
  assert.doesNotMatch(html, />2月<\/time>/);
  assert.match(html, /2026-02-01/);
  assert.match(html, /加盟新店/);
  assert.match(html, /甘肃省/);
  assert.match(html, /常规店/);
  assert.match(html, /王吉祥、范嘉瑞/);
});

test('main chart click params resolve months from x-axis labels and series bars', () => {
  const payload = {
    months: [
      { month: 1, label: '1月' },
      { month: 2, label: '2月' },
      { month: 3, label: '3月' },
    ],
  };

  assert.equal(monthFromMainChartClickParams({ componentType: 'xAxis', value: '2月' }, payload), 2);
  assert.equal(monthFromMainChartClickParams({ componentType: 'series', dataIndex: 2 }, payload), 3);
  assert.equal(monthFromMainChartClickParams({ componentType: 'series', name: '1月', dataIndex: 9 }, payload), 1);
  assert.equal(monthFromMainChartClickParams({ componentType: 'series', seriesName: '月份点击层', data: { month: 2 } }, payload), 2);
  assert.equal(monthFromMainChartClickParams({ componentType: 'dataZoom', dataIndex: 2 }, payload), 0);
  assert.equal(monthFromMainChartClickParams({ componentType: 'markArea', name: '3月', dataIndex: 2 }, payload), 0);
});

test('main chart pointer point resolves zrender and native event coordinates', () => {
  assert.deepEqual(mainChartPointerPointFromEvent({ offsetX: 120, offsetY: 240 }), [120, 240]);
  assert.deepEqual(mainChartPointerPointFromEvent({ zrX: 121, zrY: 241 }), [121, 241]);
  assert.deepEqual(mainChartPointerPointFromEvent({ event: { offsetX: 122, offsetY: 242 } }), [122, 242]);
  assert.equal(mainChartPointerPointFromEvent({}), null);
});

test('project modal view can combine province and store age filters when provided', () => {
  const context = {
    projects: [
      { id: 'gd-new', province: '广东省', storeAge: 'newStore', storeStatus: '常规店', quadrantKey: 'directNew' },
      { id: 'gd-old', province: '广东省', storeAge: 'oldStore', storeStatus: '常规店', quadrantKey: 'directOld' },
      { id: 'zj-new', province: '浙江省', storeAge: 'newStore', storeStatus: '常规店', quadrantKey: 'directNew' },
    ],
  };

  const provinceView = getProjectModalView(context, { filter: 'all', province: '广东省' });
  assert.equal(provinceView.filterLabel, '省份：广东省');
  assert.deepEqual(
    provinceView.projects.map((project) => project.id),
    ['gd-new', 'gd-old']
  );

  const segmentView = getProjectModalView(context, { filter: 'all', province: '广东省', storeAge: 'newStore' });
  assert.equal(segmentView.filterLabel, '省份：广东省 · 新店');
  assert.deepEqual(
    segmentView.projects.map((project) => project.id),
    ['gd-new']
  );
});

function aggregateMonth(month, { total, statusLabel, provinceLabel, projectId, storeAge = 'newStore' }) {
  const newStoreTotal = storeAge === 'newStore' ? total : 0;
  const oldStoreTotal = storeAge === 'oldStore' ? total : 0;
  return {
    month,
    label: `${month}月`,
    total,
    newStore: { total: newStoreTotal, direct: newStoreTotal, franchise: 0 },
    oldStore: { total: oldStoreTotal, direct: oldStoreTotal, franchise: 0 },
    quadrants: {
      directNew: {
        total: newStoreTotal,
        storeStatuses: newStoreTotal ? [{ key: statusLabel, label: statusLabel, total: newStoreTotal, direct: newStoreTotal, franchise: 0 }] : [],
        provinces: newStoreTotal ? [{ key: provinceLabel, label: provinceLabel, total: newStoreTotal, newStore: newStoreTotal, oldStore: 0 }] : [],
      },
      directOld: {
        total: oldStoreTotal,
        storeStatuses: oldStoreTotal ? [{ key: statusLabel, label: statusLabel, total: oldStoreTotal, direct: oldStoreTotal, franchise: 0 }] : [],
        provinces: oldStoreTotal ? [{ key: provinceLabel, label: provinceLabel, total: oldStoreTotal, newStore: 0, oldStore: oldStoreTotal }] : [],
      },
    },
    storeStatuses: [{ key: statusLabel, label: statusLabel, total, direct: total, franchise: 0 }],
    provinces: [{ key: provinceLabel, label: provinceLabel, total, newStore: newStoreTotal, oldStore: oldStoreTotal }],
    projects: [
      {
        id: projectId,
        month,
        storeStatus: statusLabel,
        quadrantKey: storeAge === 'newStore' ? 'directNew' : 'directOld',
        province: provinceLabel,
        storeAge,
        storeAgeLabel: storeAge === 'newStore' ? '新店' : '老店',
      },
    ],
  };
}

test('data zoom month range drives ranking context aggregation', () => {
  const payload = {
    year: 2026,
    months: [
      aggregateMonth(1, { total: 10, statusLabel: '常规店', provinceLabel: '浙江省', projectId: 'm1' }),
      aggregateMonth(2, { total: 20, statusLabel: '下沉店', provinceLabel: '江苏省', projectId: 'm2' }),
      aggregateMonth(3, { total: 30, statusLabel: '高标店', provinceLabel: '安徽省', projectId: 'm3' }),
      aggregateMonth(4, { total: 40, statusLabel: '旗舰店', provinceLabel: '广东省', projectId: 'm4' }),
    ],
  };

  const context = buildContext(payload, {
    contextMode: 'range',
    chartViewport: { startMonth: 2, endMonth: 3, startLabel: '2月', endLabel: '3月' },
  });

  assert.equal(context.label, '2026年 2-3月');
  assert.equal(context.total, 50);
  assert.deepEqual(
    context.storeStatuses.map((item) => item.label),
    ['高标店', '下沉店']
  );
  assert.deepEqual(
    context.provinces.map((item) => item.label),
    ['安徽省', '江苏省']
  );
  assert.deepEqual(
    context.projects.map((project) => project.id),
    ['m2', 'm3']
  );
});

test('data zoom full visual range keeps the 12th month in context', () => {
  const payload = {
    year: 2026,
    months: Array.from({ length: 12 }, (_, index) => aggregateMonth(index + 1, {
      total: index + 1,
      statusLabel: '常规店',
      provinceLabel: '广东省',
      projectId: `m${index + 1}`,
    })),
  };

  const viewport = chartViewportFromDataZoom(payload, {
    batch: [{ startValue: 0, endValue: 11, start: 0, end: 100 }],
  });
  const context = buildContext(payload, {
    contextMode: 'range',
    chartViewport: viewport,
  });

  assert.deepEqual(viewport, { startMonth: 1, endMonth: 12, startLabel: '1月', endLabel: '12月' });
  assert.equal(context.label, '2026年 1-12月');
  assert.equal(context.total, 78);
});

test('data zoom labels distinguish category indexes from month labels', () => {
  assert.equal(dataZoomMonthLabel(0), '1月');
  assert.equal(dataZoomMonthLabel(11), '12月');
  assert.equal(dataZoomMonthLabel(11, '11'), '12月');
  assert.equal(dataZoomMonthLabel('11月'), '11月');
  assert.equal(dataZoomMonthLabel('12月'), '12月');
});

test('unfilled store status is kept in projects but hidden from status distribution', () => {
  const payload = {
    year: 2026,
    months: [
      aggregateMonth(1, { total: 10, statusLabel: '常规店', provinceLabel: '浙江省', projectId: 'filled' }),
      aggregateMonth(2, { total: 1, statusLabel: '未填写', provinceLabel: '江苏省', projectId: 'missing-status' }),
    ],
  };

  const context = buildContext(payload, { contextMode: 'year' });

  assert.equal(context.total, 11);
  assert.deepEqual(
    context.storeStatuses.map((item) => item.label),
    ['常规店']
  );
  assert.deepEqual(
    context.projects.map((project) => project.id),
    ['filled', 'missing-status']
  );
});

test('main chart uses store-age labels for single-channel data and restores channel labels when mixed', async () => {
  const module = await import('../public/dashboard/annual-entry-structure.mjs');
  assert.equal(typeof module.buildMainChartOption, 'function');
  assert.equal(typeof module.buildStatusChartOption, 'function');
  assert.equal(typeof module.renderEntryStatusStrip, 'function');

  const directOnlyPayload = {
    year: 2026,
    months: [
      aggregateMonth(1, { total: 13, statusLabel: '常规店', provinceLabel: '浙江省', projectId: 'direct-jan' }),
      aggregateMonth(2, { total: 10, statusLabel: '常规店', provinceLabel: '江苏省', projectId: 'direct-feb' }),
    ],
  };
  const directOnlyOption = module.buildMainChartOption(directOnlyPayload, {
    contextMode: 'year',
    chartViewport: { startMonth: 1, endMonth: 12, startLabel: '1月', endLabel: '12月' },
    modal: { open: false, month: 0 },
  });

  assert.deepEqual(
    directOnlyOption.legend.data.map((item) => item.name),
    ['新店', '老店', '新店趋势', '老店趋势']
  );
  assert.equal(directOnlyOption.series.some((item) => item.name === '直营新店' || item.name === '直营老店'), false);
  assert.equal(directOnlyOption.series.some((item) => String(item.name || '').includes('加盟')), false);
  assert.match(directOnlyOption.xAxis.axisLabel.formatter('1月', 0), /新店 13/);
  assert.match(directOnlyOption.xAxis.axisLabel.formatter('1月', 0), /老店 0/);
  assert.doesNotMatch(directOnlyOption.xAxis.axisLabel.formatter('1月', 0), /直营/);
  assert.doesNotMatch(directOnlyOption.xAxis.axisLabel.formatter('1月', 0), /加盟/);

  const directOnlyStatusOption = module.buildStatusChartOption(buildContext(directOnlyPayload, { contextMode: 'year' }));
  assert.deepEqual(
    directOnlyStatusOption.series.map((item) => item.name),
    ['直营']
  );
  assert.equal(directOnlyStatusOption.legend.show, false);

  const directOnlyStrip = module.renderEntryStatusStrip(buildContext(directOnlyPayload, { contextMode: 'year' }));
  assert.match(directOnlyStrip, /店态/);
  assert.match(directOnlyStrip, /新店/);
  assert.match(directOnlyStrip, /老店/);
  assert.doesNotMatch(directOnlyStrip, /模式/);
  assert.doesNotMatch(directOnlyStrip, /直营/);

  const mixedPayload = {
    year: 2026,
    months: [
      {
        month: 1,
        label: '1月',
        total: 15,
        newStore: { total: 15, direct: 13, franchise: 2 },
        oldStore: { total: 0, direct: 0, franchise: 0 },
        quadrants: {
          directNew: { total: 13 },
          directOld: { total: 0 },
          franchiseNew: { total: 2 },
          franchiseOld: { total: 0 },
        },
        storeStatuses: [{ key: '常规店', label: '常规店', total: 15, direct: 13, franchise: 2 }],
        provinces: [{ key: '浙江省', label: '浙江省', total: 15, newStore: 15, oldStore: 0 }],
        projects: [
          { id: 'direct-jan', month: 1, quadrantKey: 'directNew', storeStatus: '常规店', province: '浙江省' },
          { id: 'franchise-jan', month: 1, quadrantKey: 'franchiseNew', storeStatus: '常规店', province: '浙江省' },
        ],
      },
    ],
  };
  const mixedOption = module.buildMainChartOption(mixedPayload, {
    contextMode: 'year',
    chartViewport: { startMonth: 1, endMonth: 12, startLabel: '1月', endLabel: '12月' },
    modal: { open: false, month: 0 },
  });

  assert.deepEqual(
    mixedOption.legend.data.map((item) => item.name),
    ['直营新店', '直营老店', '加盟新店', '加盟老店', '新店趋势', '老店趋势']
  );
  assert.equal(mixedOption.series.some((item) => item.name === '加盟新店'), true);
  assert.match(mixedOption.xAxis.axisLabel.formatter('1月', 0), /加盟 2/);

  const mixedStatusOption = module.buildStatusChartOption(buildContext(mixedPayload, { contextMode: 'year' }));
  assert.deepEqual(
    mixedStatusOption.series.map((item) => item.name),
    ['直营', '加盟']
  );
  assert.equal(mixedStatusOption.legend.show, true);

  const mixedStrip = module.renderEntryStatusStrip(buildContext(mixedPayload, { contextMode: 'year' }));
  assert.match(mixedStrip, /模式/);
  assert.match(mixedStrip, /直营/);
  assert.match(mixedStrip, /加盟/);
});

test('main chart can hide store-age trend point numbers and add side legend labels', async () => {
  const module = await import('../public/dashboard/annual-entry-structure.mjs');
  const payload = {
    year: 2026,
    months: [
      aggregateMonth(1, { total: 12, statusLabel: '常规店', provinceLabel: '浙江省', projectId: 'new-jan' }),
      aggregateMonth(2, {
        total: 5,
        statusLabel: '常规店',
        provinceLabel: '浙江省',
        projectId: 'old-feb',
        storeAge: 'oldStore',
      }),
    ],
  };
  const baseState = {
    contextMode: 'year',
    chartViewport: { startMonth: 1, endMonth: 12, startLabel: '1月', endLabel: '12月' },
    modal: { open: false, month: 0 },
  };

  const defaultOption = module.buildMainChartOption(payload, baseState);
  const defaultTrendSeries = defaultOption.series.filter((item) => item.type === 'line');
  assert.deepEqual(defaultTrendSeries.map((item) => item.label?.show), [true, true]);
  assert.equal(defaultTrendSeries.some((item) => item.markPoint), false);

  const teamOption = module.buildMainChartOption(payload, {
    ...baseState,
    showStoreAgeTrendPointLabels: false,
    showStoreAgeTrendSideLegend: true,
  });
  const teamTrendSeries = teamOption.series.filter((item) => item.type === 'line');

  assert.deepEqual(teamTrendSeries.map((item) => item.label?.show), [false, false]);
  assert.equal(teamTrendSeries.some((item) => item.data.some((point) => point.showLabel)), false);
  assert.deepEqual(
    teamTrendSeries.map((item) => item.markPoint?.data?.[0]?.label?.formatter),
    ['新店', '老店']
  );
  assert.deepEqual(
    teamTrendSeries.map((item) => item.markPoint?.data?.[0]?.label?.color),
    ['#C7433E', '#7B5AA6']
  );
  assert.deepEqual(
    teamTrendSeries.map((item) => item.markPoint?.data?.[0]?.coord?.[0]),
    ['1月', '1月']
  );
});

test('clicked month opens modal while keeping the year context unchanged', () => {
  const payload = {
    year: 2026,
    months: [
      aggregateMonth(1, { total: 10, statusLabel: '常规店', provinceLabel: '浙江省', projectId: 'm1' }),
      aggregateMonth(2, { total: 20, statusLabel: '下沉店', provinceLabel: '江苏省', projectId: 'm2' }),
      aggregateMonth(3, { total: 30, statusLabel: '高标店', provinceLabel: '安徽省', projectId: 'm3' }),
    ],
  };
  const state = {
    contextMode: 'year',
    selectedMonth: 0,
    selectedQuarter: 'all',
    chartViewport: { startMonth: 1, endMonth: 12, startLabel: '1月', endLabel: '12月' },
    modal: { open: false, filter: 'all', storeStatus: '', month: 0 },
  };

  focusEntryStructureMonth(state, 2);
  const context = buildContext(payload, state);
  const modalContext = getProjectModalContext(payload, state, context);

  assert.equal(state.contextMode, 'year');
  assert.equal(state.selectedMonth, 0);
  assert.equal(state.selectedQuarter, 'all');
  assert.deepEqual(state.chartViewport, { startMonth: 1, endMonth: 12, startLabel: '1月', endLabel: '12月' });
  assert.deepEqual(state.modal, { open: true, filter: 'all', storeStatus: '', month: 2 });
  assert.equal(context.label, '2026年全年');
  assert.equal(context.total, 60);
  assert.deepEqual(
    context.projects.map((project) => project.id),
    ['m1', 'm2', 'm3']
  );
  assert.equal(modalContext.label, '2026年 2月');
  assert.deepEqual(
    modalContext.projects.map((project) => project.id),
    ['m2']
  );
});

test('data zoom range updates context state without selecting a month or opening modal', () => {
  const state = {
    contextMode: 'quarter',
    selectedMonth: 0,
    selectedQuarter: 'q2',
    chartViewport: { startMonth: 4, endMonth: 6, startLabel: '4月', endLabel: '6月' },
    modal: { open: true, filter: 'directNew', storeStatus: '常规店', month: 5 },
    error: '旧错误',
  };

  const changed = applyChartViewportContext(state, { startMonth: 2, endMonth: 4, startLabel: '2月', endLabel: '4月' });

  assert.equal(changed, true);
  assert.equal(state.contextMode, 'range');
  assert.equal(state.selectedMonth, 0);
  assert.equal(state.selectedQuarter, 'all');
  assert.deepEqual(state.chartViewport, { startMonth: 2, endMonth: 4, startLabel: '2月', endLabel: '4月' });
  assert.deepEqual(state.modal, { open: false, filter: 'all', storeStatus: '', month: 0 });
  assert.equal(state.error, '');
});

test('data zoom ignores unchanged viewport state', () => {
  const state = {
    contextMode: 'range',
    selectedMonth: 0,
    selectedQuarter: 'all',
    chartViewport: { startMonth: 2, endMonth: 4, startLabel: '2月', endLabel: '4月' },
    modal: { open: false, filter: 'all', storeStatus: '', month: 0 },
    error: '',
  };

  const changed = applyChartViewportContext(state, { startMonth: 2, endMonth: 4, startLabel: '2月', endLabel: '4月' });

  assert.equal(changed, false);
  assert.equal(state.contextMode, 'range');
  assert.deepEqual(state.chartViewport, { startMonth: 2, endMonth: 4, startLabel: '2月', endLabel: '4月' });
});

test('data zoom full-year viewport restores year context from a range state', () => {
  const state = {
    contextMode: 'range',
    selectedMonth: 0,
    selectedQuarter: 'all',
    chartViewport: { startMonth: 3, endMonth: 6, startLabel: '3月', endLabel: '6月' },
    modal: { open: true, filter: 'directNew', storeStatus: '常规店', month: 3 },
    error: '旧错误',
  };

  const changed = applyChartViewportContext(state, { startMonth: 1, endMonth: 12, startLabel: '1月', endLabel: '12月' });

  assert.equal(changed, true);
  assert.equal(state.contextMode, 'year');
  assert.equal(state.selectedMonth, 0);
  assert.equal(state.selectedQuarter, 'all');
  assert.deepEqual(state.chartViewport, { startMonth: 1, endMonth: 12, startLabel: '1月', endLabel: '12月' });
  assert.deepEqual(state.modal, { open: false, filter: 'all', storeStatus: '', month: 0 });
  assert.equal(state.error, '');
});

test('clicked month opens modal while preserving quarter context', () => {
  const payload = {
    year: 2026,
    months: [
      aggregateMonth(1, { total: 10, statusLabel: '常规店', provinceLabel: '浙江省', projectId: 'm1' }),
      aggregateMonth(2, { total: 20, statusLabel: '下沉店', provinceLabel: '江苏省', projectId: 'm2' }),
      aggregateMonth(6, { total: 60, statusLabel: '高标店', provinceLabel: '广东省', projectId: 'm6' }),
    ],
  };
  const state = {
    contextMode: 'quarter',
    selectedMonth: 0,
    selectedQuarter: 'q1',
    chartViewport: { startMonth: 1, endMonth: 3, startLabel: '1月', endLabel: '3月' },
    modal: { open: false, filter: 'all', storeStatus: '', month: 0 },
    error: '旧错误',
  };

  const changed = focusEntryStructureMonth(state, 2);
  const context = buildContext(payload, state);
  const modalContext = getProjectModalContext(payload, state, context);

  assert.equal(changed, true);
  assert.equal(state.contextMode, 'quarter');
  assert.equal(state.selectedMonth, 0);
  assert.equal(state.selectedQuarter, 'q1');
  assert.deepEqual(state.chartViewport, { startMonth: 1, endMonth: 3, startLabel: '1月', endLabel: '3月' });
  assert.deepEqual(state.modal, { open: true, filter: 'all', storeStatus: '', month: 2 });
  assert.equal(state.error, '');
  assert.equal(context.label, '2026年 Q1');
  assert.deepEqual(
    context.projects.map((project) => project.id),
    ['m1', 'm2']
  );
  assert.deepEqual(
    modalContext.projects.map((project) => project.id),
    ['m2']
  );
});

test('clicked month opens modal while preserving data zoom range context', () => {
  const payload = {
    year: 2026,
    months: [
      aggregateMonth(1, { total: 10, statusLabel: '常规店', provinceLabel: '浙江省', projectId: 'm1' }),
      aggregateMonth(4, { total: 40, statusLabel: '旗舰店', provinceLabel: '福建省', projectId: 'm4' }),
      aggregateMonth(6, { total: 60, statusLabel: '高标店', provinceLabel: '广东省', projectId: 'm6' }),
    ],
  };
  const state = {
    contextMode: 'range',
    selectedMonth: 0,
    selectedQuarter: 'all',
    chartViewport: { startMonth: 4, endMonth: 6, startLabel: '4月', endLabel: '6月' },
    modal: { open: false, filter: 'all', storeStatus: '', month: 0 },
    error: '旧错误',
  };

  const changed = focusEntryStructureMonth(state, 6);
  const context = buildContext(payload, state);
  const modalContext = getProjectModalContext(payload, state, context);

  assert.equal(changed, true);
  assert.equal(state.contextMode, 'range');
  assert.equal(state.selectedMonth, 0);
  assert.equal(state.selectedQuarter, 'all');
  assert.deepEqual(state.chartViewport, { startMonth: 4, endMonth: 6, startLabel: '4月', endLabel: '6月' });
  assert.deepEqual(state.modal, { open: true, filter: 'all', storeStatus: '', month: 6 });
  assert.equal(state.error, '');
  assert.equal(context.label, '2026年 4-6月');
  assert.deepEqual(
    context.projects.map((project) => project.id),
    ['m4', 'm6']
  );
  assert.deepEqual(
    modalContext.projects.map((project) => project.id),
    ['m6']
  );
});
