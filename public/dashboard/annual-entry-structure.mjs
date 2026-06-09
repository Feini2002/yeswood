import { renderBarChart } from './chart-bar.mjs';
import { renderEmptyState } from './empty-state.mjs';
import { bindTooltipTriggers, escapeHtml, tooltipDataAttr } from './tooltip.mjs';

const QUADRANT_LABELS = {
  directNew: '直营新店',
  directOld: '直营老店',
  franchiseNew: '加盟新店',
  franchiseOld: '加盟老店',
};

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pct(part, total) {
  const denominator = safeNumber(total);
  if (!denominator) {
    return 0;
  }
  return Math.round((safeNumber(part) / denominator) * 100);
}

function formatTopItems(items = [], limit = 3) {
  return (items || []).slice(0, limit).map((item) => `${item.label} ${item.total}`).join(' · ') || '—';
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

function renderSummaryTotals(totals = {}) {
  const items = [
    { label: '总进店', value: totals.entry },
    { label: '新店', value: totals.newStore },
    { label: '老店', value: totals.oldStore },
    { label: '直营', value: totals.direct },
    { label: '加盟', value: totals.franchise },
  ];
  return items
    .map(
      (item) => `
        <div class="entry-structure-summary-item">
          <span>${escapeHtml(item.label)}</span>
          <strong>${item.value}</strong>
        </div>
      `
    )
    .join('');
}

function renderDataQualityNotes(payload = {}) {
  const { dataQuality = {}, fieldCoverage = {} } = payload;
  const coverageLow = Object.values(fieldCoverage).some((value) => safeNumber(value) < 70);
  const rows = [
    ['启动时间缺失', dataQuality.missingStartDate],
    ['店型未识别', dataQuality.unclassifiedStoreAge],
    ['组别未归类', dataQuality.unclassifiedScope],
    ['暂停排除', dataQuality.excludedPaused],
    ['取消/关闭排除', dataQuality.excludedCanceled],
  ].filter(([, value]) => safeNumber(value) > 0);

  return `
    <details class="entry-structure-data-notes">
      <summary>数据说明</summary>
      <div class="entry-structure-data-notes-body">
        ${
          coverageLow
            ? '<p class="entry-structure-coverage-warn">部分字段覆盖偏低，趋势仅供参考。</p>'
            : ''
        }
        <dl class="entry-structure-coverage-grid">
          <div><dt>启动时间覆盖</dt><dd>${safeNumber(fieldCoverage.startDate)}%</dd></div>
          <div><dt>店型覆盖</dt><dd>${safeNumber(fieldCoverage.storeNature)}%</dd></div>
          <div><dt>省份覆盖</dt><dd>${safeNumber(fieldCoverage.province)}%</dd></div>
          <div><dt>组别覆盖</dt><dd>${safeNumber(fieldCoverage.businessGroup)}%</dd></div>
        </dl>
        ${
          rows.length
            ? `<ul class="entry-structure-quality-list">${rows
                .map(([label, value]) => `<li>${escapeHtml(label)}：${value} 项</li>`)
                .join('')}</ul>`
            : '<p>当年有效进店数据质量正常。</p>'
        }
      </div>
    </details>
  `;
}

function buildBarTooltip({ year, month, storeAgeLabel, monthData, segment }) {
  const bucket = segment === 'newStore' ? monthData.newStore : monthData.oldStore;
  const total = bucket.total || 0;
  const storeStatuses = (monthData.storeStatuses || [])
    .filter((item) => {
      if (segment === 'newStore') {
        return item.newStore > 0;
      }
      return item.oldStore > 0;
    })
    .slice(0, 8);
  const provinces = (monthData.provinces || [])
    .filter((item) => {
      if (segment === 'newStore') {
        return item.newStore > 0;
      }
      return item.oldStore > 0;
    })
    .slice(0, 5);

  return {
    title: `${year}年 ${month}月 · ${storeAgeLabel}进店 ${total} 项`,
    value: `直营 ${bucket.direct} 项（${pct(bucket.direct, total)}%）`,
    compare: `加盟 ${bucket.franchise} 项（${pct(bucket.franchise, total)}%）`,
    extra: [
      '店态结构',
      ...storeStatuses.map((item) => `${item.label} ${segment === 'newStore' ? item.newStore : item.oldStore}`),
      '省份 Top 5',
      ...provinces.map((item) => `${item.label} ${segment === 'newStore' ? item.newStore : item.oldStore}`),
    ].join('\n'),
  };
}

function renderMainChart(payload, selectedMonth, onMonthSelect) {
  const { year, months = [] } = payload;
  const max = Math.max(
    ...months.flatMap((month) => [month.newStore?.total || 0, month.oldStore?.total || 0]),
    1
  );

  return `
    <div class="entry-structure-chart" role="img" aria-label="${year}年度进店结构主图">
      <div class="entry-structure-chart-axis" aria-hidden="true">
        <span>${max}</span>
        <span>${Math.round(max / 2)}</span>
        <span>0</span>
      </div>
      <div class="entry-structure-chart-body">
        ${months
          .map((monthData) => {
            const month = monthData.month;
            const selected = month === selectedMonth ? ' is-selected' : '';
            const renderBar = (segment, label) => {
              const bucket = segment === 'newStore' ? monthData.newStore : monthData.oldStore;
              const total = bucket?.total || 0;
              const height = Math.max(8, Math.round((total / max) * 180));
              const directHeight = total ? Math.round((bucket.direct / total) * height) : 0;
              const franchiseHeight = Math.max(0, height - directHeight);
              const tooltip = buildBarTooltip({ year, month, storeAgeLabel: label, monthData, segment });
              return `
                <button
                  type="button"
                  class="entry-structure-bar-hit${selected}"
                  data-entry-month="${month}"
                  ${tooltipDataAttr(tooltip)}
                  aria-label="${escapeHtml(`${month}月${label} ${total}项`)}"
                >
                  <span class="entry-structure-bar-stack" style="height:${height}px">
                    <span class="entry-structure-bar-segment is-franchise" style="height:${franchiseHeight}px"></span>
                    <span class="entry-structure-bar-segment is-direct" style="height:${directHeight}px"></span>
                  </span>
                  <span class="entry-structure-bar-value">${total || ''}</span>
                </button>
              `;
            };
            return `
              <div class="entry-structure-month-group${selected}">
                <div class="entry-structure-month-bars">
                  ${renderBar('newStore', '新店')}
                  ${renderBar('oldStore', '老店')}
                </div>
                <button type="button" class="entry-structure-month-label${selected}" data-entry-month="${month}">
                  ${escapeHtml(monthData.label)}
                </button>
              </div>
            `;
          })
          .join('')}
      </div>
      <div class="entry-structure-chart-legend" aria-hidden="true">
        <span><i class="is-direct"></i>直营</span>
        <span><i class="is-franchise"></i>加盟</span>
      </div>
    </div>
  `;
}

function renderQuadrants(monthData, year, selectedMonth) {
  if (!monthData || !monthData.total) {
    return renderEmptyState({
      title: '当月暂无有效进店',
      description: selectedMonth ? `${year}年${selectedMonth}月没有可统计的进店项目。` : '全年暂无有效进店项目。',
      compact: true,
    });
  }

  const quadrants = monthData.quadrants || {};
  return `
    <div class="entry-structure-quadrant-grid">
      ${Object.entries(QUADRANT_LABELS)
        .map(([key, label]) => {
          const quadrant = quadrants[key] || { total: 0, storeStatuses: [], provinces: [] };
          return `
            <article class="entry-structure-quadrant-card">
              <header>
                <h3>${escapeHtml(label)}</h3>
                <strong>${quadrant.total} 项</strong>
              </header>
              <p>占当月 ${pct(quadrant.total, monthData.total)}%</p>
              <dl>
                <div><dt>主要店态</dt><dd>${escapeHtml(formatTopItems(quadrant.storeStatuses))}</dd></div>
                <div><dt>主要省份</dt><dd>${escapeHtml(formatTopItems(quadrant.provinces))}</dd></div>
              </dl>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderStoreStatusRanking(monthData) {
  const host = document.createElement('div');
  renderBarChart(
    host,
    (monthData?.storeStatuses || []).map((item) => ({
      label: item.label,
      value: item.total,
      tooltip: {
        title: item.label,
        value: `${item.total} 项`,
        definition: '当月有效进店项目的店态分布。',
        compare: `直营 ${item.direct} · 加盟 ${item.franchise}`,
      },
    })),
    { definition: '当月店态排行（Top 8 + 其他）。' }
  );
  return host.innerHTML;
}

function renderProvinceRanking(monthData, year, selectedMonth) {
  const provinces = monthData?.provinces || [];
  if (!provinces.length) {
    return renderEmptyState({
      title: '暂无区域分布',
      description: '当月没有可展示的省份进店数据。',
      compact: true,
    });
  }

  const compact = provinces.length > 15;
  return `
    <div class="entry-structure-region-list${compact ? ' is-compact' : ''}">
      ${provinces
        .map(
          (item) => `
            <div class="entry-structure-region-row" data-entry-province="${escapeHtml(item.key)}">
              <span class="entry-structure-region-name">${escapeHtml(item.label)}</span>
              <span class="entry-structure-region-bar"><i style="width:${Math.max(6, pct(item.total, monthData.total))}%"></i></span>
              <span class="entry-structure-region-meta">
                <strong>${item.total} 项</strong>
                <small>新店 ${item.newStore} / 老店 ${item.oldStore}</small>
              </span>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

export function mountAnnualEntryStructure(container, options = {}) {
  if (!container) {
    return null;
  }

  const state = {
    payload: options.payload || null,
    selectedYear: safeNumber(options.payload?.year, new Date().getFullYear()),
    selectedMonth: safeNumber(options.payload?.defaultMonth, 0),
    loading: false,
    error: '',
    onYearChange: options.onYearChange || null,
  };

  function monthData() {
    return (state.payload?.months || []).find((item) => item.month === state.selectedMonth) || null;
  }

  function paint() {
    const payload = state.payload;
    if (!payload) {
      container.innerHTML = renderEmptyState({
        title: '年度进店结构加载中',
        description: state.loading ? '正在获取年度进店数据…' : '暂无年度进店结构数据。',
        compact: false,
      });
      return;
    }

    const month = monthData();
    const yearOptions = buildYearOptions(new Date().getFullYear(), state.selectedYear);

    container.innerHTML = `
      <article class="overview-panel overview-entry-structure-panel">
        <header class="overview-panel-header entry-structure-header">
          <div>
            <span class="overview-panel-kicker">年度节奏</span>
            <h2>年度进店结构</h2>
          </div>
          <label class="entry-structure-year-field">
            <span>年份</span>
            <select data-entry-year>
              ${yearOptions
                .map(
                  (year) =>
                    `<option value="${year}"${year === state.selectedYear ? ' selected' : ''}>${year}年</option>`
                )
                .join('')}
            </select>
          </label>
        </header>

        <div class="entry-structure-summary" aria-label="年度汇总">
          ${renderSummaryTotals(payload.totals)}
        </div>

        ${
          state.loading
            ? '<p class="entry-structure-coverage-warn">正在刷新年度进店数据...</p>'
            : state.error
              ? `<p class="entry-structure-coverage-warn">年度进店数据刷新失败：${escapeHtml(state.error)}</p>`
              : ''
        }

        ${renderDataQualityNotes(payload)}

        ${renderMainChart(payload, state.selectedMonth)}

        <div class="entry-structure-detail-grid">
          <section class="entry-structure-quadrants-panel">
            <header class="entry-structure-subheader">
              <h3>${state.selectedMonth ? `${payload.year}年 ${state.selectedMonth}月` : '月份详情'}</h3>
              <span>四象限摘要</span>
            </header>
            ${renderQuadrants(month, payload.year, state.selectedMonth)}
          </section>

          <section class="entry-structure-status-panel">
            <header class="entry-structure-subheader">
              <h3>店态排行</h3>
              <span>Top 8 + 其他</span>
            </header>
            <div class="entry-structure-status-ranking" data-entry-status-ranking></div>
          </section>
        </div>

        <section class="entry-structure-region-panel">
          <header class="entry-structure-subheader">
            <h3>${state.selectedMonth ? `${payload.year}年 ${state.selectedMonth}月 · 区域分布` : '区域分布'}</h3>
            <span>省份排行</span>
          </header>
          ${renderProvinceRanking(month, payload.year, state.selectedMonth)}
        </section>
      </article>
    `;

    const statusHost = container.querySelector('[data-entry-status-ranking]');
    if (statusHost) {
      statusHost.innerHTML = renderStoreStatusRanking(month);
    }

    bindTooltipTriggers(container);

    const yearSelect = container.querySelector('[data-entry-year]');
    yearSelect?.addEventListener('change', async () => {
      const nextYear = safeNumber(yearSelect.value, state.selectedYear);
      if (nextYear === state.selectedYear || typeof state.onYearChange !== 'function') {
        return;
      }
      state.loading = true;
      state.error = '';
      paint();
      try {
        const nextPayload = await state.onYearChange(nextYear);
        state.payload = nextPayload;
        state.selectedYear = safeNumber(nextPayload?.year, nextYear);
        state.selectedMonth = safeNumber(nextPayload?.defaultMonth, 0);
      } catch (error) {
        state.error = error?.message || '请求失败';
      } finally {
        state.loading = false;
      }
      paint();
    });

    container.querySelectorAll('[data-entry-month]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextMonth = safeNumber(button.getAttribute('data-entry-month'), 0);
        if (!nextMonth || nextMonth === state.selectedMonth) {
          return;
        }
        state.selectedMonth = nextMonth;
        paint();
      });
    });
  }

  paint();

  return {
    update(payload) {
      state.payload = payload;
      state.selectedYear = safeNumber(payload?.year, state.selectedYear);
      state.selectedMonth = safeNumber(payload?.defaultMonth, state.selectedMonth);
      state.error = '';
      paint();
    },
  };
}
