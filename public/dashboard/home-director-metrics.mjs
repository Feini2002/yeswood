import {
  LIFECYCLE_STAGE_ORDER,
  classifyProjectLifecycleStage,
  deriveProjectWorkflowFacts,
  readRawFieldDisplay,
} from './project-lifecycle.mjs';
import { isClassifiableStoreStatus } from '../lib/constants.mjs';
import { isStandardProvinceDisplayName, provinceDisplayName } from './province-display.mjs';

export { readRawFieldDisplay } from './project-lifecycle.mjs';

export const HOME_MONTHLY_OPS_METRICS = [
  { key: 'hardMeetingMeasureVolume', label: '硬装上会复尺' },
  { key: 'hardPlanVolume', label: '硬装平面' },
  { key: 'hardConstructionVolume', label: '施工图记录' },
  { key: 'pointVolume', label: '点位设计' },
  { key: 'productListVolume', label: '产品清单接收' },
  { key: 'schemeVolume', label: '方案设计' },
  { key: 'purchaseVolume', label: '采购推进' },
  { key: 'siteVolume', label: '摆场推进' },
];

const HOME_REGION_ROW_LIMIT = 8;

const FIELD_ALIASES = {
  hardStage: ['硬装项目进度', '硬装进度'],
  softStage: ['软装项目进度', '软装进度'],
  hardSchemeStatus: ['硬装方案情况（每周五刷新）', '硬装方案情况', '方案情况'],
  hardCompletion: ['硬装方案完成时间', '躺平内部审核结束时间', '内部审核结束时间'],
  hardStart: ['平面开始时间'],
  pointStatus: ['点位完成情况'],
  pointDone: ['点位完成时间'],
  softStart: ['软装方案开始时间'],
  softCompletion: ['软装完成情况'],
  storeTier: ['店态'],
  projectName: ['项目名称', '门店名称'],
  storeNature: ['店铺性质', '门店性质', '项目类型'],
  businessGroup: ['组别'],
  startDate: ['启动时间', '启动日期'],
  constructionReview: ['施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）', '施工图完成审核时间'],
  cdOwner: ['CD负责人', '硬装负责人'],
  vmOwner: ['VM负责人', '软装负责人'],
};

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(safeNumber(value) * factor) / factor;
}

function pct(part, total) {
  const denominator = safeNumber(total);
  if (!denominator) {
    return 0;
  }
  return Math.round((safeNumber(part) / denominator) * 100);
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

const SLEEP_STORE_STATUS = '睡眠店';
const SLEEP_STORE_NAME_PATTERN = /睡眠店/;
const SLEEP_HARD_CLOSED_STAGE_PATTERN = /^(闭环|完成|已完成)$/;
const SLEEP_CONSTRUCTION_CLOSED_STAGE_PATTERN =
  /施工.*闭环|施工图.*完成.*审核|施工图.*审核.*完成|施工图.*审核.*通过|施工图完成审核|施工图审核通过/;
const FORM_CLOSED_STAGES = new Set(['闭环']);
const FORM_PAUSED_STAGE_PATTERN = /暂停/;
const FORM_PAUSE_RECOVERY_PATTERN = /曾暂停|历史暂停|暂停后(?:恢复|复工|重启|继续|推进)|暂停.*(?:恢复|复工|重启|继续|推进)/;
const FORM_REPAUSED_STAGE_PATTERN = /(?:再次|重新|又).*暂停|(?:恢复|复工|重启|继续|推进)后.*暂停/;
const FORM_CANCELED_PATTERN = /取消|已取消|关闭|已关闭/;
const HARD_STAGE_AT_OR_AFTER_CONSTRUCTION_PATTERN = /施工图|施工整改|待采购|摆场|闭环|已完成|^完成$|点位/;
const SOFT_STAGE_AT_OR_AFTER_POINT_PATTERN = /点位|软装方案|软装完成|产品清单|待采购|采购|摆场|闭环|^完成$|已完成/;

function isSleepStoreProject(project = {}) {
  const storeStatus = normalizeText(project.storeStatus) || readRawFieldDisplay(project, FIELD_ALIASES.storeTier);
  if (storeStatus === SLEEP_STORE_STATUS) {
    return true;
  }
  const projectName = [project.name, readRawFieldDisplay(project, FIELD_ALIASES.projectName)]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
  return SLEEP_STORE_NAME_PATTERN.test(projectName);
}

function readWorkflowStage(project, discipline = 'hard') {
  if (discipline === 'soft' && isSleepStoreProject(project)) {
    return '';
  }
  const rawStage = readRawFieldDisplay(project, discipline === 'soft' ? FIELD_ALIASES.softStage : FIELD_ALIASES.hardStage);
  if (rawStage) {
    return rawStage;
  }
  return normalizeText(project?.[discipline === 'soft' ? 'softProgressStage' : 'hardProgressStage']);
}

function parseTime(value) {
  if (value === undefined || value === null || value === '') {
    return Number.NaN;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10000000000 ? value * 1000 : value;
  }
  const raw = normalizeText(value);
  if (!raw) {
    return Number.NaN;
  }
  if (/^\d{10,13}$/.test(raw)) {
    const timestamp = Number(raw);
    return raw.length === 10 ? timestamp * 1000 : timestamp;
  }
  const dateOnly = raw.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (dateOnly) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function monthKey(value) {
  const timestamp = parseTime(value);
  if (!Number.isFinite(timestamp)) {
    return '';
  }
  const date = new Date(timestamp);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}

function dateYear(value) {
  const timestamp = parseTime(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).getUTCFullYear();
}

function dashboardYear(now = new Date()) {
  const timestamp = parseTime(now);
  if (!Number.isFinite(timestamp)) {
    return new Date().getUTCFullYear();
  }
  return new Date(timestamp).getUTCFullYear();
}

function dateDistanceDays(value, now = new Date()) {
  const timestamp = parseTime(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((timestamp - today) / 86400000);
}

function isUrgent(project) {
  return !isDesignResponsibilityClosed(project) && normalizeText(project?.status).includes('紧急');
}

function isDelayed(project) {
  if (isDesignResponsibilityClosed(project)) {
    return false;
  }
  const hardSchemeDelayed = /延期/.test(readRawFieldDisplay(project, FIELD_ALIASES.hardSchemeStatus));
  const softCompletionDelayed = isSoftCompletionOpenDelayed(project);
  return (
    (hasOpenHardDesignResponsibility(project) && hardSchemeDelayed) ||
    (hasOpenSoftDesignResponsibility(project) && softCompletionDelayed)
  );
}

function isHighRisk(project) {
  return !isDesignResponsibilityClosed(project) && normalizeText(project?.riskLevel) === '高';
}

function splitOwnerNames(value) {
  return normalizeText(value)
    .split(/[、,，/|；;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function ownerNamesFromProjectField(project, propertyName, fieldAliases = []) {
  const propertyNames = splitOwnerNames(project?.[propertyName]);
  if (propertyNames.length || Object.prototype.hasOwnProperty.call(project || {}, propertyName)) {
    return propertyNames;
  }
  return fieldAliases.flatMap((fieldName) => splitOwnerNames(readRawFieldDisplay(project, [fieldName])));
}

function projectTeamOwnerNames(project) {
  const names = new Set([
    ...ownerNamesFromProjectField(project, 'cdOwner', FIELD_ALIASES.cdOwner),
    ...ownerNamesFromProjectField(project, 'vmOwner', FIELD_ALIASES.vmOwner),
  ]);
  return Array.from(names);
}

function projectOwnerDisplay(project) {
  if (isSleepStoreProject(project)) {
    return normalizeText(project?.cdOwner || project?.ownerDisplay || project?.owner) || '未分配';
  }
  return normalizeText(project?.ownerDisplay || project?.owner || project?.cdOwner || project?.vmOwner) || '未分配';
}

function projectBusinessScope(project) {
  const scope = normalizeText(project?.franchiseScope);
  if (scope === 'direct' || scope === 'franchise') {
    return scope;
  }
  const group = readRawFieldDisplay(project, FIELD_ALIASES.businessGroup);
  if (/加盟/.test(group)) {
    return 'franchise';
  }
  if (/直营|自营/.test(group)) {
    return 'direct';
  }
  return 'other';
}

function projectStageText(project) {
  const hard = readWorkflowStage(project, 'hard');
  const soft = readWorkflowStage(project, 'soft');
  return [hard, soft, project?.status, project?.progress ? `${project.progress}%` : ''].filter(Boolean).join(' ');
}

function isClosedStage(stage) {
  return stage === '闭环' || stage === '完成' || stage === '已完成';
}

function isHardWorkflowClosed(project) {
  const hardStage = readWorkflowStage(project, 'hard');
  if (isSleepStoreProject(project)) {
    return (
      Boolean(readRawFieldDisplay(project, FIELD_ALIASES.constructionReview)) ||
      SLEEP_HARD_CLOSED_STAGE_PATTERN.test(hardStage) ||
      SLEEP_CONSTRUCTION_CLOSED_STAGE_PATTERN.test(hardStage)
    );
  }
  return isClosedStage(hardStage);
}

function isSoftCompletionDone(project) {
  return /准时完成|延期完成/.test(readRawFieldDisplay(project, FIELD_ALIASES.softCompletion));
}

function isSoftWorkflowClosed(project) {
  return isClosedStage(readWorkflowStage(project, 'soft'));
}

function isSoftCompletionOpenDelayed(project) {
  const text = readRawFieldDisplay(project, FIELD_ALIASES.softCompletion);
  return Boolean(text && /延期/.test(text) && !/延期完成/.test(text));
}

function isCompleteText(value) {
  const text = normalizeText(value);
  if (!text || /未完成|未开始|未启动|未安排|待|延期中|暂停/.test(text)) {
    return false;
  }
  return /准时完成|延期完成|已完成|完成|闭环/.test(text);
}

function isPointDesignStarted(project) {
  const hardStage = readWorkflowStage(project, 'hard');
  const softStage = readWorkflowStage(project, 'soft');
  return Boolean(
    readRawFieldDisplay(project, FIELD_ALIASES.hardCompletion) ||
      (hardStage && !isStoppedFormWorkflowStage(hardStage) && HARD_STAGE_AT_OR_AFTER_CONSTRUCTION_PATTERN.test(hardStage)) ||
      (softStage && !isStoppedFormWorkflowStage(softStage) && SOFT_STAGE_AT_OR_AFTER_POINT_PATTERN.test(softStage)) ||
      readRawFieldDisplay(project, FIELD_ALIASES.pointStatus) ||
      readRawFieldDisplay(project, FIELD_ALIASES.pointDone)
  );
}

function isPointDesignCompleted(project) {
  return Boolean(
    readRawFieldDisplay(project, FIELD_ALIASES.pointDone) ||
      isCompleteText(readRawFieldDisplay(project, FIELD_ALIASES.pointStatus)) ||
      (isSoftWorkflowClosed(project) && isSoftCompletionDone(project))
  );
}

function isHardDesignResponsibilityCompleted(project) {
  return Boolean(readRawFieldDisplay(project, FIELD_ALIASES.hardCompletion));
}

function isHardDesignResponsibilityStarted(project) {
  return Boolean(
    readRawFieldDisplay(project, FIELD_ALIASES.hardCompletion) ||
      readRawFieldDisplay(project, FIELD_ALIASES.hardStart)
  );
}

function isSoftDesignResponsibilityStarted(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  return Boolean(
    isPointDesignStarted(project) ||
      readRawFieldDisplay(project, FIELD_ALIASES.softStart) ||
      readRawFieldDisplay(project, FIELD_ALIASES.softCompletion)
  );
}

function hasOpenHardDesignResponsibility(project) {
  if (isHardDesignResponsibilityCompleted(project) || (isSleepStoreProject(project) && isHardWorkflowClosed(project))) {
    return false;
  }
  return isHardDesignResponsibilityStarted(project);
}

function hasOpenSoftDesignResponsibility(project) {
  return isSoftDesignResponsibilityStarted(project) && !(isPointDesignCompleted(project) && isSoftCompletionDone(project));
}

function isDesignResponsibilityClosed(project) {
  if (isSleepStoreProject(project)) {
    return isHardWorkflowClosed(project);
  }
  const hasHardTrack = isHardDesignResponsibilityStarted(project);
  const hasSoftTrack = isSoftDesignResponsibilityStarted(project);

  if (!hasHardTrack && !hasSoftTrack) {
    return false;
  }
  return (
    (!hasHardTrack || isHardDesignResponsibilityCompleted(project)) &&
    (!hasSoftTrack || (isPointDesignCompleted(project) && isSoftCompletionDone(project)))
  );
}

export function classifyProjectStage(project) {
  return classifyProjectLifecycleStage(project);
}

function projectEntryYear(project) {
  return dateYear(project?.startDate || readRawFieldDisplay(project, FIELD_ALIASES.startDate));
}

function countCurrentYearEntryProjects(projects = [], now = new Date()) {
  const year = dashboardYear(now);
  return (projects || []).filter((project) => classifyProjectStage(project).key !== 'paused' && projectEntryYear(project) === year).length;
}

function currentYearEntrySummary(departmentMetrics = {}, projects = [], now = new Date()) {
  const backendEntry = departmentMetrics?.currentYearEntry;
  const backendCount = Number(backendEntry?.count);
  if (Number.isFinite(backendCount)) {
    return {
      year: safeNumber(backendEntry?.year, dashboardYear(now)),
      count: backendCount,
    };
  }
  return {
    year: dashboardYear(now),
    count: countCurrentYearEntryProjects(projects, now),
  };
}

function rawHardStage(project) {
  return readWorkflowStage(project, 'hard');
}

function rawSoftStage(project) {
  return readWorkflowStage(project, 'soft');
}

function isFormScopedProject(project) {
  return ['direct', 'franchise'].includes(projectBusinessScope(project));
}

function isCurrentPausedWorkflowStage(stage) {
  const text = normalizeText(stage);
  if (!FORM_PAUSED_STAGE_PATTERN.test(text)) {
    return false;
  }
  if (FORM_REPAUSED_STAGE_PATTERN.test(text)) {
    return true;
  }
  return !FORM_PAUSE_RECOVERY_PATTERN.test(text);
}

function isStoppedFormWorkflowStage(stage) {
  return isCurrentPausedWorkflowStage(stage) || FORM_CANCELED_PATTERN.test(normalizeText(stage));
}

function isFormPausedOrCanceled(project) {
  const hardStage = rawHardStage(project);
  const softStage = rawSoftStage(project);
  if (isCurrentPausedWorkflowStage(hardStage) || isCurrentPausedWorkflowStage(softStage)) {
    return true;
  }
  return FORM_CANCELED_PATTERN.test(
    [hardStage, softStage, project?.status, readRawFieldDisplay(project, ['项目状态', '状态'])]
      .map(normalizeText)
      .filter(Boolean)
      .join(' ')
  );
}

function isFormClosedProject(project) {
  return FORM_CLOSED_STAGES.has(rawHardStage(project)) || FORM_CLOSED_STAGES.has(rawSoftStage(project));
}

function countProjects(projects, predicate, scope = '') {
  return projects.filter((project) => (!scope || projectBusinessScope(project) === scope) && predicate(project)).length;
}

function projectBoardSummary(projects = [], now = new Date()) {
  const year = dashboardYear(now);
  const previousYear = year - 1;
  const scopedProjects = (projects || []).filter(isFormScopedProject);
  const currentYearEntryPredicate = (project) => projectEntryYear(project) === year && !isFormPausedOrCanceled(project);
  const previousYearUnclosedPredicate = (project) =>
    projectEntryYear(project) === previousYear && !isFormPausedOrCanceled(project) && !isFormClosedProject(project);
  const closedPredicate = (project) => !isFormPausedOrCanceled(project) && isFormClosedProject(project);

  return {
    year,
    previousYear,
    currentYearEntryTotal: countProjects(scopedProjects, currentYearEntryPredicate),
    currentYearEntryDirect: countProjects(scopedProjects, currentYearEntryPredicate, 'direct'),
    currentYearEntryFranchise: countProjects(scopedProjects, currentYearEntryPredicate, 'franchise'),
    pausedOrCanceled: countProjects(scopedProjects, isFormPausedOrCanceled),
    closedProjectTotal: countProjects(scopedProjects, closedPredicate),
    closedProjectDirect: countProjects(scopedProjects, closedPredicate, 'direct'),
    closedProjectFranchise: countProjects(scopedProjects, closedPredicate, 'franchise'),
    previousYearUnclosedTotal: countProjects(scopedProjects, previousYearUnclosedPredicate),
    previousYearUnclosedDirect: countProjects(scopedProjects, previousYearUnclosedPredicate, 'direct'),
    previousYearUnclosedFranchise: countProjects(scopedProjects, previousYearUnclosedPredicate, 'franchise'),
  };
}

function readMatrixStoreStatus(project) {
  const label = normalizeText(project.storeStatus) || readRawFieldDisplay(project, FIELD_ALIASES.storeTier) || '未设置';
  return isClassifiableStoreStatus(label) ? label : '';
}

function isClassifiableTierLabel(label, key = '') {
  const resolved = String(label ?? '').trim() || (String(key).startsWith('custom:') ? key.slice('custom:'.length) : String(key));
  return isClassifiableStoreStatus(resolved);
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = normalizeText(keyFn(item)) || '未设置';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function displayProvinceName(label) {
  const normalized = normalizeText(label) || '未设置';
  return provinceDisplayName(normalized) || normalized;
}

function isNonStandardProvinceName(label) {
  return !isStandardProvinceDisplayName(normalizeText(label) || '未设置');
}

function buildProvinceNameAudit(projects = []) {
  const sourceCounts = countBy(projects, (project) => project.province);
  const sourceByDisplay = new Map();
  for (const item of sourceCounts) {
    const displayName = displayProvinceName(item.label);
    const bucket = sourceByDisplay.get(displayName) || { displayName, labels: [], count: 0 };
    bucket.labels.push(item);
    bucket.count += item.value;
    sourceByDisplay.set(displayName, bucket);
  }

  const issues = [];
  for (const bucket of sourceByDisplay.values()) {
    if (isNonStandardProvinceName(bucket.displayName)) {
      issues.push({
        type: 'nonStandard',
        label: bucket.displayName,
        canonical: bucket.displayName,
        count: bucket.count,
        labels: bucket.labels,
      });
    }
  }

  issues.sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label), 'zh-Hans-CN'));
  return {
    sourceLabelCount: sourceCounts.length,
    canonicalLabelCount: sourceByDisplay.size,
    issueCount: issues.length,
    issues,
  };
}

function isActiveRegionProject(project) {
  return classifyProjectStage(project).key !== 'paused';
}

function firstCount(items = [], label) {
  return safeNumber((items || []).find((item) => item.label === label)?.value);
}

function metricSummary(metrics = {}, departmentMetrics = {}) {
  const summary = metrics?.summary || {};
  const totals = departmentMetrics?.totals || {};
  const scopeCount = departmentMetrics?.scopeCount ?? summary.totalProjects ?? 0;
  const pausedCount =
    departmentMetrics?.pausedOrCanceledCount ??
    metrics?.pausedOrCanceledCount ??
    summary.pausedOrCanceledProjects ??
    departmentMetrics?.pausedCount ??
    metrics?.pausedCount ??
    summary.pausedProjects ??
    0;
  const totalScopeCount = departmentMetrics?.totalScopeCount ?? metrics?.totalScopeCount ?? scopeCount + pausedCount;
  const openDelayed = totals.openDelayed ?? summary.delayedProjects ?? 0;
  const notStarted = totals.notStarted ?? summary.notStarted ?? 0;
  const inProgress = totals.inProgress ?? summary.activeProjects ?? 0;
  const urgentCount = firstCount(metrics?.statusCounts || [], '紧急');
  const monthlyOpsTotal = Object.values(departmentMetrics?.monthlyOps || {}).reduce((sum, tier) => {
    if (!tier || typeof tier !== 'object') {
      return sum;
    }
    return sum + Object.values(tier).reduce((inner, value) => inner + safeNumber(value), 0);
  }, 0);
  return {
    scopeCount,
    totalScopeCount,
    pausedCount,
    openDelayed,
    notStarted,
    inProgress,
    urgentCount,
    highRiskProjects: summary.highRiskProjects ?? 0,
    averageProgress: summary.averageProgress ?? 0,
    monthlyOpsTotal,
    delayedRate: pct(openDelayed, scopeCount),
    pausedRate: pct(pausedCount, totalScopeCount),
  };
}

function buildSignalStrip(summary) {
  const board = summary.projectBoard || {};
  const year = board.year ?? summary.currentYear ?? dashboardYear();
  const previousYear = board.previousYear ?? year - 1;
  return [
    {
      key: 'currentYearEntryTotal',
      label: `${String(year).slice(-2)}年总进店量（推进）`,
      value: board.currentYearEntryTotal ?? 0,
      caption: `${year} 启动 · 不含暂停/取消`,
      tone: 'teal',
      drillFilter: null,
    },
    {
      key: 'pausedOrCanceled',
      label: '暂停/取消项目量',
      value: board.pausedOrCanceled ?? 0,
      caption: '当前暂停或取消',
      tone: board.pausedOrCanceled ? 'amber' : 'green',
      alert: (board.pausedOrCanceled ?? 0) > 0,
      drillFilter: null,
    },
    {
      key: 'closedProjectTotal',
      label: '全年已闭环项目总量',
      value: board.closedProjectTotal ?? 0,
      caption: '任一轨道闭环',
      tone: 'teal',
      drillFilter: null,
    },
    {
      key: 'previousYearUnclosedTotal',
      label: `${String(previousYear).slice(-2)}年未闭环项目量`,
      value: board.previousYearUnclosedTotal ?? 0,
      caption: `${previousYear} 启动 · 未闭环`,
      tone: board.previousYearUnclosedTotal ? 'coral' : 'green',
      alert: (board.previousYearUnclosedTotal ?? 0) > 0,
      drillFilter: null,
    },
    {
      key: 'currentYearEntryDirect',
      label: '直营进店量（推进）',
      value: board.currentYearEntryDirect ?? 0,
      caption: `直营 ${year} 启动`,
      tone: 'green',
      drillFilter: null,
    },
    {
      key: 'currentYearEntryFranchise',
      label: '加盟进店量（推进）',
      value: board.currentYearEntryFranchise ?? 0,
      caption: `加盟 ${year} 启动`,
      tone: 'green',
      drillFilter: null,
    },
    {
      key: 'closedProjectDirect',
      label: '已闭环项目 - 直营',
      value: board.closedProjectDirect ?? 0,
      caption: '直营闭环',
      tone: 'teal',
      drillFilter: null,
    },
    {
      key: 'closedProjectFranchise',
      label: '已闭环项目 - 加盟',
      value: board.closedProjectFranchise ?? 0,
      caption: '加盟闭环',
      tone: 'teal',
      drillFilter: null,
    },
    {
      key: 'previousYearUnclosedDirect',
      label: `${String(previousYear).slice(-2)}年未闭环项目量 - 直营`,
      value: board.previousYearUnclosedDirect ?? 0,
      caption: '直营遗留未闭环',
      tone: board.previousYearUnclosedDirect ? 'coral' : 'green',
      alert: (board.previousYearUnclosedDirect ?? 0) > 0,
      drillFilter: null,
    },
    {
      key: 'previousYearUnclosedFranchise',
      label: `${String(previousYear).slice(-2)}年未闭环项目量 - 加盟`,
      value: board.previousYearUnclosedFranchise ?? 0,
      caption: '加盟遗留未闭环',
      tone: board.previousYearUnclosedFranchise ? 'coral' : 'green',
      alert: (board.previousYearUnclosedFranchise ?? 0) > 0,
      drillFilter: null,
    },
  ];
}

function buildStageLane(projects = []) {
  const stageMap = new Map();
  const orderedStages = [
    ...LIFECYCLE_STAGE_ORDER,
  ];
  orderedStages.forEach((stage) => {
    stageMap.set(stage.key, {
      key: stage.key,
      label: stage.label,
      total: 0,
      delayed: 0,
      urgent: 0,
      progressTotal: 0,
      parallelHardConstruction: 0,
      projects: [],
    });
  });

  for (const project of projects || []) {
    const stage = classifyProjectStage(project);
    if (!stageMap.has(stage.key)) {
      stageMap.set(stage.key, { key: stage.key, label: stage.label, total: 0, delayed: 0, urgent: 0, progressTotal: 0, parallelHardConstruction: 0, projects: [] });
    }
    const bucket = stageMap.get(stage.key);
    const facts = deriveProjectWorkflowFacts(project);
    bucket.total += 1;
    bucket.delayed += isDelayed(project) ? 1 : 0;
    bucket.urgent += isUrgent(project) ? 1 : 0;
    bucket.progressTotal += safeNumber(project?.progress);
    bucket.parallelHardConstruction += stage.key === 'point' && facts.hardConstructionStarted ? 1 : 0;
    bucket.projects.push(project);
  }

  const activeBuckets = Array.from(stageMap.values()).filter((stage) => stage.total > 0);
  const visibleBuckets = Array.from(stageMap.values()).filter((stage) => stage.total > 0 || stage.key === 'point');
  const average = activeBuckets.length
    ? activeBuckets.reduce((sum, stage) => sum + stage.total, 0) / activeBuckets.length
    : 0;
  const max = Math.max(...activeBuckets.map((stage) => stage.total), 1);
  return visibleBuckets.map((stage) => ({
    ...stage,
    share: pct(stage.total, projects.length || 0),
    delayedRate: pct(stage.delayed, stage.total),
    avgProgress: stage.total ? Math.round(stage.progressTotal / stage.total) : 0,
    pressure: Math.round((stage.total / max) * 100),
    congested: average > 0 && stage.total > average * 1.45,
    drillFilter: { lifecycleStage: stage.key },
  }));
}

function riskTags(project, now) {
  if (classifyProjectStage(project).key === 'paused') {
    return [];
  }
  if (isDesignResponsibilityClosed(project)) {
    return [];
  }

  const tags = [];
  const dueDays = dateDistanceDays(project?.dueDate, now);
  if (isUrgent(project)) tags.push({ label: '紧急', tone: 'coral', score: 120 });
  if (isDelayed(project)) tags.push({ label: '延期', tone: 'coral', score: 95 });
  if (isHighRisk(project)) tags.push({ label: '高风险', tone: 'coral', score: 80 });
  if (tags.length && dueDays !== null && dueDays < 0) tags.push({ label: `计划过期 ${Math.abs(dueDays)} 天`, tone: 'amber', score: 24 });
  if (tags.length && dueDays !== null && dueDays >= 0 && dueDays <= 30) tags.push({ label: `${dueDays} 天内开业`, tone: 'amber', score: 18 });
  if (/重|高/.test(normalizeText(project?.difficultyLevel || project?.difficulty?.level))) {
    tags.push({ label: '高难度', tone: 'amber', score: 24 });
  }
  if (!tags.length && safeNumber(project?.progress) < 35) {
    tags.push({ label: '低进度', tone: 'amber', score: 12 });
  }
  return tags;
}

function buildRiskQueue(projects = [], now = new Date()) {
  return (projects || [])
    .map((project) => {
      const tags = riskTags(project, now);
      const score = tags.reduce((sum, tag) => sum + tag.score, 0);
      return {
        id: project.id,
        name: project.name || '未命名项目',
        owner: projectOwnerDisplay(project),
        province: project.province || '未设置地区',
        status: project.status || '',
        dueDate: project.dueDate || '',
        progress: safeNumber(project.progress),
        stage: classifyProjectStage(project).label,
        tags,
        score,
        drillFilter: project.id ? { search: project.name || project.id } : { search: project.name || '' },
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .slice(0, 10);
}

function buildOwnerPressure(projects = []) {
  const loadMap = new Map();
  const activeProjects = (projects || []).filter(isActiveRegionProject);
  for (const project of activeProjects) {
    const names = projectTeamOwnerNames(project);
    for (const name of names) {
      if (!loadMap.has(name)) {
        loadMap.set(name, {
          name,
          projectCount: 0,
        });
      }
      const stat = loadMap.get(name);
      stat.projectCount += 1;
    }
  }

  const maxLoad = Math.max(...Array.from(loadMap.values()).map((stat) => safeNumber(stat.projectCount)), 1);
  return Array.from(loadMap.values())
    .map((stat) => {
      const loadScore = Math.round(Math.min(100, (safeNumber(stat.projectCount) / maxLoad) * 100));
      const status = loadScore >= 80 ? 'overloaded' : loadScore >= 60 ? 'watch' : loadScore <= 35 ? 'available' : 'steady';
      return {
        ...stat,
        loadScore,
        status,
        drillFilter: { teamProjectOwner: stat.name, excludePaused: '1' },
      };
    })
    .sort((a, b) => b.projectCount - a.projectCount || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .slice(0, 10);
}

function buildRegionMatrix(projects = []) {
  const sourceProjects = Array.isArray(projects) ? projects : [];
  const activeProjects = sourceProjects.filter(isActiveRegionProject);
  const rowCounts = countBy(activeProjects, (project) => displayProvinceName(project.province));
  const allRows = rowCounts.map((item) => item.label);
  const rows = allRows.slice(0, HOME_REGION_ROW_LIMIT);
  const overflowRows = allRows.slice(HOME_REGION_ROW_LIMIT);
  const matrixProjects = activeProjects.filter((project) => readMatrixStoreStatus(project));
  const allCols = countBy(matrixProjects, (project) => readMatrixStoreStatus(project));
  const cols = allCols.map((item) => item.label);
  const cells = new Map();
  for (const row of allRows) {
    for (const col of cols) {
      cells.set(`${row}::${col}`, { province: row, storeStatus: col, total: 0, direct: 0, franchise: 0, other: 0 });
    }
  }
  for (const project of matrixProjects) {
    const row = displayProvinceName(project.province);
    const col = readMatrixStoreStatus(project);
    if (!col || !cells.has(`${row}::${col}`)) {
      continue;
    }
    const cell = cells.get(`${row}::${col}`);
    cell.total += 1;
    const businessScope = projectBusinessScope(project);
    if (businessScope === 'direct') {
      cell.direct += 1;
    } else if (businessScope === 'franchise') {
      cell.franchise += 1;
    } else {
      cell.other += 1;
    }
  }
  return {
    rows,
    allRows,
    overflowRows,
    rowCounts,
    cols,
    activeProjectCount: activeProjects.length,
    excludedPausedCount: sourceProjects.length - activeProjects.length,
    visibleRowLimit: HOME_REGION_ROW_LIMIT,
    totalRows: allRows.length,
    hiddenRows: overflowRows.length,
    totalCols: allCols.length,
    hiddenCols: 0,
    provinceAudit: buildProvinceNameAudit(activeProjects),
    max: Math.max(...Array.from(cells.values()).map((cell) => cell.total), 1),
    cells: Array.from(cells.values()).map((cell) => ({
      ...cell,
      drillFilter: { province: cell.province, storeStatus: cell.storeStatus, excludePaused: '1' },
    })),
  };
}

function buildTierMatrix(departmentMetrics = {}) {
  const tiers = departmentMetrics?.tiers || {};
  const labels = departmentMetrics?.tierLabels || {};
  const order = (
    Array.isArray(departmentMetrics?.tierOrder) && departmentMetrics.tierOrder.length
      ? departmentMetrics.tierOrder
      : Object.keys(tiers)
  ).filter((key) => isClassifiableTierLabel(labels[key], key));
  const metrics = [
    { key: 'projectCount', label: '项目数', tone: 'teal' },
    { key: 'inProgress', label: '推进中', tone: 'green' },
    { key: 'notStarted', label: '未开始', tone: 'amber' },
    { key: 'openDelayed', label: '未闭环延期', tone: 'coral' },
    { key: 'schemeDoneYtd', label: '全年方案完成', tone: 'green' },
  ];
  const rows = order
    .filter((key) => tiers[key])
    .map((key) => ({
      key,
      label: labels[key] || key,
      values: metrics.map((metric) => ({
        ...metric,
        value: safeNumber(tiers[key]?.[metric.key]),
        drillFilter: { tier: key, metric: metric.key, storeStatus: labels[key] || key, excludePaused: '1' },
      })),
    }));
  return {
    columns: metrics,
    rows,
    summary: {
      rowCount: rows.length,
      concreteCount: rows.filter((row) => row.key !== 'other').length,
      hasOther: rows.some((row) => row.key === 'other'),
    },
  };
}

function buildMonthlyOpsMatrix(departmentMetrics = {}) {
  const monthlyOps = departmentMetrics?.monthlyOps || {};
  const labels = departmentMetrics?.tierLabels || {};
  const order = (
    Array.isArray(departmentMetrics?.tierOrder) && departmentMetrics.tierOrder.length
      ? departmentMetrics.tierOrder
      : Object.keys(monthlyOps)
  ).filter((key) => monthlyOps[key] && isClassifiableTierLabel(labels[key], key));
  const columns = order.map((key) => ({ key, label: labels[key] || key }));
  const rows = HOME_MONTHLY_OPS_METRICS.map((metric) => {
    const values = columns.map((column) => ({
      tier: column.key,
      value: safeNumber(monthlyOps[column.key]?.[metric.key]),
      drillFilter: { tier: column.key, metric: metric.key, storeStatus: column.label, excludePaused: '1' },
    }));
    return {
      ...metric,
      total: values.reduce((sum, item) => sum + item.value, 0),
      values,
    };
  }).filter((row) => row.total > 0);
  return { columns, rows };
}

function classifyStoreNature(project) {
  const raw = readRawFieldDisplay(project, FIELD_ALIASES.storeNature);
  if (/新/.test(raw)) return 'newStore';
  if (/老|旧|翻|改/.test(raw)) return 'renovated';
  return 'other';
}

function buildPressureTimeline(projects = []) {
  const buckets = new Map();
  const ensure = (label) => {
    if (!buckets.has(label)) {
      buckets.set(label, { label, startCount: 0, dueCount: 0, delayed: 0, weightedWorkload: 0, newStore: 0, renovated: 0, other: 0 });
    }
    return buckets.get(label);
  };
  for (const project of projects || []) {
    if (!isActiveRegionProject(project)) {
      continue;
    }
    const startMonth = monthKey(project.startDate);
    const dueMonth = monthKey(project.dueDate);
    const nature = classifyStoreNature(project);
    if (startMonth) {
      const bucket = ensure(startMonth);
      bucket.startCount += 1;
      bucket[nature] += 1;
      bucket.delayed += isDelayed(project) ? 1 : 0;
      bucket.weightedWorkload += safeNumber(project?.difficultyWeight ?? project?.difficulty?.weight);
    }
    if (dueMonth) {
      ensure(dueMonth).dueCount += 1;
    }
  }
  const rows = Array.from(buckets.values()).sort((a, b) => a.label.localeCompare(b.label)).slice(-8);
  const max = Math.max(...rows.map((item) => item.startCount + item.dueCount + item.weightedWorkload), 1);
  return rows.map((item) => {
    const pressureScore = Math.round(Math.min(100, ((item.startCount + item.dueCount + item.weightedWorkload) / max) * 100));
    return {
      ...item,
      weightedWorkload: round(item.weightedWorkload, 1),
      pressureScore,
      tone: pressureScore >= 80 ? 'alert' : pressureScore >= 60 ? 'watch' : 'steady',
    };
  });
}

function buildDataNotes(metrics = {}, departmentMetrics = {}) {
  const coverage = departmentMetrics?.fieldCoverage || {};
  const notes = [
    {
      label: '总盘口径',
      value: `${departmentMetrics?.scopeCount ?? metrics?.summary?.totalProjects ?? 0} 项`,
      text: '首页在营项目不含暂停/取消项目，暂停和取消单独看。',
    },
    {
      label: '延期口径',
      value: `${departmentMetrics?.totals?.openDelayed ?? metrics?.summary?.delayedProjects ?? 0} 项`,
      text: '优先采用部门总盘未闭环延期，不把已闭环延期混入压力池。',
    },
  ];
  const coverageEntries = Object.entries(coverage).filter(([, value]) => typeof value === 'number');
  if (coverageEntries.length) {
    const minCoverage = coverageEntries.reduce((min, [, value]) => Math.min(min, value), 100);
    notes.push({
      label: '字段覆盖',
      value: `${Math.round(minCoverage)}%+`,
      text: '低覆盖节点只用于趋势提醒，不作为精确排产承诺。',
    });
  }
  return notes;
}

export function buildDirectorOverviewModel({
  metrics = {},
  departmentMetrics = {},
  projects = [],
  snapshot = {},
  now = new Date(),
} = {}) {
  const safeProjects = Array.isArray(projects) ? projects : [];
  const baseSummary = metricSummary(metrics, departmentMetrics);
  const currentYearEntry = currentYearEntrySummary(departmentMetrics, safeProjects, now);
  const backendProjectBoard = departmentMetrics?.projectBoard && typeof departmentMetrics.projectBoard === 'object' ? departmentMetrics.projectBoard : null;
  const projectBoard = backendProjectBoard
    ? {
        year: dashboardYear(now),
        previousYear: dashboardYear(now) - 1,
        ...backendProjectBoard,
      }
    : projectBoardSummary(safeProjects, now);
  const annualEntry = departmentMetrics?.annualEntryStructure;
  if (!backendProjectBoard && annualEntry?.totals && annualEntry.year === currentYearEntry.year) {
    projectBoard.currentYearEntryTotal = annualEntry.totals.entry ?? projectBoard.currentYearEntryTotal;
    projectBoard.currentYearEntryDirect = annualEntry.totals.direct ?? projectBoard.currentYearEntryDirect;
    projectBoard.currentYearEntryFranchise = annualEntry.totals.franchise ?? projectBoard.currentYearEntryFranchise;
  } else if (!backendProjectBoard && Number.isFinite(Number(departmentMetrics?.currentYearEntry?.count))) {
    projectBoard.currentYearEntryTotal = departmentMetrics.currentYearEntry.count;
  }
  const summary = {
    ...baseSummary,
    currentYear: currentYearEntry.year,
    currentYearEntry: currentYearEntry.count,
    projectBoard,
  };
  return {
    summary,
    source: snapshot?.source || '',
    syncedAt: snapshot?.syncedAt || '',
    signals: buildSignalStrip(summary),
    stageLane: buildStageLane(safeProjects),
    riskQueue: buildRiskQueue(safeProjects, now),
    ownerPressure: buildOwnerPressure(safeProjects),
    regionMatrix: buildRegionMatrix(safeProjects),
    tierMatrix: buildTierMatrix(departmentMetrics),
    monthlyOpsMatrix: buildMonthlyOpsMatrix(departmentMetrics),
    pressureTimeline: buildPressureTimeline(safeProjects),
    statusCounts: metrics?.statusCounts || [],
    monthlyTrend: metrics?.monthlyTrend || [],
    dataNotes: buildDataNotes(metrics, departmentMetrics),
  };
}
