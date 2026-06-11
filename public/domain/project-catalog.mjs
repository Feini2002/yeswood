import { state } from '../lib/state.mjs';
import { fetchJson } from '../lib/api.mjs';
import { runtimeStore } from '../lib/runtime-flags.mjs';
import { snapshotSignature } from '../realtime.js';

const COMPLEX_FILTER_KEYS = [
  'metric',
  'tier',
  'lifecycleStage',
  'delayed',
  'storeNature',
  'excludePaused',
  'activeResponsibility',
  'owner',
  'teamProjectOwner',
  'collaborator',
  'collaborationDiscipline',
  'dashboardContext',
  'profile',
  'riskLevel',
];

const DRILL_CACHE_LIMIT = 32;
const PROJECT_DETAIL_CACHE_LIMIT = 48;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function readFilters() {
  return state.filters || {};
}

function toQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

function matchesValue(actual, expected) {
  const filterValue = normalizeText(expected);
  if (!filterValue) {
    return true;
  }
  return normalizeText(actual) === filterValue;
}

function searchableText(project) {
  const rawFieldText = Object.values(project.rawFields || {})
    .map((field) => field.display)
    .join(' ');
  return [project.name, project.owner, project.ownerDisplay, project.province, project.businessType, project.storeStatus, rawFieldText]
    .join(' ')
    .toLowerCase();
}

export function currentCatalogSignature(snapshot = state.snapshot) {
  return snapshotSignature(snapshot);
}

export function invalidateProjectCaches({ catalog = false, drill = true, details = true } = {}) {
  if (catalog) {
    state.projectsCatalogLoaded = false;
    state.projectsCatalogSignature = '';
    state.allProjects = [];
    runtimeStore.projectCatalogPromise = null;
  }
  if (drill) {
    runtimeStore.drillProjectsCache?.clear();
    runtimeStore.drillResolvePromises?.clear();
  }
  if (details) {
    runtimeStore.projectDetailCache?.clear();
    runtimeStore.projectDetailPromises?.clear();
  }
}

function ensureDrillCache() {
  if (!runtimeStore.drillProjectsCache) {
    runtimeStore.drillProjectsCache = new Map();
  }
  if (!runtimeStore.drillResolvePromises) {
    runtimeStore.drillResolvePromises = new Map();
  }
  return runtimeStore.drillProjectsCache;
}

function ensureDetailCache() {
  if (!runtimeStore.projectDetailCache) {
    runtimeStore.projectDetailCache = new Map();
  }
  if (!runtimeStore.projectDetailPromises) {
    runtimeStore.projectDetailPromises = new Map();
  }
  return runtimeStore.projectDetailCache;
}

function pruneLimitedMap(cache, maxEntries) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

function rememberDrillCache(cacheKey, items = []) {
  const cache = ensureDrillCache();
  cache.set(cacheKey, items);
  pruneLimitedMap(cache, DRILL_CACHE_LIMIT);
}

export function drillCacheKey(filters = {}) {
  const params = new URLSearchParams(toQuery(filters).replace(/^\?/, ''));
  params.sort();
  return `${state.projectsCatalogSignature || currentCatalogSignature()}|${params.toString()}`;
}

export function peekDrillProjectsCache(filters = {}) {
  return ensureDrillCache().get(drillCacheKey(filters)) || null;
}

export function hasComplexProjectFilters(filters = readFilters()) {
  return COMPLEX_FILTER_KEYS.some((key) => normalizeText(filters[key]));
}

export function filterProjectsLocally(projects = [], filters = readFilters()) {
  const search = normalizeText(filters.search).toLowerCase();
  return (Array.isArray(projects) ? projects : []).filter((project) => {
    const text = searchableText(project);
    return (
      (!search || text.includes(search)) &&
      matchesValue(project.province, filters.province) &&
      matchesValue(project.businessType, filters.businessType) &&
      matchesValue(project.storeStatus, filters.storeStatus) &&
      matchesValue(project.status, filters.status)
    );
  });
}

export async function fetchFilteredProjects(filters = readFilters(), { view = 'summary' } = {}) {
  const params = new URLSearchParams(toQuery(filters).replace(/^\?/, ''));
  params.set('view', view);
  const query = params.toString();
  const payload = await fetchJson(query ? `/api/projects?${query}` : `/api/projects?view=${view}`);
  return {
    items: Array.isArray(payload?.items) ? payload.items : [],
    fieldCatalog: Array.isArray(payload?.fieldCatalog) ? payload.fieldCatalog : [],
  };
}

async function loadProjectCatalogPayload({ view = 'summary' } = {}) {
  const payload = await fetchJson(`/api/projects?view=${view}`);
  state.allProjects = Array.isArray(payload?.items) ? payload.items : [];
  state.fieldCatalog = Array.isArray(payload?.fieldCatalog) ? payload.fieldCatalog : state.fieldCatalog;
  state.projectsCatalogLoaded = true;
  state.projectsCatalogSignature = currentCatalogSignature();
  invalidateProjectCaches({ catalog: false, drill: true, details: false });
  return state.allProjects;
}

function catalogIsFresh(signature = currentCatalogSignature()) {
  return (
    state.projectsCatalogLoaded &&
    Array.isArray(state.allProjects) &&
    state.projectsCatalogSignature === signature
  );
}

export async function fetchProjectCatalog({ force = false, view = 'summary' } = {}) {
  const signature = currentCatalogSignature();
  if (!force && catalogIsFresh(signature)) {
    return state.allProjects;
  }
  if (!force && state.projectsCatalogSignature && state.projectsCatalogSignature !== signature) {
    invalidateProjectCaches({ catalog: true, drill: true, details: true });
  }
  if (!force && runtimeStore.projectCatalogPromise) {
    return runtimeStore.projectCatalogPromise;
  }

  const request = loadProjectCatalogPayload({ view }).finally(() => {
    if (runtimeStore.projectCatalogPromise === request) {
      runtimeStore.projectCatalogPromise = null;
    }
  });
  runtimeStore.projectCatalogPromise = request;
  return request;
}

export async function fetchProjectDetail(projectId) {
  const id = normalizeText(projectId);
  if (!id) {
    return null;
  }

  const signature = currentCatalogSignature();
  const detailCache = ensureDetailCache();
  const cached = detailCache.get(id);
  if (cached?.signature === signature && cached.project) {
    return cached.project;
  }

  const inflight = runtimeStore.projectDetailPromises.get(id);
  if (inflight) {
    return inflight;
  }

  const request = fetchJson(`/api/projects?id=${encodeURIComponent(id)}&view=full`)
    .then((payload) => {
      const item = payload?.item || null;
      if (!item) {
        return null;
      }
      detailCache.set(id, { signature, project: item });
      pruneLimitedMap(detailCache, PROJECT_DETAIL_CACHE_LIMIT);
      replaceProjectInCatalog(item);
      return item;
    })
    .finally(() => {
      if (runtimeStore.projectDetailPromises.get(id) === request) {
        runtimeStore.projectDetailPromises.delete(id);
      }
    });

  runtimeStore.projectDetailPromises.set(id, request);
  return request;
}

export function replaceProjectInCatalog(project) {
  if (!project?.id) {
    return;
  }
  const pools = [state.allProjects, state.projects, state.drillModal?.projects].filter(Array.isArray);
  for (const pool of pools) {
    const index = pool.findIndex((entry) => entry.id === project.id);
    if (index >= 0) {
      pool[index] = project;
    }
  }
}

export async function resolveVisibleProjects(filters = readFilters()) {
  if (!hasComplexProjectFilters(filters) && catalogIsFresh()) {
    return filterProjectsLocally(state.allProjects, filters);
  }
  const payload = await fetchFilteredProjects(filters);
  if (!hasComplexProjectFilters(filters)) {
    state.allProjects = payload.items;
    state.projectsCatalogLoaded = true;
    state.projectsCatalogSignature = currentCatalogSignature();
  }
  if (payload.fieldCatalog?.length) {
    state.fieldCatalog = payload.fieldCatalog;
  }
  return payload.items;
}

export function projectsFromIdList(ids = []) {
  const idList = Array.isArray(ids) ? ids : [];
  if (!idList.length) {
    return [];
  }
  const byId = new Map((state.allProjects || []).map((project) => [project.id, project]));
  return idList.map((id) => byId.get(id)).filter(Boolean);
}

export async function fetchDrillProjectIds(filters = {}) {
  const params = new URLSearchParams(toQuery(filters).replace(/^\?/, ''));
  params.set('fields', 'ids');
  const query = params.toString();
  const payload = await fetchJson(query ? `/api/projects?${query}` : '/api/projects?fields=ids');
  return Array.isArray(payload?.ids) ? payload.ids : [];
}

async function resolveDrillProjectsUncached(filters = {}) {
  await fetchProjectCatalog();
  if (!state.allProjects.length) {
    const payload = await fetchFilteredProjects(filters, { view: 'summary' });
    return payload.items || [];
  }

  const ids = await fetchDrillProjectIds(filters);
  const items = projectsFromIdList(ids);
  if (items.length || !ids.length) {
    return items;
  }

  const payload = await fetchFilteredProjects(filters, { view: 'summary' });
  return payload.items || [];
}

export async function resolveDrillProjects(filters = {}, { useCache = true } = {}) {
  const cacheKey = drillCacheKey(filters);
  if (useCache) {
    const cached = peekDrillProjectsCache(filters);
    if (cached) {
      return cached;
    }
  }

  const inflight = runtimeStore.drillResolvePromises?.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const request = resolveDrillProjectsUncached(filters)
    .then((items) => {
      if (useCache) {
        rememberDrillCache(cacheKey, items);
      }
      return items;
    })
    .finally(() => {
      if (runtimeStore.drillResolvePromises?.get(cacheKey) === request) {
        runtimeStore.drillResolvePromises.delete(cacheKey);
      }
    });

  ensureDrillCache();
  runtimeStore.drillResolvePromises.set(cacheKey, request);
  return request;
}
