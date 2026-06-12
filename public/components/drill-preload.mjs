import { currentCatalogSignature, preloadDrillProjects } from '../domain/project-catalog.mjs';
import { runtimeStore } from '../lib/runtime-flags.mjs';

function stableFilterKey(filter = {}) {
  const params = new URLSearchParams();
  Object.entries(filter || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, value]) => params.set(key, String(value)));
  return params.toString();
}

function readDrillFilterFromElement(element) {
  const raw = element?.dataset?.drill || element?.getAttribute?.('data-drill') || '';
  if (!raw) {
    return null;
  }
  try {
    const filter = JSON.parse(raw);
    return filter && typeof filter === 'object' && !Array.isArray(filter) ? filter : null;
  } catch {
    return null;
  }
}

export function visibleDrillFilters(root = document) {
  const nodes = Array.from(root?.querySelectorAll?.('[data-drill]') || []);
  const filters = [];
  const seen = new Set();
  for (const node of nodes) {
    const filter = readDrillFilterFromElement(node);
    const key = stableFilterKey(filter);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    filters.push(filter);
  }
  return filters;
}

export function queueDrillPreload(filters = [], { concurrency = 3, forceRefresh = false, keyPrefix = 'drill' } = {}) {
  const uniqueFilters = [];
  const filterKeys = new Set();
  for (const filter of Array.isArray(filters) ? filters : []) {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
      continue;
    }
    const key = stableFilterKey(filter);
    if (!key || filterKeys.has(key)) {
      continue;
    }
    filterKeys.add(key);
    uniqueFilters.push(filter);
  }
  if (!uniqueFilters.length) {
    return null;
  }

  const preloadKey = `${keyPrefix}:${currentCatalogSignature()}:${Array.from(filterKeys).sort().join('|')}`;
  if (!forceRefresh && runtimeStore.drillPreloadKeys?.has(preloadKey)) {
    return null;
  }
  if (!runtimeStore.drillPreloadKeys) {
    runtimeStore.drillPreloadKeys = new Set();
  }
  runtimeStore.drillPreloadKeys.add(preloadKey);

  const request = preloadDrillProjects(uniqueFilters, { concurrency }).then((results) => {
    if (results.some((result) => result.status === 'rejected')) {
      runtimeStore.drillPreloadKeys.delete(preloadKey);
    }
    return results;
  }).catch(() => {
    runtimeStore.drillPreloadKeys.delete(preloadKey);
    return [];
  });
  return request;
}

export function queueVisibleDrillPreload({ root = document, concurrency = 3, forceRefresh = false, extraFilters = [] } = {}) {
  const filters = [...(Array.isArray(extraFilters) ? extraFilters : []), ...visibleDrillFilters(root)];
  if (!filters.length) {
    return null;
  }
  const schedule = typeof queueMicrotask === 'function' ? queueMicrotask : (callback) => setTimeout(callback, 0);
  schedule(() => {
    queueDrillPreload(filters, {
      concurrency,
      forceRefresh,
      keyPrefix: 'visible-drill',
    });
  });
  return true;
}
