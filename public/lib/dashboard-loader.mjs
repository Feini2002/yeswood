import { state } from '../lib/state.mjs';
import { elements, setPanelInsight } from '../lib/dom.mjs';
import { escapeHtml, formatDateTime } from '../lib/format.mjs';
import { DASHBOARD_SESSION_ENDPOINT, DASHBOARD_SYNC_ENDPOINT, fetchJson, normalizeDashboardPayload } from '../lib/api.mjs';
import { currentPageId, parsePageHash, applyDevelopmentDocumentationVisibility } from '../lib/router.mjs';
import { sourceDisplayLabel } from '../domain/metrics-display.mjs';
import {
  readFilters,
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
  loadTeamWorkCompletion,
  loadOwnerResponsibilityReview,
  ensureTeamMetricsCacheContext,
  rememberTeamWorkCompletion,
  rememberOwnerReview,
  renderTeamWorkCompletionDashboard,
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
  teamOwnerDirectoryReady,
} from '../domain/personnel.mjs';
import { loadProfileMetrics, loadProfileDashboard, renderProfilePage } from '../pages/profile-shared.mjs';
import { renderOwnerReviewDashboard } from '../pages/owner-review.mjs';
import {
  currentCatalogSignature,
  fetchProjectCatalog,
  hasComplexProjectFilters,
  invalidateProjectCaches,
  resolveVisibleProjects,
} from '../domain/project-catalog.mjs';

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


function needsProjectCatalog(pageId = currentPageId()) {
  return pageId === 'overview' || pageId === 'details';
}


function hasVisibleDashboardData() {
  return Boolean(state.snapshot) && (Boolean(state.metrics) || Boolean(state.profileMetrics?.department));
}


export async function loadProjectCatalog({ force = false } = {}) {
  return fetchProjectCatalog({ force, view: 'summary' });
}


export async function applyVisibleProjects({ filters = readFilters() } = {}) {
  state.filters = filters;
  state.projects = await resolveVisibleProjects(filters);
  return state.projects;
}

function applyFilterOptions(filters = {}) {
  state.filters = filters || {};
  setOptions(elements.provinceFilter, filters.provinces || []);
  setOptions(elements.businessTypeFilter, filters.businessTypes || []);
  setOptions(elements.storeStatusFilter, filters.storeStatuses || []);
  setOptions(elements.statusFilter, filters.statuses || []);
  enhanceProjectFilters();
  enhanceTeamOwnerSelect();
}


function dashboardSessionUrl(options = {}) {
  const route = parsePageHash();
  const params = new URLSearchParams();
  const owner = options.owner || route.owner || resolveTeamOwner();
  const dashboardContext = options.dashboardContext || route.dashboardContext || resolveTeamDashboardContext() || 'all';
  const year = Number(options.year || route.year || state.teamWorkCompletionYear || new Date().getFullYear());
  if (owner) {
    params.set('owner', owner);
  }
  params.set('context', dashboardContext);
  if (Number.isFinite(year)) {
    params.set('year', String(year));
  }
  const query = params.toString();
  return query ? `${DASHBOARD_SESSION_ENDPOINT}?${query}` : DASHBOARD_SESSION_ENDPOINT;
}


export function applyDashboardSessionPayload(payload = {}) {
  const snapshot = payload.snapshot || {};
  const nextCatalogSignature = currentCatalogSignature(snapshot);
  if (state.projectsCatalogSignature && state.projectsCatalogSignature !== nextCatalogSignature) {
    invalidateProjectCaches({ catalog: true, drill: true, details: true });
  }

  state.snapshot = snapshot;
  state.personnelArchitecture = snapshot.personnelArchitecture || state.personnelArchitecture;
  state.metrics = payload.metrics || {};
  state.fullMetrics = payload.metrics || {};
  state.pendingDetailsDrill = null;
  state.profileMetrics.department = payload.departmentMetrics || null;
  state.annualEntryStructure = payload.departmentMetrics?.annualEntryStructure || null;
  applyFilterOptions(payload.filters || {});
  applyDevelopmentDocumentationVisibility();
  ensureTeamOwnerOptions();

  const team = payload.team || {};
  const owner = team.owner || team.metrics?.owner || team.workCompletion?.owner || team.responsibilityReview?.owner || '';
  const dashboardContext = team.dashboardContext || team.metrics?.dashboardContext || 'all';
  const year = Number(team.year || team.workCompletion?.year || state.teamWorkCompletionYear || new Date().getFullYear());
  if (owner && team.metrics) {
    ensureTeamMetricsCacheContext(dashboardContext);
    state.teamMetricsByOwner = {
      ...state.teamMetricsByOwner,
      [owner]: team.metrics,
    };
    state.teamMetrics = team.metrics;
    state.teamMetricsLoading = false;
    state.teamMetricsError = '';
    state.selectedTeamOwner = owner;
  }
  if (owner && team.workCompletion) {
    state.teamWorkCompletion = team.workCompletion;
    state.teamWorkCompletionYear = year;
    state.teamWorkCompletionLoading = false;
    state.teamWorkCompletionError = '';
    state.teamWorkCompletionRefreshStatus = '';
    state.teamWorkCompletionRefreshError = '';
    rememberTeamWorkCompletion(team.workCompletion, owner, dashboardContext, year);
  }
  if (owner && team.responsibilityReview) {
    state.ownerReview = team.responsibilityReview;
    state.ownerReviewLoading = false;
    state.ownerReviewError = '';
    state.ownerReviewRefreshStatus = '';
    state.ownerReviewRefreshError = '';
    rememberOwnerReview(team.responsibilityReview, owner, dashboardContext);
  }
  return payload;
}


export async function loadDashboardSession(options = {}) {
  const payload = await fetchJson(dashboardSessionUrl(options));
  return applyDashboardSessionPayload(payload);
}


export async function loadCoreDashboard(options = {}) {
  const snapshotRequest = options.snapshot ? Promise.resolve(options.snapshot) : fetchJson('/api/snapshot');
  const [snapshot, metrics, departmentMetrics] = await Promise.all([
    snapshotRequest,
    fetchJson('/api/metrics'),
    loadProfileMetrics('department').catch(() => null),
  ]);
  const normalized = normalizeDashboardPayload({ snapshot, projects: {}, metrics, departmentMetrics });
  if (normalized.departmentMetrics) {
    state.profileMetrics.department = normalized.departmentMetrics;
    state.annualEntryStructure = normalized.departmentMetrics.annualEntryStructure || null;
  }

  const nextCatalogSignature = currentCatalogSignature(normalized.snapshot);
  if (state.projectsCatalogSignature && state.projectsCatalogSignature !== nextCatalogSignature) {
    invalidateProjectCaches({ catalog: true, drill: true, details: true });
  }

  state.snapshot = normalized.snapshot;
  state.personnelArchitecture = normalized.snapshot.personnelArchitecture || state.personnelArchitecture;
  state.metrics = normalized.metrics;
  state.fullMetrics = normalized.metrics;
  state.pendingDetailsDrill = null;
  applyDevelopmentDocumentationVisibility();
  ensureTeamOwnerOptions();
  return normalized;
}


export async function loadTeamPageModules({ forceRefresh = false } = {}) {
  const owner = resolveTeamOwner();
  const dashboardContext = resolveTeamDashboardContext();
  if (!owner && !teamOwnerDirectoryReady()) {
    renderTeamDashboardLoading();
    renderTeamWorkCompletionLoading();
    return null;
  }
  const catalogPromise = loadProjectCatalog({ force: forceRefresh }).catch((error) => {
    console.warn('Team page project catalog preload failed', error);
    return null;
  });
  const teamResult = await Promise.allSettled([
    loadTeamMetrics(owner, dashboardContext, { forceRefresh }),
    loadTeamWorkCompletion(owner, dashboardContext, undefined, { forceRefresh }),
    loadOwnerResponsibilityReview(owner, dashboardContext, { forceRefresh }),
  ]);
  await catalogPromise;
  const failedTeamLoad = teamResult.find((result) => result.status === 'rejected');
  if (failedTeamLoad && teamResult.every((result) => result.status === 'rejected')) {
    throw failedTeamLoad.reason;
  }
}


export async function loadDashboard(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const pageId = currentPageId();
  await loadDashboardSession(options);
  renderAll();

  const catalogPromise =
    needsProjectCatalog(pageId) && (!state.projectsCatalogLoaded || forceRefresh)
      ? loadProjectCatalog({ force: forceRefresh })
      : null;
  const pageLoads = [];

  if (needsProjectCatalog(pageId)) {
    pageLoads.push(
      (catalogPromise || Promise.resolve(state.allProjects))
        .then(() => applyVisibleProjects())
        .then(() => renderAll())
    );
  }

  if (pageId === 'teams') {
    ensureOwnerReviewControls();
    renderTeamDashboard();
    renderTeamWorkCompletionDashboard();
    renderOwnerReviewDashboard();
  } else if (catalogPromise) {
    catalogPromise
      .then(() => applyVisibleProjects())
      .catch((error) => {
        console.warn('Background project catalog preload failed', error);
      });
  }
  if (pageId === 'owner-review') {
    ensureOwnerReviewControls();
    pageLoads.push(
      loadOwnerResponsibilityReview(resolveOwnerReviewOwner(), resolveOwnerReviewDashboardContext(), {
        forceRefresh,
      }).then(() => renderOwnerReviewDashboard())
    );
  }
  if (pageId === 'franchise' || pageId === 'direct') {
    pageLoads.push(
      loadProfileDashboard(pageId, { forceRefresh }).then(() => renderProfilePage(pageId))
    );
  }

  if (pageLoads.length) {
    await Promise.all(pageLoads);
  }
}


export async function softRefresh() {
  const pageId = currentPageId();
  try {
    if (pageId === 'details' || pageId === 'overview') {
      const filters = readFilters();
      if (!state.projectsCatalogLoaded && !hasComplexProjectFilters(filters)) {
        await loadProjectCatalog();
      }
      await applyVisibleProjects({ filters });
      renderAll();
      return true;
    }
    if (pageId === 'teams') {
      renderTeamDashboard();
      renderTeamWorkCompletionDashboard();
      renderOwnerReviewDashboard();
      return true;
    }
    renderAll();
    return true;
  } catch (error) {
    console.warn('Soft refresh failed', error);
    return false;
  }
}


export async function hardRefresh() {
  const showBlockingLoader = !hasVisibleDashboardData();
  if (showBlockingLoader) {
    renderDashboardStatusState('loading');
  }
  try {
    if (showBlockingLoader) {
      invalidateProjectCaches({ catalog: true, drill: true, details: true });
    }
    await loadDashboard({ forceRefresh: true });
    return true;
  } catch (error) {
    if (showBlockingLoader) {
      renderDashboardStatusState('error', error);
    }
    setSyncMessage('刷新失败');
    return false;
  } finally {
    updateSyncControl();
    updateAnalysisAgentControl();
  }
}


export async function loadFilters() {
  const filters = await fetchJson('/api/filters');
  applyFilterOptions(filters);
}


export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}


export async function refresh() {
  return hardRefresh();
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
      const results = await Promise.allSettled([
        loadTeamPageModules({ forceRefresh: true }),
      ]);
      renderTeamDashboard();
      renderTeamWorkCompletionDashboard();
      renderOwnerReviewDashboard();
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) {
        throw failed.reason;
      }
    } else if (pageId === 'franchise' || pageId === 'direct') {
      await loadProfileDashboard(pageId, { forceRefresh: true });
      renderProfilePage(pageId);
    } else {
      await loadCoreDashboard();
      if (needsProjectCatalog(pageId)) {
        await loadProjectCatalog({ force: true });
        await applyVisibleProjects();
      }
      renderAll();
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
    invalidateProjectCaches({ catalog: true, drill: true, details: true });
    await loadDashboard({ snapshot, forceRefresh: true });
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
      invalidateProjectCaches({ catalog: true, drill: true, details: true });
      await loadDashboard({ snapshot: nextSnapshot, forceRefresh: true });
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
  const { metrics, projects, snapshot } = state;
  const pageId = currentPageId();
  applyDevelopmentDocumentationVisibility();

  if (pageId === 'overview') {
    renderOverviewDashboard(metrics, state.profileMetrics.department, projects, snapshot);
  } else if (pageId === 'details') {
    renderTable(projects);
  } else if (pageId === 'teams') {
    renderTeamDashboard();
  }

  elements.sourceLabel.textContent = sourceDisplayLabel(snapshot.source);
  elements.syncedAt.textContent = formatDateTime(snapshot.syncedAt);
  updateSyncControl();
  updateAnalysisAgentControl();
}
