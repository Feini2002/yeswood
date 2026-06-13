import { TEAM_WORK_COMPLETION_CACHE_LIMIT } from '../lib/constants.mjs';
import { runtimeStore } from '../lib/runtime-flags.mjs';
import { state } from '../lib/state.mjs';
import { currentCatalogSignature, rememberProjectDetails } from './project-catalog.mjs';

function snapshotCachePart(value) {
  return value === null || value === undefined ? '' : String(value);
}

function teamWorkCompletionSnapshotCacheKey(snapshot = state.snapshot) {
  return [
    snapshotCachePart(snapshot?.source),
    snapshotCachePart(snapshot?.storage),
    snapshotCachePart(snapshot?.syncedAt),
    snapshotCachePart(snapshot?.contentHash),
    snapshotCachePart(snapshot?.dataRevision),
    snapshotCachePart(snapshot?.totalRecords),
    snapshotCachePart(snapshot?.ignoredRecords),
  ].join('|');
}

function teamWorkCompletionContextKey(dashboardContext = 'all') {
  return dashboardContext || 'all';
}

function teamWorkCompletionOptions(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveTeamWorkCompletionYearAndOptions(year, options) {
  if (year && typeof year === 'object' && !Array.isArray(year)) {
    return {
      year: state.teamWorkCompletionYear,
      options: teamWorkCompletionOptions(year),
    };
  }
  return {
    year,
    options: teamWorkCompletionOptions(options),
  };
}

export function teamWorkCompletionCacheKey(
  owner = '',
  dashboardContext = 'all',
  year = state.teamWorkCompletionYear,
  options
) {
  const resolved = resolveTeamWorkCompletionYearAndOptions(year, options);
  return `${teamWorkCompletionSnapshotCacheKey(resolved.options.snapshot)}:${teamWorkCompletionContextKey(dashboardContext)}:${owner || ''}:${
    Number(resolved.year) || ''
  }`;
}

export function cachedTeamWorkCompletion(
  owner = '',
  dashboardContext = 'all',
  year = state.teamWorkCompletionYear
) {
  return state.teamWorkCompletionByKey?.[teamWorkCompletionCacheKey(owner, dashboardContext, year)] || null;
}

export function pruneTeamWorkCompletionCache(maxEntries = TEAM_WORK_COMPLETION_CACHE_LIMIT) {
  const entries = Object.entries(state.teamWorkCompletionByKey || {});
  if (entries.length <= maxEntries) {
    return;
  }
  state.teamWorkCompletionByKey = Object.fromEntries(entries.slice(entries.length - maxEntries));
}

export function rememberTeamWorkCompletion(
  payload,
  owner = payload?.owner || '',
  dashboardContext = payload?.dashboardContext || 'all',
  year = payload?.year || state.teamWorkCompletionYear,
  options
) {
  if (!payload?.owner && !owner) {
    return;
  }
  const resolved = resolveTeamWorkCompletionYearAndOptions(year, options);
  const requestedKey = teamWorkCompletionCacheKey(owner || payload.owner, dashboardContext, resolved.year, resolved.options);
  const canonicalKey = teamWorkCompletionCacheKey(payload.owner || owner, dashboardContext, resolved.year, resolved.options);
  state.teamWorkCompletionByKey = {
    ...state.teamWorkCompletionByKey,
    [requestedKey]: payload,
    [canonicalKey]: payload,
  };
  rememberProjectDetails(payload.projectDetailsById, {
    signature: resolved.options.projectDetailSignature || currentCatalogSignature(resolved.options.snapshot),
  });
  pruneTeamWorkCompletionCache();
}

export function teamWorkCompletionReviewMatchesOwner(review = null, owner = '') {
  const requestedOwner = String(owner || '').trim();
  if (!review || !requestedOwner) {
    return false;
  }
  return [
    review.owner,
    review.requestedOwner,
    review.displayName,
    review.team?.owner,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .includes(requestedOwner);
}

function teamWorkCompletionProjectsById(review = null) {
  return review?.projectsById && typeof review.projectsById === 'object' ? review.projectsById : {};
}

function teamWorkCompletionSourceProjects(review = null) {
  return Array.isArray(review?.sourceProjects) ? review.sourceProjects : [];
}

function addProjectIds(target, values = []) {
  if (!Array.isArray(values)) {
    return;
  }
  values.forEach((value) => {
    const projectId = String(value || '').trim();
    if (projectId) {
      target.add(projectId);
    }
  });
}

function expectedTeamWorkCompletionProjectIds(review = null) {
  const projectIds = new Set();
  Object.values(review?.summary || {}).forEach((metric) => {
    if (!metric || typeof metric !== 'object') {
      return;
    }
    addProjectIds(projectIds, metric.completedProjectIds);
    addProjectIds(projectIds, metric.inProgressProjectIds);
  });
  (review?.groups || []).forEach((group) => addProjectIds(projectIds, group?.projectIds));
  (review?.members || []).forEach((member) => addProjectIds(projectIds, member?.projectIds));
  return projectIds;
}

function teamWorkCompletionDetailProjectIds(review = null) {
  const projectIds = new Set(Object.keys(teamWorkCompletionProjectsById(review)));
  teamWorkCompletionSourceProjects(review).forEach((project) => {
    const projectId = String(project?.id || project?.recordMeta?.id || '').trim();
    if (projectId) {
      projectIds.add(projectId);
    }
  });
  return projectIds;
}

function expectedTeamWorkCompletionProjectCount(review = null) {
  const explicitCount = Number(review?.projectCount);
  if (Number.isFinite(explicitCount) && explicitCount >= 0) {
    return explicitCount;
  }
  const projectIds = expectedTeamWorkCompletionProjectIds(review);
  return projectIds.size;
}

export function teamWorkCompletionHasDetail(review = state.teamWorkCompletion) {
  if (!review || review.detailReady !== true) {
    return false;
  }

  const projectsById = teamWorkCompletionProjectsById(review);
  const sourceProjects = teamWorkCompletionSourceProjects(review);
  const expectedProjectIds = expectedTeamWorkCompletionProjectIds(review);
  if (expectedProjectIds.size > 0) {
    const detailProjectIds = teamWorkCompletionDetailProjectIds(review);
    return Array.from(expectedProjectIds).every((projectId) => detailProjectIds.has(projectId));
  }

  const expectedProjectCount = expectedTeamWorkCompletionProjectCount(review);
  if (expectedProjectCount <= 0) {
    return true;
  }

  return Object.keys(projectsById).length >= expectedProjectCount || sourceProjects.length >= expectedProjectCount;
}

export function mergeTeamWorkCompletionDetail(review = state.teamWorkCompletion, detail = {}) {
  return {
    ...(review || {}),
    ...(detail || {}),
    detailReady: true,
    detailStatus: 'ready',
    detailReason: '',
  };
}

export function teamWorkCompletionDetailCacheKey(review = state.teamWorkCompletion, options) {
  if (!review) {
    return '';
  }
  const owner = String(review.owner || state.selectedTeamOwner || '').trim();
  if (!owner) {
    return '';
  }
  return teamWorkCompletionCacheKey(owner, review.dashboardContext || 'all', review.year || state.teamWorkCompletionYear, options);
}

export function currentTeamWorkCompletionCacheKey() {
  return teamWorkCompletionDetailCacheKey(state.teamWorkCompletion);
}

export function isCurrentTeamWorkCompletionKey(requestKey = '') {
  return Boolean(requestKey && currentTeamWorkCompletionCacheKey() === requestKey);
}

export function markTeamWorkCompletionDetailStatus(requestKey = '', status = '', detail = '') {
  if (!requestKey || !status) {
    return;
  }
  if (!runtimeStore.teamWorkCompletionDetailStatuses) {
    runtimeStore.teamWorkCompletionDetailStatuses = new Map();
  }
  const existing = runtimeStore.teamWorkCompletionDetailStatuses.get(requestKey) || {};
  runtimeStore.teamWorkCompletionDetailStatuses.set(requestKey, {
    status,
    detail,
    startedAt: existing.startedAt || Date.now(),
    updatedAt: Date.now(),
  });
}

export function getTeamWorkCompletionDetailStatus(review = state.teamWorkCompletion) {
  if (teamWorkCompletionHasDetail(review)) {
    return { status: 'ready', detail: '', elapsedMs: 0 };
  }
  const requestKey = teamWorkCompletionDetailCacheKey(review);
  const entry = requestKey ? runtimeStore.teamWorkCompletionDetailStatuses?.get(requestKey) : null;
  if (!entry) {
    return { status: 'idle', detail: '', elapsedMs: 0 };
  }
  return {
    ...entry,
    elapsedMs: Math.max(0, Date.now() - Number(entry.startedAt || Date.now())),
  };
}
