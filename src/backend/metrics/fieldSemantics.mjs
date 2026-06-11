import { isClassifiableStoreStatus } from '../../../public/lib/constants.mjs';
import { isSleepHardDecorationClosed, isSleepStoreProject } from '../projectTypeRules.mjs';

const HARD_WORKFLOW_FIELDS = ['硬装项目进度', '硬装进度'];
const SOFT_WORKFLOW_FIELDS = ['软装项目进度', '软装进度'];
const SCHEME_STATUS_FIELDS = ['硬装方案情况（每周五刷新）', '硬装方案情况', '方案情况'];
const SOFT_COMPLETION_FIELDS = ['软装完成情况'];
const HARD_DESIGN_COMPLETION_FIELDS = [
  '硬装方案完成时间',
  '躺平内部审核结束时间',
  '内部审核结束时间',
];
const HARD_DESIGN_START_FIELDS = ['平面开始时间'];
const POINT_STATUS_FIELDS = ['点位完成情况'];
const POINT_DONE_FIELDS = ['点位完成时间'];
const SOFT_DESIGN_START_FIELDS = ['软装方案开始时间'];
const STORE_TIER_FIELDS = ['店态'];
const STORE_NATURE_FIELDS = ['店铺性质'];
const GROUP_SCOPE_FIELDS = ['组别'];

export const STORE_SEGMENT_ORDER = [
  'newStore-regular',
  'renovated-regular',
  'newStore-sinking',
  'renovated-sinking',
];

export const STORE_SEGMENT_LABELS = {
  'newStore-regular': '新店-常规',
  'renovated-regular': '翻新店-常规',
  'newStore-sinking': '新店-下沉',
  'renovated-sinking': '翻新店-下沉',
};
const PRIORITY_STATUS_FIELDS = ['项目状态', '状态'];

const NOT_STARTED_STAGES = ['未开始', '未安排', '未排期', '未排班', '待启动'];
const SOFT_PAUSE_STAGES = ['暂停'];
const PAUSED_STAGE_PATTERN = /暂停/;
const HARD_STAGE_AT_OR_AFTER_CONSTRUCTION_PATTERN = /施工图|施工整改|待采购|摆场|闭环|已完成|^完成$|点位/;
const SOFT_STAGE_AT_OR_AFTER_POINT_PATTERN = /点位|软装方案|软装完成|产品清单|待采购|采购|摆场|闭环|^完成$|已完成/;
const SCHEME_DONE_STATUSES = ['准时完成', '延期完成'];
const SOFT_COMPLETION_DONE_STATUSES = ['准时完成', '延期完成'];
const PRIORITY_STATUSES = ['紧急', '一般'];
export const PRIORITY_LEVEL_UNSET = '未设置';
export const PRIORITY_LEVELS = ['紧急', '一般', PRIORITY_LEVEL_UNSET];

const STORE_TIER_MAP = [
  { key: 'regular', pattern: /常规店/ },
  { key: 'sinking', pattern: /下沉店/ },
  { key: 'super', pattern: /超一线/ },
  { key: 'flagship', pattern: /旗舰店/ },
  { key: 'premium', pattern: /高标店/ },
  { key: 'black', pattern: /黑标店/ },
];

function customStoreTierKey(raw) {
  const normalized = normalizeCell(raw).replace(/\s+/g, '');
  return normalized ? `custom:${normalized}` : 'other';
}

export function storeTierKeyFromLabel(label) {
  const raw = normalizeCell(label);
  if (!raw) {
    return 'other';
  }
  for (const rule of STORE_TIER_MAP) {
    if (rule.pattern.test(raw)) {
      return rule.key;
    }
  }
  return customStoreTierKey(raw);
}

export function isOtherStoreTierKey(key) {
  return key === 'other' || String(key || '').startsWith('custom:');
}

export function normalizeCell(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map(normalizeCell).filter(Boolean).join('、');
  }

  if (typeof value === 'object') {
    const preferred = value.text ?? value.name ?? value.title ?? value.label ?? value.value ?? value.displayValue;
    if (preferred !== undefined && preferred !== value) {
      return normalizeCell(preferred);
    }
    return JSON.stringify(value);
  }

  return String(value).trim();
}

function normalizeFieldKey(value) {
  return normalizeCell(value).toLowerCase();
}

function normalizeRawFieldDisplay(cell) {
  if (cell && typeof cell === 'object') {
    return normalizeCell(cell.display ?? cell.displayValue ?? cell.text ?? cell.name ?? cell.title ?? cell.label ?? cell.value ?? '');
  }
  return normalizeCell(cell);
}

export function readRawDisplay(project, fieldNames) {
  const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
  const rawFields = project.rawFields || {};
  for (const fieldName of names) {
    const display = normalizeRawFieldDisplay(rawFields[fieldName]);
    if (display) {
      return display;
    }
  }
  const entries = Object.entries(rawFields);
  for (const fieldName of names) {
    const needle = normalizeFieldKey(fieldName);
    if (!needle) {
      continue;
    }
    const matches = entries.filter(([key, cell]) => {
      return normalizeFieldKey(key) === needle && normalizeRawFieldDisplay(cell);
    });
    if (matches.length === 1) {
      return normalizeRawFieldDisplay(matches[0][1]);
    }
  }
  return '';
}

// 已知阶段的特征关键词，用于过滤非阶段的 progress 回退值（如"等待确认"）
const KNOWN_STAGE_KEYWORDS = /闭环|完成|摆场|施工|采购|方案|上会|复尺|平面|点位|未开始|未安排|暂停|产品清单/;
function progressFallbackStage(value) {
  const text = normalizeCell(value);
  if (!text || /^\d+(?:\.\d+)?%?$/.test(text)) {
    return '';
  }
  // 仅当文本包含已知阶段关键词时才作为阶段名返回，避免非阶段文本（如"等待确认"）被下游逻辑误判
  if (!KNOWN_STAGE_KEYWORDS.test(text)) {
    return '';
  }
  return text;
}

export function readWorkflowStage(project, { discipline = 'hard' } = {}) {
  if (discipline === 'soft' && isSleepStoreProject(project)) {
    return '';
  }
  const fields = discipline === 'soft' ? SOFT_WORKFLOW_FIELDS : HARD_WORKFLOW_FIELDS;
  const stage = readRawDisplay(project, fields);
  if (stage) {
    return stage;
  }
  const stageProperty = discipline === 'soft' ? project?.softProgressStage : project?.hardProgressStage;
  if (stageProperty) {
    return normalizeCell(stageProperty);
  }
  if (discipline === 'hard' && project.progress !== undefined) {
    return progressFallbackStage(project.progress);
  }
  return '';
}

function isClosedStage(stage) {
  return stage === '闭环' || stage === '完成' || stage === '已完成';
}

/** Exact match only — avoids treating「完成上会」「施工图完成审核」as closed. */
export function isHardWorkflowClosed(project) {
  if (isSleepStoreProject(project)) {
    return isSleepHardDecorationClosed(project);
  }
  const stage = readWorkflowStage(project, { discipline: 'hard' });
  return isClosedStage(stage);
}

/** Soft closed: exact stage or contains 闭环 as whole stage label. */
export function isSoftWorkflowClosed(project) {
  const stage = readWorkflowStage(project, { discipline: 'soft' });
  if (!stage) {
    return false;
  }
  if (isClosedStage(stage)) {
    return true;
  }
  return /^闭环$/.test(stage);
}

function isSoftCompletionDone(project) {
  const status = readSoftCompletionStatus(project);
  return SOFT_COMPLETION_DONE_STATUSES.some((item) => status.includes(item));
}

function isCompleteText(value) {
  const text = normalizeCell(value);
  if (!text || /未完成|未开始|未启动|未安排|待|延期中|暂停/.test(text)) {
    return false;
  }
  return /准时完成|延期完成|已完成|完成|闭环/.test(text);
}

function hasHardConstructionStartSignal(project) {
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  return Boolean(
    readHardDesignCompletionDate(project) ||
      (hardStage && !PAUSED_STAGE_PATTERN.test(hardStage) && HARD_STAGE_AT_OR_AFTER_CONSTRUCTION_PATTERN.test(hardStage))
  );
}

function hasPointDesignStartSignal(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  return Boolean(
    hasHardConstructionStartSignal(project) ||
      (softStage && !PAUSED_STAGE_PATTERN.test(softStage) && SOFT_STAGE_AT_OR_AFTER_POINT_PATTERN.test(softStage))
  );
}

function isPointDesignStarted(project) {
  return Boolean(
    hasPointDesignStartSignal(project) ||
      readRawDisplay(project, POINT_STATUS_FIELDS) ||
      readRawDisplay(project, POINT_DONE_FIELDS)
  );
}

function isPointDesignCompleted(project) {
  return Boolean(
    readRawDisplay(project, POINT_DONE_FIELDS) ||
      isCompleteText(readRawDisplay(project, POINT_STATUS_FIELDS)) ||
      (isSoftWorkflowClosed(project) && isSoftCompletionDone(project))
  );
}

function hasOpenSoftCompletionSignal(project) {
  const status = readSoftCompletionStatus(project);
  return Boolean(status && !SOFT_COMPLETION_DONE_STATUSES.some((item) => status.includes(item)));
}

export function isPointDesignResponsibilityStarted(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  return isPointDesignStarted(project);
}

export function isPointDesignResponsibilityCompleted(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  return isPointDesignCompleted(project);
}

export function hasOpenPointDesignResponsibility(project) {
  return isPointDesignResponsibilityStarted(project) && !isPointDesignResponsibilityCompleted(project);
}

export function isOpenPointDesignResponsibilityDelayed(project) {
  const status = readRawDisplay(project, POINT_STATUS_FIELDS);
  return hasOpenPointDesignResponsibility(project) && Boolean(status && /延期/.test(status));
}

export function isSoftSchemeDesignResponsibilityStarted(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  return Boolean(readRawDisplay(project, SOFT_DESIGN_START_FIELDS) || readSoftCompletionStatus(project));
}

export function isSoftSchemeDesignResponsibilityCompleted(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  return isSoftCompletionDone(project);
}

export function hasOpenSoftSchemeDesignResponsibility(project) {
  return isSoftSchemeDesignResponsibilityStarted(project) && !isSoftSchemeDesignResponsibilityCompleted(project);
}

export function isOpenSoftSchemeDesignResponsibilityDelayed(project) {
  return hasOpenSoftSchemeDesignResponsibility(project) && isSoftCompletionDelayed(project);
}

export function isSoftProjectDesignStageCompleted(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  return isPointDesignResponsibilityCompleted(project) && isSoftSchemeDesignResponsibilityCompleted(project);
}

export function isSoftDesignClosed(project) {
  return isSoftProjectDesignStageCompleted(project);
}

export function isDesignResponsibilityClosed(project) {
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
    (!hasSoftTrack || isSoftDesignResponsibilityCompleted(project))
  );
}

export function isWorkflowClosed(project, { discipline = 'soft' } = {}) {
  return discipline === 'hard' ? isHardWorkflowClosed(project) : isSoftWorkflowClosed(project);
}

export function isPriorityStatus(project) {
  const status = readRawDisplay(project, PRIORITY_STATUS_FIELDS) || normalizeCell(project.status);
  return PRIORITY_STATUSES.some((item) => status.includes(item));
}

export function normalizePriorityStatus(raw) {
  const status = normalizeCell(raw);
  if (!status || status === '未分类') {
    return PRIORITY_LEVEL_UNSET;
  }
  if (status.includes('紧急')) {
    return '紧急';
  }
  if (status.includes('一般')) {
    return '一般';
  }
  return PRIORITY_LEVEL_UNSET;
}

export function readPrioritySourceRaw(project) {
  return readRawDisplay(project, PRIORITY_STATUS_FIELDS) || normalizeCell(project.status);
}

export function readPriorityStatus(project) {
  return normalizePriorityStatus(readPrioritySourceRaw(project));
}

export function readStoreTier(project) {
  const raw = readRawDisplay(project, STORE_TIER_FIELDS) || normalizeCell(project.storeStatus);
  return storeTierKeyFromLabel(raw);
}

export function readStoreNatureLabel(project) {
  const raw = readRawDisplay(project, STORE_NATURE_FIELDS);
  if (raw) {
    return raw;
  }
  const tierLabel = readRawDisplay(project, STORE_TIER_FIELDS) || normalizeCell(project.storeStatus);
  return tierLabel;
}

export function readStoreNatureKey(project) {
  const raw = readStoreNatureLabel(project);
  if (/新店/.test(raw)) {
    return 'newStore';
  }
  if (/老店|翻新|改造|扩店|换址|重装/.test(raw)) {
    return 'renovated';
  }
  return 'other';
}

export function matchesStoreSegment(project, segmentKey) {
  const nature = readStoreNatureKey(project);
  const tier = readStoreTier(project);
  switch (segmentKey) {
    case 'newStore-regular':
      return nature === 'newStore' && tier === 'regular';
    case 'renovated-regular':
      return nature === 'renovated' && tier === 'regular';
    case 'newStore-sinking':
      return nature === 'newStore' && tier === 'sinking';
    case 'renovated-sinking':
      return nature === 'renovated' && tier === 'sinking';
    default:
      return false;
  }
}

export function readStoreStatusSourceLabel(project) {
  return readRawDisplay(project, STORE_TIER_FIELDS) || normalizeCell(project.storeStatus);
}

export function hasClassifiableStoreStatus(project) {
  return isClassifiableStoreStatus(readStoreStatusSourceLabel(project));
}

export function matchesOwnerMonthlyTier(project, tier) {
  if (!hasClassifiableStoreStatus(project)) {
    return false;
  }
  const projectTier = readStoreTier(project);
  return tier === 'other' ? isOtherStoreTierKey(projectTier) : projectTier === tier;
}

export function readStoreTierLabel(project) {
  return readStoreStatusSourceLabel(project) || '其他';
}

export function readFranchiseScope(project) {
  const group = readRawDisplay(project, GROUP_SCOPE_FIELDS);
  if (/加盟/.test(group)) {
    return 'franchise';
  }
  if (/直营/.test(group)) {
    return 'direct';
  }
  return 'other';
}

export function readSchemeStatus(project) {
  return readRawDisplay(project, SCHEME_STATUS_FIELDS);
}

export function readSoftCompletionStatus(project) {
  return readRawDisplay(project, SOFT_COMPLETION_FIELDS);
}

export function readHardDesignCompletionDate(project) {
  return readRawDisplay(project, HARD_DESIGN_COMPLETION_FIELDS);
}

export function isHardDesignResponsibilityCompleted(project) {
  return Boolean(readHardDesignCompletionDate(project));
}

function isHardDesignResponsibilityStarted(project) {
  return Boolean(
    readHardDesignCompletionDate(project) ||
      readRawDisplay(project, HARD_DESIGN_START_FIELDS)
  );
}

export function isSoftDesignResponsibilityStarted(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  return Boolean(
    isPointDesignStarted(project) ||
      readRawDisplay(project, SOFT_DESIGN_START_FIELDS) ||
      hasOpenSoftCompletionSignal(project)
  );
}

export function isSoftDesignResponsibilityCompleted(project) {
  return isSoftProjectDesignStageCompleted(project);
}

export function hasOpenHardDesignResponsibility(project) {
  if (isHardDesignResponsibilityCompleted(project) || (isSleepStoreProject(project) && isHardWorkflowClosed(project))) {
    return false;
  }
  return isHardDesignResponsibilityStarted(project);
}

export function hasOpenSoftDesignResponsibility(project) {
  return isSoftDesignResponsibilityStarted(project) && !isSoftDesignResponsibilityCompleted(project);
}

export function hasOpenDesignResponsibility(project, { discipline = '' } = {}) {
  if (discipline === 'hard') {
    return hasOpenHardDesignResponsibility(project);
  }
  if (discipline === 'soft') {
    return hasOpenSoftDesignResponsibility(project);
  }
  if (isSleepStoreProject(project)) {
    return hasOpenHardDesignResponsibility(project);
  }
  return hasOpenHardDesignResponsibility(project) || hasOpenSoftDesignResponsibility(project);
}

export function isOpenDesignResponsibilityDelayed(project, { discipline = '' } = {}) {
  if (discipline === 'hard') {
    return hasOpenHardDesignResponsibility(project) && isSchemeDelayed(project);
  }
  if (discipline === 'soft') {
    return isOpenPointDesignResponsibilityDelayed(project) || isOpenSoftSchemeDesignResponsibilityDelayed(project);
  }
  if (isSleepStoreProject(project)) {
    return isOpenDesignResponsibilityDelayed(project, { discipline: 'hard' });
  }
  return (
    isOpenDesignResponsibilityDelayed(project, { discipline: 'hard' }) ||
    isOpenDesignResponsibilityDelayed(project, { discipline: 'soft' })
  );
}

export function isSchemeDelayed(project) {
  const schemeText = readSchemeStatus(project);
  return Boolean(schemeText && /延期/.test(schemeText));
}

export function isSchemeDelayDone(project) {
  const schemeText = readSchemeStatus(project);
  return schemeText.includes('延期完成');
}

export function isSchemeDone(project) {
  const schemeText = readSchemeStatus(project);
  return SCHEME_DONE_STATUSES.some((item) => schemeText.includes(item));
}

export function isSoftCompletionDelayed(project) {
  const text = readSoftCompletionStatus(project);
  return Boolean(text && /延期/.test(text) && !/延期完成/.test(text));
}

function matchesNotStartedStage(stage) {
  if (!stage) {
    return true;
  }
  return NOT_STARTED_STAGES.some((item) => stage === item || stage.includes(item));
}

export function isSoftNotStarted(project, { includePause = false } = {}) {
  const stage = readWorkflowStage(project, { discipline: 'soft' });
  if (includePause && stage && SOFT_PAUSE_STAGES.some((item) => stage.includes(item))) {
    return true;
  }
  if (hasPointDesignStartSignal(project)) {
    return false;
  }
  return matchesNotStartedStage(stage);
}

export function isHardNotStarted(project) {
  return matchesNotStartedStage(readWorkflowStage(project, { discipline: 'hard' }));
}

/**
 * 未开始：硬装与软装均未推进（AND）；负责人月度盘可将软装「暂停」计入软装侧未开始。
 */
export function isProjectNotStarted(project, { includeSoftPause = false } = {}) {
  return isHardNotStarted(project) && isSoftNotStarted(project, { includePause: includeSoftPause });
}

/** 进行中：硬装或软装任一侧在推进（店态只筛项目，不绑定工种）。 */
export function isProjectInProgress(project) {
  return isHardInProgress(project) || isSoftInProgress(project);
}

export function isHardInProgress(project) {
  const stage = readWorkflowStage(project, { discipline: 'hard' });
  if (!stage || matchesNotStartedStage(stage)) {
    return false;
  }
  return !isHardWorkflowClosed(project);
}

export function isSoftInProgress(project) {
  const stage = readWorkflowStage(project, { discipline: 'soft' });
  if (hasPointDesignStartSignal(project)) {
    return !isSoftDesignClosed(project);
  }
  if (!stage || matchesNotStartedStage(stage)) {
    return false;
  }
  if (SOFT_PAUSE_STAGES.some((item) => stage.includes(item))) {
    return true;
  }
  return !isSoftDesignClosed(project);
}

/**
 * 未闭环延期：只看设计责任内的明确延期状态。
 * 计划开业、采购、产品清单等管理/协同边界不单独构成设计延期。
 */
/**
 * 未闭环延期：只看设计责任内的明确延期状态。
 * 计划开业、采购、产品清单等管理/协同边界不单独构成设计延期。
 * 注：now / countClosedSchemeDelay 参数已移除——本函数仅委托给 isOpenDesignResponsibilityDelayed，
 *     与时间窗口或已闭环延期计数无关，避免调用方误用。
 */
export function isOpenDelayed(project) {
  return isOpenDesignResponsibilityDelayed(project);
}

export function readMetricDate(project, fieldCandidates) {
  for (const fieldName of fieldCandidates) {
    if (fieldName === 'updatedAt' && project.updatedAt) {
      return project.updatedAt;
    }
    if (fieldName === 'startDate' && project.startDate) {
      return project.startDate;
    }
    if (fieldName === 'dueDate' && project.dueDate) {
      return project.dueDate;
    }
    const raw = readRawDisplay(project, [fieldName]);
    if (raw) {
      return raw;
    }
  }
  return '';
}

export {
  HARD_WORKFLOW_FIELDS,
  SOFT_WORKFLOW_FIELDS,
  SCHEME_STATUS_FIELDS,
  SOFT_COMPLETION_FIELDS,
  STORE_TIER_FIELDS,
  STORE_NATURE_FIELDS,
  GROUP_SCOPE_FIELDS,
  NOT_STARTED_STAGES,
  POINT_STATUS_FIELDS,
  POINT_DONE_FIELDS,
};
