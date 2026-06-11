import {
  hasOpenDesignResponsibility,
  hasOpenHardDesignResponsibility,
  hasOpenSoftDesignResponsibility,
  isHardDesignResponsibilityCompleted,
  isHardInProgress,
  isHardNotStarted,
  isOpenDesignResponsibilityDelayed,
  isOpenDelayed,
  isProjectInProgress,
  isProjectNotStarted,
  isDesignResponsibilityClosed,
  isSchemeDelayDone,
  isSchemeDone,
  isSchemeDelayed,
  readSoftCompletionStatus,
  isSoftDesignResponsibilityCompleted,
  isSoftDesignResponsibilityStarted,
  isSoftDesignClosed,
  isSoftNotStarted,
  readMetricDate,
  readRawDisplay,
  matchesOwnerMonthlyTier,
  matchesStoreSegment,
  isOtherStoreTierKey,
  hasClassifiableStoreStatus,
  readStoreTier,
  readStoreNatureKey,
  readWorkflowStage,
} from './fieldSemantics.mjs';
import { getProfile, resolveDateFieldsForTier, resolveTierMetricOptions } from './profiles.mjs';
import { isSleepStoreProject } from '../projectTypeRules.mjs';

const EMPTY_VALUES = new Set(['', '未填写', '未填入', '未分配', '暂无', '无']);
const SOFT_COMPLETION_DONE_STATUSES = ['准时完成', '延期完成'];

export function parseDateForMetrics(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }
  const date = /^\d{10,13}$/.test(raw) ? new Date(Number(raw)) : new Date(raw.includes('T') ? raw : `${raw}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDate(value) {
  return parseDateForMetrics(value);
}

export function isInYear(value, year, now = new Date()) {
  const date = parseDate(value);
  if (!date) {
    return false;
  }
  const targetYear = year ?? now.getFullYear();
  return date.getFullYear() === targetYear;
}

export function isInMonth(value, now = new Date()) {
  const date = parseDate(value);
  if (!date) {
    return false;
  }
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export function matchesTier(project, tier, options = {}) {
  if (options.segmentKey) {
    return matchesStoreSegment(project, options.segmentKey);
  }
  if (!tier || tier === 'all') {
    return true;
  }
  if (!hasClassifiableStoreStatus(project)) {
    return false;
  }
  if (options.profileId === 'ownerMonthly') {
    return matchesOwnerMonthlyTier(project, tier);
  }
  const projectTier = readStoreTier(project);
  return tier === 'other' ? isOtherStoreTierKey(projectTier) : projectTier === tier;
}

function metricOptionsForTier(tier, options = {}) {
  const dateFields = resolveDateFieldsForTier(tier, options);
  const tierMetricOptions = resolveTierMetricOptions(tier, options);
  return {
    ...options,
    dateFields,
    ...tierMetricOptions,
  };
}

function tierFilterOptions(metricOptions) {
  return { profileId: metricOptions.profileId, segmentKey: metricOptions.segmentKey };
}

function isOwnerMonthlySoft(options = {}) {
  return options.profileId === 'ownerMonthly' && ['soft', 'both'].includes(options.ownerDiscipline);
}

function isSoftMetricEligible(project) {
  return !isSleepStoreProject(project);
}

function isSoftCompletionDone(project) {
  const status = readSoftCompletionStatus(project);
  return SOFT_COMPLETION_DONE_STATUSES.some((item) => status.includes(item));
}

function isSoftCompletionDelayDone(project) {
  return readSoftCompletionStatus(project).includes('延期完成');
}

function normalizedDesignDiscipline(value = '') {
  return ['hard', 'soft'].includes(value) ? value : '';
}

function ownerMonthlyDesignDisciplines(metricOptions = {}) {
  if (metricOptions.profileId !== 'ownerMonthly') {
    return [];
  }
  if (metricOptions.ownerDiscipline === 'both') {
    return ['hard', 'soft'];
  }
  const discipline = normalizedDesignDiscipline(metricOptions.ownerDiscipline);
  return discipline ? [discipline] : [];
}

function hasHardResponsibilitySignal(project) {
  return Boolean(
    readRawDisplay(project, ['硬装项目进度', '硬装进度']) ||
      project?.hardProgressStage ||
      readRawDisplay(project, ['平面开始时间']) ||
      readRawDisplay(project, ['硬装方案情况（每周五刷新）', '硬装方案情况', '方案情况'])
  );
}

function isHardResponsibilityNotStarted(project) {
  return (
    hasHardResponsibilitySignal(project) &&
    !isHardDesignResponsibilityCompleted(project) &&
    !hasOpenHardDesignResponsibility(project) &&
    isHardNotStarted(project)
  );
}

function isSoftResponsibilityNotStarted(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  return (
    isSoftDesignResponsibilityStarted(project) &&
    !isSoftDesignResponsibilityCompleted(project) &&
    !hasOpenSoftDesignResponsibility(project) &&
    isSoftNotStarted(project)
  );
}

function matchesNotStartedForMetric(project, metricOptions = {}) {
  if (metricOptions.profileId === 'ownerMonthly') {
    return isProjectNotStarted(project, { includeSoftPause: metricOptions.includeSoftPauseInNotStarted });
  }
  const disciplines = ownerMonthlyDesignDisciplines(metricOptions);
  if (!disciplines.length) {
    return isProjectNotStarted(project, { includeSoftPause: metricOptions.includeSoftPauseInNotStarted });
  }
  return disciplines.some((discipline) =>
    discipline === 'hard' ? isHardResponsibilityNotStarted(project) : isSoftResponsibilityNotStarted(project)
  );
}

function matchesInProgressForMetric(project, metricOptions = {}) {
  if (metricOptions.profileId === 'ownerMonthly') {
    return isProjectInProgress(project);
  }
  const disciplines = ownerMonthlyDesignDisciplines(metricOptions);
  if (!disciplines.length) {
    return isProjectInProgress(project);
  }
  return disciplines.some((discipline) =>
    discipline === 'hard'
      ? hasOpenHardDesignResponsibility(project)
      : hasOpenSoftDesignResponsibility(project)
  );
}

function matchesOpenDelayForMetric(project, metricOptions = {}) {
  const discipline = normalizedDesignDiscipline(metricOptions.ownerDiscipline);
  if (metricOptions.profileId === 'ownerMonthly' && discipline) {
    return isOpenDesignResponsibilityDelayed(project, { discipline });
  }
  return isOpenDesignResponsibilityDelayed(project);
}

function normalizedMetricKey(metricKey = '') {
  const aliases = {
    unscheduled: 'notStarted',
    schemeDelayedThisMonth: 'schemeDelayDoneMonth',
    schemeDelayedYtd: 'schemeDelayDoneYtd',
  };
  return aliases[metricKey] || metricKey || 'projectCount';
}

export function matchesMetricProject(project, metricKey = 'projectCount', tier = '', options = {}) {
  const key = normalizedMetricKey(metricKey);
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);

  if (!matchesTier(project, tier, tierOptions)) {
    return false;
  }

  if (key === 'projectCount' || key === 'totalProjects') {
    return true;
  }

  if (key === 'activeProjects') {
    if (metricOptions.profileId === 'ownerMonthly') {
      return isProjectInProgress(project);
    }
    return hasOpenDesignResponsibility(project);
  }

  if (key === 'delayedProjects') {
    return matchesOpenDelayForMetric(project, metricOptions);
  }

  if (key === 'highRiskProjects') {
    return project.riskLevel === '高';
  }

  if (key === 'notStarted') {
    return matchesNotStartedForMetric(project, metricOptions);
  }

  if (key === 'inProgress') {
    return matchesInProgressForMetric(project, metricOptions);
  }

  if (key === 'openDelayed') {
    return matchesOpenDelayForMetric(project, metricOptions);
  }

  if (key === 'schemeDoneYtd') {
    if (isOwnerMonthlySoft(metricOptions)) {
      return isSoftDesignResponsibilityCompleted(project);
    }
    if (!isSchemeDone(project)) {
      return false;
    }
    const profile = getProfile(options.profileId || 'department');
    if (resolveSchemeCountMode(metricOptions, profile) === 'statusOnly') {
      return true;
    }
    const now = options.now || new Date();
    const year = options.year ?? now.getFullYear();
    return projectMatchesDatePredicate(
      project,
      metricOptions.dateFields.schemeDoneYtd,
      (value) => isInYear(value, year, now),
      now
    );
  }

  if (key === 'schemeDelayDoneYtd') {
    if (isOwnerMonthlySoft(metricOptions)) {
      return isSoftDesignResponsibilityCompleted(project) && isSoftCompletionDelayDone(project);
    }
    if (!isSchemeDelayDone(project)) {
      return false;
    }
    const profile = getProfile(options.profileId || 'department');
    if (resolveSchemeCountMode(metricOptions, profile) === 'statusOnly') {
      return true;
    }
    const now = options.now || new Date();
    const year = options.year ?? now.getFullYear();
    return projectMatchesDatePredicate(
      project,
      metricOptions.dateFields.schemeDelayDoneYtd,
      (value) => isInYear(value, year, now),
      now
    );
  }

  if (key === 'schemeDelayDoneMonth') {
    const now = options.now || new Date();
    if (isOwnerMonthlySoft(metricOptions)) {
      if (!isSoftDesignResponsibilityCompleted(project) || !isSoftCompletionDelayDone(project)) {
        return false;
      }
      const doneDate = readMetricDate(project, ['软装完成时间']);
      return Boolean(doneDate && isInMonth(doneDate, now));
    }
    if (!isSchemeDelayDone(project)) {
      return false;
    }
    return projectMatchesDatePredicate(
      project,
      metricOptions.dateFields.schemeDelayDoneMonth,
      (value) => isInMonth(value, now),
      now
    );
  }

  if (key === 'schemeDelayedActiveMonth') {
    if (isOwnerMonthlySoft(metricOptions)) {
      return false;
    }
    if (!hasOpenHardDesignResponsibility(project) || !isSchemeDelayed(project) || isSchemeDelayDone(project)) {
      return false;
    }
    const now = options.now || new Date();
    return projectMatchesDatePredicate(
      project,
      ['updatedAt', 'startDate', '上会日期'],
      (value) => isInMonth(value, now),
      now
    );
  }

  if (key === 'pointVolume') {
    const now = options.now || new Date();
    return (
      hasPointProgress(project) &&
      projectMatchesDatePredicate(
        project,
        metricOptions.dateFields.pointVolume,
        (value) => isInMonth(value, now),
        now
      )
    );
  }

  if (key === 'hardMeetingMeasureVolume') {
    const now = options.now || new Date();
    return projectMatchesDatePredicate(
      project,
      metricOptions.dateFields.hardMeetingMeasureVolume,
      (value) => isInMonth(value, now),
      now
    );
  }

  if (key === 'hardPlanVolume') {
    const now = options.now || new Date();
    return projectMatchesDatePredicate(
      project,
      metricOptions.dateFields.hardPlanVolume,
      (value) => isInMonth(value, now),
      now
    );
  }

  if (key === 'hardConstructionVolume') {
    const now = options.now || new Date();
    return projectMatchesDatePredicate(
      project,
      metricOptions.dateFields.hardConstructionVolume,
      (value) => isInMonth(value, now),
      now
    );
  }

  if (key === 'productListVolume') {
    const now = options.now || new Date();
    return projectMatchesDatePredicate(
      project,
      metricOptions.dateFields.productListVolume,
      (value) => isInMonth(value, now),
      now
    );
  }

  if (key === 'schemeVolume') {
    const now = options.now || new Date();
    return projectMatchesDatePredicate(
      project,
      metricOptions.dateFields.schemeVolume,
      (value) => isInMonth(value, now),
      now
    );
  }

  if (key === 'purchaseVolume') {
    const now = options.now || new Date();
    return projectMatchesDatePredicate(
      project,
      metricOptions.dateFields.purchaseVolume,
      (value) => isInMonth(value, now),
      now
    );
  }

  if (key === 'siteVolume') {
    const now = options.now || new Date();
    const dateFields = metricOptions.dateFields.siteVolume;
    if (!isSiteStage(project)) {
      return false;
    }
    if (projectMatchesDatePredicate(project, dateFields, (value) => isInMonth(value, now), now)) {
      return true;
    }
    const stage = readWorkflowStage(project, { discipline: 'soft' });
    if (stage === '摆场') {
      const dueDate = readMetricDate(project, ['dueDate']);
      return Boolean(dueDate && isInMonth(dueDate, now));
    }
    return false;
  }

  return true;
}

export function countNotStarted(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);
  return projects.filter(
    (project) =>
      matchesTier(project, tier, tierOptions) &&
      matchesNotStartedForMetric(project, metricOptions)
  ).length;
}

export function countInProgress(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);
  return projects.filter(
    (project) => matchesTier(project, tier, tierOptions) && matchesInProgressForMetric(project, metricOptions)
  ).length;
}

export function countOpenDelayed(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);
  return projects
    .filter(
      (project) =>
        matchesTier(project, tier, tierOptions) &&
        matchesOpenDelayForMetric(project, metricOptions)
    )
    .length;
}

function projectMatchesDatePredicate(project, dateFields, predicate, now) {
  for (const fieldName of dateFields) {
    const value = readMetricDate(project, [fieldName]);
    if (value && predicate(value, now)) {
      return true;
    }
  }
  return false;
}

function resolveSchemeCountMode(metricOptions, profile) {
  return metricOptions.schemeCountMode || profile.schemeCountMode || 'yearRequired';
}

export function countSchemeDoneYtd(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const profile = getProfile(options.profileId || 'department');
  const schemeCountMode = resolveSchemeCountMode(metricOptions, profile);
  const tierOptions = tierFilterOptions(metricOptions);

  if (isOwnerMonthlySoft(metricOptions)) {
    return projects.filter((project) => matchesTier(project, tier, tierOptions) && isSoftMetricEligible(project) && isSoftDesignResponsibilityCompleted(project)).length;
  }

  return projects.filter((project) => {
    if (!matchesTier(project, tier, tierOptions) || !isSchemeDone(project)) {
      return false;
    }
    if (schemeCountMode === 'statusOnly') {
      return true;
    }
    const dateFields = metricOptions.dateFields.schemeDoneYtd;
    const now = options.now || new Date();
    const year = options.year ?? now.getFullYear();
    return projectMatchesDatePredicate(project, dateFields, (value) => isInYear(value, year, now), now);
  }).length;
}

export function countSchemeDelayDoneYtd(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const profile = getProfile(options.profileId || 'department');
  const schemeCountMode = resolveSchemeCountMode(metricOptions, profile);
  const tierOptions = tierFilterOptions(metricOptions);

  if (isOwnerMonthlySoft(metricOptions)) {
    return projects.filter(
      (project) =>
        matchesTier(project, tier, tierOptions) &&
        isSoftMetricEligible(project) &&
        isSoftDesignResponsibilityCompleted(project) &&
        isSoftCompletionDelayDone(project)
    ).length;
  }

  return projects.filter((project) => {
    if (!matchesTier(project, tier, tierOptions) || !isSchemeDelayDone(project)) {
      return false;
    }
    if (schemeCountMode === 'statusOnly') {
      return true;
    }
    const dateFields = metricOptions.dateFields.schemeDelayDoneYtd;
    const now = options.now || new Date();
    const year = options.year ?? now.getFullYear();
    return projectMatchesDatePredicate(project, dateFields, (value) => isInYear(value, year, now), now);
  }).length;
}

export function countSchemeDelayDoneMonth(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const dateFields = metricOptions.dateFields.schemeDelayDoneMonth;
  const tierOptions = tierFilterOptions(metricOptions);
  const now = options.now || new Date();

  if (isOwnerMonthlySoft(metricOptions)) {
    return projects.filter((project) => {
      if (
        !matchesTier(project, tier, tierOptions) ||
        !isSoftMetricEligible(project) ||
        !isSoftDesignResponsibilityCompleted(project) ||
        !isSoftCompletionDelayDone(project)
      ) {
        return false;
      }
      const doneDate = readMetricDate(project, ['软装完成时间']);
      return doneDate && isInMonth(doneDate, now);
    }).length;
  }

  return projects.filter((project) => {
    if (!matchesTier(project, tier, tierOptions) || !isSchemeDelayDone(project)) {
      return false;
    }
    return projectMatchesDatePredicate(project, dateFields, (value) => isInMonth(value, now), now);
  }).length;
}

/** 本月方案延期（进行中），方案字段含延期但非「延期完成」。 */
export function countSchemeDelayedActiveMonth(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);
  const now = options.now || new Date();
  if (isOwnerMonthlySoft(metricOptions)) {
    return 0;
  }
  return projects.filter((project) => {
    if (!matchesTier(project, tier, tierOptions) || !hasOpenHardDesignResponsibility(project)) {
      return false;
    }
    if (!isSchemeDelayed(project) || isSchemeDelayDone(project)) {
      return false;
    }
    return projectMatchesDatePredicate(
      project,
      ['updatedAt', 'startDate', '上会日期'],
      (value) => isInMonth(value, now),
      now
    );
  }).length;
}

export function countSchemeDelayed(projects, tier, options = {}) {
  const tierOptions = tierFilterOptions(options);
  return projects.filter((project) => matchesTier(project, tier, tierOptions) && isSchemeDelayed(project)).length;
}

function hasPointProgress(project) {
  if (!isSoftMetricEligible(project)) {
    return false;
  }
  const status = readRawDisplay(project, ['点位完成情况']);
  return Boolean(status && !EMPTY_VALUES.has(status));
}

function isSiteStage(project) {
  const stage = readWorkflowStage(project, { discipline: 'soft' });
  return stage === '摆场';
}

export function countPointVolume(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);
  const now = options.now || new Date();
  return projects.filter((project) => {
    if (!matchesTier(project, tier, tierOptions) || !hasPointProgress(project)) {
      return false;
    }
    return projectMatchesDatePredicate(
      project,
      metricOptions.dateFields.pointVolume,
      (value) => isInMonth(value, now),
      now
    );
  }).length;
}

export function countHardMeetingMeasureVolume(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);
  const now = options.now || new Date();
  return projects.filter(
    (project) =>
      matchesTier(project, tier, tierOptions) &&
      projectMatchesDatePredicate(
        project,
        metricOptions.dateFields.hardMeetingMeasureVolume,
        (value) => isInMonth(value, now),
        now
      )
  ).length;
}

export function countHardPlanVolume(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);
  const now = options.now || new Date();
  return projects.filter(
    (project) =>
      matchesTier(project, tier, tierOptions) &&
      projectMatchesDatePredicate(
        project,
        metricOptions.dateFields.hardPlanVolume,
        (value) => isInMonth(value, now),
        now
      )
  ).length;
}

export function countHardConstructionVolume(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);
  const now = options.now || new Date();
  return projects.filter(
    (project) =>
      matchesTier(project, tier, tierOptions) &&
      projectMatchesDatePredicate(
        project,
        metricOptions.dateFields.hardConstructionVolume,
        (value) => isInMonth(value, now),
        now
      )
  ).length;
}

export function countProductListVolume(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);
  const now = options.now || new Date();
  return projects.filter(
    (project) =>
      matchesTier(project, tier, tierOptions) &&
      isSoftMetricEligible(project) &&
      projectMatchesDatePredicate(
        project,
        metricOptions.dateFields.productListVolume,
        (value) => isInMonth(value, now),
        now
      )
  ).length;
}

export function countSchemeVolume(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);
  const now = options.now || new Date();
  return projects.filter((project) => {
    if (!matchesTier(project, tier, tierOptions)) {
      return false;
    }
    if (!isSoftMetricEligible(project)) {
      return false;
    }
    return projectMatchesDatePredicate(
      project,
      metricOptions.dateFields.schemeVolume,
      (value) => isInMonth(value, now),
      now
    );
  }).length;
}

export function countPurchaseVolume(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const tierOptions = tierFilterOptions(metricOptions);
  const now = options.now || new Date();
  return projects.filter(
    (project) =>
      matchesTier(project, tier, tierOptions) &&
      isSoftMetricEligible(project) &&
      projectMatchesDatePredicate(
        project,
        metricOptions.dateFields.purchaseVolume,
        (value) => isInMonth(value, now),
        now
      )
  ).length;
}

export function countSiteVolume(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  const dateFields = metricOptions.dateFields.siteVolume;
  const tierOptions = tierFilterOptions(metricOptions);
  const now = options.now || new Date();

  return projects.filter((project) => {
    if (!matchesTier(project, tier, tierOptions) || !isSoftMetricEligible(project) || !isSiteStage(project)) {
      return false;
    }
    if (projectMatchesDatePredicate(project, dateFields, (value) => isInMonth(value, now), now)) {
      return true;
    }
    const stage = readWorkflowStage(project, { discipline: 'soft' });
    if (stage === '摆场') {
      const dueDate = readMetricDate(project, ['dueDate']);
      return dueDate && isInMonth(dueDate, now);
    }
    return false;
  }).length;
}

export function calculateTierKpis(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  return {
    notStarted: countNotStarted(projects, tier, metricOptions),
    inProgress: countInProgress(projects, tier, metricOptions),
    openDelayed: countOpenDelayed(projects, tier, metricOptions),
    schemeDoneYtd: countSchemeDoneYtd(projects, tier, metricOptions),
    schemeDelayDoneYtd: countSchemeDelayDoneYtd(projects, tier, metricOptions),
    schemeDelayDoneMonth: countSchemeDelayDoneMonth(projects, tier, metricOptions),
    schemeDelayedActiveMonth: countSchemeDelayedActiveMonth(projects, tier, metricOptions),
  };
}

export function calculateStoreSegmentKpis(projects, segmentKey, options = {}) {
  const segmentOptions = { ...options, segmentKey };
  return {
    ...calculateTierKpis(projects, 'all', segmentOptions),
    projectCount: projects.filter((project) => matchesStoreSegment(project, segmentKey)).length,
  };
}

export function calculateMonthlyOps(projects, tier, options = {}) {
  const metricOptions = metricOptionsForTier(tier, options);
  return {
    hardMeetingMeasureVolume: countHardMeetingMeasureVolume(projects, tier, metricOptions),
    hardPlanVolume: countHardPlanVolume(projects, tier, metricOptions),
    hardConstructionVolume: countHardConstructionVolume(projects, tier, metricOptions),
    pointVolume: countPointVolume(projects, tier, metricOptions),
    productListVolume: countProductListVolume(projects, tier, metricOptions),
    schemeVolume: countSchemeVolume(projects, tier, metricOptions),
    purchaseVolume: countPurchaseVolume(projects, tier, metricOptions),
    siteVolume: countSiteVolume(projects, tier, metricOptions),
  };
}

export function calculateFieldCoverage(projects) {
  if (!projects.length) {
    return {
      hardWorkflow: 0,
      softWorkflow: 0,
      schemeStatus: 0,
      storeTier: 0,
      pointStatus: 0,
      entryDate: 0,
    };
  }

  const rate = (predicate) => Math.round((projects.filter(predicate).length / projects.length) * 100);

  return {
    hardWorkflow: rate((project) => Boolean(readRawDisplay(project, ['硬装项目进度']))),
    softWorkflow: rate((project) => Boolean(readRawDisplay(project, ['软装项目进度']))),
    schemeStatus: rate((project) => Boolean(readRawDisplay(project, ['硬装方案情况（每周五刷新）', '硬装方案情况']))),
    storeTier: rate((project) => readStoreTier(project) !== 'other'),
    storeNature: rate((project) => readStoreNatureKey(project) !== 'other'),
    pointStatus: rate((project) => Boolean(readRawDisplay(project, ['点位完成情况']))),
    entryDate: rate((project) => Boolean(project.startDate)),
  };
}

export function sumTierValues(tierMap, key) {
  return Object.values(tierMap).reduce((sum, tierValues) => sum + (tierValues?.[key] || 0), 0);
}

export function countActiveProjects(projects) {
  return projects.filter((project) => hasOpenDesignResponsibility(project)).length;
}

export {
  isSchemeDelayed,
  isOpenDelayed,
  isOpenDesignResponsibilityDelayed,
  isProjectNotStarted,
  isHardInProgress,
  isDesignResponsibilityClosed,
  isSoftDesignClosed,
};
