import { state } from '../lib/state.mjs';
import { elements, setPanelInsight } from '../lib/dom.mjs';
import { escapeHtml, formatDateTime } from '../lib/format.mjs';
import { fetchJson, normalizeDashboardPayload } from '../lib/api.mjs';
import { currentPageId, applyDevelopmentDocumentationVisibility } from '../lib/router.mjs';
import { DASHBOARD_SYNC_ENDPOINT } from '../lib/api.mjs';
import { sourceDisplayLabel } from '../domain/metrics-display.mjs';
import {
  readFilters,
  toQuery,
  setOptions,
  enhanceProjectFilters,
  enhanceTeamOwnerSelect,
} from '../components/filter-bar.mjs';
import {
  updateSyncControl,
  updateAnalysisAgentControl,
  isAnalysisAgentInFlight,
  setAnalysisAgentInFlight,
  setSyncMessage,
  isDashboardSyncEnabled,
  isDashboardAutoUpdateEnabled,
  currentAnalysisAgentLabel,
} from '../components/sync-controls.mjs';
import {
  renderDetailsViewTabs,
  renderProjectWorkbenchHead,
  renderProjectWorkbenchEmptyState,
  projectWorkbenchViewKey,
  renderTable,
} from '../components/project-workbench.mjs';
import { hideProjectAssignmentAlert } from '../components/project-detail-modal.mjs';
import { renderOverviewDashboard } from '../pages/overview.mjs';
import {
  renderTeamDashboard,
  renderTeamDashboardError,
  renderTeamDashboardLoading,
  loadTeamMetrics,
  loadOwnerResponsibilityReview,
} from '../pages/teams.mjs';
import { DASHBOARD_UPDATE_CHECK_INTERVAL_MS, shouldReloadDashboard } from '../realtime.js';
import { runtimeStore } from './runtime-flags.mjs';
import {
  ensureTeamOwnerOptions,
  ensureOwnerReviewControls,
  resolveTeamOwner,
  resolveTeamDashboardContext,
  resolveOwnerReviewOwner,
  resolveOwnerReviewDashboardContext,
} from '../domain/personnel.mjs';
import { loadProfileMetrics, loadProfileDashboard, renderProfilePage } from '../pages/profile-shared.mjs';
import { renderOwnerReviewDashboard } from '../pages/owner-review.mjs';

export function dashboardStatusPanel({ title, description = '', tone = 'neutral' } = {}) {
  return `
    <section class="dashboard-status-panel is-${escapeHtml(tone)}">
      <div class="dashboard-status-mark" aria-hidden="true"></div>
      <div>
        <strong>${escapeHtml(title || '看板状态')}</strong>
        ${description ? `<p>${escapeHtml(description)}</p>` : ''}
      </div>
    </section>
  `;
}


export function renderDashboardStatusState(type = 'loading', error = null) {
  const isError = type === 'error';
  const panel = dashboardStatusPanel({
    title: isError ? '看板加载失败' : '正在加载看板数据',
    description: isError
      ? '本地服务或接口暂时不可用，请稍后重试；已保留当前页面结构，避免出现空白看板。'
      : '正在读取本地项目、指标和筛选条件。',
    tone: isError ? 'error' : 'loading',
  });
  const pageId = currentPageId();

  if (pageId === 'details') {
    renderDetailsViewTabs();
    hideProjectAssignmentAlert();
    renderProjectWorkbenchHead(projectWorkbenchViewKey());
    if (elements.tableTotal) {
      elements.tableTotal.textContent = isError ? '加载失败' : '加载中';
    }
    if (elements.projectWorkbenchRows) {
      elements.projectWorkbenchRows.innerHTML = isError ? renderProjectWorkbenchEmptyState('error') : renderProjectWorkbenchEmptyState('loading');
    }
  } else if (pageId === 'teams') {
    if (isError) {
      renderTeamDashboardError();
    } else {
      renderTeamDashboardLoading();
    }
  } else if (pageId === 'owner-review') {
    if (elements.ownerReviewResponsibilityMatrix) {
      elements.ownerReviewResponsibilityMatrix.innerHTML = panel;
    }
    if (elements.ownerReviewPersonRows) {
      elements.ownerReviewPersonRows.innerHTML = '';
    }
    if (elements.ownerReviewDetailRows) {
      elements.ownerReviewDetailRows.innerHTML = '';
    }
  } else if (pageId === 'franchise' || pageId === 'direct') {
    const target = pageId === 'franchise' ? elements.franchiseKpiGrid : elements.directKpiGrid;
    if (target) {
      target.innerHTML = panel;
    }
  } else {
    if (elements.overviewCommandCenter) {
      elements.overviewCommandCenter.innerHTML = panel;
    }
    if (elements.overviewSignalStrip) {
      elements.overviewSignalStrip.innerHTML = '';
    }
  }

  if (elements.kpiGrid) {
    elements.kpiGrid.hidden = false;
    elements.kpiGrid.innerHTML = panel;
  }
}


export async function loadDashboard(options = {}) {
  const filters = readFilters();
  const query = toQuery(filters);
  const snapshotRequest = options.snapshot ? Promise.resolve(options.snapshot) : fetchJson('/api/snapshot');
  const [snapshot, projects, metrics, fullMetrics, departmentMetrics] = await Promise.all([
    snapshotRequest,
    fetchJson(`/api/projects${query}`),
    fetchJson(`/api/metrics${query}`),
    fetchJson('/api/metrics'),
    loadProfileMetrics('department').catch(() => null),
  ]);
  const normalized = normalizeDashboardPayload({ snapshot, projects, metrics, fullMetrics, departmentMetrics });
  if (normalized.departmentMetrics) {
    state.profileMetrics.department = normalized.departmentMetrics;
    state.annualEntryStructure = normalized.departmentMetrics.annualEntryStructure || null;
  }

  state.filters = filters;
  state.snapshot = normalized.snapshot;
  state.personnelArchitecture = normalized.snapshot.personnelArchitecture || state.personnelArchitecture;
  state.projects = normalized.projects;
  state.fieldCatalog = normalized.fieldCatalog;
  state.metrics = normalized.metrics;
  state.fullMetrics = normalized.fullMetrics;
  state.pendingDetailsDrill = null;
  applyDevelopmentDocumentationVisibility();
  ensureTeamOwnerOptions();
  const pageId = currentPageId();
  if (pageId === 'teams') {
    ensureOwnerReviewControls();
    const owner = resolveTeamOwner();
    const dashboardContext = resolveTeamDashboardContext();
    const [teamResult] = await Promise.allSettled([
      loadTeamMetrics(owner, dashboardContext, { forceBatch: true }),
      loadOwnerResponsibilityReview(owner, dashboardContext),
    ]);
    if (teamResult.status === 'rejected') {
      throw teamResult.reason;
    }
  }
  if (pageId === 'owner-review') {
    ensureOwnerReviewControls();
    await loadOwnerResponsibilityReview(resolveOwnerReviewOwner(), resolveOwnerReviewDashboardContext());
  }
  if (pageId === 'franchise' || pageId === 'direct') {
    await loadProfileDashboard(pageId);
  }
  renderAll();
  if (pageId === 'franchise' || pageId === 'direct') {
    renderProfilePage(pageId);
  }
}


export async function loadFilters() {
  const filters = await fetchJson('/api/filters');
  setOptions(elements.provinceFilter, filters.provinces || []);
  setOptions(elements.businessTypeFilter, filters.businessTypes || []);
  setOptions(elements.storeStatusFilter, filters.storeStatuses || []);
  setOptions(elements.statusFilter, filters.statuses || []);
  enhanceProjectFilters();
  enhanceTeamOwnerSelect();
}


export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}


export async function refresh() {
  renderDashboardStatusState('loading');
  try {
    await loadDashboard();
    return true;
  } catch (error) {
    renderDashboardStatusState('error', error);
    setSyncMessage('刷新失败');
    return false;
  } finally {
    updateSyncControl();
    updateAnalysisAgentControl();
  }
}


export async function runAnalysisAgent() {
  if (isAnalysisAgentInFlight()) {
    return;
  }

  setAnalysisAgentInFlight(true);
  updateAnalysisAgentControl();
  setSyncMessage(`${currentAnalysisAgentLabel()}中`);

  try {
    const pageId = currentPageId();
    if (pageId === 'teams') {
      const owner = resolveTeamOwner();
      const dashboardContext = resolveTeamDashboardContext();
      const results = await Promise.allSettled([
        loadTeamMetrics(owner, dashboardContext),
        loadOwnerResponsibilityReview(owner, dashboardContext),
      ]);
      renderTeamDashboard();
      renderOwnerReviewDashboard();
      const failed = results.find((result) => result.status === 'rejected');
      if (failed && results.every((result) => result.status === 'rejected')) {
        throw failed.reason;
      }
    } else if (pageId === 'franchise' || pageId === 'direct') {
      await loadProfileDashboard(pageId);
      renderProfilePage(pageId);
    } else {
      await loadDashboard();
    }
    setSyncMessage('分析已刷新');
  } catch (error) {
    console.warn('Analysis Agent failed', error);
    setSyncMessage('分析失败');
  } finally {
    setAnalysisAgentInFlight(false);
    updateAnalysisAgentControl();
  }
}


export async function syncDingTalk() {
  if (!isDashboardSyncEnabled()) {
    setSyncMessage('同步未开启');
    return;
  }

  elements.syncButton.disabled = true;
  setSyncMessage('同步中');

  try {
    const snapshot = await fetchJson(DASHBOARD_SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-dashboard-action': 'sync',
      },
    });
    await loadDashboard({ snapshot });
    setSyncMessage('已同步');
  } catch (error) {
    console.warn('Dashboard sync failed', error);
    if (error.status === 429) {
      setSyncMessage('稍后再试');
    } else if (error.status === 403) {
      setSyncMessage('同步未开启');
    } else {
      setSyncMessage('同步失败');
    }
  } finally {
    updateSyncControl();
  }
}


export function isDashboardVisible() {
  return document.visibilityState !== 'hidden';
}


export async function checkForDashboardUpdate() {
  if (runtimeStore.updateCheckInFlight || !isDashboardVisible()) {
    return;
  }

  runtimeStore.updateCheckInFlight = true;
  try {
    const nextSnapshot = await fetchJson('/api/snapshot');
    if (shouldReloadDashboard(state.snapshot, nextSnapshot)) {
      await loadDashboard({ snapshot: nextSnapshot });
    }
  } catch (error) {
    console.warn('Dashboard update check failed', error);
  } finally {
    runtimeStore.updateCheckInFlight = false;
  }
}


export function startAutoUpdateChecks() {
  window.setInterval(checkForDashboardUpdate, DASHBOARD_UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (isDashboardVisible()) {
      checkForDashboardUpdate();
    }
  });
}


export function renderAll() {
  const { metrics, fullMetrics, projects, snapshot, fieldCatalog } = state;
  applyDevelopmentDocumentationVisibility();
  renderOverviewDashboard(metrics, state.profileMetrics.department, projects, snapshot);
  renderTable(projects);
  if (currentPageId() === 'teams') {
    renderTeamDashboard();
  }

  elements.sourceLabel.textContent = sourceDisplayLabel(snapshot.source);
  elements.syncedAt.textContent = formatDateTime(snapshot.syncedAt);
  updateSyncControl();
  updateAnalysisAgentControl();
}

