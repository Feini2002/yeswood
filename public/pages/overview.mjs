import { state } from '../lib/state.mjs';
import { bindDashboardTooltips, elements, setPanelInsight } from '../lib/dom.mjs';
import { escapeHtml, displayOrDash, formatDate } from '../lib/format.mjs';
import { bindTooltipTriggers, tooltipDataAttr } from '../dashboard/tooltip.mjs';
import { renderBarChart as renderSharedBarChart } from '../dashboard/chart-bar.mjs';
import { renderColumnChart } from '../dashboard/chart-column.mjs';
import { mountAnnualEntryStructure } from '../dashboard/annual-entry-structure.mjs';
import { buildDirectorOverviewModel } from '../dashboard/home-director-metrics.mjs';
import { lifecycleStageLabel } from '../dashboard/project-lifecycle.mjs';
import { renderInsightCard, renderInsightCards } from '../dashboard/insight-card.mjs';
import { renderEmptyState } from '../dashboard/empty-state.mjs';
import { OVERVIEW_KPI_METRICS } from '../lib/constants.mjs';
import { ENTRY_STRUCTURE_ENDPOINT, fetchJson } from '../lib/api.mjs';
import {
  buildDrillFilter,
  formatMetricValue,
  riskClass,
  collectRiskProjectQueue,
  riskDutyHeadline,
} from '../domain/metrics-display.mjs';
import { displayProjectOwner } from '../domain/project-display.mjs';
import { isProjectResponsibilityDelayed } from '../domain/project-workflow.mjs';
import { adaptProfileDashboardPayload, buildOverviewKpiItems, buildOverviewInsights } from './profile-shared.mjs';
import { runtimeStore } from '../lib/runtime-flags.mjs';

export function renderKpis(metrics) {
  const departmentMetrics = state.profileMetrics.department;
  const pausedCount = departmentMetrics?.pausedCount ?? metrics.pausedCount ?? metrics.summary?.pausedProjects ?? 0;
  const overviewPayload = departmentMetrics
    ? adaptProfileDashboardPayload(departmentMetrics)
    : {
        ...metrics,
        pausedCount,
        summary: { ...metrics.summary, pausedProjects: pausedCount },
      };
  const overviewInsights = buildOverviewInsights(metrics);

  elements.kpiGrid.innerHTML = renderInsightCards(
    buildOverviewKpiItems(overviewPayload, { showZeroPaused: true })
  );
  bindDashboardTooltips(elements.kpiGrid);
  setPanelInsight(elements.statusInsight, departmentMetrics?.insights?.modules?.status || overviewInsights.status);
  setPanelInsight(elements.trendInsight, departmentMetrics?.insights?.modules?.trend || overviewInsights.trend);
}


export function renderBarChart(container, items, options = {}) {
  if (!container) {
    return;
  }
  renderSharedBarChart(container, items, options);
  bindDashboardTooltips(container);
}


export function renderRiskList(items) {
  elements.riskTotal.textContent = `${items.length} 项`;
  if (!items.length) {
    elements.riskList.innerHTML = '<div class="empty-state">暂无延期或高风险项目</div>';
    return;
  }

  elements.riskList.innerHTML = items
    .map(
      (project) => `
        <div class="risk-item">
          <div>
            <strong title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</strong>
            <span>${escapeHtml(displayProjectOwner(project))} · ${escapeHtml(project.province)} · ${escapeHtml(
        project.status
      )} · ${escapeHtml(formatDate(project.dueDate))}</span>
          </div>
          <span class="pill ${isProjectResponsibilityDelayed(project) ? 'delay' : riskClass(project.riskLevel)}">${isProjectResponsibilityDelayed(project) ? '延期' : escapeHtml(project.riskLevel)}</span>
        </div>
      `
    )
    .join('');
}


export function renderTrend(items) {
  if (!elements.trendChart) {
    return;
  }
  renderColumnChart(elements.trendChart, items, {
    total: items.reduce((sum, item) => sum + item.value, 0),
    definition: '按项目 updatedAt 月份聚合。',
  });
  bindDashboardTooltips(elements.trendChart);
}


export function overviewDrillAttr(filter) {
  if (!filter || !Object.keys(filter).length) {
    return '';
  }
  return ` data-drill="${escapeHtml(JSON.stringify(filter))}"`;
}


export function overviewToneClass(tone = '') {
  return String(tone || '').replace(/[^a-zA-Z0-9_-]/g, '');
}


export function overviewNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}


export function renderOverviewCommandCenter(model, snapshot = {}) {
  if (!elements.overviewCommandFacts) {
    return;
  }
  const summary = model.summary || {};
  elements.overviewCommandFacts.innerHTML = `
    <div><dt>在营</dt><dd>${summary.scopeCount ?? 0}</dd></div>
    <div><dt>暂停</dt><dd>${summary.pausedCount ?? 0}</dd></div>
  `;
}


export function renderOverviewSignalStrip(model) {
  const container = elements.overviewSignalStrip;
  if (!container) {
    return;
  }
  const signals = model.signals || [];
  if (!signals.length) {
    container.innerHTML = renderEmptyState({ title: '暂无经营信号', compact: true });
    return;
  }
  container.innerHTML = signals
    .map((item) => {
      const tone = overviewToneClass(item.tone);
      const tooltip = {
        title: item.label,
        value: `${item.value ?? 0}`,
        definition: item.caption || '当前筛选口径下的总盘信号。',
      };
      return `
        <article
          class="overview-signal-cell${item.alert ? ' is-alert' : ''}${item.drillFilter ? ' is-drillable' : ''}"
          data-tone="${escapeHtml(tone)}"
          ${tooltipDataAttr(tooltip)}
          ${overviewDrillAttr(item.drillFilter)}
          ${item.drillFilter ? 'tabindex="0"' : ''}
        >
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value ?? 0)}</strong>
          <small>${escapeHtml(item.caption || '')}</small>
        </article>
      `;
    })
    .join('');
  bindDashboardTooltips(container);
}


export function renderOverviewStageLane(model) {
  const container = elements.overviewStageLane;
  if (!container) {
    return;
  }
  const stages = model.stageLane || [];
  if (!stages.length) {
    container.innerHTML = renderEmptyState({
      title: '暂无阶段数据',
      description: '当前项目缺少硬装/软装进度字段。',
      compact: true,
    });
    return;
  }
  container.innerHTML = stages
    .map((stage) => {
      const parallelNotes = [];
      if (stage.parallelHardConstruction) {
        parallelNotes.push(`并行施工图 ${stage.parallelHardConstruction} 项`);
      }
      const tooltip = {
        title: stage.label,
        value: `${stage.total} 项`,
        definition: [`平均进度 ${stage.avgProgress}% · 阶段占比 ${stage.share}%`, ...parallelNotes].join(' · '),
        compare: `延期 ${stage.delayed} 项 · 紧急 ${stage.urgent} 项`,
      };
      return `
        <button
          type="button"
          class="overview-stage-node${stage.congested ? ' is-congested' : ''}${stage.urgent || stage.delayedRate >= 40 ? ' is-alert' : ''}"
          style="--stage-pressure:${Math.max(10, stage.pressure || 0)}%"
          ${tooltipDataAttr(tooltip)}
          ${overviewDrillAttr(stage.drillFilter)}
          data-drill-count="${escapeHtml(stage.total)}"
          data-drill-title="${escapeHtml(stage.label)}"
        >
          <span class="overview-stage-head">
            <b>${escapeHtml(stage.label)}</b>
            <em>${stage.total}</em>
          </span>
          <span class="overview-stage-track"><i></i></span>
          <span class="overview-stage-foot">
            <small>延 ${stage.delayed}</small>
            <small>均 ${stage.avgProgress}%</small>
          </span>
        </button>
      `;
    })
    .join('');
  bindDashboardTooltips(container);
}


export function renderOverviewTierMatrix(model) {
  const container = elements.overviewTierMatrix;
  if (!container) {
    return;
  }
  const matrix = model.tierMatrix || {};
  if (!matrix.rows?.length || !matrix.columns?.length) {
    container.innerHTML = renderEmptyState({
      title: '暂无分层矩阵',
      description: '部门总盘暂未返回店态分层指标。',
      compact: true,
    });
    return;
  }
  const maxByKey = new Map(
    (matrix.columns || []).map((column) => [
      column.key,
      Math.max(...matrix.rows.map((row) => overviewNumber(row.values.find((item) => item.key === column.key)?.value)), 1),
    ])
  );
  const tierSummary = matrix.summary || {};
  const tierCount = tierSummary.rowCount ?? matrix.rows.length;
  container.innerHTML = `
    <div class="overview-tier-note">
      <strong>${tierCount} 类店态</strong>
      <span>按数据源「店态」明细展开，高潜 / 旗舰 / 超一线 / 黑标不再折叠进其他。</span>
    </div>
    <div class="overview-matrix-scroll">
      <div class="overview-tier-grid" style="--overview-tier-columns:${matrix.columns.length}">
        <span class="overview-matrix-corner">店态</span>
        ${matrix.columns.map((column) => `<span class="overview-matrix-head">${escapeHtml(column.label)}</span>`).join('')}
        ${matrix.rows
          .map(
            (row) => `
              <strong class="overview-matrix-row-label">${escapeHtml(row.label)}</strong>
              ${row.values
                .map(
                  (cell) => `
	                    <button
	                      type="button"
	                      class="overview-matrix-cell is-${escapeHtml(overviewToneClass(cell.tone))}${cell.value ? '' : ' is-zero'}"
	                      style="--cell-heat:${cell.value ? Math.max(8, Math.round((cell.value / (maxByKey.get(cell.key) || 1)) * 100)) : 0}%"
	                      ${overviewDrillAttr(cell.drillFilter)}
	                      ${tooltipDataAttr({
                        title: `${row.label} · ${cell.label}`,
                        value: `${cell.value} 项`,
                        definition: '部门总盘分层指标。',
                      })}
                    >
                      ${cell.value}
                    </button>
                  `
                )
                .join('')}
            `
          )
          .join('')}
      </div>
    </div>
  `;
  bindDashboardTooltips(container);
}


export function renderOverviewOwnerPressure(model) {
  const container = elements.ownerLoad;
  if (!container) {
    return;
  }
  const owners = model.ownerPressure || [];
  if (!owners.length) {
    container.innerHTML = renderEmptyState({ title: '暂无团队项目数量', compact: true });
    return;
  }
  container.innerHTML = owners
    .map((owner) => {
      const tooltip = {
        title: owner.name,
        value: `${owner.projectCount} 项`,
        definition: '按 CD 负责人、VM 负责人两栏统计，同项目同人只计一次。',
      };
      return `
        <button
          type="button"
          class="overview-owner-row is-${escapeHtml(owner.status)}"
          style="--owner-load:${owner.loadScore}%"
          ${overviewDrillAttr(owner.drillFilter)}
          ${tooltipDataAttr(tooltip)}
        >
          <span class="overview-owner-name" title="${escapeHtml(owner.name)}">${escapeHtml(owner.name)}</span>
          <span class="overview-owner-bar"><i></i></span>
          <span class="overview-owner-meta">
            <b>${owner.projectCount}</b>
          </span>
        </button>
      `;
    })
    .join('');
  bindDashboardTooltips(container);
}


export function renderOverviewRegionMatrix(model) {
  const container = elements.overviewRegionMatrix;
  if (!container) {
    return;
  }
  const matrix = model.regionMatrix || {};
  if (!matrix.rows?.length || !matrix.cols?.length) {
    container.innerHTML = renderEmptyState({ title: '暂无区域战情', compact: true });
    return;
  }
  const cellByKey = new Map((matrix.cells || []).map((cell) => [`${cell.province}::${cell.storeStatus}`, cell]));
  const allRows = matrix.allRows?.length ? matrix.allRows : matrix.rows || [];
  const overflowRows = matrix.overflowRows || allRows.slice(matrix.rows.length);
  const visibleLimit = matrix.visibleRowLimit || matrix.rows.length;
  const provinceAudit = matrix.provinceAudit || {};
  const auditPreview = (provinceAudit.issues || [])
    .slice(0, 3)
    .map((issue) => `${issue.label}${issue.canonical && issue.canonical !== issue.label ? ` / ${issue.canonical}` : ''}`)
    .join('、');
  const regionNote = `
    <div class="overview-tier-note is-compact overview-region-summary">
      <strong>${matrix.rows.length}/${allRows.length} 省份</strong>
      <span>在营 ${matrix.activeProjectCount ?? 0} 项 · 店态 ${matrix.cols.length} 类全量 · 不含暂停 ${matrix.excludedPausedCount ?? 0} 项</span>
    </div>
  `;
  const auditNote = provinceAudit.issueCount
    ? `<div class="overview-tier-note is-compact"><strong>${matrix.cols.length}/${matrix.totalCols} 类店态</strong><span>区域矩阵按项目量展示主力店态，完整店态看分层矩阵。</span></div>`
    : '';
  const renderRegionGrid = (rows, className = '') => `
    <div class="overview-matrix-scroll">
      <div class="overview-region-grid ${className}" style="--overview-region-columns:${matrix.cols.length}">
        <span class="overview-matrix-corner">省份</span>
        ${matrix.cols.map((col) => `<span class="overview-matrix-head">${escapeHtml(col)}</span>`).join('')}
        ${rows
          .map(
            (row) => `
              <strong class="overview-matrix-row-label">${escapeHtml(row)}</strong>
              ${matrix.cols
                .map((col) => {
                  const cell = cellByKey.get(`${row}::${col}`) || {
                    total: 0,
                    direct: 0,
                    franchise: 0,
                    drillFilter: { province: row, storeStatus: col, excludePaused: '1' },
                  };
                  return `
                    <button
                      type="button"
                      class="overview-region-cell${cell.total ? '' : ' is-zero'}"
                      ${overviewDrillAttr(cell.drillFilter)}
                      ${tooltipDataAttr({
                        title: `${row} · ${col}`,
                        value: `${cell.total} 项`,
                        metrics: [
                          { label: '直营', value: `${cell.direct || 0} 项` },
                          { label: '加盟', value: `${cell.franchise || 0} 项` },
                        ],
                      })}
                    >
                      <b>${cell.total}</b>
                    </button>
                  `;
                })
                .join('')}
            `
          )
          .join('')}
      </div>
    </div>
  `;
  const overflowMarkup = overflowRows.length
    ? `
      <details class="overview-region-details">
        <summary>
          <span>展开剩余 ${overflowRows.length} 省份</span>
          <b>全量 ${allRows.length} 省份 · Top ${visibleLimit} 已显示</b>
        </summary>
        ${renderRegionGrid(overflowRows, 'is-overflow')}
      </details>
    `
    : '';
  container.innerHTML = `
    ${regionNote}
    ${auditNote}
    ${renderRegionGrid(matrix.rows)}
    ${overflowMarkup}
  `;
  bindDashboardTooltips(container);
}


export function renderOverviewMonthlyOps(model) {
  const container = elements.overviewMonthlyOps;
  if (!container) {
    return;
  }
  const matrix = model.monthlyOpsMatrix || {};
  const maxMonthlyValue = Math.max(
    ...(matrix.rows || []).flatMap((row) => (row.values || []).map((cell) => overviewNumber(cell.value))),
    1
  );
  const opsMarkup =
    matrix.rows?.length && matrix.columns?.length
      ? `
        <div class="overview-matrix-scroll">
          <div class="overview-monthly-grid" style="--overview-monthly-columns:${matrix.columns.length}">
            <span class="overview-matrix-corner">节点</span>
            ${matrix.columns.map((column) => `<span class="overview-matrix-head">${escapeHtml(column.label)}</span>`).join('')}
            ${matrix.rows
              .map(
                (row) => `
                  <strong class="overview-matrix-row-label">${escapeHtml(row.label)}</strong>
                  ${row.values
                    .map(
                      (cell) => `
                        <button
                          type="button"
                          class="overview-matrix-cell${cell.value ? ' is-teal' : ' is-zero'}"
                          style="--cell-heat:${cell.value ? Math.max(8, Math.round((cell.value / maxMonthlyValue) * 100)) : 0}%"
                          ${overviewDrillAttr(cell.drillFilter)}
                          ${tooltipDataAttr({
                            title: `${row.label} · ${cell.tier}`,
                            value: `${cell.value} 项`,
                            definition: '本月责任域节点推进量。',
                          })}
                        >
                          ${cell.value}
                        </button>
                      `
                    )
                    .join('')}
                `
              )
              .join('')}
          </div>
        </div>
      `
      : renderEmptyState({ title: '暂无本月运转量', compact: true });
  container.innerHTML = opsMarkup;
  bindDashboardTooltips(container);
}


export function renderOverviewDataNotes(model) {
  const container = elements.overviewDataNotes;
  if (!container) {
    return;
  }
  const notes = model.dataNotes || [];
  container.innerHTML = notes
    .map(
      (note) => `
        <article>
          <span>${escapeHtml(note.label)}</span>
          <strong>${escapeHtml(note.value)}</strong>
          <p>${escapeHtml(note.text)}</p>
        </article>
      `
    )
    .join('');
}


export async function loadAnnualEntryStructure(year) {
  const query = Number.isFinite(Number(year)) ? `?year=${encodeURIComponent(year)}` : '';
  return fetchJson(`${ENTRY_STRUCTURE_ENDPOINT}${query}`);
}


export function renderAnnualEntryStructurePanel(departmentMetrics) {
  const container = elements.overviewEntryStructure;
  if (!container) {
    return;
  }

  const payload = departmentMetrics?.annualEntryStructure || state.annualEntryStructure || null;
  if (!runtimeStore.annualEntryStructureController) {
    runtimeStore.annualEntryStructureController = mountAnnualEntryStructure(container, {
      payload,
      onYearChange: loadAnnualEntryStructure,
    });
    return;
  }
  runtimeStore.annualEntryStructureController.update(payload);
}


export function renderOverviewDashboard(metrics, departmentMetrics, projects, snapshot) {
  const model = buildDirectorOverviewModel({
    metrics,
    departmentMetrics,
    projects,
    snapshot,
  });
  renderOverviewCommandCenter(model, snapshot);
  renderOverviewSignalStrip(model);
  renderOverviewStageLane(model);
  renderOverviewTierMatrix(model);
  renderOverviewOwnerPressure(model);
  renderOverviewRegionMatrix(model);
  renderOverviewMonthlyOps(model);
  renderOverviewDataNotes(model);
  renderAnnualEntryStructurePanel(departmentMetrics);

  const overviewInsights = buildOverviewInsights(metrics);
  renderBarChart(elements.statusChart, model.statusCounts, { definition: '按项目状态分组统计。' });
  renderTrend(model.monthlyTrend);
  setPanelInsight(elements.statusInsight, departmentMetrics?.insights?.modules?.status || overviewInsights.status);
  setPanelInsight(elements.trendInsight, '更新时间趋势用于判断数据活跃度，不等同于业务进度；业务压力请看阶段跑道与本月运转矩阵。');
  if (elements.statusTotal) {
    elements.statusTotal.textContent = `${model.summary.scopeCount} 项`;
  }
  if (elements.kpiGrid) {
    elements.kpiGrid.hidden = true;
    elements.kpiGrid.innerHTML = '';
  }
}

const TEAM_OWNER_ROLE_LABELS = {
  cdOwner: '硬装负责人',
  vmOwner: '软装负责人',
};
const SOLE_DUAL_DISCIPLINE_OWNER_NAME = '杨锦帆';
const CREATIVE_OWNER_CATEGORY_LABEL = '创意负责人';

