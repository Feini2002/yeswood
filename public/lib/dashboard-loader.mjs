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
  updatePageRefreshControl,
  isPageRefreshInFlight,
  setPageRefreshInFlight,
  setSyncMessage,
  isDashboardSyncEnabled,
  isDashboardAutoUpdateEnabled,
} from '../components/sync-controls.mjs';
import {
  renderDetailsViewTabs,
  renderProjectWorkbenchHead,
  renderProjectWorkbenchEmptyState,
  projectWorkbenchViewKey,
  renderTable,
} from '../components/project-workbench.mjs';
import { queueVisibleDrillPreload } from '../components/drill-preload.mjs';
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
  cachedTeamWorkCompletion,
  cachedOwnerReview,
  resolveTeamWorkCompletionYear,
  renderTeamWorkCompletionDashboard,
} from '../pages/teams.mjs';
import { DASHBOARD_UPDATE_CHECK_INTERVAL_MS, shouldReloadDashboard } from '../realtime.js';
import { resolveTeamPageDashboardContext } from './constants.mjs';
import { runtimeStore } from './runtime-flags.mjs';
import { LIFECYCLE_STAGE_ORDER } from '../dashboard/project-lifecycle.mjs';
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
import { queueTeamWorkCompletionDetailPreload } from '../pages/team-work-completion.mjs';
import { teamWorkCompletionHasDetail } from '../domain/team-work-completion-store.mjs';
import {
  currentCatalogSignature,
  fetchProjectCatalog,
  filterProjectsLocally,
  hasComplexProjectFilters,
  invalidateProjectCaches,
  preloadDrillProjects,
  resolveVisibleProjects,
} from '../domain/project-catalog.mjs';

const DASHBOARD_SESSION_PREPARING_RETRY_DELAYS_MS = globalThis.__PUBLIC_APP_TEST_HARNESS__
  ? [0]
  : [500, 1000, 2000, 4000];

function isDashboardSessionPreparing(payload) {
  return payload?.status === 'preparing' && !payload.snapshot;
}

function waitForDashboardSessionRetry(delayMs) {
  if (!delayMs) {
    return Promise.resolve();
  }
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

export function dashboardStatusPanel({ title, description = '', tone = 'neutral' } = {}) {
  const role = tone === 'error' ? 'alert' : 'status';
  return `
    <section class="dashboard-status-panel is-${escapeHtml(tone)}" role="${role}" aria-live="polite">
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
    if (elements.overviewSignalStrip) {
      elements.overviewSignalStrip.innerHTML = panel;
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


function hasVisibleDashboardData(pageId = currentPageId()) {
  if (pageId === 'teams') {
    return Boolean(
      state.teamMetrics?.owner ||
        state.teamWorkCompletion?.owner ||
        state.ownerReview?.owner
    );
  }
  if (pageId === 'details') {
    return Boolean(state.projects?.length || state.allProjects?.length);
  }
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


function dashboardSessionRequestContext(options = {}) {
  const route = parsePageHash();
  const explicitOwner = String(options.owner || '').trim();
  const owner = explicitOwner || (route.pageId === 'teams' ? route.owner || resolveTeamOwner() : '');
  const dashboardContext = resolveTeamPageDashboardContext(
    options.dashboardContext || route.dashboardContext || resolveTeamDashboardContext()
  );
  const year = Number(options.year || route.year || state.teamWorkCompletionYear || new Date().getFullYear());
  return { owner, dashboardContext, year };
}

function dashboardSessionUrl(options = {}) {
  const { owner, dashboardContext, year } = dashboardSessionRequestContext(options);
  const params = new URLSearchParams();
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

function cachedTeamDashboardSessionPayload({ owner = '', dashboardContext = 'all', year } = {}, { forceRefresh = false } = {}) {
  if (forceRefresh || !owner || !hasLoadedTeamSessionBundle(owner, dashboardContext, year)) {
    return null;
  }
  const metrics = state.teamMetricsByOwner?.[owner] || null;
  const workCompletion = cachedTeamWorkCompletion(owner, dashboardContext, year);
  const responsibilityReview = cachedOwnerReview(owner, dashboardContext);
  state.teamMetrics = metrics;
  state.teamMetricsLoading = false;
  state.teamMetricsError = '';
  state.teamWorkCompletion = workCompletion;
  state.teamWorkCompletionYear = Number(year) || state.teamWorkCompletionYear;
  state.teamWorkCompletionLoading = false;
  state.teamWorkCompletionError = '';
  state.ownerReview = responsibilityReview;
  state.ownerReviewLoading = false;
  state.ownerReviewError = '';
  state.selectedTeamOwner = owner;
  return {
    schemaVersion: 1,
    readOnly: true,
    snapshot: state.snapshot,
    metrics: state.metrics,
    departmentMetrics: state.profileMetrics?.department || null,
    projectCatalog: state.projectsCatalogLoaded
      ? { items: state.allProjects || [], fieldCatalog: state.fieldCatalog || [], view: 'summary', readOnly: true }
      : null,
    team: {
      owner,
      dashboardContext,
      year,
      metrics,
      workCompletion,
      responsibilityReview,
    },
  };
}

function mergeDepartmentMetrics(baseMetrics = null, dashboardMetrics = null) {
  if (!baseMetrics && !dashboardMetrics) {
    return null;
  }
  const merged = {
    ...(baseMetrics || {}),
    ...(dashboardMetrics || {}),
  };
  if (!merged.projectBoard && baseMetrics?.projectBoard) {
    merged.projectBoard = baseMetrics.projectBoard;
  }
  if (!merged.annualEntryStructure && baseMetrics?.annualEntryStructure) {
    merged.annualEntryStructure = baseMetrics.annualEntryStructure;
  }
  return merged;
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
  const baseDepartmentMetrics = payload.departmentMetrics || null;
  state.profileMetrics.department = baseDepartmentMetrics;
  state.annualEntryStructure = baseDepartmentMetrics?.annualEntryStructure || null;
  const profileDashboards = payload.profileDashboards || {};
  const loadedProfiles = { ...(state.profileDashboardLoaded || {}) };
  for (const profile of ['department', 'direct', 'franchise']) {
    const dashboard = profileDashboards[profile];
    if (!dashboard) {
      continue;
    }
    const metrics = dashboard.metrics || dashboard;
    if (profile === 'department') {
      const mergedDepartmentMetrics = mergeDepartmentMetrics(baseDepartmentMetrics, metrics || null);
      state.profileMetrics.department = mergedDepartmentMetrics;
      state.annualEntryStructure = mergedDepartmentMetrics?.annualEntryStructure || state.annualEntryStructure || null;
    } else {
      state.profileMetrics[profile] = metrics || null;
      state.profileProjects[profile] = Array.isArray(dashboard.projects) ? dashboard.projects : [];
    }
    loadedProfiles[profile] = true;
  }
  state.profileDashboardLoaded = loadedProfiles;
  const projectCatalog = payload.projectCatalog || {};
  if (Array.isArray(projectCatalog.items)) {
    state.allProjects = projectCatalog.items;
    state.fieldCatalog = Array.isArray(projectCatalog.fieldCatalog) ? projectCatalog.fieldCatalog : state.fieldCatalog;
    state.projectsCatalogLoaded = true;
    state.projectsCatalogSignature = nextCatalogSignature;
    const activeFilters = readFilters();
    if (!hasComplexProjectFilters(activeFilters)) {
      state.projects = filterProjectsLocally(state.allProjects, activeFilters);
    }
    invalidateProjectCaches({ catalog: false, drill: true, details: false });
  }
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
    const pageId = currentPageId();
    if ((pageId === 'overview' || pageId === 'teams') && !teamWorkCompletionHasDetail(team.workCompletion)) {
      queueTeamWorkCompletionDetailPreload(team.workCompletion, {
        reason: 'dashboard-session-missing-detail',
        allowCompute: false,
      });
    }
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

function hasLoadedTeamSessionBundle(owner, dashboardContext, year) {
  if (!owner) {
    return false;
  }
  const workCompletion = cachedTeamWorkCompletion(owner, dashboardContext, year);
  return Boolean(
    state.teamMetricsByOwner?.[owner] &&
      teamWorkCompletionHasDetail(workCompletion) &&
      workCompletion?.detailStatus === 'ready' &&
      cachedOwnerReview(owner, dashboardContext)
  );
}

function overviewLifecycleDrillPreloadKey() {
  const signature = currentCatalogSignature();
  const stageKeys = LIFECYCLE_STAGE_ORDER.map((stage) => stage.key).join(',');
  return signature ? `${signature}:${stageKeys}` : '';
}

function overviewLifecycleDrillFilters() {
  return LIFECYCLE_STAGE_ORDER.map((stage) => ({ lifecycleStage: stage.key }));
}

function queueOverviewLifecycleDrillPreload({ forceRefresh = false } = {}) {
  const cacheKey = overviewLifecycleDrillPreloadKey();
  if (!cacheKey) {
    return;
  }
  if (!forceRefresh && runtimeStore.overviewLifecycleDrillPreloadKey === cacheKey) {
    return;
  }

  runtimeStore.overviewLifecycleDrillPreloadKey = cacheKey;
  const request = preloadDrillProjects(overviewLifecycleDrillFilters(), { concurrency: 3 })
    .then((results) => {
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length) {
        runtimeStore.overviewLifecycleDrillPreloadKey = '';
      }
      return results;
    })
    .catch(() => {
      runtimeStore.overviewLifecycleDrillPreloadKey = '';
      return [];
    })
    .finally(() => {
      if (runtimeStore.overviewLifecycleDrillPreloadPromise === request) {
        runtimeStore.overviewLifecycleDrillPreloadPromise = null;
      }
    });
  runtimeStore.overviewLifecycleDrillPreloadPromise = request;
}


export async function loadDashboardSession(options = {}) {
  const requestContext = dashboardSessionRequestContext(options);
  const cachedPayload =
    parsePageHash().pageId === 'teams' ? cachedTeamDashboardSessionPayload(requestContext, options) : null;
  if (cachedPayload) {
    return cachedPayload;
  }
  const payload = await fetchJson(dashboardSessionUrl(options));
  if (typeof options.shouldApply === 'function' && !options.shouldApply(payload)) {
    return { status: 'stale', reason: 'scope-changed' };
  }
  if (isDashboardSessionPreparing(payload)) {
    return payload;
  }
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
  const year = resolveTeamWorkCompletionYear();
  if (!owner && !teamOwnerDirectoryReady()) {
    renderTeamDashboardLoading();
    renderTeamWorkCompletionLoading();
    return null;
  }
  if (!forceRefresh && hasLoadedTeamSessionBundle(owner, dashboardContext, year)) {
    state.teamMetrics = state.teamMetricsByOwner[owner];
    state.teamWorkCompletion = cachedTeamWorkCompletion(owner, dashboardContext, year);
    state.ownerReview = cachedOwnerReview(owner, dashboardContext);
    queueTeamWorkCompletionDetailPreload(state.teamWorkCompletion, {
      reason: 'team-page-cache',
      allowCompute: false,
    });
    console.info?.('Team page modules served from dashboard-session read model cache', {
      owner,
      dashboardContext,
      year,
    });
    renderTeamDashboard();
    renderTeamWorkCompletionDashboard();
    renderOwnerReviewDashboard();
    return {
      source: 'cache',
      owner,
      dashboardContext,
      year,
    };
  }
  void loadProjectCatalog({ force: forceRefresh }).catch((error) => {
    console.warn('Team page project catalog preload failed', error);
    return null;
  });
  const teamResult = await Promise.allSettled([
    loadTeamMetrics(owner, dashboardContext, { forceRefresh }),
    loadTeamWorkCompletion(owner, dashboardContext, undefined, { forceRefresh }),
    loadOwnerResponsibilityReview(owner, dashboardContext, { forceRefresh }),
  ]);
  const failedTeamLoad = teamResult.find((result) => result.status === 'rejected');
  if (failedTeamLoad && teamResult.every((result) => result.status === 'rejected')) {
    throw failedTeamLoad.reason;
  }
}


export async function loadDashboard(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const pageId = currentPageId();
  let sessionPayload = await loadDashboardSession(options);
  for (const delayMs of DASHBOARD_SESSION_PREPARING_RETRY_DELAYS_MS) {
    if (!isDashboardSessionPreparing(sessionPayload)) {
      break;
    }
    if (!hasVisibleDashboardData()) {
      renderDashboardStatusState('loading');
    }
    await waitForDashboardSessionRetry(delayMs);
    sessionPayload = await loadDashboardSession(options);
  }
  if (isDashboardSessionPreparing(sessionPayload)) {
    if (!hasVisibleDashboardData()) {
      renderDashboardStatusState('loading');
    }
    console.warn('Dashboard session read model is preparing', {
      reason: sessionPayload.reason || sessionPayload.status,
    });
    if (pageId === 'teams') {
      await loadTeamPageModules();
      renderTeamDashboard();
      renderTeamWorkCompletionDashboard();
      renderOwnerReviewDashboard();
      return true;
    }
    return false;
  }
  renderAll();
  if (pageId === 'overview') {
    queueOverviewLifecycleDrillPreload({ forceRefresh });
  }

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
    if (!forceRefresh && state.profileDashboardLoaded?.[pageId]) {
      renderProfilePage(pageId);
    } else {
      pageLoads.push(
        loadProfileDashboard(pageId, { forceRefresh }).then(() => renderProfilePage(pageId))
      );
    }
  }

  if (pageLoads.length) {
    await Promise.all(pageLoads);
  }
  return true;
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


export async function hardRefresh({ preserveVisibleData = true } = {}) {
  const showBlockingLoader = !preserveVisibleData || !hasVisibleDashboardData();
  if (showBlockingLoader) {
    renderDashboardStatusState('loading');
  }
  try {
    if (showBlockingLoader) {
      invalidateProjectCaches({ catalog: true, drill: true, details: true });
    }
    await loadDashboard({ forceRefresh: true, preserveVisibleData });
    return true;
  } catch (error) {
    if (showBlockingLoader) {
      renderDashboardStatusState('error', error);
    }
    setSyncMessage('刷新失败');
    return false;
  } finally {
    updateSyncControl();
    updatePageRefreshControl();
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


export async function refreshCurrentPage() {
  if (isPageRefreshInFlight()) {
    return false;
  }

  setPageRefreshInFlight(true);
  updatePageRefreshControl();
  setSyncMessage('刷新中');

  try {
    const refreshed = await hardRefresh({ preserveVisibleData: true });
    setSyncMessage(refreshed ? '已刷新' : '刷新失败');
    return refreshed;
  } catch (error) {
    console.warn('Page refresh failed', error);
    setSyncMessage('刷新失败');
    return false;
  } finally {
    setPageRefreshInFlight(false);
    updatePageRefreshControl();
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
    const loaded = await loadDashboard({ snapshot, forceRefresh: true, preserveVisibleData: true, background: true });
    setSyncMessage(loaded ? '已同步' : '读模型生成中');
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
      await loadDashboard({ snapshot: nextSnapshot, forceRefresh: true, preserveVisibleData: true, background: true });
    }
  } catch (error) {
    console.warn('Dashboard update check failed', error);
  } finally {
    runtimeStore.updateCheckInFlight = false;
  }
}


export function startAutoUpdateChecks() {
  if (runtimeStore.updateCheckTimer !== null) {
    return;
  }
  runtimeStore.updateCheckTimer = window.setInterval(checkForDashboardUpdate, DASHBOARD_UPDATE_CHECK_INTERVAL_MS);
  runtimeStore.updateCheckVisibilityHandler = () => {
    if (isDashboardVisible()) {
      checkForDashboardUpdate();
    }
  };
  document.addEventListener('visibilitychange', runtimeStore.updateCheckVisibilityHandler);
}

export function stopAutoUpdateChecks() {
  if (runtimeStore.updateCheckTimer !== null) {
    window.clearInterval(runtimeStore.updateCheckTimer);
    runtimeStore.updateCheckTimer = null;
  }
  if (runtimeStore.updateCheckVisibilityHandler) {
    document.removeEventListener('visibilitychange', runtimeStore.updateCheckVisibilityHandler);
    runtimeStore.updateCheckVisibilityHandler = null;
  }
  runtimeStore.updateCheckInFlight = false;
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
  updatePageRefreshControl();
  if (pageId !== 'overview') {
    queueVisibleDrillPreload();
  }
}
