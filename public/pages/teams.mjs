import { state } from '../lib/state.mjs';
import { bindDashboardTooltips, elements, setPanelInsight } from '../lib/dom.mjs';
import { escapeHtml, displayOrDash, formatDate } from '../lib/format.mjs';
import { bindTooltipTriggers, hideTooltip, tooltipDataAttr } from '../dashboard/tooltip.mjs';
import { renderEmptyState } from '../dashboard/empty-state.mjs';
import { renderInsightCards } from '../dashboard/insight-card.mjs';
import { mountAnnualEntryStructure } from '../dashboard/annual-entry-structure.mjs';
import {
  DASHBOARD_SESSION_ENDPOINT,
  DASHBOARD_METRICS_ENDPOINT,
  TEAM_METRICS_ENDPOINT,
  TEAM_METRICS_BATCH_ENDPOINT,
  TEAM_RESPONSIBILITY_REVIEW_ENDPOINT,
  TEAM_WORK_COMPLETION_ENDPOINT,
  fetchJson,
} from '../lib/api.mjs';
import { currentPageId, ownerReviewModuleVisible, parsePageHash } from '../lib/router.mjs';
import {
  resolveTeamOwner,
  resolveTeamDashboardContext,
  resolveOwnerReviewOwner,
  resolveOwnerReviewDashboardContext,
  ensureTeamOwnerOptions,
  teamOwnerOptions,
  teamOwnerDirectoryReady,
} from '../domain/personnel.mjs';
import {
  ownerTierRows,
  formatMetricValue,
  riskClass,
  buildOwnerTierDrillFilter,
  metricDefinitionTooltip,
} from '../domain/metrics-display.mjs';
import { renderTeamHeroStat } from '../components/team-hero-stat.mjs';
import { renderLegacyTeamSummaryKpis, renderOwnerMonthlyTierBoard } from '../components/drill-modal.mjs';
import {
  renderOwnerReviewDashboard,
  closeOwnerReviewMemberModal,
  closeOwnerReviewDecisionModal,
  ownerReviewVisibleReview,
  ownerReviewPreferredPersonName,
} from './owner-review.mjs';
import {
  closeTeamCompletionMemberModal,
  handleTeamCompletionFilterClick,
  handleTeamCompletionGroupGridClick,
  handleTeamCompletionMemberClick,
  handleTeamCompletionMemberModalClick,
  handleTeamCompletionMemberModalKeydown,
  handleTeamCompletionMonthClick,
  openTeamCompletionGroupModal,
  openTeamCompletionMemberModal,
  openTeamCompletionMonthModal,
  queueTeamWorkCompletionDetailPreload,
  renderTeamWorkCompletionDashboard,
  renderTeamWorkCompletionError,
  renderTeamWorkCompletionLoading,
  syncTeamCompletionControls,
} from './team-work-completion.mjs';
import {
  cachedTeamWorkCompletion as cachedStoredTeamWorkCompletion,
  rememberTeamWorkCompletion as rememberStoredTeamWorkCompletion,
  pruneTeamWorkCompletionCache as pruneStoredTeamWorkCompletionCache,
  teamWorkCompletionCacheKey as storedTeamWorkCompletionCacheKey,
} from '../domain/team-work-completion-store.mjs';
import { runtimeStore } from '../lib/runtime-flags.mjs';
import { teamOwnerDisplayName } from '../domain/personnel.mjs';
import { OWNER_REVIEW_CACHE_LIMIT, TEAM_OWNER_STORAGE_KEY } from '../lib/constants.mjs';
import { enhanceTeamOwnerSelect, renderFilterSelect } from '../components/filter-bar.mjs';
import { closeProjectDetailModal } from '../components/project-detail-modal.mjs';

const OWNER_REVIEW_FETCH_TIMEOUT_MS = 90_000;

export {
  closeTeamCompletionMemberModal,
  handleTeamCompletionFilterClick,
  handleTeamCompletionGroupGridClick,
  handleTeamCompletionMemberClick,
  handleTeamCompletionMemberModalClick,
  handleTeamCompletionMemberModalKeydown,
  handleTeamCompletionMonthClick,
  openTeamCompletionGroupModal,
  openTeamCompletionMemberModal,
  openTeamCompletionMonthModal,
  renderTeamWorkCompletionDashboard,
  renderTeamWorkCompletionError,
  renderTeamWorkCompletionLoading,
};

export function resetOwnerReviewViewState() {
  state.ownerReviewSearchQuery = '';
  state.ownerReviewLoadFilter = 'all';
  state.ownerReviewSelectedGroup = '';
  state.ownerReviewExpandedIdleGroups = {};
  state.ownerReviewDecisionModalType = '';
  state.selectedOwnerReviewPerson = '';
  state.selectedOwnerReviewMember = '';
  state.ownerReviewMemberFilter = 'all';
}


export function resetOwnerReviewForTeamOwnerChange() {
  resetOwnerReviewViewState();
  closeTeamCompletionMemberModal();
  closeOwnerReviewMemberModal();
  closeOwnerReviewDecisionModal();
}


export function ownerReviewSnapshotCacheKey(snapshot = state.snapshot) {
  return [
    snapshot?.source || '',
    snapshot?.storage || '',
    snapshot?.syncedAt || '',
    snapshot?.totalRecords ?? '',
    snapshot?.ignoredRecords ?? '',
  ].join('|');
}


export function ownerReviewCacheKey(owner = resolveOwnerReviewOwner(), dashboardContext = resolveOwnerReviewDashboardContext()) {
  return `${ownerReviewSnapshotCacheKey()}:${teamMetricsContextKey(dashboardContext)}:${owner || ''}`;
}


export function cachedOwnerReview(owner = resolveOwnerReviewOwner(), dashboardContext = resolveOwnerReviewDashboardContext()) {
  return state.ownerReviewByKey?.[ownerReviewCacheKey(owner, dashboardContext)] || null;
}


function abortPendingOwnerReviewRequests() {
  for (const entry of runtimeStore.ownerReviewRequestPromises.values()) {
    entry.controller?.abort?.();
  }
}


export function rememberOwnerReview(payload, owner = payload?.owner || '', dashboardContext = payload?.dashboardContext || 'all') {
  if (!payload?.owner && !owner) {
    return;
  }
  const requestedKey = ownerReviewCacheKey(owner || payload.owner, dashboardContext);
  const canonicalKey = ownerReviewCacheKey(payload.owner || owner, dashboardContext);
  state.ownerReviewByKey = {
    ...state.ownerReviewByKey,
    [requestedKey]: payload,
    [canonicalKey]: payload,
  };
  pruneOwnerReviewCache();
}


export function pruneOwnerReviewCache(maxEntries = OWNER_REVIEW_CACHE_LIMIT) {
  const entries = Object.entries(state.ownerReviewByKey || {});
  if (entries.length <= maxEntries) {
    return;
  }
  state.ownerReviewByKey = Object.fromEntries(entries.slice(entries.length - maxEntries));
}

export function resolveTeamWorkCompletionYear() {
  const routeYear = Number(parsePageHash().year || 0);
  if (Number.isFinite(routeYear) && routeYear >= 2000 && routeYear <= 2100) {
    return routeYear;
  }
  return Number(state.teamWorkCompletionYear || new Date().getFullYear());
}


export function teamWorkCompletionCacheKey(
  owner = resolveTeamOwner(),
  dashboardContext = resolveTeamDashboardContext(),
  year = resolveTeamWorkCompletionYear()
) {
  return storedTeamWorkCompletionCacheKey(owner, dashboardContext, year);
}


export function cachedTeamWorkCompletion(
  owner = resolveTeamOwner(),
  dashboardContext = resolveTeamDashboardContext(),
  year = resolveTeamWorkCompletionYear()
) {
  return cachedStoredTeamWorkCompletion(owner, dashboardContext, year);
}


export function rememberTeamWorkCompletion(
  payload,
  owner = payload?.owner || '',
  dashboardContext = payload?.dashboardContext || 'all',
  year = payload?.year || resolveTeamWorkCompletionYear()
) {
  rememberStoredTeamWorkCompletion(payload, owner, dashboardContext, year);
}


export function pruneTeamWorkCompletionCache(maxEntries) {
  pruneStoredTeamWorkCompletionCache(maxEntries);
}


export async function loadTeamDashboardSessionBundle(
  owner = resolveTeamOwner(),
  dashboardContext = resolveTeamDashboardContext() || 'all',
  year = resolveTeamWorkCompletionYear()
) {
  if (!owner) {
    return null;
  }
  const normalizedYear = Number(year) || new Date().getFullYear();
  const params = new URLSearchParams();
  params.set('owner', owner);
  params.set('context', dashboardContext || 'all');
  params.set('year', String(normalizedYear));
  const payload = await fetchJson(`${DASHBOARD_SESSION_ENDPOINT}?${params}`, { timeoutMs: 15_000 });
  if (payload?.status === 'preparing' && !payload.team) {
    state.selectedTeamOwner = owner;
    state.teamWorkCompletionRefreshStatus = 'preparing';
    state.teamWorkCompletionRefreshError = payload.reason || '';
    return {
      status: 'preparing',
      reason: payload.reason || payload.status,
      metrics: null,
      workCompletion: null,
      responsibilityReview: null,
    };
  }
  if (payload.snapshot) {
    state.snapshot = payload.snapshot;
    state.personnelArchitecture = payload.snapshot.personnelArchitecture || state.personnelArchitecture;
  }
  if (payload.metrics) {
    state.metrics = payload.metrics;
    state.fullMetrics = payload.metrics;
    ensureTeamOwnerOptions();
  }
  const team = payload.team || {};
  const canonicalOwner =
    team.owner || team.metrics?.owner || team.workCompletion?.owner || team.responsibilityReview?.owner || owner;
  const contextKey = team.dashboardContext || dashboardContext || 'all';
  const teamYear = Number(team.year || team.workCompletion?.year || normalizedYear);
  if (team.metrics) {
    ensureTeamMetricsCacheContext(contextKey);
    state.teamMetricsByOwner = {
      ...state.teamMetricsByOwner,
      [owner]: team.metrics,
      [canonicalOwner]: team.metrics,
    };
    state.teamMetrics = team.metrics;
    state.teamMetricsLoading = false;
    state.teamMetricsError = '';
  }
  if (team.workCompletion) {
    rememberTeamWorkCompletion(team.workCompletion, owner, contextKey, teamYear);
    state.teamWorkCompletion = team.workCompletion;
    state.teamWorkCompletionYear = teamYear;
    state.teamWorkCompletionLoading = false;
    state.teamWorkCompletionError = '';
    state.teamWorkCompletionRefreshStatus = '';
    state.teamWorkCompletionRefreshError = '';
    state.teamWorkCompletionSwitchTarget = '';
    queueTeamWorkCompletionDetailPreload(team.workCompletion, {
      reason: 'dashboard-session',
      allowCompute: false,
    });
  }
  if (team.responsibilityReview) {
    rememberOwnerReview(team.responsibilityReview, owner, contextKey);
    state.ownerReview = team.responsibilityReview;
    state.ownerReviewLoading = false;
    state.ownerReviewError = '';
    state.ownerReviewRefreshStatus = '';
    state.ownerReviewRefreshError = '';
  }
  state.selectedTeamOwner = canonicalOwner;
  localStorage.setItem(TEAM_OWNER_STORAGE_KEY, canonicalOwner);
  return {
    metrics: team.metrics || null,
    workCompletion: team.workCompletion || null,
    responsibilityReview: team.responsibilityReview || null,
  };
}


function abortPendingTeamWorkCompletionRequests() {
  for (const entry of runtimeStore.teamWorkCompletionRequestPromises.values()) {
    entry.controller?.abort?.();
  }
}


export function teamMetricsOwnerList(owner = resolveTeamOwner()) {
  const owners = teamOwnerOptions().map((item) => item.owner).filter(Boolean);
  if (owner && !owners.includes(owner)) {
    owners.unshift(owner);
  }
  return Array.from(new Set(owners));
}


export function teamMetricsContextKey(dashboardContext = resolveTeamDashboardContext()) {
  return dashboardContext || 'all';
}


export function teamMetricsBatchRequestKey(dashboardContext = resolveTeamDashboardContext(), owners = teamMetricsOwnerList()) {
  return `${teamMetricsContextKey(dashboardContext)}:${owners.join('|')}`;
}


export function ensureTeamMetricsCacheContext(dashboardContext = resolveTeamDashboardContext(), { force = false } = {}) {
  const contextKey = teamMetricsContextKey(dashboardContext);
  if (force || state.teamMetricsBatchKey !== contextKey) {
    state.teamMetricsByOwner = {};
    state.teamMetricsBatchKey = contextKey;
    runtimeStore.teamMetricsBatchPromises = new Map();
    runtimeStore.teamMetricsCacheGeneration += 1;
    runtimeStore.teamMetricsPreloadToken += 1;
    if (runtimeStore.teamMetricsPreloadTimer) {
      clearTimeout(runtimeStore.teamMetricsPreloadTimer);
      runtimeStore.teamMetricsPreloadTimer = null;
    }
  }
  return contextKey;
}


export function normalizeTeamMetricsByOwner(payload = {}, requestedOwners = []) {
  const metricsByOwner = payload.metricsByOwner || {};
  const normalized = { ...metricsByOwner };
  const responseOwners = Array.isArray(payload.owners) ? payload.owners : Object.keys(metricsByOwner);

  requestedOwners.forEach((requestedOwner, index) => {
    if (!requestedOwner || normalized[requestedOwner]) {
      return;
    }
    const responseOwner = responseOwners[index];
    const metrics = metricsByOwner[responseOwner];
    if (metrics) {
      normalized[requestedOwner] = metrics;
    }
  });

  for (const metrics of Object.values(metricsByOwner)) {
    if (metrics?.owner && !normalized[metrics.owner]) {
      normalized[metrics.owner] = metrics;
    }
  }

  return normalized;
}


export async function loadTeamMetricsBatch(
  dashboardContext = resolveTeamDashboardContext(),
  owners = teamMetricsOwnerList(),
  { force = false, background = false } = {}
) {
  const contextKey = ensureTeamMetricsCacheContext(dashboardContext, { force });
  const generation = runtimeStore.teamMetricsCacheGeneration;
  const uniqueOwners = Array.from(new Set(owners.filter(Boolean)));
  if (!uniqueOwners.length) {
    return state.teamMetricsByOwner;
  }

  const cacheKey = teamMetricsBatchRequestKey(contextKey, uniqueOwners);
  const hasAllOwners = uniqueOwners.every((owner) => state.teamMetricsByOwner?.[owner]);
  if (!force && hasAllOwners) {
    return state.teamMetricsByOwner;
  }
  if (!force && runtimeStore.teamMetricsBatchPromises.has(cacheKey)) {
    return runtimeStore.teamMetricsBatchPromises.get(cacheKey);
  }

  dashboardContext = contextKey;
  const params = new URLSearchParams();
  params.set('context', dashboardContext);
  for (const owner of uniqueOwners) {
    params.append('owner', owner);
  }

  if (!background) {
    state.teamMetricsBatchLoading = true;
  }
  const promise = fetchJson(`${TEAM_METRICS_BATCH_ENDPOINT}?${params}`, { timeoutMs: 60_000 })
    .then((payload) => {
      if (generation !== runtimeStore.teamMetricsCacheGeneration || state.teamMetricsBatchKey !== contextKey) {
        return state.teamMetricsByOwner;
      }
      const metricsByOwner = normalizeTeamMetricsByOwner(payload, uniqueOwners);
      state.teamMetricsByOwner = {
        ...state.teamMetricsByOwner,
        ...metricsByOwner,
      };
      state.teamMetricsBatchKey = contextKey;
      if (!background) {
        state.teamMetricsBatchLoading = false;
      }
      return state.teamMetricsByOwner;
    })
    .catch((error) => {
      if (!background && generation === runtimeStore.teamMetricsCacheGeneration && state.teamMetricsBatchKey === contextKey) {
        state.teamMetricsBatchLoading = false;
      }
      throw error;
    })
    .finally(() => {
      if (runtimeStore.teamMetricsBatchPromises.get(cacheKey) === promise) {
        runtimeStore.teamMetricsBatchPromises.delete(cacheKey);
      }
    });

  runtimeStore.teamMetricsBatchPromises.set(cacheKey, promise);
  return promise;
}


export function cancelTeamMetricsPreload() {
  runtimeStore.teamMetricsPreloadToken += 1;
  if (runtimeStore.teamMetricsPreloadTimer) {
    clearTimeout(runtimeStore.teamMetricsPreloadTimer);
    runtimeStore.teamMetricsPreloadTimer = null;
  }
}


export function cancelTeamWorkCompletionPreload() {
  runtimeStore.teamWorkCompletionPreloadToken += 1;
  if (runtimeStore.teamWorkCompletionPreloadTimer) {
    clearTimeout(runtimeStore.teamWorkCompletionPreloadTimer);
    runtimeStore.teamWorkCompletionPreloadTimer = null;
  }
}


export function scheduleTeamWorkCompletionPreload(
  dashboardContext = resolveTeamDashboardContext(),
  priorityOwner = resolveTeamOwner(),
  year = resolveTeamWorkCompletionYear()
) {
  const normalizedYear = Number(year) || new Date().getFullYear();
  const owners = teamMetricsOwnerList(priorityOwner).filter(
    (owner) =>
      owner &&
      owner !== priorityOwner &&
      !cachedTeamWorkCompletion(owner, dashboardContext, normalizedYear)
  );
  if (!owners.length) {
    return;
  }

  cancelTeamWorkCompletionPreload();
  const token = runtimeStore.teamWorkCompletionPreloadToken;
  let index = 0;

  const runNext = () => {
    if (token !== runtimeStore.teamWorkCompletionPreloadToken) {
      return;
    }
    const owner = owners[index];
    index += 1;
    if (!owner) {
      return;
    }
    loadTeamWorkCompletion(owner, dashboardContext, normalizedYear, { background: true }).catch((error) => {
      console.warn('Team work completion background preload failed', error);
    });
    if (index < owners.length && token === runtimeStore.teamWorkCompletionPreloadToken) {
      runtimeStore.teamWorkCompletionPreloadTimer = setTimeout(runNext, 1500);
    }
  };

  runtimeStore.teamWorkCompletionPreloadTimer = setTimeout(runNext, 2500);
}


export function scheduleTeamMetricsPreload(dashboardContext = resolveTeamDashboardContext(), priorityOwner = resolveTeamOwner()) {
  const contextKey = ensureTeamMetricsCacheContext(dashboardContext);
  const owners = teamMetricsOwnerList(priorityOwner).filter(
    (owner) => owner && owner !== priorityOwner && !state.teamMetricsByOwner?.[owner]
  );
  if (!owners.length) {
    return;
  }

  runtimeStore.teamMetricsPreloadToken += 1;
  const token = runtimeStore.teamMetricsPreloadToken;
  let index = 0;
  if (runtimeStore.teamMetricsPreloadTimer) {
    clearTimeout(runtimeStore.teamMetricsPreloadTimer);
  }

  const runNextChunk = async () => {
    if (token !== runtimeStore.teamMetricsPreloadToken || state.teamMetricsBatchKey !== contextKey) {
      return;
    }
    const chunk = owners.slice(index, index + 2).filter((owner) => !state.teamMetricsByOwner?.[owner]);
    index += 2;
    if (chunk.length) {
      try {
        await loadTeamMetricsBatch(contextKey, chunk, { background: true });
      } catch (error) {
        console.warn('Team metrics background preload failed', error);
      }
    }
    if (index < owners.length && token === runtimeStore.teamMetricsPreloadToken) {
      runtimeStore.teamMetricsPreloadTimer = setTimeout(runNextChunk, 1200);
    }
  };

  runtimeStore.teamMetricsPreloadTimer = setTimeout(runNextChunk, 1800);
}


export async function loadTeamMetrics(
  owner = resolveTeamOwner(),
  dashboardContext = resolveTeamDashboardContext(),
  { forceBatch = false, forceRefresh = false } = {}
) {
  if (!owner) {
    state.teamMetrics = null;
    state.teamMetricsLoading = false;
    state.teamMetricsError = '';
    state.selectedTeamOwner = '';
    return null;
  }

  const requestId = ++runtimeStore.teamMetricsRequestId;
  const force = Boolean(forceBatch || forceRefresh);
  const previousMetrics = state.teamMetrics?.owner ? state.teamMetrics : null;
  ensureTeamMetricsCacheContext(dashboardContext, { force });
  const cachedMetrics = state.teamMetricsByOwner?.[owner] || null;
  const staleMetrics = !cachedMetrics && !force ? previousMetrics : null;
  const visibleMetrics = cachedMetrics || staleMetrics;
  state.teamMetrics = visibleMetrics || null;
  state.teamMetricsLoading = !visibleMetrics;
  state.teamMetricsError = '';
  state.selectedTeamOwner = owner;
  if (cachedMetrics) {
    localStorage.setItem(TEAM_OWNER_STORAGE_KEY, cachedMetrics.owner || owner);
  }
  if (currentPageId() === 'teams' && !staleMetrics) {
    renderTeamDashboard();
  }
  if (cachedMetrics && !force) {
    scheduleTeamMetricsPreload(dashboardContext, cachedMetrics.owner || owner);
    return cachedMetrics;
  }

  try {
    const metricsByOwner = await loadTeamMetricsBatch(dashboardContext, [owner], { force });
    if (requestId !== runtimeStore.teamMetricsRequestId) {
      return null;
    }
    const metrics = metricsByOwner[owner] || null;
    if (!metrics) {
      throw new Error('Team metrics owner payload missing');
    }
    const canonicalOwner = metrics.owner || owner;
    state.teamMetrics = metrics;
    state.teamMetricsLoading = false;
    state.teamMetricsError = '';
    state.selectedTeamOwner = canonicalOwner;
    localStorage.setItem(TEAM_OWNER_STORAGE_KEY, canonicalOwner);
    if (canonicalOwner !== owner) {
      ensureTeamOwnerOptions();
    }
    if (currentPageId() === 'teams') {
      renderTeamDashboard();
    }
    scheduleTeamMetricsPreload(dashboardContext, canonicalOwner);
    return metrics;
  } catch (error) {
    if (requestId !== runtimeStore.teamMetricsRequestId) {
      return null;
    }
    if (staleMetrics) {
      state.teamMetrics = staleMetrics;
      state.teamMetricsLoading = false;
      state.teamMetricsError = error?.message || 'Team metrics refresh failed';
      state.selectedTeamOwner = owner;
      return staleMetrics;
    }
    state.teamMetrics = null;
    state.teamMetricsLoading = false;
    state.teamMetricsError = error?.message || 'Team metrics load failed';
    state.selectedTeamOwner = owner;
    if (currentPageId() === 'teams') {
      renderTeamDashboardError();
    }
    throw error;
  }
}


export async function loadTeamWorkCompletion(
  owner = resolveTeamOwner(),
  dashboardContext = resolveTeamDashboardContext(),
  year = resolveTeamWorkCompletionYear(),
  { forceRefresh = false, background = false } = {}
) {
  if (!owner) {
    if (!teamOwnerDirectoryReady()) {
      state.teamWorkCompletionLoading = true;
      state.teamWorkCompletionError = '';
      state.teamWorkCompletionRefreshStatus = '';
      state.teamWorkCompletionRefreshError = '';
      state.teamWorkCompletionSwitchTarget = '';
      if (currentPageId() === 'teams') {
        renderTeamWorkCompletionLoading(state.selectedTeamOwner);
      }
      return null;
    }
    state.teamWorkCompletion = null;
    state.teamWorkCompletionLoading = false;
    state.teamWorkCompletionError = '';
    renderTeamWorkCompletionDashboard();
    return null;
  }

  const normalizedYear = Number(year) || new Date().getFullYear();
  const cachedReview = cachedTeamWorkCompletion(owner, dashboardContext, normalizedYear);
  if (cachedReview && !forceRefresh) {
    state.teamWorkCompletion = cachedReview;
    state.teamWorkCompletionYear = cachedReview.year || normalizedYear;
    state.teamWorkCompletionLoading = false;
    state.teamWorkCompletionError = '';
    state.teamWorkCompletionRefreshStatus = '';
    state.teamWorkCompletionRefreshError = '';
    state.selectedTeamOwner = cachedReview.owner || owner;
    localStorage.setItem(TEAM_OWNER_STORAGE_KEY, cachedReview.owner || owner);
    if (!background && currentPageId() === 'teams') {
      renderTeamWorkCompletionDashboard(cachedReview);
    }
    if (!background) {
      queueTeamWorkCompletionDetailPreload(cachedReview, {
        reason: 'cache-hit',
        allowCompute: false,
      });
    }
    return cachedReview;
  }

  const requestKey = `${background ? 'bg:' : ''}${teamWorkCompletionCacheKey(owner, dashboardContext, normalizedYear)}`;
  const existingRequest = runtimeStore.teamWorkCompletionRequestPromises.get(requestKey);
  if (existingRequest) {
    if (background || existingRequest.requestId === runtimeStore.teamWorkCompletionRequestId) {
      return existingRequest.promise;
    }
  }

  const requestId = background ? 0 : ++runtimeStore.teamWorkCompletionRequestId;
  if (!background) {
    abortPendingTeamWorkCompletionRequests();
  }
  const previousReview = state.teamWorkCompletion?.owner ? state.teamWorkCompletion : null;
  const staleReview = !cachedReview && !background ? previousReview : null;
  const visibleReview = cachedReview || staleReview;
  const switchingOwner = Boolean(staleReview && staleReview.owner && staleReview.owner !== owner);
  if (!background) {
    if (visibleReview) {
      state.teamWorkCompletion = visibleReview;
    }
    state.teamWorkCompletionYear = normalizedYear;
    state.teamWorkCompletionLoading = !cachedReview;
    state.teamWorkCompletionError = '';
    state.teamWorkCompletionRefreshStatus = cachedReview ? '' : switchingOwner ? 'switching' : visibleReview ? 'refreshing' : '';
    state.teamWorkCompletionRefreshError = '';
    state.teamWorkCompletionSwitchTarget = switchingOwner ? owner : '';
    state.selectedTeamOwner = owner;
    if (currentPageId() === 'teams') {
      if (!visibleReview) {
        renderTeamWorkCompletionLoading(owner);
      } else {
        renderTeamWorkCompletionDashboard(visibleReview);
      }
    }
  }

  const params = new URLSearchParams();
  params.set('owner', owner);
  params.set('context', dashboardContext || 'all');
  params.set('year', String(normalizedYear));
  if (forceRefresh) {
    params.set('forceRefresh', 'true');
  }

  const requestController = new AbortController();
  const requestEntry = { requestId, promise: null, controller: requestController };
  requestEntry.promise = (async () => {
    try {
      const payload = await fetchJson(`${TEAM_WORK_COMPLETION_ENDPOINT}?${params}`, {
        signal: requestController.signal,
        timeoutMs: 60_000,
      });
      if (!background && requestId !== runtimeStore.teamWorkCompletionRequestId) {
        return null;
      }
      if (payload?.status === 'preparing') {
        if (background) {
          return payload;
        }
        if (visibleReview) {
          state.teamWorkCompletion = visibleReview;
          state.teamWorkCompletionLoading = false;
          state.teamWorkCompletionError = '';
          state.teamWorkCompletionRefreshStatus = 'preparing';
          state.teamWorkCompletionRefreshError = payload.reason || '';
          state.teamWorkCompletionSwitchTarget = '';
          if (currentPageId() === 'teams') {
            renderTeamWorkCompletionDashboard(visibleReview);
          }
          return visibleReview;
        }
        state.teamWorkCompletion = null;
        state.teamWorkCompletionLoading = true;
        state.teamWorkCompletionError = '';
        state.teamWorkCompletionRefreshStatus = 'preparing';
        state.teamWorkCompletionRefreshError = payload.reason || '';
        if (currentPageId() === 'teams') {
          renderTeamWorkCompletionLoading(owner);
        }
        return payload;
      }
      rememberTeamWorkCompletion(payload, owner, dashboardContext, normalizedYear);
      if (background) {
        return payload;
      }
      state.teamWorkCompletion = payload;
      state.teamWorkCompletionLoading = false;
      state.teamWorkCompletionError = '';
      state.teamWorkCompletionRefreshStatus = '';
      state.teamWorkCompletionRefreshError = '';
      state.teamWorkCompletionSwitchTarget = '';
      state.teamWorkCompletionYear = payload.year || normalizedYear;
      state.selectedTeamOwner = payload.owner || owner;
      localStorage.setItem(TEAM_OWNER_STORAGE_KEY, payload.owner || owner);
      if (currentPageId() === 'teams') {
        renderTeamWorkCompletionDashboard(payload);
      }
      queueTeamWorkCompletionDetailPreload(payload, {
        reason: 'after-summary',
        allowCompute: false,
      });
      return payload;
    } catch (error) {
      if (!background && requestId !== runtimeStore.teamWorkCompletionRequestId) {
        return null;
      }
      if (background) {
        throw error;
      }
      if (visibleReview) {
        state.teamWorkCompletion = visibleReview;
        state.teamWorkCompletionLoading = false;
        state.teamWorkCompletionError = '';
        state.teamWorkCompletionRefreshStatus = 'stale';
        state.teamWorkCompletionRefreshError = error?.message || 'Team work completion refresh failed';
        state.teamWorkCompletionSwitchTarget = '';
        if (currentPageId() === 'teams') {
          renderTeamWorkCompletionDashboard(visibleReview);
        }
        return visibleReview;
      }
      state.teamWorkCompletion = null;
      state.teamWorkCompletionLoading = false;
      state.teamWorkCompletionError = error?.message || 'Team work completion load failed';
      state.teamWorkCompletionRefreshStatus = '';
      state.teamWorkCompletionRefreshError = '';
      if (currentPageId() === 'teams') {
        renderTeamWorkCompletionError(state.teamWorkCompletionError);
      }
      throw error;
    }
  })().finally(() => {
    if (runtimeStore.teamWorkCompletionRequestPromises.get(requestKey) === requestEntry) {
      runtimeStore.teamWorkCompletionRequestPromises.delete(requestKey);
    }
  });
  runtimeStore.teamWorkCompletionRequestPromises.set(requestKey, requestEntry);
  return requestEntry.promise;
}


function navigateTeamWorkCompletion(owner, dashboardContext, year) {
  const params = new URLSearchParams();
  if (owner) {
    params.set('owner', owner);
  }
  if (dashboardContext) {
    params.set('dashboardContext', dashboardContext);
  }
  if (Number.isFinite(Number(year))) {
    params.set('year', String(Number(year)));
  }
  const query = params.toString();
  window.location.hash = query ? `#teams?${query}` : '#teams';
}


function normalizeTeamDashboardScopeContext(dashboardContext = 'all') {
  return dashboardContext === 'all' ? '' : dashboardContext;
}


export async function loadTeamDashboardScope(
  owner = resolveTeamOwner(),
  dashboardContext = 'all',
  year = resolveTeamWorkCompletionYear()
) {
  if (!owner) {
    return null;
  }

  const sessionBundle = await loadTeamDashboardSessionBundle(owner, dashboardContext || 'all', year).catch((error) => {
    console.warn('Team dashboard session bundle load failed', error);
    return null;
  });
  if (sessionBundle?.metrics && sessionBundle.workCompletion && sessionBundle.responsibilityReview) {
    if (currentPageId() === 'teams') {
      renderTeamDashboard();
      renderTeamWorkCompletionDashboard();
      renderOwnerReviewDashboard();
    }
    return [
      { status: 'fulfilled', value: sessionBundle.metrics },
      { status: 'fulfilled', value: sessionBundle.workCompletion },
      { status: 'fulfilled', value: sessionBundle.responsibilityReview },
    ];
  }
  if (sessionBundle?.status === 'preparing') {
    if (currentPageId() === 'teams') {
      renderTeamDashboard();
      renderTeamWorkCompletionDashboard();
      renderOwnerReviewDashboard();
    }
    return [{ status: 'fulfilled', value: sessionBundle }];
  }

  const routeContext = normalizeTeamDashboardScopeContext(dashboardContext);
  const results = await Promise.allSettled([
    loadTeamMetrics(owner, routeContext),
    loadTeamWorkCompletion(owner, dashboardContext, year),
    loadOwnerResponsibilityReview(owner, routeContext),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed && results.every((result) => result.status === 'rejected')) {
    throw failed.reason;
  }
  return results;
}


export function handleTeamWorkCompletionContextClick(event) {
  const button = event.target.closest('[data-team-completion-context]');
  if (!button) {
    return null;
  }
  event.preventDefault();

  const dashboardContext = button.dataset.teamCompletionContext || 'all';
  const owner = resolveTeamOwner();
  const year = resolveTeamWorkCompletionYear();
  syncTeamCompletionControls(state.teamWorkCompletion, dashboardContext);
  navigateTeamWorkCompletion(owner, normalizeTeamDashboardScopeContext(dashboardContext), year);
  return loadTeamDashboardScope(owner, dashboardContext, year).catch((error) => {
    console.warn('Team dashboard scope switch failed', error);
    syncTeamCompletionControls(state.teamWorkCompletion);
    return null;
  });
}


export function handleTeamWorkCompletionYearChange() {
  const owner = resolveTeamOwner();
  const dashboardContext = resolveTeamDashboardContext() || 'all';
  const year = Number(elements.teamCompletionYearSelect?.value || new Date().getFullYear());
  state.teamWorkCompletionYear = year;
  navigateTeamWorkCompletion(owner, normalizeTeamDashboardScopeContext(dashboardContext), year);
  return loadTeamDashboardScope(owner, dashboardContext, year).catch((error) => {
    console.warn('Team dashboard scope year switch failed', error);
    return null;
  });
}


export async function loadTeamAnnualEntryStructure(year) {
  const owner = state.teamMetrics?.owner || state.selectedTeamOwner || resolveTeamOwner();
  if (!owner) {
    return null;
  }

  const dashboardContext = state.teamMetrics?.dashboardContext || resolveTeamDashboardContext();
  const params = new URLSearchParams();
  params.set('profile', 'ownerMonthly');
  params.set('owner', owner);
  params.set('context', dashboardContext || 'all');
  if (Number.isFinite(Number(year))) {
    params.set('year', String(Number(year)));
  }

  const payload = await fetchJson(`${DASHBOARD_METRICS_ENDPOINT}?${params}`);
  return payload?.annualEntryStructure || null;
}


export async function loadOwnerResponsibilityReview(
  owner = resolveOwnerReviewOwner(),
  dashboardContext = resolveOwnerReviewDashboardContext(),
  { forceRefresh = false } = {}
) {
  if (!owner) {
    state.ownerReview = null;
    state.ownerReviewLoading = false;
    state.ownerReviewError = '';
    state.ownerReviewRefreshStatus = '';
    state.ownerReviewRefreshError = '';
    return null;
  }

  const cachedReview = cachedOwnerReview(owner, dashboardContext);
  if (cachedReview && !forceRefresh) {
    state.ownerReview = cachedReview;
    state.ownerReviewLoading = false;
    state.ownerReviewError = '';
    state.ownerReviewRefreshStatus = '';
    state.ownerReviewRefreshError = '';
    const visiblePayload = ownerReviewVisibleReview(cachedReview);
    const hasSelectedPerson = visiblePayload?.people?.some((item) => item.name === state.selectedOwnerReviewPerson);
    if (!hasSelectedPerson) {
      state.selectedOwnerReviewPerson = ownerReviewPreferredPersonName(visiblePayload);
    }
    if (ownerReviewModuleVisible()) {
      renderOwnerReviewDashboard();
    }
    return cachedReview;
  }

  const requestKey = ownerReviewCacheKey(owner, dashboardContext);
  const existingRequest = runtimeStore.ownerReviewRequestPromises.get(requestKey);
  if (existingRequest?.requestId === runtimeStore.ownerReviewRequestId) {
    return existingRequest.promise;
  }

  const requestId = ++runtimeStore.ownerReviewRequestId;
  abortPendingOwnerReviewRequests();
  if (cachedReview) {
    state.ownerReview = cachedReview;
  }
  state.ownerReviewLoading = !cachedReview;
  state.ownerReviewError = '';
  state.ownerReviewRefreshStatus = cachedReview ? 'refreshing' : '';
  state.ownerReviewRefreshError = '';
  if (ownerReviewModuleVisible()) {
    if (!cachedReview) {
      closeProjectDetailModal();
      closeOwnerReviewMemberModal();
    }
    renderOwnerReviewDashboard();
  }

  const params = new URLSearchParams();
  params.set('owner', owner);
  params.set('context', dashboardContext || 'all');

  const requestController = new AbortController();
  const requestEntry = { requestId, promise: null, controller: requestController };
  requestEntry.promise = (async () => {
    try {
      const payload = await fetchJson(`${TEAM_RESPONSIBILITY_REVIEW_ENDPOINT}?${params}`, {
        timeoutMs: OWNER_REVIEW_FETCH_TIMEOUT_MS,
        signal: requestController.signal,
      });
      if (requestId !== runtimeStore.ownerReviewRequestId) {
        return null;
      }
      const previousOwner = state.ownerReview?.owner || '';
      state.ownerReview = payload;
      rememberOwnerReview(payload, owner, dashboardContext);
      state.ownerReviewLoading = false;
      state.ownerReviewError = '';
      state.ownerReviewRefreshStatus = '';
      state.ownerReviewRefreshError = '';
      const visiblePayload = ownerReviewVisibleReview(payload);
      const hasSelectedPerson = visiblePayload?.people?.some((item) => item.name === state.selectedOwnerReviewPerson);
      state.selectedOwnerReviewPerson =
        hasSelectedPerson && previousOwner === payload.owner
          ? state.selectedOwnerReviewPerson
          : ownerReviewPreferredPersonName(visiblePayload);
      if (previousOwner !== payload.owner) {
        state.selectedOwnerReviewMember = '';
        state.ownerReviewMemberFilter = 'all';
      }
      localStorage.setItem(TEAM_OWNER_STORAGE_KEY, payload.owner || owner);
      if (ownerReviewModuleVisible()) {
        renderOwnerReviewDashboard();
      }
      return payload;
    } catch (error) {
      if (requestId !== runtimeStore.ownerReviewRequestId) {
        return null;
      }
      if (cachedReview) {
        state.ownerReview = cachedReview;
        state.ownerReviewLoading = false;
        state.ownerReviewError = '';
        state.ownerReviewRefreshStatus = 'stale';
        state.ownerReviewRefreshError = error?.message || 'Owner responsibility review refresh failed';
        if (ownerReviewModuleVisible()) {
          renderOwnerReviewDashboard();
        }
        return cachedReview;
      }
      state.ownerReview = null;
      state.ownerReviewLoading = false;
      state.ownerReviewError = error?.message || 'Owner responsibility review load failed';
      state.ownerReviewRefreshStatus = '';
      state.ownerReviewRefreshError = '';
      if (ownerReviewModuleVisible()) {
        renderOwnerReviewDashboard();
      }
      throw error;
    }
  })().finally(() => {
    if (runtimeStore.ownerReviewRequestPromises.get(requestKey) === requestEntry) {
      runtimeStore.ownerReviewRequestPromises.delete(requestKey);
    }
  });
  runtimeStore.ownerReviewRequestPromises.set(requestKey, requestEntry);
  return requestEntry.promise;
}


export function clearTeamDashboardContent() {
  elements.teamKpiGrid.innerHTML = '';
  elements.teamAlertGrid.innerHTML = '';
  elements.teamProgressGrid.innerHTML = '';
  if (elements.teamEntryTrendBoard) {
    runtimeStore.teamAnnualEntryStructureController?.destroy?.();
    runtimeStore.teamAnnualEntryStructureController = null;
    elements.teamEntryTrendBoard.innerHTML = '';
  }
  if (elements.teamDifficultyBoard) {
    elements.teamDifficultyBoard.innerHTML = '';
    elements.teamDifficultyBoard.hidden = true;
  }
  setPanelInsight(elements.teamEntryTrendInsight, '');
  setPanelInsight(elements.teamStoreTierInsight, '');
  setPanelInsight(elements.teamAlertsInsight, '');
}


export function renderTeamDashboardLoading(owner = state.selectedTeamOwner) {
  const ownerName = teamOwnerDisplayName(owner);
  elements.teamDashboardTitle.textContent = '负责人项目盘面';
  elements.teamHeadline.innerHTML = `
    <span class="team-refresh-chip">
      <span class="team-refresh-dot" aria-hidden="true"></span>
      ${escapeHtml(ownerName ? `正在刷新 ${ownerName}` : '正在刷新小组数据')}
    </span>
  `;
  elements.teamHeroStats.innerHTML = renderTeamHeroStoreTierDistribution({}, { loading: true });
  elements.teamDashboardMeta.textContent = '';
  if (elements.teamCoverageNote) {
    elements.teamCoverageNote.hidden = true;
    elements.teamCoverageNote.textContent = '';
  }
  if (elements.teamTierKpiBoard) {
    elements.teamTierKpiBoard.innerHTML = renderEmptyState({
      title: '正在切换小组数据',
      description: ownerName ? `${ownerName} 的指标加载中...` : '最新指标加载中...',
    });
  }
  clearTeamDashboardContent();
}


export function renderTeamDashboardError() {
  elements.teamDashboardTitle.textContent = '负责人项目盘面';
  elements.teamHeadline.textContent = '团队数据加载失败，请稍后重试';
  elements.teamHeroStats.innerHTML = '';
  elements.teamDashboardMeta.textContent = '';
  if (elements.teamTierKpiBoard) {
    elements.teamTierKpiBoard.innerHTML = renderEmptyState({
      title: '团队看板加载失败',
      description: '请刷新页面或检查后端服务。',
    });
  }
  if (elements.teamDifficultyBoard) {
    elements.teamDifficultyBoard.innerHTML = '';
    elements.teamDifficultyBoard.hidden = true;
  }
}


export function renderTeamKpis(metrics) {
  const insights = metrics.insights?.modules || {};
  const tooltips = metrics.tooltipCatalog || metrics.metricDefinitions || {};
  const usedOwnerMonthly = renderOwnerMonthlyTierBoard(metrics);

  if (usedOwnerMonthly) {
    elements.teamKpiGrid.hidden = true;
    elements.teamProgressGrid.hidden = true;
    elements.teamKpiGrid.innerHTML = '';
    elements.teamProgressGrid.innerHTML = '';
  } else {
    renderLegacyTeamSummaryKpis(metrics);
    if (elements.teamTierKpiBoard) {
      elements.teamTierKpiBoard.innerHTML = '';
    }
  }


  if (metrics.riskHealthAnalysis) {
    if (elements.teamAlertsSection) {
      elements.teamAlertsSection.hidden = true;
    }
    elements.teamAlertGrid.innerHTML = '';
    setPanelInsight(elements.teamAlertsInsight, '');
    return;
  }

  if (elements.teamAlertsSection) {
    elements.teamAlertsSection.hidden = false;
  }
  const alerts = metrics.alerts || {};
  const alertItems = [
    {
      key: 'schemeDelayedThisMonth',
      label: '方案延期完成（本月）',
      value: alerts.schemeDelayedThisMonth ?? 0,
      insight: '本月延期完成。',
      alert: true,
      tooltip: metricDefinitionTooltip(tooltips, 'schemeDelayedThisMonth', '方案延期完成（本月）', alerts.schemeDelayedThisMonth ?? 0) || tooltips.schemeDelayedThisMonth,
      drillable: true,
      drillFilter: buildOwnerTierDrillFilter(metrics, '', 'schemeDelayedThisMonth', { drillDelayed: true }),
    },
    {
      key: 'schemeDelayedYtd',
      label: '方案延期完成（全年）',
      value: alerts.schemeDelayedYtd ?? 0,
      insight: '全年累计延期完成。',
      alert: true,
      tooltip: metricDefinitionTooltip(tooltips, 'schemeDelayedYtd', '方案延期完成（全年）', alerts.schemeDelayedYtd ?? 0) || tooltips.schemeDelayedYtd,
      drillable: true,
      drillFilter: buildOwnerTierDrillFilter(metrics, '', 'schemeDelayedYtd', { drillDelayed: true }),
    },
    {
      key: 'openDelayed',
      label: '已延期项目（未闭环）',
      value: alerts.openDelayed ?? 0,
      insight: '延期且尚未完成。',
      alert: true,
      tooltip: metricDefinitionTooltip(tooltips, 'openDelayed', '已延期项目（未闭环）', alerts.openDelayed ?? 0) || tooltips.openDelayed,
      drillable: true,
      drillFilter: buildOwnerTierDrillFilter(metrics, '', 'openDelayed', { drillDelayed: true }),
    },
    {
      key: 'unscheduled',
      label: '未开始项目',
      value: alerts.unscheduled ?? 0,
      insight: '软装进度未开始。',
      alert: true,
      tooltip: metricDefinitionTooltip(tooltips, 'unscheduled', '未开始项目', alerts.unscheduled ?? 0) || tooltips.unscheduled,
      drillable: true,
      drillFilter: buildOwnerTierDrillFilter(metrics, '', 'notStarted'),
    },
  ];
  elements.teamAlertGrid.innerHTML = renderInsightCards(alertItems);
  bindDashboardTooltips(elements.teamAlertGrid);
  setPanelInsight(elements.teamAlertsInsight, insights.alerts);
}


export function teamHeroSummaryParts(metrics) {
  const summary = metrics.summary || {};
  const total = summary.totalProjects ?? 0;
  if (!total) {
    return [];
  }

  const inProgress = metrics.totals?.inProgress ?? summary.activeProjects ?? 0;
  const teamPaused = metrics.pausedCount ?? summary.pausedProjects ?? 0;
  const chips = [
    { label: '总项目', amount: String(total), unit: '项' },
    { label: '进行中', amount: String(inProgress), unit: '项' },
    { label: '暂停', amount: String(teamPaused), unit: '家', tone: teamPaused > 0 ? 'muted' : '' },
  ];
  return chips;
}


export function renderTeamHeroSummary(metrics) {
  const chips = teamHeroSummaryParts(metrics);
  if (!chips.length) {
    return '';
  }
  return chips
    .map(
      (chip) => `
        <span class="team-hero-chip${chip.tone ? ` is-${chip.tone}` : ''}">
          <span class="team-hero-chip-label">${escapeHtml(chip.label)}</span>
          <span class="team-hero-chip-value">
            <b>${escapeHtml(chip.amount)}</b><i>${escapeHtml(chip.unit)}</i>
          </span>
        </span>
      `
    )
    .join('');
}


export { renderTeamHeroStat } from '../components/team-hero-stat.mjs';

function teamHeroTierProjectCount(tierMetrics = {}) {
  for (const key of ['projectCount', 'totalProjects', 'total', 'count']) {
    const value = Number(tierMetrics[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}


export function teamHeroStoreTierParts(metrics = {}) {
  const tiers = metrics.tiers || {};
  const rows = ownerTierRows(metrics)
    .map((row) => ({
      ...row,
      count: teamHeroTierProjectCount(tiers[row.key]),
    }))
    .filter((row) => row.count > 0);

  const visibleRows = rows.slice(0, 5);
  const hiddenCount = rows.slice(5).reduce((sum, row) => sum + row.count, 0);
  if (hiddenCount > 0) {
    visibleRows.push({ key: 'other', label: '其他', count: hiddenCount });
  }
  return visibleRows;
}


export function renderTeamHeroStoreTierDistribution(metrics = {}, { loading = false } = {}) {
  if (loading) {
    return renderTeamHeroStat('店态分布', '刷新中');
  }

  const rows = teamHeroStoreTierParts(metrics);
  if (!rows.length) {
    return renderTeamHeroStat('店态分布', '—');
  }

  return `
    <div class="team-hero-tier-distribution" aria-label="店态分布">
      <span class="team-hero-tier-title">店态分布</span>
      <span class="team-hero-tier-items">
        ${rows
          .map(
            (row) => `
              <span class="team-hero-tier-item">
                <span>${escapeHtml(row.label)}</span>
                <b>${escapeHtml(String(row.count))}</b>
              </span>
            `
          )
          .join('')}
      </span>
    </div>
  `;
}


export function renderTeamHero(metrics) {
  elements.teamDashboardTitle.textContent = '负责人项目盘面';
  elements.teamHeadline.innerHTML = renderTeamHeroSummary(metrics);
  elements.teamDashboardMeta.textContent = '';
  renderFilterSelect(elements.teamOwnerSelect);
  elements.teamHeroStats.innerHTML = renderTeamHeroStoreTierDistribution(metrics);
}


export function renderTeamDashboard() {
  if (state.teamMetricsLoading) {
    renderTeamDashboardLoading();
    return;
  }

  const metrics = state.teamMetrics;
  if (!metrics?.owner) {
    elements.teamDashboardTitle.textContent = '负责人项目盘面';
    elements.teamHeadline.textContent = '';
    elements.teamHeroStats.innerHTML = '';
    elements.teamDashboardMeta.textContent = '';
    if (elements.teamTierKpiBoard) {
      elements.teamTierKpiBoard.innerHTML = renderEmptyState({
        title: '暂无负责人数据',
        description: '请选择负责人后查看责任项目。',
      });
    }
    clearTeamDashboardContent();
    return;
  }

  const insights = metrics.insights?.modules || {};
  renderTeamHero(metrics);
  renderTeamCoverageNote(metrics);
  renderTeamKpis(metrics);
  setPanelInsight(elements.teamStoreTierInsight, insights.storeTier);

  renderTeamEntryTrendBoard(metrics);
  renderTeamDifficultyBoard(metrics);
  renderTeamTierCharts(metrics);
  renderTeamWorkCompletionDashboard();
  if (!elements.teamKpiGrid.hidden) {
    bindDashboardTooltips(elements.teamKpiGrid);
    bindDashboardTooltips(elements.teamProgressGrid);
  }
  if (elements.teamTierKpiBoard) {
    bindDashboardTooltips(elements.teamTierKpiBoard);
  }
}


export function trendMonthLabel(label = '') {
  const text = String(label || '');
  return text.includes('-') ? text.slice(2).replace('-', '/') : text || '—';
}


export function trendShortMonthLabel(label = '') {
  const text = String(label || '');
  return text.includes('-') ? text.slice(5) : text || '—';
}


export function monthlyTotal(points = []) {
  return points.reduce((sum, item) => sum + Number(item.value || 0), 0);
}


export function monthlyLatest(points = []) {
  return points.length ? points[points.length - 1] : { label: '—', value: 0 };
}


export function monthlyPrevious(points = []) {
  return points.length > 1 ? points[points.length - 2] : { label: '—', value: 0 };
}


export function monthlyPeak(points = []) {
  return points.reduce((best, item) => (Number(item.value || 0) > Number(best.value || 0) ? item : best), { label: '—', value: 0 });
}


export function monthlyAverage(points = []) {
  return points.length ? monthlyTotal(points) / points.length : 0;
}


export function deltaLabel(delta) {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return String(delta);
  return '0';
}


export function trendTone(delta) {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}


export function trendSignal(latestValue, average, delta) {
  if (!latestValue) {
    return { label: '低位', tone: 'flat' };
  }
  if (average && latestValue >= average * 1.35 && delta >= 0) {
    return { label: '冲高', tone: 'up' };
  }
  if (delta < 0 && average && latestValue < average) {
    return { label: '回落', tone: 'down' };
  }
  return { label: '平稳', tone: 'flat' };
}


export function renderTrendStat(label, value, unit = '') {
  return `
    <div class="ops-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}${unit ? `<small>${escapeHtml(unit)}</small>` : ''}</strong>
    </div>
  `;
}


export function renderOpsTrendBars(points = [], { tone = 'green', definition = '按启动月份聚合。', barMax = 92 } = {}) {
  if (!points.length) {
    return renderEmptyState({
      title: '暂无月度记录',
      description: '当前口径下没有可展示的进店月份。',
      compact: true,
    });
  }

  const max = Math.max(...points.map((item) => Number(item.value || 0)), 1);
  return `
    <div class="ops-trend-bars" style="--point-count:${points.length}">
      ${points
        .map((item, index) => {
          const value = Number(item.value || 0);
          const height = Math.max(8, Math.round((value / max) * barMax));
          const tooltip = {
            title: item.label,
            value: `${value} 项`,
            definition,
            compare: index ? `较上月 ${deltaLabel(value - Number(points[index - 1].value || 0))}` : '',
          };
          return `
            <button class="ops-trend-point is-${escapeHtml(tone)}" type="button" ${tooltipDataAttr(tooltip)} aria-label="${escapeHtml(`${item.label}：${value} 项`)}">
              <span>${escapeHtml(value)}</span>
              <i style="--bar-height:${height}px"></i>
              <em>${escapeHtml(trendShortMonthLabel(item.label))}</em>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}


export function pointValueByLabel(points = [], label = '') {
  return Number(points.find((item) => item.label === label)?.value || 0);
}


export function difficultyByLabel(points = [], label = '') {
  return points.find((item) => item.label === label) || null;
}


export function pressureByLabel(points = [], label = '') {
  return points.find((item) => item.label === label) || null;
}


export function latestCombinedMonth(...groups) {
  return groups
    .flat()
    .map((item) => item.label)
    .filter(Boolean)
    .sort()
    .pop() || '—';
}


export function combinedEntryTrendSeries(newStore = [], oldStore = [], difficultyByMonth = [], pressureByMonth = []) {
  const labels = Array.from(
    new Set([...newStore, ...oldStore, ...pressureByMonth].map((item) => item.label).filter(Boolean))
  ).sort();
  return labels.map((label) => {
    const newValue = pointValueByLabel(newStore, label);
    const oldValue = pointValueByLabel(oldStore, label);
    const pressure = pressureByLabel(pressureByMonth, label);
    const difficulty = difficultyByLabel(difficultyByMonth, label) || pressure?.difficulty || null;
    return {
      label,
      newValue,
      oldValue,
      value: newValue + oldValue,
      difficulty,
      pressure,
    };
  });
}


export function entrySeriesPrevious(series = []) {
  return series.length > 1 ? series[series.length - 2] : { label: '—', newValue: 0, oldValue: 0, value: 0 };
}


export function entrySeriesPeak(series = []) {
  return series.reduce((best, item) => (Number(item.value || 0) > Number(best.value || 0) ? item : best), {
    label: '—',
    newValue: 0,
    oldValue: 0,
    value: 0,
  });
}


export function entrySeriesDifficultyPeak(series = []) {
  return series.reduce(
    (best, item) =>
      Number(item.difficulty?.responsibleWeightedWorkload || 0) > Number(best.difficulty?.responsibleWeightedWorkload || 0)
        ? item
        : best,
    { label: '—', difficulty: null }
  );
}

const ENTRY_PRESSURE_WATCH_THRESHOLD = 60;
const ENTRY_PRESSURE_CRITICAL_THRESHOLD = 80;


export function entryPressureScore(item = {}) {
  return Math.max(0, Math.min(100, Number(item.pressure?.pressureScore || item.difficulty?.pressureScore || 0)));
}


export function entryPressureStatus(score = 0) {
  const safeScore = Number(score || 0);
  if (safeScore >= ENTRY_PRESSURE_CRITICAL_THRESHOLD) {
    return { label: '高压', tone: 'up' };
  }
  if (safeScore >= ENTRY_PRESSURE_WATCH_THRESHOLD) {
    return { label: '承压', tone: 'up' };
  }
  if (safeScore > 0) {
    return { label: '可控', tone: 'flat' };
  }
  return { label: '低位', tone: 'flat' };
}


export function entryPressureTooltipTone(score = 0) {
  const safeScore = Number(score || 0);
  if (safeScore >= ENTRY_PRESSURE_CRITICAL_THRESHOLD) {
    return 'critical';
  }
  if (safeScore >= ENTRY_PRESSURE_WATCH_THRESHOLD) {
    return 'watch';
  }
  if (safeScore > 0) {
    return 'stable';
  }
  return 'muted';
}


export function entryPressureY(score = 0) {
  return 100 - Math.max(0, Math.min(100, Number(score || 0)));
}


export function entryPressureX(index, count) {
  return count ? ((index + 0.5) / count) * 100 : 50;
}


export function entryPressureMarkerStyle(score, index, count) {
  return `--pressure-x:${entryPressureX(index, count).toFixed(2)}%;--pressure-y:${entryPressureY(score).toFixed(2)}%`;
}


export function entryPressurePolyline(series = []) {
  const points = series
    .map((item, index) => {
      const score = entryPressureScore(item);
      return `${entryPressureX(index, series.length).toFixed(2)},${entryPressureY(score).toFixed(2)}`;
    })
    .join(' ');
  if (!points) {
    return '';
  }
  return `
    <svg class="entry-pressure-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${escapeHtml(points)}"></polyline>
    </svg>
  `;
}


export function entrySeriesPressurePeak(series = []) {
  return series.reduce((best, item) => (entryPressureScore(item) > entryPressureScore(best) ? item : best), {
    label: '—',
    difficulty: null,
    pressure: null,
  });
}


export function entryDifficultyTone(difficulty = null) {
  return difficultyLevelTone(difficulty?.level, difficulty?.pressureTone || difficulty?.tone);
}


export function entryDifficultyLabel(difficulty = null) {
  if (!difficulty?.projectCount) {
    return '无难度';
  }
  const workload = compactWorkloadLabel(difficulty.responsibleWeightedWorkload);
  const pressure = Number(difficulty.pressureScore || 0);
  const pressureText = pressure ? `压力 ${pressure}` : difficulty.pressureLevel || '';
  const level = difficulty.level || '未判定';
  return [pressureText || level, workload].filter(Boolean).join(' · ');
}


export function renderEntryAdviceItem(item) {
  if (typeof item === 'string') {
    return `<li>${escapeHtml(item)}</li>`;
  }
  const action = item.action ? item.action.replace(/。/, '') : '';
  return `
    <li class="entry-rhythm-advice-item is-${escapeHtml(item.severity || 'P3')}">
      <strong>${escapeHtml(item.title || '调度建议')}</strong>
      <span>${escapeHtml(item.text || '')}</span>
      ${action ? `<em>${escapeHtml(action)}</em>` : ''}
    </li>
  `;
}


export function renderEntryAgentList(items = [], emptyText = '') {
  const rows = (items || []).filter(Boolean).slice(0, 4);
  if (!rows.length && !emptyText) {
    return '';
  }
  return `
    <ul class="entry-rhythm-agent-list">
      ${(rows.length ? rows : [emptyText]).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
    </ul>
  `;
}


export function renderEntryRhythmAgentPanel(departmentOperations = null, rhythmAdvice = null, fallbackItems = []) {
  const ownerRecommendation =
    departmentOperations?.ownerRecommendation || departmentOperations?.currentOwnerRecommendation || null;
  if (ownerRecommendation) {
    const stance = ownerRecommendation.stance || 'steady';
    const departmentAction = (departmentOperations.departmentRecommendations || [])[0]?.action || '';
    const actions = ownerRecommendation.actions || [];
    const limitations = departmentOperations.limitations || [];
    return `
      <div class="entry-rhythm-agent is-${escapeHtml(stance)}">
        <div class="entry-rhythm-agent-head">
          <span>Agent 月度研判</span>
          <strong>${escapeHtml(ownerRecommendation.stanceLabel || '稳承接')}</strong>
        </div>
        <p class="entry-rhythm-advice-headline">${escapeHtml(ownerRecommendation.headline || '')}</p>
        <div class="entry-rhythm-agent-section">
          <b>判断依据</b>
          ${renderEntryAgentList(ownerRecommendation.evidence || [], '暂无可引用依据')}
        </div>
        <div class="entry-rhythm-agent-section">
          <b>团队动作</b>
          ${renderEntryAgentList(actions.length ? actions : [departmentAction].filter(Boolean), '维持当前排期节奏')}
        </div>
        ${
          limitations.length
            ? `<p class="entry-rhythm-agent-note">${escapeHtml(limitations.slice(0, 2).join('；'))}</p>`
            : ''
        }
      </div>
    `;
  }

  return `
    <div class="entry-rhythm-agent is-fallback">
      <div class="entry-rhythm-agent-head">
        <span>Agent 月度研判</span>
        <strong>${escapeHtml(rhythmAdvice?.confidence === 'low' ? '数据待补' : '稳承接')}</strong>
      </div>
      ${rhythmAdvice?.headline ? `<p class="entry-rhythm-advice-headline">${escapeHtml(rhythmAdvice.headline)}</p>` : ''}
      <ul>
        ${fallbackItems.map(renderEntryAdviceItem).join('')}
      </ul>
    </div>
  `;
}


export function entryRhythmInsights({ series = [], latest, previous, peak, totalNew, totalOld, average, fieldLow = false } = {}) {
  const delta = Number(latest.value || 0) - Number(previous.value || 0);
  const total = totalNew + totalOld;
  const newShare = total ? Math.round((totalNew / total) * 100) : 0;
  const latestLeader = latest.newValue >= latest.oldValue ? '新店' : '老店';
  const latestLeaderValue = Math.max(latest.newValue || 0, latest.oldValue || 0);
  const pressure =
    average && latest.value >= average * 1.25
      ? `最近进店月高于月均 ${deltaLabel(Math.round(latest.value - average))} 项，请先确认本周承接窗口。`
      : average && latest.value < average * 0.75
        ? `最近进店月低于月均 ${deltaLabel(Math.round(latest.value - average))} 项，需确认是否有延期后移。`
        : '最近进店月接近月均，维持当前排产节奏。';

  return [
    `最近进店月合计 ${latest.value || 0} 项，较上月 ${deltaLabel(delta)}；先排查${latestLeader}承接节奏。`,
    `进店峰值在 ${trendMonthLabel(peak.label)}，合计 ${peak.value || 0} 项；提前锁定复核与支援人手。`,
    `累计新店 ${totalNew} 项、老店 ${totalOld} 项，新店占比 ${newShare}%，按资源类型拆班。`,
    pressure,
    fieldLow ? '进店月份字段覆盖率偏低，请先补齐启动月份再判断排产峰值。' : '',
  ].filter(Boolean);
}


export function entryTierPointValue(points = [], label = '') {
  return Number(points.find((item) => item.label === label)?.value || 0);
}


export function buildEntryStoreTierContext(byStoreTier = {}, difficultySummary = {}) {
  const tierTotals = Object.entries(byStoreTier || {})
    .map(([label, points]) => {
      const safePoints = Array.isArray(points) ? points : [];
      return {
        label,
        points: safePoints,
        total: monthlyTotal(safePoints),
      };
    })
    .filter((item) => item.label && (item.total > 0 || item.points.length))
    .sort((a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label), 'zh-Hans-CN'))
    .map((item, index) => ({ ...item, toneClass: `is-tier-${index % 6}` }));

  const difficultyRows = difficultySummary.byStoreTier || [];
  const difficultyByLabel = new Map(difficultyRows.map((row) => [row.label || row.key, row]));
  const difficultyByKey = new Map(difficultyRows.map((row) => [row.key || row.label, row]));
  const highByLabel = new Map();

  (difficultySummary.matrixByStoreTierAndLevel || []).forEach((cell) => {
    if (cell.level !== '?' && cell.level !== '?') {
      return;
    }
    const row = difficultyByKey.get(cell.storeTier) || {};
    const label = cell.storeTierLabel || row.label || cell.storeTier;
    const current = highByLabel.get(label) || { count: 0, workload: 0 };
    current.count += Number(cell.projectCount || cell.value || 0);
    current.workload += Number(cell.responsibleWeightedWorkload || cell.weightedWorkload || 0);
    highByLabel.set(label, current);
  });

  const monthLabels = Array.from(new Set(tierTotals.flatMap((tier) => tier.points.map((point) => point.label).filter(Boolean)))).sort();
  const byMonth = new Map(
    monthLabels.map((label) => {
      const parts = tierTotals
        .map((tier) => ({
          label: tier.label,
          value: entryTierPointValue(tier.points, label),
          toneClass: tier.toneClass,
        }))
        .filter((part) => part.value > 0);
      const monthTotal = parts.reduce((sum, part) => sum + Number(part.value || 0), 0) || 1;
      return [
        label,
        parts.map((part) => ({
          ...part,
          share: Math.max(2, Math.round((Number(part.value || 0) / monthTotal) * 100)),
        })),
      ];
    })
  );

  const rows = tierTotals.map((tier) => {
    const difficulty = difficultyByLabel.get(tier.label) || {};
    const high = highByLabel.get(tier.label) || {};
    return {
      ...tier,
      projectCount: Number(difficulty.projectCount || tier.total || 0),
      workload: Number(difficulty.responsibleWeightedWorkload || difficulty.weightedWorkload || 0),
      highCount: Number(high.count || 0),
      highWorkload: Number(high.workload || 0),
    };
  });
  const primary =
    rows
      .slice()
      .sort(
        (a, b) =>
          Number(b.workload || 0) - Number(a.workload || 0) ||
          Number(b.highCount || 0) - Number(a.highCount || 0) ||
          Number(b.total || 0) - Number(a.total || 0)
      )[0] || null;

  return {
    rows,
    byMonth,
    primary,
    totalHighCount: rows.reduce((sum, row) => sum + Number(row.highCount || 0), 0),
  };
}


export function entryPrimaryTierLabel(context = {}) {
  const primary = context.primary;
  if (!primary) {
    return '--';
  }
  const value = primary.workload ? compactWorkloadLabel(primary.workload) : `${primary.total || primary.projectCount || 0}项`;
  return `${primary.label} · ${value}`;
}


export function entryStoreTooltipRows(parts = []) {
  const total = parts.reduce((sum, part) => sum + Number(part.value || 0), 0) || 1;
  return parts.slice(0, 5).map((part) => ({
    label: part.label,
    value: `${part.value || 0}项`,
    note: `占 ${Math.round((Number(part.value || 0) / total) * 100)}%`,
    tone: String(part.toneClass || '').replace(/^is-/, ''),
  }));
}


export function renderEntryStoreTierFocus(context = {}) {
  const rows = (context.rows || [])
    .slice()
    .sort(
      (a, b) =>
        Number(b.workload || 0) - Number(a.workload || 0) ||
        Number(b.highCount || 0) - Number(a.highCount || 0) ||
        Number(b.total || 0) - Number(a.total || 0)
    )
    .slice(0, 5);
  if (!rows.length) {
    return '';
  }

  return `
    <div class="entry-store-focus">
      <div class="entry-store-focus-head">
        <span>优先关注店态</span>
        <strong>${escapeHtml(context.primary?.label || '--')}</strong>
      </div>
      <div class="entry-store-focus-list">
        ${rows
          .map((row) => {
            const workload = row.workload ? compactWorkloadLabel(row.workload) : '--';
            const highText = row.highCount ? ` · 难重项目 ${row.highCount}项` : '';
            return `
              <div class="entry-store-focus-row">
                <span><i class="${escapeHtml(row.toneClass)}"></i>${escapeHtml(row.label)}</span>
                <strong>${escapeHtml(row.total || row.projectCount || 0)}<small>项</small></strong>
                <em>${escapeHtml(workload)}${escapeHtml(highText)}</em>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}


export function renderEntryComboChart(series = [], tierContext = {}) {
  if (!series.length) {
    return renderEmptyState({
      title: '暂无月度记录',
      description: '当前口径下没有可展示的进店月份。',
      compact: true,
    });
  }

  const max = Math.max(...series.flatMap((item) => [Number(item.newValue || 0), Number(item.oldValue || 0)]), 1);
  const mid = Math.max(1, Math.round(max / 2));
  const barMax = 164;
  return `
    <div class="entry-combo-shell">
      <div class="entry-combo-caption">
        <span>柱：新店 / 老店项目数</span>
        <span>压力线 ${ENTRY_PRESSURE_WATCH_THRESHOLD} 预警 / ${ENTRY_PRESSURE_CRITICAL_THRESHOLD} 高压</span>
      </div>
      <div class="entry-combo-chart" style="--entry-point-count:${series.length}">
        <div class="entry-combo-plot" style="--entry-point-count:${series.length}">
          <div class="entry-combo-axis" aria-hidden="true">
            <span>${escapeHtml(max)}</span>
            <span>${escapeHtml(mid)}</span>
            <span>0</span>
          </div>
          <div class="entry-pressure-axis" aria-hidden="true">
            <span>100</span>
            <span>${ENTRY_PRESSURE_WATCH_THRESHOLD}</span>
            <span>0</span>
          </div>
          <div class="entry-pressure-layer" aria-hidden="true">
            <span class="entry-pressure-threshold is-critical" style="--threshold-y:${entryPressureY(ENTRY_PRESSURE_CRITICAL_THRESHOLD)}%">
              <em>${ENTRY_PRESSURE_CRITICAL_THRESHOLD} 高压</em>
            </span>
            <span class="entry-pressure-threshold is-watch" style="--threshold-y:${entryPressureY(ENTRY_PRESSURE_WATCH_THRESHOLD)}%">
              <em>${ENTRY_PRESSURE_WATCH_THRESHOLD} 预警</em>
            </span>
            ${entryPressurePolyline(series)}
            ${series
              .map((item, index) => {
                const pressureScore = Math.round(entryPressureScore(item));
                const tone = entryDifficultyTone(item.difficulty || {});
                return `<span class="entry-pressure-dot is-${escapeHtml(tone)}" style="${entryPressureMarkerStyle(pressureScore, index, series.length)}"><i>${escapeHtml(pressureScore || '--')}</i></span>`;
              })
              .join('')}
          </div>
          <div class="entry-combo-points">
            ${series
              .map((item, index) => {
                const previous = index ? series[index - 1] : null;
                const totalDelta = previous ? Number(item.value || 0) - Number(previous.value || 0) : 0;
                const difficulty = item.difficulty || {};
                const difficultyLabel = entryDifficultyLabel(difficulty);
                const pressure = item.pressure || {};
                const pressureScore = Math.round(entryPressureScore(item));
                const newPressure = Number(pressure.newStorePressureScore || 0);
                const oldPressure = Number(pressure.oldStorePressureScore || 0);
                const tierParts = tierContext.byMonth?.get(item.label) || [];
                const leadTier =
                  tierParts
                    .slice()
                    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0) || String(a.label).localeCompare(String(b.label), 'zh-Hans-CN'))[0] || null;
                const leadTierLabel = leadTier ? leadTier.label : '未识别';
                const tierText = tierParts.length
                  ? ` · 店态 ${tierParts.map((part) => `${part.label} ${part.value}`).join(' / ')}`
                  : '';
                const pressureStatus = entryPressureStatus(pressureScore);
                const pressureTone = entryPressureTooltipTone(pressureScore);
                const storeRows = entryStoreTooltipRows(tierParts);
                const difficultyHighText = difficulty.highDifficultyCount ? `难重 ${difficulty.highDifficultyCount}项` : '';
                const tooltip = {
                  eyebrow: previous ? `环比 ${deltaLabel(totalDelta)}` : '首月样本',
                  title: `${trendMonthLabel(item.label)} 进店压力`,
                  value: `合计 ${item.value || 0} 项`,
                  metrics: [
                    { label: '压力', value: pressureScore || '--', note: pressureStatus.label, tone: pressureTone },
                    { label: '新店', value: `${item.newValue || 0}项`, note: newPressure ? `压力 ${newPressure}` : '新店进店', tone: 'new' },
                    { label: '老店', value: `${item.oldValue || 0}项`, note: oldPressure ? `压力 ${oldPressure}` : '老店进店', tone: 'old' },
                    { label: '主压', value: leadTierLabel, note: storeRows.length ? `${storeRows.length}类店态` : '未识别', tone: 'tier' },
                  ],
                  sections: [
                    storeRows.length ? { title: '店态分布', rows: storeRows } : null,
                    {
                      title: '判断线索',
                      rows: [
                        { label: '难度', value: difficultyLabel, note: difficultyHighText },
                        { label: '阈值', value: `${ENTRY_PRESSURE_WATCH_THRESHOLD}预警 / ${ENTRY_PRESSURE_CRITICAL_THRESHOLD}高压`, note: pressureStatus.label },
                      ],
                    },
                  ].filter(Boolean),
                  badges: [
                    { label: pressureScore >= ENTRY_PRESSURE_WATCH_THRESHOLD ? pressureStatus.label : '平稳', tone: pressureTone },
                    difficultyHighText ? { label: difficultyHighText, tone: 'critical' } : null,
                    tierParts.length ? { label: `店态 ${tierParts.length} 类`, tone: 'tier' } : null,
                  ].filter(Boolean),
                  definition: `进店量、店态和难度折算为 0-100 压力分，用于识别预警和高压月份。${tierText ? ` ${tierText}` : ''}`,
                };
                const newHeight = item.newValue > 0 ? Math.max(8, Math.round((item.newValue / max) * barMax)) : 0;
                const oldHeight = item.oldValue > 0 ? Math.max(8, Math.round((item.oldValue / max) * barMax)) : 0;
                return `
                  <button class="entry-combo-point" type="button" ${tooltipDataAttr(tooltip)} aria-label="${escapeHtml(`${trendMonthLabel(item.label)}：合计 ${item.value || 0} 项，新店 ${item.newValue || 0} 项，老店 ${item.oldValue || 0} 项，压力 ${pressureScore || '--'}，主压店态 ${leadTierLabel}`)}">
                    <span class="entry-combo-bars" aria-hidden="true">
                      <i class="is-new" style="--bar-height:${newHeight}px"></i>
                      <i class="is-old" style="--bar-height:${oldHeight}px"></i>
                    </span>
                    <span class="entry-tier-source">
                      <span class="entry-tier-stack${tierParts.length ? '' : ' is-empty'}" aria-hidden="true">
                        ${tierParts
                          .map(
                            (part) =>
                              `<i class="${escapeHtml(part.toneClass)}" style="--tier-width:${escapeHtml(part.share)}%"></i>`
                          )
                          .join('')}
                      </span>
                    </span>
                    <em class="entry-combo-month">${escapeHtml(trendMonthLabel(item.label))}</em>
                  </button>
                `;
              })
              .join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}


export function renderEntryRhythmBoard(
  newStore = [],
  oldStore = [],
  {
    fieldLow = false,
    difficultyByMonth = [],
    pressureByMonth = [],
    rhythmAdvice = null,
    departmentOperations = null,
    storeTierByMonth = {},
    difficultySummary = {},
  } = {}
) {
  const series = combinedEntryTrendSeries(newStore, oldStore, difficultyByMonth, pressureByMonth);
  const entrySeries = combinedEntryTrendSeries(newStore, oldStore);
  const tierContext = buildEntryStoreTierContext(storeTierByMonth, difficultySummary);
  const metricSeries = entrySeries.length ? entrySeries : series;
  const latest = metricSeries.length ? metricSeries[metricSeries.length - 1] : { label: '本月', newValue: 0, oldValue: 0, value: 0 };
  const previous = entrySeriesPrevious(metricSeries);
  const peak = entrySeriesPeak(metricSeries);
  const pressurePeak = entrySeriesPressurePeak(series);
  const pressurePeakScore = Math.round(entryPressureScore(pressurePeak));
  const totalNew = monthlyTotal(newStore);
  const totalOld = monthlyTotal(oldStore);
  const average = metricSeries.length ? metricSeries.reduce((sum, item) => sum + Number(item.value || 0), 0) / metricSeries.length : 0;
  const delta = Number(latest.value || 0) - Number(previous.value || 0);
  const latestPressurePoint = series.find((item) => item.label === latest.label) || series[series.length - 1] || latest;
  const latestPressureScore = Math.round(entryPressureScore(latestPressurePoint));
  const signal =
    rhythmAdvice?.tone === 'pressure'
      ? { label: '承压', tone: 'up' }
      : entryPressureStatus(latestPressureScore || pressurePeakScore);
  const analysis = rhythmAdvice?.interpretations?.length
    ? rhythmAdvice.interpretations
    : entryRhythmInsights({ series: metricSeries, latest, previous, peak, totalNew, totalOld, average, fieldLow });
  const analysisItems = analysis.slice(0, 3);
  const latestLabel = latestCombinedMonth(newStore, oldStore);
  const pressurePeakLabel = pressurePeakScore
    ? `${trendMonthLabel(pressurePeak.label)} · ${pressurePeakScore}`
    : '--';

  return `
    <article class="entry-rhythm-board">
      <header class="entry-rhythm-header">
        <div>
          <span class="ops-kicker">${escapeHtml(trendMonthLabel(latestLabel))}</span>
          <h2>进店压力看盘</h2>
          <p>按月查看进店集中度、压力峰值和高压店态，用于排期、支援与插单判断。</p>
        </div>
        <strong class="ops-signal is-${escapeHtml(signal.tone)}">${escapeHtml(signal.label)}</strong>
      </header>
      <div class="entry-rhythm-layout">
        <section class="entry-rhythm-main">
          <div class="entry-rhythm-primary">
            <div>
              <span>最近进店月</span>
              <strong>${escapeHtml(latest.value || 0)}<small>项</small></strong>
            </div>
            <b class="ops-delta is-${escapeHtml(trendTone(delta))}">环比 ${escapeHtml(deltaLabel(delta))}</b>
          </div>
          <div class="entry-rhythm-stats">
            ${renderTrendStat('当前压力值', latestPressureScore ? `${trendMonthLabel(latestPressurePoint.label)} · ${latestPressureScore}` : '--')}
            ${renderTrendStat('最高压力月', pressurePeakLabel)}
            ${renderTrendStat('高压店态', entryPrimaryTierLabel(tierContext))}
            ${renderTrendStat('新店 / 老店结构', `${latest.newValue || 0} / ${latest.oldValue || 0}`, '项')}
            ${renderTrendStat('月均基线', average.toFixed(1), '项')}
            ${renderTrendStat('进店峰值', `${trendMonthLabel(peak.label)} · ${peak.value || 0}`)}
          </div>
          ${renderEntryComboChart(series, tierContext)}
        </section>
        <aside class="entry-rhythm-analysis">
          <div class="entry-rhythm-legend">
            <span><i class="is-new"></i>新店</span>
            <span><i class="is-old"></i>老店</span>
            <span><i class="is-pressure"></i>压力值</span>
            <span><i class="is-watch"></i>${ENTRY_PRESSURE_WATCH_THRESHOLD} 预警</span>
            <span><i class="is-critical"></i>${ENTRY_PRESSURE_CRITICAL_THRESHOLD} 高压</span>
            <span><i class="is-tier-0"></i>店态来源</span>
          </div>
          ${renderEntryRhythmAgentPanel(departmentOperations, rhythmAdvice, analysisItems)}
          ${renderEntryStoreTierFocus(tierContext)}
        </aside>
      </div>
    </article>
  `;
}


export function renderEntryTrendPanelInsight(newStore = [], oldStore = [], fieldLow = false, rhythmAdvice = null) {
  if (rhythmAdvice?.headline) {
    return rhythmAdvice.headline;
  }
  const series = combinedEntryTrendSeries(newStore, oldStore);
  const latest = series.length ? series[series.length - 1] : { newValue: 0, oldValue: 0, value: 0 };
  const previous = entrySeriesPrevious(series);
  const delta = Number(latest.value || 0) - Number(previous.value || 0);
  const note = fieldLow ? '进店月份字段覆盖率偏低，当前趋势仅供辅助判断。' : '';
  return [
    `最近月合计 ${latest.value || 0} 项`,
    `新店 ${latest.newValue || 0} / 老店 ${latest.oldValue || 0}`,
    `环比 ${deltaLabel(delta)}`,
    note,
  ]
    .filter(Boolean)
    .join(' · ');
}


export function renderTeamEntryTrendBoard(metrics) {
  if (!elements.teamEntryTrendBoard) {
    return;
  }
  const annualEntryStructure = metrics.annualEntryStructure || null;
  if (annualEntryStructure) {
    if (!runtimeStore.teamAnnualEntryStructureController) {
      runtimeStore.teamAnnualEntryStructureController = mountAnnualEntryStructure(elements.teamEntryTrendBoard, {
        payload: annualEntryStructure,
        onYearChange: loadTeamAnnualEntryStructure,
        showStoreAgeTrendPointLabels: false,
        showStoreAgeTrendSideLegend: true,
      });
    } else {
      runtimeStore.teamAnnualEntryStructureController.update(annualEntryStructure);
    }
    setPanelInsight(
      elements.teamEntryTrendInsight,
      '按当前负责人项目口径汇总，复用首页年度结构、店态分布、省份贡献和项目明细。'
    );
    return;
  }

  runtimeStore.teamAnnualEntryStructureController?.destroy?.();
  runtimeStore.teamAnnualEntryStructureController = null;

  const newStore = metrics.monthlyEntry?.newStore || [];
  const oldStore = metrics.monthlyEntry?.oldStore || [];
  const difficultyByMonth = metrics.monthlyEntry?.difficultyByMonth || [];
  const pressureByMonth = metrics.monthlyEntry?.pressureByMonth || [];
  const rhythmAdvice = metrics.monthlyEntry?.rhythmAdvice || null;
  const departmentOperations = metrics.departmentOperations || null;
  const storeTierByMonth = metrics.monthlyEntry?.byStoreTier || {};
  const fieldLow = (metrics.fieldCoverage?.entryDate ?? 100) < 50;

  if (!newStore.length && !oldStore.length) {
    elements.teamEntryTrendBoard.innerHTML = renderEmptyState({
      title: fieldLow ? '字段不足，暂无法统计' : '暂无进店趋势',
      description: fieldLow ? '进店月份字段覆盖率较低，无法形成可靠进店节奏。' : '当前负责人暂无可展示的月度进店记录。',
      compact: true,
    });
    setPanelInsight(elements.teamEntryTrendInsight, '');
    return;
  }

  elements.teamEntryTrendBoard.innerHTML = renderEntryRhythmBoard(newStore, oldStore, {
    fieldLow,
    difficultyByMonth,
    pressureByMonth,
    rhythmAdvice,
    departmentOperations,
    storeTierByMonth,
    difficultySummary: metrics.difficultySummary || {},
  });
  setPanelInsight(elements.teamEntryTrendInsight, renderEntryTrendPanelInsight(newStore, oldStore, fieldLow, rhythmAdvice));
  bindDashboardTooltips(elements.teamEntryTrendBoard);
}


export function compactWorkloadLabel(value, unit = '人月') {
  const number = Number(value || 0);
  if (!number) {
    return '--';
  }
  const text = Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, '');
  return `${text}${unit}`;
}


export function difficultyLevelTone(level = '', fallback = '') {
  return (
    fallback ||
    {
      轻: 'light',
      中: 'medium',
      难: 'hard',
      重: 'heavy',
      未判定: 'unknown',
    }[level] ||
    'unknown'
  );
}


export function teamDifficultyActiveLevels(summary = {}) {
  const levelValues = new Map((summary.byLevel || []).map((item) => [item.label, Number(item.projectCount || item.value || 0)]));
  const ordered = Array.isArray(summary.levelOrder) && summary.levelOrder.length
    ? summary.levelOrder
    : ['轻', '中', '难', '重', '未判定'];
  const active = ordered.filter((level) => levelValues.get(level) > 0);
  return active.length ? active : ordered.slice(0, 4);
}


export function teamDifficultyHighCount(summary = {}) {
  return (summary.byLevel || [])
    .filter((item) => item.label === '难' || item.label === '重')
    .reduce((sum, item) => sum + Number(item.projectCount || item.value || 0), 0);
}


export function renderTeamDifficultySummary(summary = {}, metrics = {}) {
  const ownerLabel = metrics.disciplineLabel || '负责人';
  const items = [
    {
      label: '责任人月',
      value: compactWorkloadLabel(summary.responsibleWeightedWorkload, ''),
      unit: '人月',
      detail: `${ownerLabel}口径`,
    },
    {
      label: '综合人月',
      value: compactWorkloadLabel(summary.weightedWorkload, ''),
      unit: '人月',
      detail: `${summary.workdays || 0} 人天`,
    },
    {
      label: '平均难度',
      value: summary.avgScore || '--',
      unit: '',
      detail: `${summary.measuredProjectCount || 0}/${summary.projectCount || 0} 项有系数`,
    },
    {
      label: '难/重项目',
      value: teamDifficultyHighCount(summary),
      unit: '项',
      detail: '难度等级为难或重',
    },
  ];

  return `
    <div class="team-difficulty-summary">
      ${items
        .map(
          (item) => `
            <div class="team-difficulty-summary-item">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}${item.unit ? `<small>${escapeHtml(item.unit)}</small>` : ''}</strong>
              <em>${escapeHtml(item.detail)}</em>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}


export function renderTeamDifficultyMatrix(summary = {}, metrics = {}) {
  const rows = summary.byStoreTier || [];
  const levels = teamDifficultyActiveLevels(summary);
  const matrix = new Map(
    (summary.matrixByStoreTierAndLevel || []).map((cell) => [`${cell.storeTier}::${cell.level}`, cell])
  );

  if (!rows.length) {
    return renderEmptyState({
      title: '暂无难度压力数据',
      description: '当前负责人暂无可计算难度的项目。',
      compact: true,
    });
  }

  return `
    <div class="team-difficulty-matrix" style="--difficulty-level-count:${levels.length}">
      <div class="team-difficulty-matrix-head">
        <span>店态</span>
        ${levels.map((level) => `<strong>${escapeHtml(level)}</strong>`).join('')}
      </div>
      ${rows
        .map((row) => {
          const rowTotal = Number(row.responsibleWeightedWorkload || row.weightedWorkload || 0);
          return `
            <div class="team-difficulty-matrix-row">
              <div class="team-difficulty-row-label">
                <strong>${escapeHtml(row.label || row.key)}</strong>
                <span>${escapeHtml(row.projectCount || 0)} 项 · ${escapeHtml(compactWorkloadLabel(rowTotal))}</span>
              </div>
              ${levels
                .map((level) => {
                  const cell = matrix.get(`${row.key}::${level}`) || {};
                  const count = Number(cell.projectCount || 0);
                  if (!count) {
                    return '<span class="team-difficulty-cell is-empty">--</span>';
                  }
                  const workload = Number(cell.responsibleWeightedWorkload || cell.weightedWorkload || 0);
                  const tone = difficultyLevelTone(level, cell.tone);
                  const tooltip = {
                    title: `${row.label || row.key} · ${level}`,
                    value: `${count} 项 / ${compactWorkloadLabel(workload)}`,
                    definition: `按${metrics.disciplineLabel || '负责人'}口径统计责任人月，项目难度来自本地数据库难度系数。`,
                    compare: `综合 ${compactWorkloadLabel(cell.weightedWorkload)} · ${cell.workdays || 0} 人天`,
                  };
                  return `
                    <span class="team-difficulty-cell is-${escapeHtml(tone)}" tabindex="0" ${tooltipDataAttr(tooltip)}>
                      <strong>${escapeHtml(count)}</strong>
                      <em>${escapeHtml(compactWorkloadLabel(workload))}</em>
                    </span>
                  `;
                })
                .join('')}
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}


export function renderTeamDifficultyBoard(metrics) {
  const board = elements.teamDifficultyBoard;
  if (!board) {
    return;
  }
  const summary = metrics.difficultySummary || {};
  if (!summary.projectCount) {
    board.hidden = true;
    board.innerHTML = '';
    return;
  }

  board.hidden = false;
  board.innerHTML = `
    ${renderTeamDifficultySummary(summary, metrics)}
    ${renderTeamDifficultyMatrix(summary, metrics)}
  `;
  bindDashboardTooltips(board);
}


export function renderTierDifficultyStrip(difficulty = null) {
  if (!difficulty?.projectCount) {
    return '';
  }
  const levels = (difficulty.byLevel || []).filter((item) => Number(item.projectCount || item.value || 0) > 0);
  if (!levels.length) {
    return '';
  }
  const total = levels.reduce((sum, item) => sum + Number(item.projectCount || item.value || 0), 0) || 1;
  return `
    <div class="tier-difficulty-strip" aria-label="难度分布">
      <div class="tier-difficulty-track">
        ${levels
          .map((item) => {
            const count = Number(item.projectCount || item.value || 0);
            const tone = difficultyLevelTone(item.label, item.tone);
            const width = Math.max(10, Math.round((count / total) * 100));
            return `<span class="tier-difficulty-segment is-${escapeHtml(tone)}" style="--segment-width:${width}%"></span>`;
          })
          .join('')}
      </div>
      <div class="tier-difficulty-legend">
        ${levels
          .map((item) => `<span>${escapeHtml(item.label)} ${escapeHtml(item.projectCount || item.value || 0)}</span>`)
          .join('')}
      </div>
    </div>
  `;
}


export function renderTierPressureCard(tier, points = [], total = 0, fieldLow = false, difficulty = null) {
  const latest = monthlyLatest(points);
  const previous = monthlyPrevious(points);
  const peak = monthlyPeak(points);
  const average = monthlyAverage(points);
  const delta = Number(latest.value || 0) - Number(previous.value || 0);
  const signal = trendSignal(Number(latest.value || 0), average, delta);
  const share = total ? Math.round((monthlyTotal(points) / total) * 100) : 0;

  return `
    <article class="tier-pressure-card is-${escapeHtml(signal.tone)}">
      <header>
        <div>
          <span class="ops-kicker">${escapeHtml(trendMonthLabel(latest.label))}</span>
          <h2>${escapeHtml(tier)}</h2>
        </div>
        <strong>${escapeHtml(latest.value || 0)}<small>项</small></strong>
      </header>
      <div class="tier-pressure-meta">
        <span class="ops-signal is-${escapeHtml(signal.tone)}">${escapeHtml(signal.label)}</span>
        <span class="ops-delta is-${escapeHtml(trendTone(delta))}">环比 ${escapeHtml(deltaLabel(delta))}</span>
      </div>
      <div class="tier-pressure-visual">
        ${renderOpsTrendBars(points, {
          tone: signal.tone === 'up' ? 'old' : 'new',
          barMax: 78,
          definition: `${tier} 店态按进店月份聚合。${fieldLow ? '进店月份字段覆盖率较低，趋势仅供参考。' : ''}`,
        })}
      </div>
      ${renderTierDifficultyStrip(difficulty)}
      <footer>
        <span>合计 ${monthlyTotal(points)} 项 · 占团队 ${share}%</span>
        <span>峰值 ${trendMonthLabel(peak.label)} / ${peak.value || 0} 项</span>
      </footer>
    </article>
  `;
}


export function renderTeamTierCharts(metrics) {
  if (!elements.teamTierGrid) {
    return;
  }
  const tiers = metrics.monthlyEntry?.byStoreTier || {};
  const tierEntries = Object.entries(tiers);
  const total = metrics.summary?.totalProjects || 0;
  const fieldLow = (metrics.fieldCoverage?.entryDate ?? 100) < 50;
  const difficultyByTier = new Map((metrics.difficultySummary?.byStoreTier || []).map((item) => [item.label, item]));

  if (!tierEntries.length) {
    elements.teamTierGrid.innerHTML = renderEmptyState({
      title: '暂无店态分层数据',
      description: '当前负责人暂无可展示的店态进店记录。',
      compact: true,
    });
    return;
  }

  elements.teamTierGrid.innerHTML = tierEntries
    .map(([tier, points]) => renderTierPressureCard(tier, points, total, fieldLow, difficultyByTier.get(tier)))
    .join('');
  bindDashboardTooltips(elements.teamTierGrid);
}


export function renderTeamCoverageNote(metrics) {
  const coverage = metrics.fieldCoverage || {};
  const notes = [];
  if ((coverage.entryDate ?? 100) < 50) {
    notes.push('进店月份字段覆盖率较低，月度进店可能使用更新时间近似统计');
  }
  if ((coverage.storeNature ?? 100) < 50) {
    notes.push('店铺性质填写率较低，新店/老店拆分可能不完整');
  }
  if (metrics.monthlyEntry?.usesUpdatedAtFallback) {
    notes.push('当前团队多数项目缺少进店月份字段，图表已启用更新时间回退');
  }
  if (!notes.length) {
    elements.teamCoverageNote.hidden = true;
    elements.teamCoverageNote.textContent = '';
    return;
  }
  elements.teamCoverageNote.hidden = false;
  elements.teamCoverageNote.textContent = notes.join('、');
}

