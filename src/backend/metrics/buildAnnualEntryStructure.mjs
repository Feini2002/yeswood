import { provinceDisplayName } from '../../../public/dashboard/province-display.mjs';
import { isInYear } from './calculators.mjs';
import {
  hasValidEntryStartDate,
  isClassifiedEntryStoreAge,
  isDirectFranchiseScoped,
  isEntryExcludedCanceled,
  isEntryExcludedProject,
  isValidYearEntryProject,
  entryMonth,
  matchesEntryScope,
} from './entryScope.mjs';
import { readFranchiseScope, readStoreNatureKey, readStoreTierLabel } from './fieldSemantics.mjs';
import { isPausedProject } from './pausedProjects.mjs';

const STORE_STATUS_TOP_LIMIT = 8;
const PROVINCE_MISSING_LABEL = '省份未填写';

function dashboardYear(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
}

function createRankingBucket(key, label) {
  return {
    key,
    label,
    total: 0,
    newStore: 0,
    oldStore: 0,
    direct: 0,
    franchise: 0,
  };
}

function bumpRankingBucket(bucket, project, scope, storeAgeKey) {
  bucket.total += 1;
  if (storeAgeKey === 'newStore') {
    bucket.newStore += 1;
  } else if (storeAgeKey === 'renovated') {
    bucket.oldStore += 1;
  }
  if (scope === 'direct') {
    bucket.direct += 1;
  } else if (scope === 'franchise') {
    bucket.franchise += 1;
  }
}

function readRankingMap(map, key, label) {
  if (!map.has(key)) {
    map.set(key, createRankingBucket(key, label));
  }
  return map.get(key);
}

function finalizeRanking(map, limit = STORE_STATUS_TOP_LIMIT) {
  const items = Array.from(map.values()).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'zh-Hans-CN'));
  if (items.length <= limit) {
    return items;
  }
  const top = items.slice(0, limit);
  const rest = items.slice(limit);
  const other = createRankingBucket('其他', '其他');
  for (const item of rest) {
    other.total += item.total;
    other.newStore += item.newStore;
    other.oldStore += item.oldStore;
    other.direct += item.direct;
    other.franchise += item.franchise;
  }
  return other.total ? [...top, other] : top;
}

function createEmptyMonth(month) {
  return {
    month,
    label: `${month}月`,
    total: 0,
    newStore: { total: 0, direct: 0, franchise: 0 },
    oldStore: { total: 0, direct: 0, franchise: 0 },
    quadrants: {
      directNew: { total: 0, storeStatuses: [], provinces: [] },
      directOld: { total: 0, storeStatuses: [], provinces: [] },
      franchiseNew: { total: 0, storeStatuses: [], provinces: [] },
      franchiseOld: { total: 0, storeStatuses: [], provinces: [] },
    },
    storeStatuses: [],
    provinces: [],
    _storeStatusMap: new Map(),
    _provinceMap: new Map(),
    _quadrantMaps: {
      directNew: { storeStatuses: new Map(), provinces: new Map() },
      directOld: { storeStatuses: new Map(), provinces: new Map() },
      franchiseNew: { storeStatuses: new Map(), provinces: new Map() },
      franchiseOld: { storeStatuses: new Map(), provinces: new Map() },
    },
  };
}

function resolveQuadrantKey(scope, storeAgeKey) {
  if (scope === 'direct' && storeAgeKey === 'newStore') {
    return 'directNew';
  }
  if (scope === 'direct' && storeAgeKey === 'renovated') {
    return 'directOld';
  }
  if (scope === 'franchise' && storeAgeKey === 'newStore') {
    return 'franchiseNew';
  }
  if (scope === 'franchise' && storeAgeKey === 'renovated') {
    return 'franchiseOld';
  }
  return '';
}

function readProvinceLabel(project) {
  const raw = String(project?.province || '').trim();
  const label = provinceDisplayName(raw) || raw || PROVINCE_MISSING_LABEL;
  return label;
}

function readStoreStatusLabel(project) {
  return readStoreTierLabel(project) || '未设置';
}

function accumulateDataQuality(project, year, dataQuality) {
  const scope = readFranchiseScope(project);
  const inYear = hasValidEntryStartDate(project) && isInYear(project.startDate, year);

  if ((scope === 'direct' || scope === 'franchise') && !hasValidEntryStartDate(project)) {
    dataQuality.missingStartDate += 1;
    return;
  }

  if (!inYear) {
    return;
  }

  if (isPausedProject(project)) {
    dataQuality.excludedPaused += 1;
    return;
  }

  if (isEntryExcludedCanceled(project)) {
    dataQuality.excludedCanceled += 1;
    return;
  }

  if (scope === 'other') {
    dataQuality.unclassifiedScope += 1;
    return;
  }

  if (!isClassifiedEntryStoreAge(project)) {
    dataQuality.unclassifiedStoreAge += 1;
  }
}

function calculateEntryFieldCoverage(projects, year) {
  const usableProjects = (projects || []).filter((project) => !isEntryExcludedProject(project));
  const scopedProjects = usableProjects.filter(isDirectFranchiseScoped);
  const datedProjects = usableProjects.filter(
    (project) =>
      hasValidEntryStartDate(project) &&
      isInYear(project.startDate, year)
  );
  const scopedDatedProjects = datedProjects.filter(isDirectFranchiseScoped);
  const validEntryProjects = scopedDatedProjects.filter(isClassifiedEntryStoreAge);
  const rate = (items, predicate) => {
    if (!items.length) {
      return 0;
    }
    return Math.round((items.filter(predicate).length / items.length) * 100);
  };
  return {
    startDate: rate(scopedProjects, (project) => hasValidEntryStartDate(project)),
    storeNature: rate(scopedDatedProjects, (project) => isClassifiedEntryStoreAge(project)),
    province: rate(validEntryProjects, (project) => Boolean(String(project?.province || '').trim())),
    businessGroup: rate(datedProjects, (project) => matchesEntryScope(project, 'directFranchise')),
  };
}

function finalizeProvinceRanking(map) {
  return Array.from(map.values()).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'zh-Hans-CN'));
}

function serializeMonthFixed(monthState) {
  for (const quadrantKey of Object.keys(monthState._quadrantMaps)) {
    const maps = monthState._quadrantMaps[quadrantKey];
    monthState.quadrants[quadrantKey].storeStatuses = finalizeRanking(maps.storeStatuses, STORE_STATUS_TOP_LIMIT);
    monthState.quadrants[quadrantKey].provinces = finalizeRanking(maps.provinces, STORE_STATUS_TOP_LIMIT);
  }
  monthState.storeStatuses = finalizeRanking(monthState._storeStatusMap, STORE_STATUS_TOP_LIMIT);
  monthState.provinces = finalizeProvinceRanking(monthState._provinceMap);
  delete monthState._storeStatusMap;
  delete monthState._provinceMap;
  delete monthState._quadrantMaps;
  return monthState;
}

export function buildAnnualEntryStructure(projects, options = {}) {
  const now = options.now || new Date();
  const year = Number(options.year) || dashboardYear(now);
  const months = Array.from({ length: 12 }, (_, index) => createEmptyMonth(index + 1));
  const dataQuality = {
    missingStartDate: 0,
    unclassifiedStoreAge: 0,
    unclassifiedScope: 0,
    excludedPaused: 0,
    excludedCanceled: 0,
  };
  const totals = {
    entry: 0,
    newStore: 0,
    oldStore: 0,
    direct: 0,
    franchise: 0,
  };

  for (const project of projects || []) {
    accumulateDataQuality(project, year, dataQuality);
  }

  for (const project of projects || []) {
    if (!isValidYearEntryProject(project, year, 'directFranchise')) {
      continue;
    }

    const monthIndex = entryMonth(project) - 1;
    if (monthIndex < 0 || monthIndex > 11) {
      continue;
    }

    const monthState = months[monthIndex];
    const scope = readFranchiseScope(project);
    const storeAgeKey = readStoreNatureKey(project);
    const isNewStore = storeAgeKey === 'newStore';
    const storeAgeBucket = isNewStore ? monthState.newStore : monthState.oldStore;
    const quadrantKey = resolveQuadrantKey(scope, storeAgeKey);

    monthState.total += 1;
    storeAgeBucket.total += 1;
    if (scope === 'direct') {
      storeAgeBucket.direct += 1;
      totals.direct += 1;
    } else {
      storeAgeBucket.franchise += 1;
      totals.franchise += 1;
    }
    if (isNewStore) {
      totals.newStore += 1;
    } else {
      totals.oldStore += 1;
    }
    totals.entry += 1;

    const storeStatusLabel = readStoreStatusLabel(project);
    const provinceLabel = readProvinceLabel(project);
    bumpRankingBucket(readRankingMap(monthState._storeStatusMap, storeStatusLabel, storeStatusLabel), project, scope, storeAgeKey);
    bumpRankingBucket(readRankingMap(monthState._provinceMap, provinceLabel, provinceLabel), project, scope, storeAgeKey);

    if (quadrantKey) {
      const quadrant = monthState.quadrants[quadrantKey];
      quadrant.total += 1;
      const maps = monthState._quadrantMaps[quadrantKey];
      bumpRankingBucket(
        readRankingMap(maps.storeStatuses, storeStatusLabel, storeStatusLabel),
        project,
        scope,
        storeAgeKey
      );
      bumpRankingBucket(readRankingMap(maps.provinces, provinceLabel, provinceLabel), project, scope, storeAgeKey);
    }
  }

  let defaultMonth = 0;
  for (let index = months.length - 1; index >= 0; index -= 1) {
    if (months[index].total > 0) {
      defaultMonth = index + 1;
      break;
    }
  }

  return {
    year,
    defaultMonth,
    totals,
    dataQuality,
    fieldCoverage: calculateEntryFieldCoverage(projects, year),
    months: months.map((monthState) => serializeMonthFixed(monthState)),
  };
}
