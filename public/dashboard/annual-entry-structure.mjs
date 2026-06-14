import { renderEmptyState } from './empty-state.mjs';
import { bindTooltipTriggers, escapeHtml } from './tooltip.mjs';
import { isClassifiableStoreStatus } from '../lib/constants.mjs';

const ECHARTS_ASSET_URL = '../assets/echarts/echarts.esm.min.mjs';
const DEFAULT_ECHARTS_IMPORT_TIMEOUT_MS = 8000;
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);
const QUARTERS = {
  q1: { label: 'Q1', range: [1, 3], caption: '1-3月' },
  q2: { label: 'Q2', range: [4, 6], caption: '4-6月' },
  q3: { label: 'Q3', range: [7, 9], caption: '7-9月' },
  q4: { label: 'Q4', range: [10, 12], caption: '10-12月' },
};
const QUADRANTS = [
  { key: 'directNew', label: '直营新店', shortLabel: '直营新', color: '#166534', tone: 'direct-new' },
  { key: 'directOld', label: '直营老店', shortLabel: '直营老', color: '#74A56E', tone: 'direct-old' },
  { key: 'franchiseNew', label: '加盟新店', shortLabel: '加盟新', color: '#2F6FA3', tone: 'franchise-new' },
  { key: 'franchiseOld', label: '加盟老店', shortLabel: '加盟老', color: '#8AAFD6', tone: 'franchise-old' },
];
const ENTRY_CHANNELS = [
  { key: 'direct', label: '直营' },
  { key: 'franchise', label: '加盟' },
];
const CHART_COLORS = {
  directNew: '#166534',
  directOld: '#74A56E',
  franchiseNew: '#2F6FA3',
  franchiseOld: '#8AAFD6',
  direct: '#1F7A45',
  franchise: '#3E78B2',
  newStore: '#166534',
  oldStore: '#8AAFD6',
  newStoreTrend: '#C7433E',
  oldStoreTrend: '#7B5AA6',
};
const CHART_FONT_FAMILY = '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei UI", "PingFang SC", sans-serif';

let echartsModulePromise = null;

function withImportTimeout(promise, timeoutMs) {
  const normalizedTimeoutMs = Number(timeoutMs);
  if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
    return promise;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ECharts import timed out after ${normalizedTimeoutMs}ms`));
    }, normalizedTimeoutMs);
    promise.then(
      (module) => {
        clearTimeout(timer);
        resolve(module);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function loadECharts(options = {}) {
  const importer = typeof options.importer === 'function' ? options.importer : () => import(ECHARTS_ASSET_URL);
  const timeoutMs = Object.hasOwn(options, 'timeoutMs') ? options.timeoutMs : DEFAULT_ECHARTS_IMPORT_TIMEOUT_MS;
  if (options.importer) {
    return withImportTimeout(importer(), timeoutMs);
  }
  if (!echartsModulePromise) {
    echartsModulePromise = importer();
  }
  return withImportTimeout(echartsModulePromise, timeoutMs);
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildYearOptions(currentYear, selectedYear) {
  const years = [];
  for (let year = currentYear + 1; year >= currentYear - 6; year -= 1) {
    years.push(year);
  }
  if (!years.includes(selectedYear)) {
    years.unshift(selectedYear);
    years.sort((a, b) => b - a);
  }
  return years;
}

function quarterForMonth(month) {
  if (month >= 1 && month <= 3) return 'q1';
  if (month >= 4 && month <= 6) return 'q2';
  if (month >= 7 && month <= 9) return 'q3';
  if (month >= 10 && month <= 12) return 'q4';
  return 'all';
}

function isMonthInQuarter(month, quarterKey) {
  const quarter = QUARTERS[quarterKey];
  if (!quarter) {
    return false;
  }
  return month >= quarter.range[0] && month <= quarter.range[1];
}

function rankingKey(item = {}) {
  return item.key || item.label || 'unknown';
}

function createRankingBucket(item = {}) {
  return {
    key: rankingKey(item),
    label: item.label || item.key || '未设置',
    total: 0,
    newStore: 0,
    oldStore: 0,
    direct: 0,
    franchise: 0,
  };
}

function addRankingItem(map, item = {}) {
  const key = rankingKey(item);
  if (!map.has(key)) {
    map.set(key, createRankingBucket(item));
  }
  const bucket = map.get(key);
  bucket.total += safeNumber(item.total);
  bucket.newStore += safeNumber(item.newStore);
  bucket.oldStore += safeNumber(item.oldStore);
  bucket.direct += safeNumber(item.direct);
  bucket.franchise += safeNumber(item.franchise);
}

function addStoreStatusRankingItem(map, item = {}) {
  if (!isClassifiableStoreStatus(item.label || item.key)) {
    return;
  }
  addRankingItem(map, item);
}

function finalizeRankingMap(map, limit = 0) {
  const items = Array.from(map.values()).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'zh-Hans-CN'));
  if (!limit || items.length <= limit) {
    return items;
  }
  const top = items.slice(0, limit);
  const rest = items.slice(limit);
  const other = createRankingBucket({ key: '其他', label: '其他' });
  rest.forEach((item) => {
    other.total += item.total;
    other.newStore += item.newStore;
    other.oldStore += item.oldStore;
    other.direct += item.direct;
    other.franchise += item.franchise;
  });
  return other.total ? [...top, other] : top;
}

function sortEntryProjects(projects = []) {
  return [...projects].sort((a, b) => {
    const monthCompare = safeNumber(a.month) - safeNumber(b.month);
    if (monthCompare) {
      return monthCompare;
    }
    const dateCompare = String(a.startDate || '').localeCompare(String(b.startDate || ''));
    if (dateCompare) {
      return dateCompare;
    }
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
  });
}

function createAggregateContext(payload, label, caption, months = []) {
  const storeStatusMap = new Map();
  const provinceMap = new Map();
  const quadrantMaps = Object.fromEntries(
    QUADRANTS.map((item) => [
      item.key,
      {
        total: 0,
        storeStatuses: new Map(),
        provinces: new Map(),
      },
    ])
  );
  const aggregate = {
    label,
    caption,
    total: 0,
    newStore: { total: 0, direct: 0, franchise: 0 },
    oldStore: { total: 0, direct: 0, franchise: 0 },
    direct: 0,
    franchise: 0,
    months,
    monthsWithData: 0,
    quadrants: {},
    storeStatuses: [],
    provinces: [],
    projects: [],
  };

  months.forEach((month) => {
    aggregate.total += safeNumber(month.total);
    aggregate.newStore.total += safeNumber(month.newStore?.total);
    aggregate.newStore.direct += safeNumber(month.newStore?.direct);
    aggregate.newStore.franchise += safeNumber(month.newStore?.franchise);
    aggregate.oldStore.total += safeNumber(month.oldStore?.total);
    aggregate.oldStore.direct += safeNumber(month.oldStore?.direct);
    aggregate.oldStore.franchise += safeNumber(month.oldStore?.franchise);
    aggregate.direct += safeNumber(month.newStore?.direct) + safeNumber(month.oldStore?.direct);
    aggregate.franchise += safeNumber(month.newStore?.franchise) + safeNumber(month.oldStore?.franchise);
    if (safeNumber(month.total) > 0) {
      aggregate.monthsWithData += 1;
    }
    (month.storeStatuses || []).forEach((item) => addStoreStatusRankingItem(storeStatusMap, item));
    (month.provinces || []).forEach((item) => addRankingItem(provinceMap, item));
    QUADRANTS.forEach((quadrantConfig) => {
      const quadrant = month.quadrants?.[quadrantConfig.key] || {};
      const target = quadrantMaps[quadrantConfig.key];
      target.total += safeNumber(quadrant.total);
      (quadrant.storeStatuses || []).forEach((item) => addStoreStatusRankingItem(target.storeStatuses, item));
      (quadrant.provinces || []).forEach((item) => addRankingItem(target.provinces, item));
    });
  });

  QUADRANTS.forEach((quadrantConfig) => {
    const source = quadrantMaps[quadrantConfig.key];
    aggregate.quadrants[quadrantConfig.key] = {
      total: source.total,
      storeStatuses: finalizeRankingMap(source.storeStatuses),
      provinces: finalizeRankingMap(source.provinces, 4),
    };
  });
  aggregate.storeStatuses = finalizeRankingMap(storeStatusMap);
  aggregate.provinces = finalizeRankingMap(provinceMap);
  aggregate.projects = sortEntryProjects(months.flatMap((month) => month.projects || []));
  aggregate.averagePerMonth = months.length ? Math.round((aggregate.total / months.length) * 10) / 10 : 0;
  aggregate.peakMonth = months.reduce((peak, month) => {
    if (!peak || safeNumber(month.total) > safeNumber(peak.total)) {
      return month;
    }
    return peak;
  }, null);

  if (!aggregate.peakMonth && payload?.months?.length) {
    aggregate.peakMonth = payload.months.reduce((peak, month) => {
      if (!peak || safeNumber(month.total) > safeNumber(peak.total)) {
        return month;
      }
      return peak;
    }, null);
  }

  return aggregate;
}

function quadrantChannelKey(quadrantKey = '') {
  if (String(quadrantKey).startsWith('direct')) {
    return 'direct';
  }
  if (String(quadrantKey).startsWith('franchise')) {
    return 'franchise';
  }
  return '';
}

function hasEntryChannel(source = {}, channelKey) {
  if (!source || !channelKey) {
    return false;
  }
  const quadrantKeys =
    channelKey === 'direct' ? ['directNew', 'directOld'] : channelKey === 'franchise' ? ['franchiseNew', 'franchiseOld'] : [];
  if (
    safeNumber(source[channelKey]) > 0 ||
    safeNumber(source.totals?.[channelKey]) > 0 ||
    safeNumber(source.newStore?.[channelKey]) > 0 ||
    safeNumber(source.oldStore?.[channelKey]) > 0 ||
    quadrantKeys.some((key) => safeNumber(source.quadrants?.[key]?.total) > 0)
  ) {
    return true;
  }
  if ((source.projects || []).some((project) => projectScopeKey(project) === channelKey)) {
    return true;
  }
  if ((source.storeStatuses || []).some((item) => safeNumber(item[channelKey]) > 0)) {
    return true;
  }
  if ((source.provinces || []).some((item) => safeNumber(item[channelKey]) > 0)) {
    return true;
  }
  return (source.months || []).some((month) => hasEntryChannel(month, channelKey));
}

function visibleEntryChannels(source = {}) {
  return ENTRY_CHANNELS.filter((channel) => hasEntryChannel(source, channel.key));
}

function formatEntryChannelSummary(channelTotals, channels) {
  return channels.map((channel) => `${channel.label} ${safeNumber(channelTotals[channel.key])}`).join(' / ');
}

function normalizedViewportRange(viewport = {}) {
  const startFromLabel = monthNumberFromAxisValue(viewport.startLabel);
  const endFromLabel = monthNumberFromAxisValue(viewport.endLabel);
  const startMonth = safeNumber(viewport.startMonth, startFromLabel);
  const endMonth = safeNumber(viewport.endMonth, endFromLabel);
  if (!startMonth || !endMonth) {
    return null;
  }
  const start = Math.max(1, Math.min(12, Math.round(Math.min(startMonth, endMonth))));
  const end = Math.max(1, Math.min(12, Math.round(Math.max(startMonth, endMonth))));
  return {
    startMonth: start,
    endMonth: end,
    startLabel: monthAxisLabel(start),
    endLabel: monthAxisLabel(end),
  };
}

function closedProjectModalState() {
  return { open: false, filter: 'all', storeStatus: '', month: 0 };
}

export function focusEntryStructureMonth(state, month) {
  const normalizedMonth = Math.min(12, Math.max(1, Math.round(safeNumber(month, 0))));
  if (!state || !normalizedMonth) {
    return false;
  }
  state.modal = { open: true, filter: 'all', storeStatus: '', month: normalizedMonth };
  state.error = '';
  return true;
}

export function applyChartViewportContext(state, viewport) {
  const nextViewport = normalizedViewportRange(viewport);
  if (!state || !nextViewport) {
    return false;
  }
  const fullYearViewport = isFullYearViewport(nextViewport);
  if (sameViewport(nextViewport, state.chartViewport) && (!fullYearViewport || state.contextMode === 'year')) {
    return false;
  }
  state.contextMode = fullYearViewport ? 'year' : 'range';
  state.selectedMonth = 0;
  state.selectedQuarter = 'all';
  state.chartViewport = nextViewport;
  state.modal = closedProjectModalState();
  state.error = '';
  return true;
}

function isFullYearViewport(viewport = {}) {
  const range = normalizedViewportRange(viewport);
  return Boolean(range && range.startMonth === 1 && range.endMonth === 12);
}

function monthRangeLabel(year, range) {
  if (!range) {
    return `${year}年全年`;
  }
  if (range.startMonth === range.endMonth) {
    return `${year}年 ${range.startMonth}月`;
  }
  return `${year}年 ${range.startMonth}-${range.endMonth}月`;
}

export function buildContext(payload, state) {
  const months = payload?.months || [];
  if (state.contextMode === 'range') {
    const range = normalizedViewportRange(state.chartViewport);
    if (range) {
      return createAggregateContext(
        payload,
        monthRangeLabel(payload.year, range),
        '滚动条口径',
        months.filter((month) => month.month >= range.startMonth && month.month <= range.endMonth)
      );
    }
  }
  if (state.contextMode === 'quarter' && QUARTERS[state.selectedQuarter]) {
    const quarter = QUARTERS[state.selectedQuarter];
    return createAggregateContext(
      payload,
      `${payload.year}年 ${quarter.label}`,
      `${quarter.caption}运营口径`,
      months.filter((month) => isMonthInQuarter(month.month, state.selectedQuarter))
    );
  }
  return createAggregateContext(payload, `${payload.year}年全年`, '1-12月全量口径', months);
}

export function getProjectModalContext(payload, state, context) {
  const modalMonth = safeNumber(state?.modal?.month);
  if (!state?.modal?.open || !modalMonth) {
    return context;
  }
  const month = (payload?.months || []).find((item) => item.month === modalMonth);
  if (!month) {
    return context;
  }
  return createAggregateContext(payload, `${payload.year}年 ${modalMonth}月`, '点击月份', [month]);
}

function renderEntryStatusStrip(context) {
  const modeItems = visibleEntryChannels(context).map((channel) => ({
    label: channel.label,
    value: safeNumber(context[channel.key]),
  }));
  const structureGroups = [
    {
      label: '店态',
      items: [
        { label: '新店', value: context.newStore.total },
        { label: '老店', value: context.oldStore.total },
      ],
    },
    ...(modeItems.length > 1 ? [{ label: '模式', items: modeItems }] : []),
  ];
  return `
    <section class="entry-structure-status-strip" data-entry-status-strip aria-label="当前口径进店结构">
      <strong class="entry-structure-primary-metric">
        <span>${escapeHtml(context.label)}</span>
        <b>${context.total}</b><em>项</em>
      </strong>
      <div class="entry-structure-status-groups">
        ${structureGroups
          .map(
            (group) => `
              <div class="entry-structure-status-group">
                <span class="entry-structure-status-group-label">${escapeHtml(group.label)}</span>
                <span class="entry-structure-status-pills">
                  ${group.items
                    .map(
                      (item) => `
                        <span class="entry-structure-status-pill">
                          <span class="entry-structure-status-pill-label">${escapeHtml(item.label)}</span>
                          <b>${item.value}</b>
                        </span>
                      `,
                    )
                    .join('')}
                </span>
              </div>
            `,
          )
          .join('')}
      </div>
    </section>
  `;
}

function scopeTotal(payload, key) {
  if (key === 'all') {
    return safeNumber(payload?.totals?.entry);
  }
  const quarter = QUARTERS[key];
  if (!quarter) {
    return 0;
  }
  return (payload?.months || [])
    .filter((month) => isMonthInQuarter(month.month, key))
    .reduce((sum, month) => sum + safeNumber(month.total), 0);
}

function renderScopeSwitch(payload, state) {
  const options = [
    { key: 'all', label: '全年', caption: '1-12月' },
    ...Object.entries(QUARTERS).map(([key, item]) => ({ key, ...item })),
  ];
  return `
    <div class="entry-structure-scope-switch" role="group" aria-label="口径切换">
      ${options
        .map((item) => {
          const total = scopeTotal(payload, item.key);
          const active =
            (item.key === 'all' && state.contextMode === 'year') ||
            (item.key !== 'all' && state.contextMode === 'quarter' && state.selectedQuarter === item.key);
          const empty = !total;
          const classNames = [
            item.key === 'all' ? 'is-all' : '',
            active ? 'is-active' : '',
            empty ? 'is-empty' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return `
            <button
              type="button"
              class="${classNames}"
              data-entry-range="${escapeHtml(item.key)}"
              aria-pressed="${active ? 'true' : 'false'}"
            >
              <span class="entry-structure-scope-label">${escapeHtml(item.label)}</span>
              <strong>${total ? `${total}项` : '—'}</strong>
              <small>${escapeHtml(item.caption)}</small>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderYearPicker(yearOptions, selectedYear) {
  return `
    <label class="entry-structure-year-field">
      <span>年份</span>
      <select
        class="entry-structure-year-native"
        id="entry-structure-year-select"
        name="entry-structure-year"
        data-entry-year
        aria-label="选择年份"
        tabindex="-1"
      >
        ${yearOptions
          .map((year) => `<option value="${year}"${year === selectedYear ? ' selected' : ''}>${year}年</option>`)
          .join('')}
      </select>
      <div class="entry-structure-year-picker" data-entry-year-picker>
        <button
          type="button"
          class="entry-structure-year-button"
          data-entry-year-button
          aria-haspopup="listbox"
          aria-expanded="false"
        >
          <span>${selectedYear}年</span>
          <i aria-hidden="true"></i>
        </button>
        <div class="entry-structure-year-menu" role="listbox" aria-label="选择年份">
          ${yearOptions
            .map(
              (year) => `
                <button
                  type="button"
                  class="entry-structure-year-option${year === selectedYear ? ' is-active' : ''}"
                  data-entry-year-option="${year}"
                  role="option"
                  aria-selected="${year === selectedYear ? 'true' : 'false'}"
                >
                  <span>${year}年</span>
                </button>
              `,
            )
            .join('')}
        </div>
      </div>
    </label>
  `;
}

function cleanupYearPickerOutsideHandler(state) {
  if (!state?.yearPickerOutsideHandler || typeof document === 'undefined') {
    return;
  }
  document.removeEventListener?.('click', state.yearPickerOutsideHandler);
  state.yearPickerOutsideHandler = null;
}

function renderChartFallback(message = '图表加载中') {
  return `<div class="entry-structure-chart-fallback">${escapeHtml(message)}</div>`;
}

export function monthFromMainChartClickParams(params, payload) {
  if (params?.componentType === 'xAxis') {
    return monthNumberFromAxisValue(params.value);
  }
  if (params?.componentType !== 'series') {
    return 0;
  }
  const monthFromData = safeNumber(params?.data?.month, 0);
  if (monthFromData >= 1 && monthFromData <= 12) {
    return Math.round(monthFromData);
  }
  const monthFromName = monthNumberFromAxisValue(params?.name);
  if (monthFromName) {
    return monthFromName;
  }
  const dataIndex = Math.round(safeNumber(params?.dataIndex, -1));
  if (dataIndex >= 0) {
    return safeNumber(payload?.months?.[dataIndex]?.month, 0);
  }
  return 0;
}

export function mainChartPointerPointFromEvent(event) {
  const x = safeNumber(event?.offsetX, safeNumber(event?.zrX, safeNumber(event?.event?.offsetX, NaN)));
  const y = safeNumber(event?.offsetY, safeNumber(event?.zrY, safeNumber(event?.event?.offsetY, NaN)));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return [x, y];
}

function renderRankingShell(context) {
  return `
    <div class="entry-structure-ranking-grid">
      <section class="entry-structure-chart-panel">
        <header class="entry-structure-subheader is-ranking">
          <div class="entry-structure-subheader-copy">
            <h3>店态分布</h3>
            ${renderRankingContextMeta(context)}
          </div>
        </header>
        <div class="entry-structure-chart-host is-ranking" data-entry-status-chart role="img" aria-label="店态分布图">
          ${renderChartFallback()}
        </div>
      </section>

      <section class="entry-structure-chart-panel">
        <header class="entry-structure-subheader is-ranking">
          <div class="entry-structure-subheader-copy">
            <h3>省份贡献</h3>
            ${renderRankingContextMeta(context)}
          </div>
        </header>
        <div class="entry-structure-chart-host is-ranking" data-entry-province-chart role="img" aria-label="省份排行图">
          ${renderChartFallback()}
        </div>
      </section>
    </div>
  `;
}

function renderRankingContextMeta(context = {}) {
  const label = context.label || '当前口径';
  const caption = context.caption || '实时汇总';
  const items = [
    '<span>按当前口径汇总</span>',
    `<strong>${escapeHtml(label)}</strong>`,
    `<em>${escapeHtml(caption)}</em>`,
  ];
  return `
    <div class="entry-structure-context-meta" data-entry-context-meta title="${escapeHtml(`${label} | ${caption}`)}">
      ${items
        .map(
          (item, index) => `
            ${index ? '<span class="entry-structure-context-divider" aria-hidden="true"></span>' : ''}
            ${item}
          `,
        )
        .join('')}
    </div>
  `;
}

function getQuadrantConfig(key) {
  return QUADRANTS.find((item) => item.key === key) || null;
}

function normalizeModalFilter(filter = 'all') {
  if (filter && typeof filter === 'object') {
    return {
      activeFilter: filter.filter || 'all',
      activeStoreStatus: String(filter.storeStatus || '').trim(),
      activeProvince: String(filter.province || '').trim(),
      activeStoreAge: String(filter.storeAge || '').trim(),
    };
  }
  return {
    activeFilter: filter || 'all',
    activeStoreStatus: '',
    activeProvince: '',
    activeStoreAge: '',
  };
}

function storeStatusMatches(project, storeStatus) {
  return !storeStatus || String(project.storeStatus || '').trim() === storeStatus;
}

function provinceMatches(project, province) {
  return !province || String(project.province || '').trim() === province;
}

function storeAgeMatches(project, storeAge) {
  return !storeAge || String(project.storeAge || '').trim() === storeAge;
}

function storeAgeFilterLabel(storeAge) {
  if (storeAge === 'newStore') {
    return '新店';
  }
  if (storeAge === 'oldStore') {
    return '老店';
  }
  return '';
}

function getDrawerProjects(context, filter = 'all') {
  const { activeFilter, activeStoreStatus, activeProvince, activeStoreAge } = normalizeModalFilter(filter);
  const projects = (context.projects || []).filter(
    (project) =>
      storeStatusMatches(project, activeStoreStatus) &&
      provinceMatches(project, activeProvince) &&
      storeAgeMatches(project, activeStoreAge)
  );
  if (!activeFilter || activeFilter === 'all') {
    return projects;
  }
  return projects.filter((project) => project.quadrantKey === activeFilter);
}

export function getProjectModalView(context, filter = 'all') {
  const { activeFilter, activeStoreStatus, activeProvince, activeStoreAge } = normalizeModalFilter(filter);
  const projects = getDrawerProjects(context, {
    filter: activeFilter,
    storeStatus: activeStoreStatus,
    province: activeProvince,
    storeAge: activeStoreAge,
  });
  const quadrantLabel = activeFilter === 'all' ? '' : getQuadrantConfig(activeFilter)?.label || '';
  const filterLabel = [
    activeStoreStatus ? `店态：${activeStoreStatus}` : '',
    activeProvince ? `省份：${activeProvince}` : '',
    storeAgeFilterLabel(activeStoreAge),
    quadrantLabel,
  ]
    .filter(Boolean)
    .join(' · ') || '全部项目';
  return {
    activeFilter,
    activeStoreStatus,
    activeProvince,
    activeStoreAge,
    projects,
    filterLabel,
  };
}

function renderModalFilters(context, activeFilter, activeStoreStatus = '', activeProvince = '', activeStoreAge = '') {
  const projects = (context.projects || []).filter(
    (project) =>
      storeStatusMatches(project, activeStoreStatus) &&
      provinceMatches(project, activeProvince) &&
      storeAgeMatches(project, activeStoreAge)
  );
  const visibleChannelKeys = new Set(visibleEntryChannels({ projects }).map((channel) => channel.key));
  const filters = [
    {
      key: 'all',
      label: activeStoreStatus || activeProvince || activeStoreAge ? '该筛选全部' : '全部项目',
      total: projects.length,
      tone: 'all',
    },
    ...QUADRANTS.filter((config) => visibleChannelKeys.has(quadrantChannelKey(config.key))).map((config) => ({
      key: config.key,
      label: config.label,
      total: projects.filter((project) => project.quadrantKey === config.key).length,
      tone: config.tone,
    })),
  ];
  return filters
    .map(
      (item) => `
        <button
          type="button"
          class="entry-structure-modal-filter is-${escapeHtml(item.tone)}${activeFilter === item.key ? ' is-active' : ''}"
          data-entry-modal-filter="${escapeHtml(item.key)}"
          aria-pressed="${activeFilter === item.key ? 'true' : 'false'}"
        >
          <span>${escapeHtml(item.label)}</span>
          <strong>${item.total}</strong>
        </button>
      `
    )
    .join('');
}

function projectScopeKey(project = {}) {
  if (project.scope === 'direct' || project.quadrantKey === 'directNew' || project.quadrantKey === 'directOld') {
    return 'direct';
  }
  if (project.scope === 'franchise' || project.quadrantKey === 'franchiseNew' || project.quadrantKey === 'franchiseOld') {
    return 'franchise';
  }
  return '';
}

function projectStoreAgeKey(project = {}) {
  if (project.storeAge === 'newStore' || project.quadrantKey === 'directNew' || project.quadrantKey === 'franchiseNew') {
    return 'newStore';
  }
  if (project.storeAge === 'oldStore' || project.quadrantKey === 'directOld' || project.quadrantKey === 'franchiseOld') {
    return 'oldStore';
  }
  return '';
}

function isFilledProjectValue(value) {
  const normalized = String(value || '').trim();
  return normalized && !normalized.includes('未设置') && !normalized.includes('待补录');
}

function renderProjectModalSummary(projects = []) {
  const direct = projects.filter((project) => projectScopeKey(project) === 'direct').length;
  const franchise = projects.filter((project) => projectScopeKey(project) === 'franchise').length;
  const newStore = projects.filter((project) => projectStoreAgeKey(project) === 'newStore').length;
  const oldStore = projects.filter((project) => projectStoreAgeKey(project) === 'oldStore').length;
  const provinceCount = new Set(projects.map((project) => project.province).filter(isFilledProjectValue)).size;
  const channelCounts = { direct, franchise };
  const channelSummary = visibleEntryChannels({ projects })
    .map((channel) => `${channel.label} ${channelCounts[channel.key]}`)
    .join(' · ');
  return [channelSummary, `新店 ${newStore} · 老店 ${oldStore}`, `覆盖省份 ${provinceCount}`].filter(Boolean).join('｜');
}

function renderProjectRows(projects = []) {
  if (!projects.length) {
    return `
      <div class="entry-structure-modal-empty">
        <strong>当前口径暂无项目</strong>
        <span>切换月份、季度或年度后再查看。</span>
      </div>
    `;
  }
  return projects
    .map(
      (project) => {
        const structureTone = getQuadrantConfig(project.quadrantKey)?.tone || 'all';
        return `
        <article class="entry-structure-project-row" data-entry-project-id="${escapeHtml(project.id || '')}">
          <div class="entry-structure-project-main">
            <strong title="${escapeHtml(project.name || '未命名项目')}">${escapeHtml(project.name || '未命名项目')}</strong>
          </div>
          <div class="entry-structure-project-date">
            <strong>${escapeHtml(project.startDate || '日期待补录')}</strong>
          </div>
          <div class="entry-structure-project-structure is-${escapeHtml(structureTone)}">
            <strong>${escapeHtml(project.quadrantLabel || '结构待补录')}</strong>
          </div>
          <div class="entry-structure-project-location">
            <strong>${escapeHtml(project.province || '省份待补录')}</strong>
            <span>${escapeHtml(project.storeStatus || '店态待补录')}</span>
          </div>
          <div class="entry-structure-project-owner">
            <strong>${escapeHtml(project.owner || '待分配')}</strong>
          </div>
        </article>
      `;
      }
    )
    .join('');
}

export function renderProjectModal(state, context) {
  const modal = state.modal || { open: false, filter: 'all', storeStatus: '', month: 0 };
  if (!modal.open) {
    return '';
  }
  const { activeFilter, activeStoreStatus, activeProvince, activeStoreAge, projects, filterLabel } = getProjectModalView(context, modal);
  return `
    <div class="entry-structure-modal-layer">
      <button type="button" class="entry-structure-modal-backdrop" data-entry-modal-close aria-label="关闭项目清单"></button>
      <section class="entry-structure-project-modal" role="dialog" aria-modal="true" aria-label="进店项目清单">
        <header class="entry-structure-modal-header">
          <div>
            <span data-entry-modal-caption>${escapeHtml(context.caption)} · ${escapeHtml(filterLabel)}</span>
            <h3 data-entry-modal-title>${escapeHtml(context.label)} · ${escapeHtml(filterLabel)} · ${projects.length}项</h3>
            <p data-entry-modal-summary>${escapeHtml(renderProjectModalSummary(projects))}</p>
          </div>
          <button type="button" class="entry-structure-modal-close" data-entry-modal-close aria-label="关闭项目清单">×</button>
        </header>
        <div class="entry-structure-modal-filters" data-entry-modal-filters role="group" aria-label="项目结构筛选">
          ${renderModalFilters(context, activeFilter, activeStoreStatus, activeProvince, activeStoreAge)}
        </div>
        <section class="entry-structure-modal-table" aria-label="进店项目明细">
          <div class="entry-structure-modal-table-head">
            <span>项目</span>
            <span>进店日期</span>
            <span>结构</span>
            <span>地区 / 店态</span>
            <span>负责人</span>
          </div>
          <div class="entry-structure-modal-rows" data-entry-modal-rows>
            ${renderProjectRows(projects)}
          </div>
        </section>
      </section>
    </div>
  `;
}

function closeProjectModal(container, state) {
  state.modal = { open: false, filter: 'all', storeStatus: '', month: 0 };
  container.querySelector('.entry-structure-modal-layer')?.remove?.();
}

function updateProjectModalContent(container, state, context, nextFilter) {
  const modalLayer = container.querySelector('.entry-structure-modal-layer');
  const captionNode = modalLayer?.querySelector('[data-entry-modal-caption]');
  const titleNode = modalLayer?.querySelector('[data-entry-modal-title]');
  const summaryNode = modalLayer?.querySelector('[data-entry-modal-summary]');
  const filtersNode = modalLayer?.querySelector('[data-entry-modal-filters]');
  const rowsNode = modalLayer?.querySelector('[data-entry-modal-rows]');
  if (!modalLayer || !captionNode || !titleNode || !summaryNode || !filtersNode || !rowsNode) {
    return false;
  }

  const nextModal = {
    ...(state.modal || {}),
    open: true,
    filter: nextFilter,
  };
  const { activeFilter, activeStoreStatus, activeProvince, activeStoreAge, projects, filterLabel } = getProjectModalView(context, nextModal);
  state.modal = {
    open: true,
    filter: activeFilter,
    storeStatus: activeStoreStatus,
    province: activeProvince,
    storeAge: activeStoreAge,
    month: safeNumber(nextModal.month),
  };
  captionNode.textContent = `${context.caption} · ${filterLabel}`;
  titleNode.textContent = `${context.label} · ${filterLabel} · ${projects.length}项`;
  summaryNode.textContent = renderProjectModalSummary(projects);
  filtersNode.innerHTML = renderModalFilters(context, activeFilter, activeStoreStatus, activeProvince, activeStoreAge);
  rowsNode.innerHTML = renderProjectRows(projects);
  rowsNode.scrollTop = 0;
  bindProjectModalFilterEvents(container, state, context);
  return true;
}

function bindProjectModalFilterEvents(container, state, context) {
  container.querySelectorAll('[data-entry-modal-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextFilter = button.getAttribute('data-entry-modal-filter') || 'all';
      updateProjectModalContent(container, state, context, nextFilter);
    });
  });
}

function shouldSkipChartRuntime() {
  return Boolean(globalThis.__PUBLIC_APP_TEST_HARNESS__) || typeof window === 'undefined' || typeof document === 'undefined';
}

function resolveECharts(module) {
  return module?.default?.init ? module.default : module;
}

function disposeCharts(state) {
  (state.chartInstances || []).forEach((chart) => {
    try {
      chart?.dispose?.();
    } catch {
      // ECharts owns canvas cleanup; ignore stale instances from fast repaint.
    }
  });
  state.chartInstances = [];
  state.contextChartInstances = [];
}

function disposeContextCharts(state) {
  const contextCharts = state.contextChartInstances || [];
  const disposed = new Set(contextCharts);
  contextCharts.forEach((chart) => {
    try {
      chart?.dispose?.();
    } catch {
      // ECharts owns canvas cleanup; ignore stale instances from fast repaint.
    }
  });
  state.contextChartInstances = [];
  state.chartInstances = (state.chartInstances || []).filter((chart) => !disposed.has(chart));
}

function registerChart(state, chart, group = 'main') {
  if (!chart) {
    return;
  }
  state.chartInstances = state.chartInstances || [];
  state.contextChartInstances = state.contextChartInstances || [];
  state.chartInstances.push(chart);
  if (group === 'context') {
    state.contextChartInstances.push(chart);
  }
}

function chartTextStyle(size = 13, weight = 700) {
  return {
    color: '#4D5A50',
    fontFamily: CHART_FONT_FAMILY,
    fontSize: size,
    fontWeight: weight,
  };
}

function monthNumberFromAxisValue(value) {
  const match = String(value || '').match(/\d+/);
  return match ? safeNumber(match[0], 0) : 0;
}

function monthAxisLabel(month) {
  const normalizedMonth = Math.min(12, Math.max(1, Math.round(safeNumber(month, 1))));
  return `${normalizedMonth}月`;
}

function mainChartViewportRange(state = {}) {
  if (state.contextMode === 'quarter' && QUARTERS[state.selectedQuarter]) {
    const [startMonth, endMonth] = QUARTERS[state.selectedQuarter].range;
    return {
      startMonth,
      endMonth,
      startLabel: monthAxisLabel(startMonth),
      endLabel: monthAxisLabel(endMonth),
    };
  }

  return {
    startMonth: 1,
    endMonth: 12,
    startLabel: '1月',
    endLabel: '12月',
  };
}

export function dataZoomMonthLabel(value, valueLabel) {
  const explicitMonth = String(valueLabel || '').includes('月') ? monthNumberFromAxisValue(valueLabel) : 0;
  if (explicitMonth) {
    return `${explicitMonth}月`;
  }

  const axisIndex = Number(value);
  if (Number.isFinite(axisIndex) && axisIndex >= 0 && axisIndex <= 11) {
    return `${axisIndex + 1}月`;
  }

  const monthFromValue = monthNumberFromAxisValue(value);
  if (monthFromValue >= 1 && monthFromValue <= 12) {
    return `${monthFromValue}月`;
  }

  return valueLabel || '';
}

function monthFromDataZoomBoundary(payload, value, percent, fallback) {
  const months = payload?.months || [];
  const number = Number(value);
  if (Number.isFinite(number)) {
    if (number >= 0 && number < months.length) {
      return safeNumber(months[Math.round(number)]?.month, Math.round(number) + 1);
    }
    if (number >= 1 && number <= 12) {
      return Math.round(number);
    }
  }

  const explicitMonth = monthNumberFromAxisValue(value);
  if (explicitMonth >= 1 && explicitMonth <= 12) {
    return explicitMonth;
  }

  const ratio = Number(percent);
  if (Number.isFinite(ratio) && months.length) {
    const index = Math.max(0, Math.min(months.length - 1, Math.round((ratio / 100) * (months.length - 1))));
    return safeNumber(months[index]?.month, index + 1);
  }

  return fallback;
}

export function chartViewportFromDataZoom(payload, params = {}, option = {}) {
  const eventZoom = params?.batch?.[0] || params || {};
  const optionZoom = Array.isArray(option?.dataZoom) ? option.dataZoom[0] || {} : {};
  const startValue = eventZoom.startValue ?? optionZoom.startValue;
  const endValue = eventZoom.endValue ?? optionZoom.endValue;
  const startPercent = eventZoom.start ?? optionZoom.start;
  const endPercent = eventZoom.end ?? optionZoom.end;
  const startMonth = monthFromDataZoomBoundary(payload, startValue, startPercent, 1);
  const endMonth = monthFromDataZoomBoundary(payload, endValue, endPercent, 12);
  return normalizedViewportRange({ startMonth, endMonth });
}

function sameViewport(left = {}, right = {}) {
  return safeNumber(left.startMonth) === safeNumber(right.startMonth) && safeNumber(left.endMonth) === safeNumber(right.endMonth);
}

function monthChannelTotals(month = {}) {
  return {
    direct: safeNumber(month.newStore?.direct) + safeNumber(month.oldStore?.direct),
    franchise: safeNumber(month.newStore?.franchise) + safeNumber(month.oldStore?.franchise),
  };
}

function monthStoreAgeTotals(month = {}) {
  const newDirect = safeNumber(month.newStore?.direct);
  const newFranchise = safeNumber(month.newStore?.franchise);
  const oldDirect = safeNumber(month.oldStore?.direct);
  const oldFranchise = safeNumber(month.oldStore?.franchise);
  return {
    newStore: {
      total: safeNumber(month.newStore?.total, newDirect + newFranchise),
      direct: newDirect,
      franchise: newFranchise,
    },
    oldStore: {
      total: safeNumber(month.oldStore?.total, oldDirect + oldFranchise),
      direct: oldDirect,
      franchise: oldFranchise,
    },
  };
}

function storeAgeLabelFromQuadrantKey(quadrantKey = '') {
  if (String(quadrantKey).endsWith('New')) {
    return '新店';
  }
  if (String(quadrantKey).endsWith('Old')) {
    return '老店';
  }
  return '';
}

function storeAgeTrendValue(month, key) {
  return safeNumber(monthStoreAgeTotals(month)[key]?.total);
}

function storeAgeTrendDelta(months, index, key) {
  if (index <= 0) {
    return null;
  }
  return storeAgeTrendValue(months[index], key) - storeAgeTrendValue(months[index - 1], key);
}

function formatTrendDelta(delta, prefix = '较上月') {
  if (!Number.isFinite(delta)) {
    return `${prefix} --`;
  }
  if (delta > 0) {
    return `${prefix} +${delta}`;
  }
  if (delta < 0) {
    return `${prefix} ${delta}`;
  }
  return `${prefix} 持平`;
}

function shouldShowStoreAgeTrendLabel(months, index, key, selectedMonth) {
  const month = months[index] || {};
  const value = storeAgeTrendValue(month, key);
  if (!value) {
    return false;
  }
  if (selectedMonth && month.month === selectedMonth) {
    return true;
  }
  const values = months.map((item) => storeAgeTrendValue(item, key)).filter((item) => item > 0);
  return value === Math.max(...values) || value === Math.min(...values);
}

function formatStoreAgeTrendTooltip(params = {}) {
  const data = params.data || {};
  const color = data.color || params.color || '#1F7A45';
  const visibleChannelKeys = Array.isArray(data.visibleChannelKeys)
    ? new Set(data.visibleChannelKeys)
    : new Set(ENTRY_CHANNELS.map((channel) => channel.key));
  const channelRows = [
    {
      key: 'direct',
      label: data.directLabel || '直营',
      value: data.direct,
    },
    {
      key: 'franchise',
      label: data.franchiseLabel || '加盟',
      value: data.franchise,
    },
  ]
    .filter((item) => visibleChannelKeys.has(item.key))
    .map(
      (item) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;color:rgba(51,51,51,0.68);">
          <span>${escapeHtml(item.label)}</span>
          <b style="color:#104020;font-size:14px;font-variant-numeric:tabular-nums;">${safeNumber(item.value)}项</b>
        </div>
      `
    )
    .join('');
  return `
    <div style="display:grid;gap:8px;min-width:208px;">
      <div style="display:grid;gap:2px;padding-bottom:7px;border-bottom:1px solid rgba(32,48,38,0.1);">
        <strong style="color:#1F2A22;font-size:15px;">${escapeHtml(data.year || '')}年 ${escapeHtml(data.month || '')}月 · ${escapeHtml(data.seriesLabel || params.seriesName || '')}</strong>
        <span style="color:rgba(51,51,51,0.58);font-size:12px;">${escapeHtml(data.deltaText || '')} · 总进店 ${safeNumber(data.monthTotal)}项</span>
      </div>
      <div style="display:grid;gap:5px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;">
          <span style="display:inline-flex;align-items:center;gap:7px;color:rgba(51,51,51,0.68);">
            <i style="width:8px;height:8px;border-radius:999px;border:2px solid ${color};background:#fff;display:inline-block;"></i>
            ${escapeHtml(data.seriesLabel || params.seriesName || '')}
          </span>
          <b style="color:#104020;font-size:14px;font-variant-numeric:tabular-nums;">${safeNumber(data.value)}项</b>
        </div>
        ${channelRows}
      </div>
    </div>
  `;
}

function buildMainChartOption(payload, state) {
  const months = payload.months || [];
  const selectedMonth = state.modal?.open ? safeNumber(state.modal.month) : 0;
  const selectedQuarter = state.contextMode === 'quarter' ? state.selectedQuarter : 'all';
  const viewport = state.chartViewport || mainChartViewportRange(state);
  const showStoreAgeTrendPointLabels = state.showStoreAgeTrendPointLabels !== false;
  const showStoreAgeTrendSideLegend = Boolean(state.showStoreAgeTrendSideLegend);
  const visibleChannels = visibleEntryChannels(payload);
  const singleChannelMode = visibleChannels.length === 1;
  const visibleChannelKeys = new Set(visibleChannels.map((channel) => channel.key));
  const seriesConfig = [
    { key: 'directNew', channelKey: 'direct', label: '直营新店', stack: 'direct', color: CHART_COLORS.directNew, radius: [0, 0, 3, 3] },
    { key: 'directOld', channelKey: 'direct', label: '直营老店', stack: 'direct', color: CHART_COLORS.directOld, radius: [3, 3, 0, 0] },
    {
      key: 'franchiseNew',
      channelKey: 'franchise',
      label: '加盟新店',
      stack: 'franchise',
      color: CHART_COLORS.franchiseNew,
      radius: [0, 0, 3, 3],
    },
    {
      key: 'franchiseOld',
      channelKey: 'franchise',
      label: '加盟老店',
      stack: 'franchise',
      color: CHART_COLORS.franchiseOld,
      radius: [3, 3, 0, 0],
    },
  ]
    .filter((item) => visibleChannelKeys.has(item.channelKey))
    .map((item) => ({
      ...item,
      label: singleChannelMode ? storeAgeLabelFromQuadrantKey(item.key) || item.label : item.label,
    }));
  const visibleChannelKeyList = visibleChannels.map((channel) => channel.key);
  const axisStoreAgeLine = (storeAgeKey, totals) => {
    const value = safeNumber(totals[storeAgeKey]?.total);
    const label = storeAgeKey === 'oldStore' ? '老店' : '新店';
    const style =
      storeAgeKey === 'oldStore'
        ? value
          ? 'entryAxisOldStore'
          : 'entryAxisOldStoreEmpty'
        : value
          ? 'entryAxisNewStore'
          : 'entryAxisNewStoreEmpty';
    return `{${style}|${label} ${value}}`;
  };
  const axisChannelLine = (channel, channelTotals) => {
    const value = safeNumber(channelTotals[channel.key]);
    const style =
      channel.key === 'franchise'
        ? value
          ? 'entryAxisFranchise'
          : 'entryAxisFranchiseEmpty'
        : value
          ? 'entryAxisDirect'
          : 'entryAxisDirectEmpty';
    return `{${style}|${channel.label} ${value}}`;
  };
  const tooltipChannelSummary = (total, month) => {
    if (singleChannelMode) {
      const storeAgeTotals = monthStoreAgeTotals(month);
      const summary = `新店 ${safeNumber(storeAgeTotals.newStore?.total)} / 老店 ${safeNumber(storeAgeTotals.oldStore?.total)}`;
      return `总进店 ${total}项 · ${summary}`;
    }
    const channelTotals = monthChannelTotals(month);
    const summary = formatEntryChannelSummary(channelTotals, visibleChannels);
    return summary ? `总进店 ${total}项 · ${summary}` : `总进店 ${total}项`;
  };
  const tooltipRows = (params = []) =>
    params
      .filter((item) => safeNumber(item.value) > 0)
      .map(
        (item) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;min-width:170px;">
            <span style="display:inline-flex;align-items:center;gap:7px;color:rgba(51,51,51,0.68);">
              <i style="width:8px;height:8px;border-radius:2px;background:${item.color};display:inline-block;"></i>
              ${item.seriesName}
            </span>
            <b style="color:#104020;font-size:14px;font-variant-numeric:tabular-nums;">${item.value}项</b>
          </div>
        `
      )
      .join('');
  const trendLegendIcon = 'path://M1 8 L9 8 A4 4 0 1 0 17 8 L23 8 L23 10 L17 10 A4 4 0 1 0 9 10 L1 10 Z';
  const trendSeriesConfig = [
    {
      key: 'newStore',
      label: '新店趋势',
      storeAgeLabel: '新店',
      directLabel: '直营新店',
      franchiseLabel: '加盟新店',
      color: CHART_COLORS.newStoreTrend,
      lineType: 'dashed',
      labelPosition: 'top',
    },
    {
      key: 'oldStore',
      label: '老店趋势',
      storeAgeLabel: '老店',
      directLabel: '直营老店',
      franchiseLabel: '加盟老店',
      color: CHART_COLORS.oldStoreTrend,
      lineType: 'dotted',
      labelPosition: 'bottom',
    },
  ];
  const sideLegendAnchorForStoreAgeTrend = (storeAgeKey) => {
    if (!showStoreAgeTrendSideLegend) {
      return null;
    }
    const viewportStartMonth = safeNumber(viewport.startMonth, 1);
    const viewportEndMonth = safeNumber(viewport.endMonth, 12);
    const viewportStartLabel = viewport.startLabel || monthAxisLabel(viewportStartMonth);
    const anchorMonth = months.find((month) => {
      const monthNumber = safeNumber(month.month);
      if (monthNumber < viewportStartMonth || monthNumber > viewportEndMonth) {
        return false;
      }
      return safeNumber(monthStoreAgeTotals(month)[storeAgeKey]?.total) > 0;
    });
    if (!anchorMonth) {
      return null;
    }
    return {
      coord: [viewportStartLabel, safeNumber(monthStoreAgeTotals(anchorMonth)[storeAgeKey]?.total)],
    };
  };
  const storeAgeSideLegendMarkPoint = (config) => {
    const anchor = sideLegendAnchorForStoreAgeTrend(config.key);
    if (!anchor) {
      return undefined;
    }
    const label = {
      show: true,
      formatter: config.storeAgeLabel,
      position: 'left',
      distance: 12,
      color: config.color,
      fontFamily: CHART_FONT_FAMILY,
      fontSize: 13,
      fontWeight: 900,
      align: 'right',
      backgroundColor: 'rgba(255, 255, 255, 0.72)',
      borderRadius: 4,
      padding: [2, 4],
    };
    return {
      silent: true,
      symbol: 'circle',
      symbolSize: 1,
      itemStyle: { opacity: 0 },
      emphasis: { disabled: true },
      label,
      data: [
        {
          name: config.storeAgeLabel,
          value: anchor.coord[1],
          coord: anchor.coord,
          label,
        },
      ],
      tooltip: { show: false },
    };
  };
  const entryColors = [...seriesConfig, ...trendSeriesConfig].map((item) => item.color);
  const legendItems = [
    ...seriesConfig.map((item) => ({ name: item.label, icon: 'roundRect' })),
    ...trendSeriesConfig.map((item) => ({ name: item.label, icon: trendLegendIcon })),
  ];
  const valueFor = (month, key) => safeNumber(month.quadrants?.[key]?.total);
  const selectedBorder = (month) =>
    month.month === selectedMonth
      ? {
          borderColor: '#1F2A22',
          borderWidth: 1.4,
        }
      : {};
  const markAreaData = [];
  if (state.contextMode === 'quarter' && QUARTERS[selectedQuarter]) {
    markAreaData.push([{ xAxis: `${QUARTERS[selectedQuarter].range[0]}月` }, { xAxis: `${QUARTERS[selectedQuarter].range[1]}月` }]);
  }
  if (selectedMonth) {
    markAreaData.push([{ xAxis: `${selectedMonth}月` }, { xAxis: `${selectedMonth}月` }]);
  }
  const markArea = markAreaData.length
    ? {
        silent: true,
        itemStyle: { color: 'rgba(31, 122, 69, 0.08)' },
        data: markAreaData,
      }
    : undefined;
  function renderMonthHitArea(params, api) {
    const coordSys = params.coordSys || {};
    const center = api.coord([api.value(0), 0]);
    const bandSize = api.size?.([1, 0]) || [];
    const width = Math.max(58, safeNumber(bandSize[0], 58));
    const x = safeNumber(center?.[0], safeNumber(coordSys.x)) - width / 2;
    return {
      type: 'rect',
      shape: {
        x,
        y: safeNumber(coordSys.y),
        width,
        height: safeNumber(coordSys.height),
      },
      style: { fill: 'rgba(31, 122, 69, 0.001)' },
    };
  }

  return {
    color: entryColors,
    animationDuration: 420,
    grid: { left: showStoreAgeTrendSideLegend ? 66 : 46, right: 22, top: 38, bottom: 128 },
    legend: {
      data: legendItems,
      right: 8,
      top: 2,
      itemWidth: 22,
      itemHeight: 12,
      itemGap: 18,
      textStyle: chartTextStyle(16, 600),
    },
    dataZoom: [
      {
        type: 'slider',
        xAxisIndex: 0,
        left: 82,
        right: 46,
        bottom: 16,
        height: 16,
        startValue: viewport.startLabel,
        endValue: viewport.endLabel,
        realtime: true,
        showDetail: true,
        brushSelect: false,
        borderColor: 'rgba(31, 122, 69, 0.18)',
        fillerColor: 'rgba(31, 122, 69, 0.12)',
        backgroundColor: 'rgba(244, 247, 242, 0.94)',
        dataBackground: {
          lineStyle: { color: 'rgba(31, 122, 69, 0.18)' },
          areaStyle: { color: 'rgba(31, 122, 69, 0.08)' },
        },
        selectedDataBackground: {
          lineStyle: { color: 'rgba(31, 122, 69, 0.38)' },
          areaStyle: { color: 'rgba(31, 122, 69, 0.16)' },
        },
        handleStyle: {
          color: '#FFFFFF',
          borderColor: 'rgba(31, 122, 69, 0.36)',
          borderWidth: 1,
        },
        moveHandleStyle: {
          color: 'rgba(31, 122, 69, 0.28)',
        },
        textStyle: chartTextStyle(12, 600),
        labelFormatter(value, valueLabel) {
          return dataZoomMonthLabel(value, valueLabel);
        },
      },
      {
        type: 'inside',
        xAxisIndex: 0,
        startValue: viewport.startLabel,
        endValue: viewport.endLabel,
        zoomOnMouseWheel: false,
        zoomLock: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: true,
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(16, 64, 32, 0.08)' } },
      confine: true,
      appendToBody: true,
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      borderColor: 'rgba(31, 122, 69, 0.26)',
      borderWidth: 1,
      padding: [12, 14],
      extraCssText: [
        'border-radius:8px',
        'box-shadow:0 14px 34px rgba(20, 28, 23, 0.18)',
        'backdrop-filter:blur(6px)',
        'line-height:1.45',
      ].join(';'),
      textStyle: {
        color: '#334238',
        fontFamily: CHART_FONT_FAMILY,
        fontSize: 13,
        fontWeight: 800,
      },
      formatter(params = []) {
        const first = params[0];
        const month = months[first?.dataIndex || 0] || {};
        const total = safeNumber(month.total);
        const rows = tooltipRows(params);
        return `
          <div style="display:grid;gap:8px;">
            <div style="display:grid;gap:2px;padding-bottom:7px;border-bottom:1px solid rgba(32,48,38,0.1);">
              <strong style="color:#1F2A22;font-size:15px;">${payload.year}年 ${month.month || ''}月</strong>
              <span style="color:rgba(51,51,51,0.58);font-size:12px;">${tooltipChannelSummary(total, month)}</span>
            </div>
            <div style="display:grid;gap:5px;">${rows || '<span style="color:rgba(51,51,51,0.5);">暂无进店</span>'}</div>
          </div>
        `;
      },
    },
    xAxis: {
      type: 'category',
      data: months.map((month) => month.label),
      triggerEvent: true,
      axisTick: { alignWithLabel: true, length: 0 },
      axisLine: { lineStyle: { color: '#D8DED7' } },
      axisLabel: {
        ...chartTextStyle(16, 600),
        interval: 0,
        margin: 10,
        formatter(value, index) {
          const month = months[index] || {};
          const monthNumber = safeNumber(month.month) || monthNumberFromAxisValue(value);
          const total = safeNumber(month.total);
          const channelTotals = monthChannelTotals(month);
          const monthStyle = monthNumber === selectedMonth ? 'entryAxisMonthActive' : total ? 'entryAxisMonth' : 'entryAxisMonthEmpty';
          if (!total) {
            return `{${monthStyle}|${value}}\n{entryAxisEmptyDash|—}`;
          }
          const channelLines = singleChannelMode
            ? ['newStore', 'oldStore'].map((storeAgeKey) => axisStoreAgeLine(storeAgeKey, monthStoreAgeTotals(month)))
            : visibleChannels.map((channel) => axisChannelLine(channel, channelTotals));
          return [`{${monthStyle}|${value}}`, ...channelLines].join('\n');
        },
        rich: {
          entryAxisMonth: {
            height: 30,
            width: 58,
            align: 'center',
            borderWidth: 1,
            borderColor: 'rgba(32, 48, 38, 0.16)',
            borderRadius: 8,
            backgroundColor: '#FFFFFF',
            color: '#4D5A50',
            fontSize: 14,
            fontWeight: 600,
          },
          entryAxisMonthActive: {
            height: 30,
            width: 58,
            align: 'center',
            borderWidth: 1,
            borderColor: 'rgba(31, 122, 69, 0.52)',
            borderRadius: 8,
            backgroundColor: '#EEF7EF',
            color: '#104020',
            fontSize: 14,
            fontWeight: 700,
          },
          entryAxisMonthEmpty: {
            height: 30,
            width: 58,
            align: 'center',
            borderWidth: 1,
            borderType: 'dashed',
            borderColor: 'rgba(32, 48, 38, 0.12)',
            borderRadius: 8,
            backgroundColor: '#FBFCFA',
            color: 'rgba(51, 51, 51, 0.42)',
            fontSize: 14,
            fontWeight: 600,
          },
          entryAxisDirect: {
            height: 22,
            width: 58,
            align: 'center',
            color: '#166534',
            fontSize: 14,
            fontWeight: 600,
          },
          entryAxisDirectEmpty: {
            height: 22,
            width: 58,
            align: 'center',
            color: 'rgba(22, 101, 52, 0.36)',
            fontSize: 14,
            fontWeight: 600,
          },
          entryAxisFranchise: {
            height: 22,
            width: 58,
            align: 'center',
            color: '#2F6FA3',
            fontSize: 14,
            fontWeight: 600,
          },
          entryAxisFranchiseEmpty: {
            height: 22,
            width: 58,
            align: 'center',
            color: 'rgba(47, 111, 163, 0.36)',
            fontSize: 14,
            fontWeight: 600,
          },
          entryAxisNewStore: {
            height: 22,
            width: 58,
            align: 'center',
            color: '#166534',
            fontSize: 14,
            fontWeight: 600,
          },
          entryAxisNewStoreEmpty: {
            height: 22,
            width: 58,
            align: 'center',
            color: 'rgba(22, 101, 52, 0.36)',
            fontSize: 14,
            fontWeight: 600,
          },
          entryAxisOldStore: {
            height: 22,
            width: 58,
            align: 'center',
            color: '#5F8F5B',
            fontSize: 14,
            fontWeight: 600,
          },
          entryAxisOldStoreEmpty: {
            height: 22,
            width: 58,
            align: 'center',
            color: 'rgba(95, 143, 91, 0.38)',
            fontSize: 14,
            fontWeight: 600,
          },
          entryAxisEmptyDash: {
            height: 20,
            width: 58,
            align: 'center',
            color: 'rgba(51, 51, 51, 0.34)',
            fontSize: 15,
            fontWeight: 600,
          },
        },
      },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: '#EEF1EC' } },
      axisLabel: chartTextStyle(14, 600),
    },
    series: [
      ...seriesConfig.map((config, index) => ({
        name: config.label,
        type: 'bar',
        stack: config.stack,
        barWidth: 22,
        barGap: '18%',
        barCategoryGap: '28%',
        emphasis: { focus: 'series', scale: 1.02 },
        label: { show: false },
        itemStyle: {
          borderRadius: config.radius,
        },
        markArea: index === 0 ? markArea : undefined,
        data: months.map((month) => ({
          value: valueFor(month, config.key),
          itemStyle: selectedBorder(month),
        })),
      })),
      ...trendSeriesConfig.map((config) => ({
        name: config.label,
        type: 'line',
        symbol: 'circle',
        showSymbol: true,
        symbolSize: 10,
        smooth: false,
        connectNulls: false,
        z: 8,
        lineStyle: {
          color: config.color,
          width: 2.4,
          type: config.lineType,
          dashOffset: 0,
          opacity: 0.72,
        },
        itemStyle: {
          color: '#FFFFFF',
          borderColor: config.color,
          borderWidth: 2.6,
        },
        emphasis: {
          focus: 'series',
          scale: 1.25,
          lineStyle: { width: 3, opacity: 0.92 },
          itemStyle: { borderWidth: 3.2 },
        },
        label: {
          show: showStoreAgeTrendPointLabels,
          position: config.labelPosition,
          distance: 8,
          color: config.color,
          fontFamily: CHART_FONT_FAMILY,
          fontSize: 13,
          fontWeight: 900,
          formatter(params) {
            return params.data?.showLabel ? `${safeNumber(params.value)}` : '';
          },
        },
        tooltip: {
          trigger: 'item',
          formatter: formatStoreAgeTrendTooltip,
        },
        markPoint: storeAgeSideLegendMarkPoint(config),
        data: months.map((month, index) => {
          const totals = monthStoreAgeTotals(month)[config.key] || {};
          const trendValue = safeNumber(totals.total);
          const delta = storeAgeTrendDelta(months, index, config.key);
          return {
            value: trendValue > 0 ? trendValue : null,
            year: payload.year,
            month: month.month,
            seriesLabel: config.label,
            directLabel: singleChannelMode ? config.storeAgeLabel : config.directLabel,
            franchiseLabel: singleChannelMode ? config.storeAgeLabel : config.franchiseLabel,
            direct: safeNumber(totals.direct),
            franchise: safeNumber(totals.franchise),
            visibleChannelKeys: visibleChannelKeyList,
            monthTotal: safeNumber(month.total),
            delta,
            deltaText: formatTrendDelta(delta, '较上月'),
            color: config.color,
            showLabel:
              showStoreAgeTrendPointLabels &&
              trendValue > 0 &&
              shouldShowStoreAgeTrendLabel(months, index, config.key, selectedMonth),
          };
        }),
      })),
      // The visible axisPointer shadow is only a hover affordance; this hidden layer owns plot-area month clicks.
      {
        name: '月份点击层',
        type: 'custom',
        coordinateSystem: 'cartesian2d',
        renderItem: renderMonthHitArea,
        encode: { x: 0, y: 1 },
        z: 30,
        silent: false,
        legendHoverLink: false,
        cursor: 'pointer',
        itemStyle: { opacity: 0 },
        emphasis: { disabled: true },
        tooltip: { show: false },
        data: months.map((month) => ({
          name: month.label,
          value: [month.label, 0],
          month: month.month,
        })),
      },
    ],
  };
}

function getStoreStatusRows(context) {
  return (context.storeStatuses || []).filter((item) => safeNumber(item.total) > 0 && isClassifiableStoreStatus(item.label || item.key));
}

function getProvinceRows(context) {
  return (context.provinces || []).filter((item) => safeNumber(item.total) > 0).slice(0, 14);
}

function buildStatusChartOption(context) {
  const rows = getStoreStatusRows(context);
  const statusSeriesConfig = visibleEntryChannels(context).map((channel) => ({
    key: channel.key,
    name: channel.label,
    color: CHART_COLORS[channel.key],
  }));
  return {
    color: statusSeriesConfig.map((item) => item.color),
    animationDuration: 360,
    grid: { left: 78, right: 22, top: 30, bottom: 24 },
    legend: {
      data: statusSeriesConfig.map((item) => item.name),
      show: statusSeriesConfig.length > 1,
      top: 0,
      right: 4,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: chartTextStyle(12),
    },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, appendToBody: true },
    xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#EEF1EC' } }, axisLabel: chartTextStyle(12) },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((item) => item.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...chartTextStyle(12), width: 70, overflow: 'truncate' },
    },
    series: statusSeriesConfig.map((config) => ({
      name: config.name,
      type: 'bar',
      stack: 'status',
      barWidth: 12,
      data: rows.map((item) => item[config.key]),
    })),
  };
}

function buildProvinceChartOption(context) {
  const rows = getProvinceRows(context);
  return {
    color: [CHART_COLORS.newStore, CHART_COLORS.oldStore],
    animationDuration: 360,
    grid: { left: 86, right: 28, top: 30, bottom: rows.length > 9 ? 44 : 24 },
    legend: { top: 0, right: 4, itemWidth: 10, itemHeight: 10, textStyle: chartTextStyle(12) },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true, appendToBody: true },
    dataZoom:
      rows.length > 9
        ? [
            {
              type: 'slider',
              yAxisIndex: 0,
              width: 10,
              right: 4,
              start: 0,
              end: Math.round((9 / rows.length) * 100),
              showDetail: false,
              brushSelect: false,
            },
          ]
        : [],
    xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#EEF1EC' } }, axisLabel: chartTextStyle(12) },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((item) => item.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...chartTextStyle(12), width: 78, overflow: 'truncate' },
    },
    series: [
      {
        name: '新店',
        type: 'bar',
        stack: 'province',
        barWidth: 12,
        data: rows.map((item) => item.newStore),
      },
      {
        name: '老店',
        type: 'bar',
        stack: 'province',
        barWidth: 12,
        data: rows.map((item) => item.oldStore),
      },
    ],
  };
}

function renderNoDataChart(host, title) {
  if (!host) {
    return;
  }
  host.innerHTML = renderEmptyState({
    title,
    description: '当前口径暂无可展示记录。',
    compact: true,
  });
}

function syncScopeSwitchState(container, state) {
  container.querySelectorAll('[data-entry-range]').forEach((button) => {
    const range = button.getAttribute('data-entry-range') || 'all';
    const active =
      (range === 'all' && state.contextMode === 'year') ||
      (range !== 'all' && state.contextMode === 'quarter' && state.selectedQuarter === range);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function renderContextCharts(echarts, container, state, context) {
  const statusHost = container.querySelector('[data-entry-status-chart]');
  const provinceHost = container.querySelector('[data-entry-province-chart]');
  if (statusHost) {
    if (!context.storeStatuses?.length) {
      renderNoDataChart(statusHost, '暂无店态分布');
    } else {
      const rows = getStoreStatusRows(context);
      const chart = echarts.init(statusHost);
      chart.setOption(buildStatusChartOption(context));
      chart.on('click', (params) => {
        const row = rows[params?.dataIndex];
        const storeStatus = String(row?.key || row?.label || '').trim();
        if (!storeStatus) {
          return;
        }
        state.modal = { open: true, filter: 'all', storeStatus, month: 0 };
        state.error = '';
        paintAnnualEntryStructure(container, state);
      });
      registerChart(state, chart, 'context');
    }
  }
  if (provinceHost) {
    if (!context.provinces?.length) {
      renderNoDataChart(provinceHost, '暂无省份排行');
    } else {
      const rows = getProvinceRows(context);
      const chart = echarts.init(provinceHost);
      chart.setOption(buildProvinceChartOption(context));
      chart.on('click', (params) => {
        const row = rows[params?.dataIndex];
        const province = String(row?.key || row?.label || '').trim();
        if (!province) {
          return;
        }
        state.modal = { open: true, filter: 'all', storeStatus: '', province, month: 0 };
        state.error = '';
        paintAnnualEntryStructure(container, state);
      });
      registerChart(state, chart, 'context');
    }
  }
}

function refreshEntryStructureContext(container, state, payload, echarts) {
  const context = buildContext(payload, state);
  const statusStrip = container.querySelector('[data-entry-status-strip]');
  const rankingGrid = container.querySelector('.entry-structure-ranking-grid');
  if (statusStrip) {
    statusStrip.outerHTML = renderEntryStatusStrip(context);
  }
  container.querySelector('.entry-structure-modal-layer')?.remove?.();
  if (rankingGrid) {
    disposeContextCharts(state);
    rankingGrid.outerHTML = renderRankingShell(context);
    renderContextCharts(echarts, container, state, context);
  }
  syncScopeSwitchState(container, state);
}

function chartGridMonthFromPoint(chart, payload, point) {
  if (!chart?.containPixel?.({ gridIndex: 0 }, point)) {
    return 0;
  }
  const rawAxisValue = chart.convertFromPixel?.({ xAxisIndex: 0 }, point);
  const axisValue = Array.isArray(rawAxisValue) ? rawAxisValue[0] : rawAxisValue;
  const axisIndex = Math.round(Number(axisValue));
  if (!Number.isFinite(axisIndex)) {
    return 0;
  }
  return safeNumber(payload?.months?.[axisIndex]?.month, 0);
}

async function renderCharts(container, state, payload, context, renderToken) {
  if (shouldSkipChartRuntime()) {
    return;
  }
  const mainHost = container.querySelector('[data-entry-chart-host]');
  try {
    const echarts = resolveECharts(await loadECharts());
    if (renderToken !== state.renderToken) {
      return;
    }
    if (mainHost) {
      const chart = echarts.init(mainHost);
      let lastHandledMainChartClickAt = 0;
      chart.setOption(buildMainChartOption(payload, state));
      chart.on('click', (params) => {
        const month = monthFromMainChartClickParams(params, payload);
        if (!month) {
          return;
        }
        lastHandledMainChartClickAt = Date.now();
        focusEntryStructureMonth(state, month);
        paintAnnualEntryStructure(container, state);
      });
      chart.getZr?.()?.on?.('click', (event) => {
        const point = mainChartPointerPointFromEvent(event);
        if (!point) {
          return;
        }
        window.setTimeout(() => {
          if (Date.now() - lastHandledMainChartClickAt < 80) {
            return;
          }
          const month = chartGridMonthFromPoint(chart, payload, point);
          if (!month) {
            return;
          }
          focusEntryStructureMonth(state, month);
          paintAnnualEntryStructure(container, state);
        }, 0);
      });
      chart.on('dataZoom', (params) => {
        const nextViewport = chartViewportFromDataZoom(payload, params, chart.getOption?.() || {});
        if (!applyChartViewportContext(state, nextViewport)) {
          return;
        }
        refreshEntryStructureContext(container, state, payload, echarts);
      });
      registerChart(state, chart);
    }
    renderContextCharts(echarts, container, state, context);
  } catch (error) {
    const message = `ECharts 加载失败：${error?.message || '未知错误'}`;
    [mainHost, container.querySelector('[data-entry-status-chart]'), container.querySelector('[data-entry-province-chart]')]
      .filter(Boolean)
      .forEach((host) => {
      host.innerHTML = renderChartFallback(message);
      });
  }
}

function paintAnnualEntryStructure(container, state) {
  cleanupYearPickerOutsideHandler(state);
  disposeCharts(state);
  const payload = state.payload;
  if (!payload) {
    container.innerHTML = renderEmptyState({
      title: '年度进店结构加载中',
      description: state.loading ? '正在获取年度进店数据…' : '暂无年度进店结构数据。',
      compact: false,
    });
    return;
  }

  const context = buildContext(payload, state);
  const modalContext = getProjectModalContext(payload, state, context);
  const yearOptions = buildYearOptions(new Date().getFullYear(), state.selectedYear);
  const renderToken = (state.renderToken += 1);

  container.innerHTML = `
    <article class="overview-panel overview-entry-structure-panel">
      <div class="entry-structure-top-band">
        <header class="overview-panel-header entry-structure-header">
          <div class="entry-structure-title-block">
            <span class="overview-panel-kicker">年度节奏</span>
            <h2>年度进店结构</h2>
          </div>
          ${renderEntryStatusStrip(context)}
          <div class="entry-structure-toolbar" aria-label="年度进店筛选">
            ${renderYearPicker(yearOptions, state.selectedYear)}
          </div>
        </header>
      </div>
      ${renderScopeSwitch(payload, state)}

      ${
        state.loading
          ? '<p class="entry-structure-coverage-warn">正在刷新年度进店数据...</p>'
          : state.error
            ? `<p class="entry-structure-coverage-warn">年度进店数据刷新失败：${escapeHtml(state.error)}</p>`
            : ''
      }

      <div class="entry-structure-analysis-grid">
        <section class="entry-structure-chart-panel is-main">
          <header class="entry-structure-subheader">
            <div>
              <h3>1-12月进店结构</h3>
              <span>全年趋势 · 月度结构</span>
            </div>
          </header>
          <div class="entry-structure-chart-host" data-entry-chart-host role="img" aria-label="${escapeHtml(payload.year)}年度进店结构主图">
            ${renderChartFallback()}
          </div>
        </section>
      </div>

      ${renderRankingShell(context)}
      ${renderProjectModal(state, modalContext)}
    </article>
  `;

  bindTooltipTriggers(container);

  container.querySelectorAll('[data-entry-modal-close]').forEach((button) => {
    button.addEventListener('click', () => {
      closeProjectModal(container, state);
    });
  });

  bindProjectModalFilterEvents(container, state, modalContext);

  const changeYear = async (nextYear) => {
    if (nextYear === state.selectedYear || typeof state.onYearChange !== 'function') {
      return;
    }
    state.loading = true;
    state.error = '';
    state.modal = { open: false, filter: 'all', storeStatus: '', month: 0 };
    paintAnnualEntryStructure(container, state);
    try {
      const nextPayload = await state.onYearChange(nextYear);
      state.payload = nextPayload;
      state.selectedYear = safeNumber(nextPayload?.year, nextYear);
      state.selectedMonth = 0;
      state.contextMode = 'year';
      state.selectedQuarter = 'all';
      state.chartViewport = mainChartViewportRange(state);
      state.modal = { open: false, filter: 'all', storeStatus: '', month: 0 };
    } catch (error) {
      state.error = error?.message || '请求失败';
    } finally {
      state.loading = false;
    }
    paintAnnualEntryStructure(container, state);
  };

  const yearSelect = container.querySelector('[data-entry-year]');
  yearSelect?.addEventListener('change', async () => {
    await changeYear(safeNumber(yearSelect.value, state.selectedYear));
  });

  const yearPicker = container.querySelector('[data-entry-year-picker]');
  const yearButton = container.querySelector('[data-entry-year-button]');
  const closeYearPicker = () => {
    yearPicker?.classList.remove('is-open');
    yearButton?.setAttribute('aria-expanded', 'false');
  };
  yearButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    const nextOpen = !yearPicker?.classList.contains('is-open');
    yearPicker?.classList.toggle('is-open', nextOpen);
    yearButton.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    if (nextOpen) {
      yearPicker?.querySelector('.entry-structure-year-option.is-active')?.focus?.();
    }
  });
  yearPicker?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    closeYearPicker();
    yearButton?.focus?.();
  });
  yearPicker?.querySelectorAll('[data-entry-year-option]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const nextYear = safeNumber(button.getAttribute('data-entry-year-option'), state.selectedYear);
      closeYearPicker();
      if (yearSelect) {
        yearSelect.value = String(nextYear);
      }
      await changeYear(nextYear);
    });
  });
  if (yearPicker && typeof document !== 'undefined') {
    state.yearPickerOutsideHandler = (event) => {
      if (!yearPicker.contains?.(event.target)) {
        closeYearPicker();
      }
    };
    document.addEventListener?.('click', state.yearPickerOutsideHandler);
  }

  container.querySelectorAll('[data-entry-range]').forEach((button) => {
    button.addEventListener('click', () => {
      const range = button.getAttribute('data-entry-range') || 'all';
      if (range === 'all') {
        state.contextMode = 'year';
        state.selectedMonth = 0;
        state.selectedQuarter = 'all';
      } else {
        state.contextMode = 'quarter';
        state.selectedQuarter = range;
        state.selectedMonth = 0;
      }
      state.chartViewport = mainChartViewportRange(state);
      state.error = '';
      state.modal = { open: false, filter: 'all', storeStatus: '', month: 0 };
      paintAnnualEntryStructure(container, state);
    });
  });

  renderCharts(container, state, payload, context, renderToken);
}

export function mountAnnualEntryStructure(container, options = {}) {
  if (!container) {
    return null;
  }

  const state = {
    payload: options.payload || null,
    selectedYear: safeNumber(options.payload?.year, new Date().getFullYear()),
    selectedMonth: 0,
    selectedQuarter: 'all',
    contextMode: 'year',
    chartViewport: mainChartViewportRange({ contextMode: 'year', selectedQuarter: 'all', selectedMonth: 0 }),
    loading: false,
    error: '',
    modal: { open: false, filter: 'all', storeStatus: '', month: 0 },
    onYearChange: options.onYearChange || null,
    showStoreAgeTrendPointLabels: options.showStoreAgeTrendPointLabels !== false,
    showStoreAgeTrendSideLegend: Boolean(options.showStoreAgeTrendSideLegend),
    chartInstances: [],
    contextChartInstances: [],
    renderToken: 0,
    resizeHandler: null,
    keydownHandler: null,
    yearPickerOutsideHandler: null,
  };

  if (!shouldSkipChartRuntime()) {
    state.resizeHandler = () => {
      state.chartInstances.forEach((chart) => chart?.resize?.());
    };
    state.keydownHandler = (event) => {
      if (event.key !== 'Escape' || !state.modal?.open) {
        return;
      }
      closeProjectModal(container, state);
    };
    window.addEventListener('resize', state.resizeHandler);
    window.addEventListener('keydown', state.keydownHandler);
  }

  paintAnnualEntryStructure(container, state);

  return {
    update(payload) {
      state.payload = payload;
      state.selectedYear = safeNumber(payload?.year, state.selectedYear);
      state.selectedMonth = 0;
      state.contextMode = 'year';
      state.selectedQuarter = 'all';
      state.chartViewport = mainChartViewportRange(state);
      state.error = '';
      state.modal = { open: false, filter: 'all', storeStatus: '', month: 0 };
      paintAnnualEntryStructure(container, state);
    },
    destroy() {
      cleanupYearPickerOutsideHandler(state);
      disposeCharts(state);
      if (state.resizeHandler && typeof window !== 'undefined') {
        window.removeEventListener('resize', state.resizeHandler);
      }
      if (state.keydownHandler && typeof window !== 'undefined') {
        window.removeEventListener('keydown', state.keydownHandler);
      }
    },
  };
}

export { buildMainChartOption, buildStatusChartOption, renderEntryStatusStrip };
