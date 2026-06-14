import { state } from '../lib/state.mjs';
import { bindDashboardTooltips, elements } from '../lib/dom.mjs';
import { escapeHtml, displayOrDash } from '../lib/format.mjs';
import { bindTooltipTriggers, hideTooltip } from '../dashboard/tooltip.mjs';
import { currentPageId, navigateToDetailsDrill } from '../lib/router.mjs';
import { DETAILS_WORKBENCH_VIEWS } from '../lib/constants.mjs';
import { peekDrillProjectsCache, resolveDrillProjects } from '../domain/project-catalog.mjs';
import { closeProjectDetailModal } from './project-detail-modal.mjs';
import { closeOwnerReviewMemberModal } from '../pages/owner-review.mjs';
import { renderInsightCard, renderInsightCards } from '../dashboard/insight-card.mjs';
import {
  buildDrillFilter,
  drillCardTitle,
  effectiveDrillFilters,
  drillFilterSummary,
  ownerTierRows,
  ownerTierMetricMeta,
  ownerTierMetricKeys,
  metricDefinitionTooltip,
  formatMetricValue,
  buildOwnerTierDrillFilter,
  ownerTotalMetrics,
} from '../domain/metrics-display.mjs';
import { sortProjectWorkbenchProjects } from '../domain/project-reminders.mjs';
import {
  renderDrillViewTabs,
  renderDrillProjectHead,
  renderProjectWorkbench,
  projectWorkbenchViewKey,
  projectWorkbenchRowCells,
} from './project-workbench.mjs';

import { runtimeStore } from '../lib/runtime-flags.mjs';

export function handleDrillProjectModalClick(event) {
  if (event.target.closest('[data-drill-project-close]') || event.target === elements.drillProjectModal) {
    closeDrillProjectModal();
  }
}


export function closeDrillProjectModal() {
  runtimeStore.drillModalRequestId += 1;
  state.drillModal = {
    ...state.drillModal,
    open: false,
    loading: false,
    error: '',
    projects: [],
  };
  if (elements.drillProjectModal) {
    elements.drillProjectModal.hidden = true;
  }
}


export function renderDrillProjectRows() {
  if (!elements.drillProjectRows) {
    return;
  }
  const viewKey = projectWorkbenchViewKey(state.drillWorkbenchView);
  const view = DETAILS_WORKBENCH_VIEWS[viewKey];
  const { projects, loading, error, targetCount } = state.drillModal;

  renderDrillViewTabs();
  renderDrillProjectHead(viewKey);
  elements.drillProjectRows.className = `project-workbench-rows drill-project-rows ${view.gridClass}`;

  if (loading) {
    const count = Number(targetCount);
    const detail = Number.isFinite(count)
      ? `预计 ${count} 项，正在匹配当前口径下的项目清单。`
      : '正在匹配当前卡片口径下的项目清单。';
    elements.drillProjectRows.innerHTML = `
      <div class="drill-loading-state" role="status" aria-live="polite">
        <span class="drill-loading-mark" aria-hidden="true"></span>
        <strong>正在匹配项目</strong>
        <p>${escapeHtml(detail)}</p>
      </div>
    `;
    return;
  }

  if (error) {
    elements.drillProjectRows.innerHTML = `<div class="empty-state">${escapeHtml(error)}</div>`;
    return;
  }

  if (!projects.length) {
    elements.drillProjectRows.innerHTML = '<div class="empty-state">暂无匹配项目</div>';
    return;
  }

  elements.drillProjectRows.innerHTML = sortProjectWorkbenchProjects(projects)
    .map((project) => {
      const cells = projectWorkbenchRowCells(project, viewKey).join('');
      return `
        <div class="project-workbench-row ${view.gridClass}" role="button" tabindex="0" data-project-id="${escapeHtml(project.id)}" data-drill-project-row="true" aria-label="查看 ${escapeHtml(project.name || '项目')} 明细">
          ${cells}
        </div>
      `;
    })
    .join('');
}


export function renderDrillProjectModal() {
  if (!elements.drillProjectModal) {
    return;
  }
  const { open, title, subtitle, targetCount, projects, loading, error } = state.drillModal;
  elements.drillProjectModal.hidden = !open;
  if (!open) {
    return;
  }

  if (elements.drillProjectModalTitle) {
    elements.drillProjectModalTitle.textContent = title || '项目明细';
  }
  if (elements.drillProjectModalSubtitle) {
    elements.drillProjectModalSubtitle.textContent = subtitle || '';
  }
  if (elements.drillProjectModalCount) {
    const count = loading && Number.isFinite(Number(targetCount)) ? Number(targetCount) : projects.length;
    elements.drillProjectModalCount.textContent = `${count} 项`;
  }
  if (elements.drillProjectModalStatus) {
    elements.drillProjectModalStatus.textContent = loading ? '正在匹配项目' : error ? '加载失败' : '';
  }
  renderDrillProjectRows();
}


export async function openDrillProjectModal(filter = {}, { targetCount = null, title = '项目明细' } = {}) {
  hideTooltip();
  const requestId = runtimeStore.drillModalRequestId + 1;
  runtimeStore.drillModalRequestId = requestId;
  const filters = effectiveDrillFilters(filter);
  const normalizedTargetCount = Number(targetCount);
  const cachedProjects = peekDrillProjectsCache(filters);
  state.drillWorkbenchView = 'list';
  state.drillModal = {
    open: true,
    loading: !cachedProjects,
    error: '',
    title,
    subtitle: drillFilterSummary(filters),
    targetCount: Number.isFinite(normalizedTargetCount) ? normalizedTargetCount : null,
    filters,
    projects: cachedProjects || [],
  };
  renderDrillProjectModal();

  try {
    const items = await resolveDrillProjects(filters);
    if (requestId !== runtimeStore.drillModalRequestId) {
      return;
    }
    state.drillModal = {
      ...state.drillModal,
      loading: false,
      projects: items,
    };
    renderDrillProjectModal();
  } catch (error) {
    if (requestId !== runtimeStore.drillModalRequestId) {
      return;
    }
    console.warn('Project drill modal load failed', error);
    state.drillModal = {
      ...state.drillModal,
      loading: false,
      error: '项目列表加载失败',
      projects: [],
    };
    renderDrillProjectModal();
  }
}


export function readDrillTargetCount(card) {
  const explicitCount = Number(card?.dataset.drillCount);
  if (Number.isFinite(explicitCount)) {
    return explicitCount;
  }
  const raw = card?.querySelector('.insight-card-value')?.textContent || '';
  if (!raw || raw.includes('%')) {
    return null;
  }
  const value = Number(raw.replace(/[^\d.-]/g, ''));
  return Number.isFinite(value) ? value : null;
}


export function handleDashboardDrillClick(event) {
  const card = event.target.closest('[data-drill]');
  if (!card) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  try {
    const filter = JSON.parse(card.dataset.drill);
    openDrillProjectModal(filter, {
      targetCount: readDrillTargetCount(card),
      title: drillCardTitle(card),
    });
  } catch (error) {
    console.warn('Invalid drill filter', error);
  }
}


export function handleDashboardDrillKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  if (!event.target.closest('[data-drill]')) {
    return;
  }
  handleDashboardDrillClick(event);
}


export function handleGlobalModalKeydown(event) {
  if (event.key !== 'Escape') {
    return;
  }
  if (elements.projectDetailModal && !elements.projectDetailModal.hidden) {
    closeProjectDetailModal();
    return;
  }
  if (elements.ownerReviewMemberModal && !elements.ownerReviewMemberModal.hidden) {
    closeOwnerReviewMemberModal();
    return;
  }
  if (state.drillModal.open) {
    closeDrillProjectModal();
  }
}


export function renderOwnerMonthlyTierBoard(metrics) {
  const board = elements.teamTierKpiBoard;
  if (!board) {
    return false;
  }

  const hardOwnerItems = Array.isArray(metrics.hardOwnerMetrics?.items) ? metrics.hardOwnerMetrics.items : [];
  if (hardOwnerItems.length) {
    const hardOwnerRows = Array.isArray(metrics.hardOwnerMetrics?.rows) ? metrics.hardOwnerMetrics.rows : [];
    const hardOwnerRowItems = (row = {}) =>
      hardOwnerItems.map((item) => {
        const rowItem = (row.items || []).find((candidate) => candidate.key === item.key) || {};
        return {
          ...item,
          ...rowItem,
          key: item.key,
          label: rowItem.label || item.label,
          value: rowItem.value ?? row.values?.[item.key] ?? 0,
          tone: rowItem.tone || item.tone || 'teal',
          alert: rowItem.alert ?? item.alert,
          tooltip: rowItem.tooltip || item.tooltip,
        };
      });
    const renderHardOwnerRow = (row, items, { total = false } = {}) => {
      const rowLabel = row.label || row.storeStatus || row.key;
      const cards = items
        .map((item) =>
          renderInsightCard({
            key: total ? item.key : `${row.key}-${item.key}`,
            label: item.label,
            value: item.value ?? 0,
            tone: item.tone || 'teal',
            alert: item.alert,
            tooltip: item.tooltip,
            drillable: true,
            drillFilter: buildDrillFilter({
              owner: metrics.owner || metrics.displayName || '',
              dashboardContext: metrics.dashboardContext || 'all',
              metric: item.key,
              storeStatus: total ? '' : row.storeStatus || row.label || '',
              excludePaused: '1',
            }),
          })
        )
        .join('');
      return `
        <div class="tier-kpi-row${total ? ' is-total is-hard-owner' : ' is-hard-owner-status'}" data-tier="${escapeHtml(row.key)}" style="--tier-metric-count:${hardOwnerItems.length}">
          <div class="tier-kpi-row-label">${escapeHtml(rowLabel)}</div>
          ${cards}
        </div>
      `;
    };
    const hardOwnerDetailRows = hardOwnerRows
      .map((row) => renderHardOwnerRow(row, hardOwnerRowItems(row)))
      .join('');
    const hardOwnerDetails = hardOwnerRows.length
      ? `
        <details class="tier-kpi-details" open>
          <summary>
            <span>店态明细</span>
            <small>${hardOwnerRows.length} 类店态</small>
          </summary>
          <div class="tier-kpi-detail-rows">
            ${hardOwnerDetailRows}
          </div>
        </details>
      `
      : '';
    board.innerHTML = `
      <div class="tier-kpi-table is-hard-owner-form" style="--tier-metric-count:${hardOwnerItems.length}">
        ${renderHardOwnerRow({ key: 'hard-owner', label: '硬装负责人' }, hardOwnerItems, { total: true })}
        ${hardOwnerDetails}
      </div>
    `;
    bindDashboardTooltips(board);
    return true;
  }

  const tiers = metrics.tiers || {};
  const definitions = metrics.metricDefinitions || {};
  const rows = ownerTierRows(metrics).filter((row) => tiers[row.key] && Object.keys(tiers[row.key]).length);
  const hasTiers = rows.length > 0;

  if (!hasTiers) {
    return false;
  }

  const totalMetrics = ownerTotalMetrics(metrics);
  const firstMetrics = Object.keys(totalMetrics).length
    ? totalMetrics
    : rows.map((row) => tiers[row.key] || {}).find((tierMetrics) => Object.keys(tierMetrics).length) || {};
  const metricKeys = ownerTierMetricKeys(firstMetrics);

  const renderTierRow = (row, tierMetrics, { total = false } = {}) => {
    const cards = metricKeys
      .map((key) => {
        const meta = ownerTierMetricMeta(key);
        const value = tierMetrics[key] ?? 0;
        const tooltip = metricDefinitionTooltip(definitions, key, meta.label, value) || metricDefinitionTooltip(definitions, `${row.key}.${key}`, meta.label, value);
        return renderInsightCard({
          key: `${row.key}-${key}`,
          label: meta.label,
          value,
          tone: meta.tone || 'teal',
          alert: meta.alert,
          tooltip,
          drillable: true,
          drillFilter: total
            ? buildDrillFilter({
                owner: metrics.owner || metrics.displayName || '',
                dashboardContext: metrics.dashboardContext || '',
                metric: key,
                status: meta.drillStatus || '',
                delayed: meta.drillDelayed ? '1' : '',
              })
            : buildOwnerTierDrillFilter(metrics, row.key, key, meta, row),
        });
      })
      .join('');
    return `
      <div class="tier-kpi-row${total ? ' is-total' : ''}" data-tier="${escapeHtml(row.key)}" style="--tier-metric-count:${metricKeys.length}">
        <div class="tier-kpi-row-label">${escapeHtml(row.label)}</div>
        ${cards}
      </div>
    `;
  };

  const totalRow = renderTierRow({ key: 'all', label: '总盘' }, totalMetrics, { total: true });
  const rowHtml = rows.map((row) => renderTierRow(row, tiers[row.key] || {})).join('');
  const detailsOpen = rows.length <= 3 ? ' open' : '';
  const scopeBreakdown = metrics.scopeBreakdown || {};
  const closedInScope = Number(scopeBreakdown.closedInScope || 0);
  const unbucketedInScope = Number(scopeBreakdown.unbucketedInScope || 0);
  const scopeBreakdownNote =
    closedInScope > 0 || unbucketedInScope > 0
      ? `
        <div class="tier-kpi-scope-note" data-scope-breakdown="owner-bucket-remainder">
          ${
            closedInScope > 0
              ? `<span>${escapeHtml(String(closedInScope))} 项已闭环仍在负责人范围，不计入进行中/未开始。</span>`
              : ''
          }
          ${
            unbucketedInScope > 0
              ? `<span>${escapeHtml(
                  String(unbucketedInScope)
                )} 项未归入进行中/未开始，请核对闭环、店态或责任身份。</span>`
              : ''
          }
        </div>
      `
      : '';

  board.innerHTML = `
    <div class="tier-kpi-table" style="--tier-metric-count:${metricKeys.length}">
      ${totalRow}
      ${scopeBreakdownNote}
      <details class="tier-kpi-details"${detailsOpen}>
        <summary>
          <span>分类明细</span>
          <small>${rows.length} 类店态</small>
        </summary>
        <div class="tier-kpi-detail-rows">
          ${rowHtml}
        </div>
      </details>
    </div>
  `;
  bindDashboardTooltips(board);
  return true;
}


export function renderLegacyTeamSummaryKpis(metrics) {
  const summary = metrics.summary || {};
  const insights = metrics.insights?.modules || {};
  const tooltips = metrics.tooltipCatalog || metrics.metricDefinitions || {};
  const coreItems = [
    { key: 'totalProjects', label: '团队项目总数', value: summary.totalProjects, insight: insights.summary, tone: 'teal', tooltip: tooltips.totalProjects },
    { key: 'activeProjects', label: '推进项目', value: summary.activeProjects, insight: '未完成状态的项目。', tone: 'green', tooltip: tooltips.activeProjects },
    { key: 'notStarted', label: '未开始', value: summary.notStarted, insight: '尚未进入明确执行节点。', tone: 'amber', tooltip: tooltips.notStarted },
    { key: 'delayedProjects', label: '延期项目', value: summary.delayedProjects, insight: insights.alerts, tone: 'coral', tooltip: tooltips.delayedProjects },
  ];
  elements.teamKpiGrid.hidden = false;
  elements.teamProgressGrid.hidden = false;
  elements.teamKpiGrid.innerHTML = renderInsightCards(coreItems);
  elements.teamProgressGrid.innerHTML = renderInsightCard({
    key: 'averageProgress',
    label: '平均进度',
    value: `${summary.averageProgress ?? 0}%`,
    insight: `${summary.highRiskProjects ?? 0} 个高风险项目需要关注。`,
    tone: 'teal',
    featured: true,
    tooltip: tooltips.averageProgress,
  });
  bindDashboardTooltips(elements.teamKpiGrid);
  bindDashboardTooltips(elements.teamProgressGrid);
}
