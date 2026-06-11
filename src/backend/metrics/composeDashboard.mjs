import {
  hasClassifiableStoreStatus,
  isOtherStoreTierKey,
  matchesOwnerMonthlyTier,
  readStoreTier,
  readStoreTierLabel,
} from './fieldSemantics.mjs';
import {
  calculateFieldCoverage,
  calculateMonthlyOps,
  calculateStoreSegmentKpis,
  calculateTierKpis,
  sumTierValues,
} from './calculators.mjs';
import { STORE_SEGMENT_LABELS, STORE_SEGMENT_ORDER } from './fieldSemantics.mjs';
import { buildAnnualEntryStructure } from './buildAnnualEntryStructure.mjs';
import { countYearEntry } from './entryScope.mjs';
import { partitionProjectsByPaused } from './pausedProjects.mjs';
import { getMetricDefinitions, getProfile, MONTHLY_OPS_KEYS, TIER_LABELS } from './profiles.mjs';
import { filterProjectsByProfile } from './scopes.mjs';
import { findResponsibilityIdentity } from '../responsibilityIdentities.mjs';

const TIER_SORT_ORDER = ['regular', 'sinking', 'super', 'flagship', 'premium', 'black', 'other'];
const MONTHLY_OPS_DISCIPLINES = {
  hardMeetingMeasureVolume: 'hard',
  hardPlanVolume: 'hard',
  hardConstructionVolume: 'company',
  pointVolume: 'soft',
  productListVolume: 'company',
  schemeVolume: 'soft',
  purchaseVolume: 'company',
  siteVolume: 'company',
};

function normalizeOwnerDiscipline(value = '') {
  return ['hard', 'soft', 'both'].includes(value) ? value : '';
}

export function buildMonthlyOpsPerspective(ownerDiscipline = '') {
  const discipline = normalizeOwnerDiscipline(ownerDiscipline);
  const metricGroups = {};
  const metricLabels = {};

  for (const [key, metricDiscipline] of Object.entries(MONTHLY_OPS_DISCIPLINES)) {
    if (metricDiscipline === 'company') {
      metricGroups[key] = 'company';
      continue;
    }
    metricGroups[key] = 'primary';
  }

  metricLabels.hardMeetingMeasureVolume = '硬装上会复尺推进';
  metricLabels.hardPlanVolume = '硬装平面推进';
  metricLabels.hardConstructionVolume = '施工图记录';
  metricLabels.pointVolume = '点位设计推进';
  metricLabels.productListVolume = '产品清单接收';
  metricLabels.schemeVolume = '方案设计推进';
  metricLabels.purchaseVolume = '采购推进';
  metricLabels.siteVolume = '摆场交付';

  const disciplineLabel = discipline === 'hard' ? '硬装负责人' : discipline === 'soft' ? '软装负责人' : discipline === 'both' ? '创意负责人' : '负责人';
  const summary = `${disciplineLabel}项目盘 · 按公司阶段节点统计，不按执行承接拆分`;

  return {
    title: '本月公司阶段运转概览',
    discipline: discipline || 'all',
    disciplineLabel,
    summary,
    groups: {
      primary: '设计阶段动作',
      collaboration: '跨阶段动作',
      company: '公司后续阶段',
    },
    metricGroups,
    metricLabels,
  };
}

function compareTierKeys(a, b, labels = {}) {
  const indexA = TIER_SORT_ORDER.indexOf(a);
  const indexB = TIER_SORT_ORDER.indexOf(b);
  if (indexA !== -1 || indexB !== -1) {
    return (indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA) - (indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB);
  }
  return String(labels[a] || a).localeCompare(String(labels[b] || b), 'zh-Hans-CN');
}

function resolveTierLabels(scopedProjects, tiers) {
  const labels = { ...TIER_LABELS };
  for (const project of scopedProjects) {
    if (!hasClassifiableStoreStatus(project)) {
      continue;
    }
    const key = readStoreTier(project);
    const label = readStoreTierLabel(project);
    if (key && label && !labels[key]) {
      labels[key] = label;
    }
  }
  for (const tier of tiers) {
    labels[tier] = labels[tier] || (tier.startsWith('custom:') ? tier.slice('custom:'.length) : tier);
  }
  return labels;
}

function resolveProfileTiers(profile, scopedProjects) {
  const fallbackTiers = profile.tiers || ['regular', 'sinking'];
  if (!scopedProjects.length) {
    return fallbackTiers;
  }

  const tierKeys = Array.from(
    new Set(
      scopedProjects
        .filter(hasClassifiableStoreStatus)
        .map((project) => readStoreTier(project))
        .filter(Boolean)
    )
  );
  if (!tierKeys.length) {
    return fallbackTiers;
  }

  const labels = resolveTierLabels(scopedProjects, tierKeys);
  return tierKeys.sort((a, b) => compareTierKeys(a, b, labels));
}

function buildTotals(tierValues, monthlyOps, tiers) {
  const totals = {};
  for (const key of [
    'notStarted',
    'inProgress',
    'openDelayed',
    'schemeDoneYtd',
    'schemeDelayDoneYtd',
    'schemeDelayDoneMonth',
    'schemeDelayedActiveMonth',
    'projectCount',
  ]) {
    totals[key] = sumTierValues(tierValues, key);
  }
  totals.monthlyOps = {};
  for (const key of MONTHLY_OPS_KEYS) {
    totals.monthlyOps[key] = sumTierValues(monthlyOps, key);
  }
  return totals;
}

function dashboardYear(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
}

function resolveEntryScope(profileId) {
  if (profileId === 'direct') {
    return 'direct';
  }
  if (profileId === 'franchise') {
    return 'franchise';
  }
  return 'directFranchise';
}

function buildCurrentYearEntry(allProjects, profileId, options = {}) {
  const now = options.now || new Date();
  const year = options.year ?? dashboardYear(now);
  return {
    year,
    count: countYearEntry(allProjects, year, { scope: resolveEntryScope(profileId) }),
  };
}

export function composeDashboardMetrics(allProjects, profileId, options = {}) {
  const profile = getProfile(profileId);
  const scopedProjects = filterProjectsByProfile(allProjects, profileId, options);
  const { active: metricsProjects, paused: pausedProjects } = partitionProjectsByPaused(scopedProjects);
  const tiers = resolveProfileTiers(profile, metricsProjects);
  const tierLabels = resolveTierLabels(metricsProjects, tiers);
  const tierValues = {};
  const monthlyOps = {};
  const entryStructureProjects = profile.id === 'ownerMonthly' ? scopedProjects : allProjects;

  const owner = options.team?.owner || options.owner || '';
  const ownerIdentity = owner ? findResponsibilityIdentity(owner, options.personnelArchitecture || {}) : null;
  const ownerPerson = ownerIdentity ? {} : owner ? options.personnelArchitecture?.people?.[owner] || {} : {};
  const baseMetricOptions = {
    ...options,
    profileId: profile.id,
    owner,
    ownerDiscipline: options.ownerDiscipline || ownerIdentity?.discipline || ownerPerson.discipline || '',
  };

  for (const tier of tiers) {
    tierValues[tier] = {
      ...calculateTierKpis(metricsProjects, tier, baseMetricOptions),
      projectCount: metricsProjects.filter(
        (project) =>
          hasClassifiableStoreStatus(project) &&
          (profile.id === 'ownerMonthly'
            ? matchesOwnerMonthlyTier(project, tier)
            : tier === 'other'
              ? isOtherStoreTierKey(readStoreTier(project))
              : readStoreTier(project) === tier)
      ).length,
    };
    monthlyOps[tier] = calculateMonthlyOps(metricsProjects, tier, baseMetricOptions);
  }

  const payload = {
    profile: profile.id,
    label: profile.label,
    description: profile.description,
    ownerDiscipline: baseMetricOptions.ownerDiscipline,
    monthlyOpsPerspective: buildMonthlyOpsPerspective(baseMetricOptions.ownerDiscipline),
    scopeCount: metricsProjects.length,
    pausedCount: pausedProjects.length,
    totalScopeCount: scopedProjects.length,
    currentYearEntry: buildCurrentYearEntry(entryStructureProjects, profile.id, options),
    tiers: tierValues,
    monthlyOps,
    totals: buildTotals(tierValues, monthlyOps, tiers),
    fieldCoverage: calculateFieldCoverage(metricsProjects),
    metricDefinitions: getMetricDefinitions(),
    tierLabels,
    tierOrder: tiers,
  };

  if (profile.id === 'department' || profile.id === 'direct' || profile.id === 'franchise') {
    const storeSegments = {};
    for (const segmentKey of STORE_SEGMENT_ORDER) {
      storeSegments[segmentKey] = calculateStoreSegmentKpis(metricsProjects, segmentKey, baseMetricOptions);
    }
    payload.storeSegments = storeSegments;
    payload.storeSegmentOrder = STORE_SEGMENT_ORDER.slice();
    payload.storeSegmentLabels = { ...STORE_SEGMENT_LABELS };
  }

  if (profile.id === 'department') {
    payload.annualEntryStructure = buildAnnualEntryStructure(allProjects, {
      now: options.now,
      year: options.year,
    });
  }

  if (profile.id === 'ownerMonthly') {
    payload.annualEntryStructure = buildAnnualEntryStructure(scopedProjects, {
      now: options.now,
      year: options.year,
    });
  }

  if (profileId === 'ownerMonthly') {
    payload.owner = options.team?.owner || options.owner || '';
    if (ownerIdentity) {
      payload.ownerIdentity = ownerIdentity;
      payload.displayName = ownerIdentity.displayName;
      payload.sourceOwner = ownerIdentity.sourceName;
    }
  }

  return payload;
}
