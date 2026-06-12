import { formatDate, displayOrDash } from '../lib/format.mjs';
import {
  isSleepStoreProject,
  progressFallbackStage,
  readRawFieldDisplay,
  displayProjectHardOwner,
  displayProjectSoftOwner,
} from './project-display.mjs';
import {
  PROJECT_STAGE_FIELD_ALIASES,
  PROJECT_STAGE_KEYS,
  resolveProjectStageReminder,
} from './project-stage-reminder-rules.mjs';
export const PROJECT_NODE_FIELD_ALIASES = {
  managementStart: ['启动时间', '启动日期', '开始日期'],
  managementOpen: ['计划开业时间', '计划完成日期', '截止日期'],
  meetingDate: ['上会时间', '上会日期'],
  meetingStatus: ['上会情况'],
  measureDate: ['复尺时间', '复尺日期'],
  measureStatus: ['复尺情况'],
  hardSchemeStatus: ['硬装方案情况（每周五刷新）', '硬装方案情况', '方案情况'],
  floorPlanStart: ['平面开始时间'],
  floorPlanFinish: ['躺平内部审核结束时间', '内部审核结束时间'],
  constructionDraft: ['施工图初稿完成时间（外包首次提供图纸的时间）', '施工图初稿完成时间'],
  constructionReview: ['施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）', '施工图完成审核时间'],
  constructionDone: ['施工完成时间'],
  pointDone: ['点位完成时间'],
  pointStatus: ['点位完成情况'],
  productListSent: ['产品清单发出时间', '产品清单接收时间', '流程记录：产品清单接收时间'],
  softSchemeStart: ['软装方案开始时间'],
  purchaseTime: ['采购时间'],
  purchaseStatus: ['采购完成情况', '采购情况'],
  displayFileSent: ['摆场文件发出时间(项目群）', '摆场文件发出时间（项目群）'],
  displayTime: ['摆场时间', '现场摆场时间'],
  displayStart: PROJECT_STAGE_FIELD_ALIASES.displayStart,
  softDoneTime: ['软装完成时间', '软装发项目群时间', '软装发群/完成时间'],
  softDoneStatus: ['软装完成情况'],
};


export const HARD_SCHEME_COMPLETION_DATE_FIELDS = ['硬装方案完成时间', '躺平内部审核结束时间', '内部审核结束时间'];
const SOFT_STAGE_REQUIRING_POINT_EVIDENCE_PATTERN = /点位已完成|点位完成|软装方案|软装完成|产品清单|待采购|采购|摆场|闭环|^完成$|已完成/;
const HARD_STAGE_AT_OR_AFTER_CONSTRUCTION_PATTERN = /施工图|施工整改|待采购|摆场|闭环|已完成|^完成$|点位/;
const SOFT_STAGE_AT_OR_AFTER_POINT_PATTERN = /点位|软装方案|软装完成|产品清单|待采购|采购|摆场|闭环|^完成$|已完成/;

const SLEEP_HARD_CLOSED_STAGE_PATTERN = /^(闭环|完成|已完成)$/;
const SLEEP_CONSTRUCTION_CLOSED_STAGE_PATTERN =
  /施工.*闭环|施工图.*完成.*审核|施工图.*审核.*完成|施工图.*审核.*通过|施工图完成审核|施工图审核通过/;

const DISCIPLINE_LABELS = {
  hard: '硬装',
  soft: '软装',
  both: '硬装+软装',
  '': '通用',
};

const HARD_WORKFLOW_FIELDS = ['硬装项目进度', '硬装进度'];
const SOFT_WORKFLOW_FIELDS = ['软装项目进度', '软装进度'];

const WORKFLOW_STAGE_DATE_RULES = {
  hard: [
    { pattern: /闭环|已完成/, label: '闭环', fields: ['软装完成时间'] },
    { pattern: /摆场/, label: '摆场', fields: PROJECT_NODE_FIELD_ALIASES.displayFileSent },
    { pattern: /点位已完成|点位完成/, label: '点位', fields: ['点位完成时间'] },
    { pattern: /施工图完成审核|内审/, label: '施工图审核', fields: PROJECT_NODE_FIELD_ALIASES.constructionReview },
    { pattern: /待采购|采购/, label: '采购', fields: PROJECT_NODE_FIELD_ALIASES.purchaseTime },
    { pattern: /施工图/, label: '施工图初稿', fields: PROJECT_NODE_FIELD_ALIASES.constructionDraft },
    { pattern: /完成上会|上会/, label: '上会', fields: PROJECT_NODE_FIELD_ALIASES.meetingDate },
    { pattern: /完成复尺|复尺/, label: '复尺', fields: ['复尺时间'] },
    { pattern: /平面/, label: '平面结束', fields: PROJECT_NODE_FIELD_ALIASES.floorPlanFinish },
  ],
  soft: [
    { pattern: /闭环|已完成/, label: '完成', fields: PROJECT_NODE_FIELD_ALIASES.softDoneTime },
    { pattern: /摆场/, label: '摆场', fields: PROJECT_NODE_FIELD_ALIASES.displayFileSent },
    { pattern: /待采购|采购/, label: '采购', fields: PROJECT_NODE_FIELD_ALIASES.purchaseTime },
    { pattern: /点位已完成|点位完成/, label: '点位', fields: PROJECT_NODE_FIELD_ALIASES.pointDone },
    { pattern: /软装完成/, label: '软装完成', fields: [...PROJECT_NODE_FIELD_ALIASES.softDoneTime, ...PROJECT_NODE_FIELD_ALIASES.displayFileSent] },
    { pattern: /软装方案/, label: '软装方案', fields: PROJECT_NODE_FIELD_ALIASES.softSchemeStart },
  ],
};

export const PAUSED_STAGE_PATTERN = /暂停/;
export const CANCELED_STAGE_PATTERN = /取消|已取消|关闭|已关闭/;
export const FOLLOW_UP_STAGE_PATTERN = /摆场|待采购|施工整改/;
const PAUSE_RECOVERY_PATTERN = /曾暂停|历史暂停|暂停后(?:恢复|复工|重启|继续|推进)|暂停.*(?:恢复|复工|重启|继续|推进)/;
const REPAUSED_STAGE_PATTERN = /(?:再次|重新|又).*暂停|(?:恢复|复工|重启|继续|推进)后.*暂停/;
const PROJECT_WORKBENCH_STAGE_ORDER = new Map(
  [
    '上会',
    '复尺',
    '平面开始',
    '平面结束',
    '施工图初稿',
    '施工图审核',
    '点位',
    '点位完成',
    '软装方案',
    '软装完成',
    '产品清单',
    '采购',
    '采购情况',
    '整改',
    '摆场',
  ].map((label, index) => [label, index])
);
const PROJECT_CLOSURE_DATE_FIELDS = [
  ...PROJECT_NODE_FIELD_ALIASES.softDoneTime,
  ...PROJECT_NODE_FIELD_ALIASES.displayTime,
  ...PROJECT_NODE_FIELD_ALIASES.displayFileSent,
  ...PROJECT_NODE_FIELD_ALIASES.pointDone,
  ...PROJECT_NODE_FIELD_ALIASES.constructionDone,
  ...PROJECT_NODE_FIELD_ALIASES.constructionReview,
];


export function readProjectNodeValue(project, nodeKey) {
  return readRawFieldDisplay(project, PROJECT_NODE_FIELD_ALIASES[nodeKey] || []);
}


export function hasProjectNodeValue(project, nodeKey) {
  return Boolean(readProjectNodeValue(project, nodeKey));
}


export function hasFloorPlanHandoff(project) {
  return hasProjectNodeValue(project, 'floorPlanFinish');
}


function normalizeWorkflowText(value) {
  return String(value || '').trim();
}


export function isCurrentPausedWorkflowStage(stage) {
  const text = normalizeWorkflowText(stage);
  if (!PAUSED_STAGE_PATTERN.test(text)) {
    return false;
  }
  if (REPAUSED_STAGE_PATTERN.test(text)) {
    return true;
  }
  return !PAUSE_RECOVERY_PATTERN.test(text);
}


export function isPausedWorkflowStage(stage) {
  return isCurrentPausedWorkflowStage(stage);
}

export function isCanceledWorkflowStage(stage) {
  return CANCELED_STAGE_PATTERN.test(normalizeWorkflowText(stage));
}

function readProjectStatus(project = {}) {
  return readRawFieldDisplay(project, ['项目状态', '状态']) || String(project?.status || '').trim();
}

export function isCanceledProject(project) {
  return (
    isCanceledWorkflowStage(readWorkflowStage(project, 'hard')) ||
    isCanceledWorkflowStage(readWorkflowStage(project, 'soft')) ||
    isCanceledWorkflowStage(readProjectStatus(project))
  );
}

export function projectStopState(project) {
  if (isCanceledProject(project)) {
    return { key: 'canceled', label: '取消', message: '项目已取消' };
  }
  if (
    isCurrentPausedWorkflowStage(readWorkflowStage(project, 'hard')) ||
    isCurrentPausedWorkflowStage(readWorkflowStage(project, 'soft'))
  ) {
    return { key: 'paused', label: '暂停', message: '项目暂停中' };
  }
  return { key: 'active', label: '', message: '' };
}

export function isPausedOrCanceledProject(project) {
  return projectStopState(project).key !== 'active';
}


export function hasHardConstructionStartSignal(project) {
  const hardStage = readWorkflowStage(project, 'hard');
  return (
    hasFloorPlanHandoff(project) ||
    hasProjectNodeValue(project, 'constructionDraft') ||
    hasProjectNodeValue(project, 'constructionReview') ||
    (hardStage && !isPausedWorkflowStage(hardStage) && HARD_STAGE_AT_OR_AFTER_CONSTRUCTION_PATTERN.test(hardStage))
  );
}


export function hasPointDesignStartSignal(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  const softStage = readWorkflowStage(project, 'soft');
  return (
    hasHardConstructionStartSignal(project) ||
    (softStage && !isPausedWorkflowStage(softStage) && SOFT_STAGE_AT_OR_AFTER_POINT_PATTERN.test(softStage))
  );
}


export function hasActivePointDesignStartSignal(project) {
  return (
    hasPointDesignStartSignal(project) &&
    !isPausedOrCanceledProject(project)
  );
}

const COMPLETED_NODE_STATUS_PATTERN = /完成|准时/;
const INCOMPLETE_NODE_STATUS_PATTERN = /未完成|延期中|未开始|未安排|待|暂停/;
const SOFT_NOT_STARTED_STAGE_PATTERN = /未开始|未安排|待启动|暂停/;
const HARD_NODE_RANKS = {
  meeting: 0,
  measure: 1,
  floorPlanStart: 2,
  floorPlanFinish: 3,
  constructionDraft: 4,
  constructionReview: 5,
};


export function isProjectNodeStatusComplete(value) {
  const status = String(value ?? '').trim();
  if (!status || INCOMPLETE_NODE_STATUS_PATTERN.test(status)) {
    return false;
  }
  return COMPLETED_NODE_STATUS_PATTERN.test(status);
}


export function needsPointCompletionEvidence(project, softStage = readWorkflowStage(project, 'soft')) {
  return (
    hasActivePointDesignStartSignal(project) ||
    isProjectNodeStatusComplete(readProjectNodeValue(project, 'pointStatus')) ||
    hasProjectNodeValue(project, 'pointDone') ||
    SOFT_STAGE_REQUIRING_POINT_EVIDENCE_PATTERN.test(String(softStage || ''))
  );
}


export function readFirstFilledProjectField(project, fieldNames = []) {
  for (const fieldName of fieldNames) {
    const value = readRawFieldDisplay(project, [fieldName]);
    if (value) {
      return value;
    }
  }
  return '';
}


export function projectFieldGapOwner(project, fieldNames = [], fallback = '') {
  return readFirstFilledProjectField(project, fieldNames) || fallback || '待补录';
}


export function isProjectMeetingStageComplete(project) {
  return hasProjectNodeValue(project, 'meetingDate');
}


export function isProjectMeasureStageComplete(project) {
  return hasProjectNodeValue(project, 'measureDate');
}


export function inferHardStageCurrentRank(stage) {
  const text = String(stage || '').trim();
  if (!text || /未开始|未安排|待启动/.test(text)) {
    return -1;
  }
  if (/闭环|已完成|^完成$|摆场|待采购|施工整改|点位/.test(text)) {
    return HARD_NODE_RANKS.constructionReview + 1;
  }
  if (/施工图完成审核|施工图审核|内审|审核/.test(text)) {
    return HARD_NODE_RANKS.constructionReview;
  }
  if (/施工图/.test(text)) {
    return HARD_NODE_RANKS.constructionDraft;
  }
  if (/平面/.test(text)) {
    return HARD_NODE_RANKS.floorPlanFinish;
  }
  if (/复尺/.test(text)) {
    return HARD_NODE_RANKS.measure;
  }
  if (/上会/.test(text)) {
    return HARD_NODE_RANKS.meeting;
  }
  return -1;
}

export function hasSoftWorkflowProgress(project, softStage = readWorkflowStage(project, 'soft')) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  const stage = String(softStage || '').trim();
  if (stage && !SOFT_NOT_STARTED_STAGE_PATTERN.test(stage)) {
    return true;
  }
  return (
    hasActivePointDesignStartSignal(project) ||
    isProjectNodeStatusComplete(readProjectNodeValue(project, 'pointStatus')) ||
    hasProjectNodeValue(project, 'pointDone') ||
    hasProjectNodeValue(project, 'productListSent') ||
    hasProjectNodeValue(project, 'softSchemeStart') ||
    hasProjectNodeValue(project, 'purchaseTime') ||
    hasProjectNodeValue(project, 'displayFileSent') ||
    hasProjectNodeValue(project, 'displayStart') ||
    hasProjectNodeValue(project, 'displayTime') ||
    hasProjectNodeValue(project, 'softDoneTime')
  );
}


export function inferHardCompletedRank(project, hardStage, softStage) {
  let rank = -1;
  if (isProjectMeetingStageComplete(project)) rank = Math.max(rank, HARD_NODE_RANKS.meeting);
  if (isProjectMeasureStageComplete(project)) rank = Math.max(rank, HARD_NODE_RANKS.measure);
  if (hasProjectNodeValue(project, 'floorPlanStart')) rank = Math.max(rank, HARD_NODE_RANKS.floorPlanStart);
  if (hasProjectNodeValue(project, 'floorPlanFinish')) rank = Math.max(rank, HARD_NODE_RANKS.floorPlanFinish);
  if (hasProjectNodeValue(project, 'constructionDraft')) rank = Math.max(rank, HARD_NODE_RANKS.constructionDraft);
  if (hasProjectNodeValue(project, 'constructionReview')) rank = Math.max(rank, HARD_NODE_RANKS.constructionReview);
  if (/闭环|已完成|^完成$|摆场|待采购|施工整改|点位/.test(String(hardStage || ''))) {
    rank = Math.max(rank, HARD_NODE_RANKS.constructionReview);
  }
  return rank;
}


export function inferHardNodeProgress(project, hardStage, softStage) {
  return {
    currentRank: inferHardStageCurrentRank(hardStage),
    completedRank: inferHardCompletedRank(project, hardStage, softStage),
  };
}


export function shouldPromptHardNode(progress, nodeKey) {
  const nodeRank = HARD_NODE_RANKS[nodeKey];
  return progress.completedRank < nodeRank && progress.currentRank <= nodeRank;
}


export function readWorkflowStage(project, discipline = 'hard') {
  if (discipline === 'soft' && isSleepStoreProject(project)) {
    return '';
  }
  const fields = discipline === 'soft' ? SOFT_WORKFLOW_FIELDS : HARD_WORKFLOW_FIELDS;
  const stage = readRawFieldDisplay(project, fields);
  if (stage) {
    return stage;
  }
  const stageProperty = discipline === 'soft' ? project?.softProgressStage : project?.hardProgressStage;
  if (stageProperty) {
    return String(stageProperty || '').trim();
  }
  if (discipline === 'hard' && project?.progress !== undefined && project?.progress !== null && project?.progress !== '') {
    return progressFallbackStage(project.progress);
  }
  return '';
}


export function readEffectiveWorkflowStage(project, discipline = 'hard') {
  const stage = readWorkflowStage(project, discipline);
  if (discipline === 'hard') {
    if (isPausedWorkflowStage(stage)) {
      return stage;
    }
    if (hasHardConstructionStartSignal(project) && (!stage || /未开始|未安排|待启动|平面/.test(stage))) {
      return '施工图';
    }
    return stage;
  }
  if (isSleepStoreProject(project)) {
    return '';
  }
  if (isPausedWorkflowStage(stage)) {
    return stage;
  }
  const stageReminder = resolveProjectStageReminder(project);
  if (stageReminder.currentStage.key === PROJECT_STAGE_KEYS.displayFinished) {
    return '摆场结束';
  }
  if (stageReminder.currentStage.key === PROJECT_STAGE_KEYS.displayInProgress) {
    return '摆场中';
  }
  if (isProjectNodeStatusComplete(readProjectNodeValue(project, 'pointStatus')) || hasProjectNodeValue(project, 'pointDone')) {
    if (!stage || SOFT_NOT_STARTED_STAGE_PATTERN.test(stage) || /点位/.test(stage)) {
      return '点位完成';
    }
  }
  if (hasActivePointDesignStartSignal(project) && (!stage || SOFT_NOT_STARTED_STAGE_PATTERN.test(stage))) {
    return '点位设计';
  }
  return stage;
}


export function projectStageDisplayItems(project) {
  const stopState = projectStopState(project);
  if (stopState.key === 'canceled') {
    return [{ track: stopState.label, value: stopState.message, className: 'is-canceled' }];
  }
  const hard = readEffectiveWorkflowStage(project, 'hard');
  const soft = readEffectiveWorkflowStage(project, 'soft');
  const items = [];
  if (hard) {
    items.push({ track: '硬装', value: hard, className: 'is-hard' });
  }
  if (soft) {
    items.push({ track: /点位/.test(soft) ? '点位' : '软装', value: soft, className: /点位/.test(soft) ? 'is-point' : 'is-soft' });
  }
  return items;
}


export function isPausedProject(project) {
  return projectStopState(project).key === 'paused';
}


export function isHardWorkflowClosed(project) {
  if (isSleepStoreProject(project)) {
    return isSleepHardDecorationClosed(project);
  }
  const stage = readWorkflowStage(project, 'hard');
  return stage === '闭环' || stage === '完成' || stage === '已完成';
}


export function isSleepHardDecorationClosed(project) {
  const hardStage = readWorkflowStage(project, 'hard');
  return (
    Boolean(readProjectNodeValue(project, 'constructionReview')) ||
    SLEEP_HARD_CLOSED_STAGE_PATTERN.test(hardStage) ||
    SLEEP_CONSTRUCTION_CLOSED_STAGE_PATTERN.test(hardStage)
  );
}


export function readSoftCompletionStatus(project) {
  return readProjectNodeValue(project, 'softDoneStatus');
}


export function isSoftCompletionDone(project) {
  return /准时完成|延期完成/.test(readSoftCompletionStatus(project));
}


export function isSoftCompletionDelayed(project) {
  const status = readSoftCompletionStatus(project);
  return Boolean(status && /延期/.test(status) && !/延期完成/.test(status));
}


export function readHardDesignCompletionDate(project) {
  return readRawFieldDisplay(project, ['硬装方案完成时间', '躺平内部审核结束时间', '内部审核结束时间']);
}


export function isHardDesignResponsibilityCompleted(project) {
  return Boolean(readHardDesignCompletionDate(project));
}


export function isHardDesignResponsibilityStarted(project) {
  const hardStage = readWorkflowStage(project, 'hard');
  return Boolean(
    readHardDesignCompletionDate(project) ||
      readProjectNodeValue(project, 'floorPlanStart') ||
      readProjectNodeValue(project, 'hardSchemeStatus') ||
      (hardStage && !/未开始|未安排|待启动|未填写|未填入/.test(hardStage))
  );
}


export function isSoftDesignResponsibilityStarted(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  return Boolean(
    hasPointDesignStartSignal(project) ||
    readProjectNodeValue(project, 'pointStatus') ||
      readProjectNodeValue(project, 'pointDone') ||
      readProjectNodeValue(project, 'softSchemeStart') ||
      readSoftCompletionStatus(project)
  );
}


export function isPointDesignCompleted(project) {
  return Boolean(
    readProjectNodeValue(project, 'pointDone') ||
      isProjectNodeStatusComplete(readProjectNodeValue(project, 'pointStatus'))
  );
}


export function isSoftProjectDesignStageCompleted(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  return isPointDesignCompleted(project) && isSoftCompletionDone(project);
}


export function isSoftDesignClosed(project) {
  return isSoftProjectDesignStageCompleted(project);
}


export function hasOpenHardDesignResponsibility(project) {
  if (isHardDesignResponsibilityCompleted(project) || (isSleepStoreProject(project) && isHardWorkflowClosed(project))) {
    return false;
  }
  return isHardDesignResponsibilityStarted(project);
}


export function hasOpenSoftDesignResponsibility(project) {
  return isSoftDesignResponsibilityStarted(project) && !isSoftProjectDesignStageCompleted(project);
}


export function isCompanyLifecycleClosed(project) {
  if (isSleepStoreProject(project)) {
    return isHardWorkflowClosed(project);
  }
  return readWorkflowStage(project, 'hard') === '闭环' || readWorkflowStage(project, 'soft') === '闭环';
}


export function isSingleTrackLifecycleClosure(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  const hardClosed = readWorkflowStage(project, 'hard') === '闭环';
  const softClosed = readWorkflowStage(project, 'soft') === '闭环';
  return hardClosed !== softClosed;
}


export function hasCompletedLifecycleMetric(project) {
  return Boolean(project?.metrics?.lifecycle?.completed);
}


export function isProjectLifecycleClosed(project) {
  return hasCompletedLifecycleMetric(project) || isCompanyLifecycleClosed(project);
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
    (!hasSoftTrack || isSoftProjectDesignStageCompleted(project))
  );
}


export function isProjectResponsibilityDelayed(project) {
  if (project?.responsibilityDelayed !== undefined) {
    return Boolean(project.responsibilityDelayed);
  }
  if (isDesignResponsibilityClosed(project)) {
    return false;
  }
  const hardSchemeDelayed = /延期/.test(readProjectNodeValue(project, 'hardSchemeStatus'));
  return (
    (hasOpenHardDesignResponsibility(project) && hardSchemeDelayed) ||
    (hasOpenSoftDesignResponsibility(project) && isSoftCompletionDelayed(project))
  );
}


export function resolvePrimaryWorkflowDiscipline(project) {
  if (isSleepStoreProject(project)) {
    return 'hard';
  }
  return isHardWorkflowClosed(project) ? 'soft' : 'hard';
}


export function readProjectStage(project) {
  const parts = projectStageDisplayItems(project).map((item) => `${item.track}：${item.value}`);
  if (parts.length) {
    return parts.join(' · ');
  }

  if (isSleepStoreProject(project)) {
    return (
      readRawFieldDisplay(project, ['硬装方案情况', '上会情况']) ||
      (project?.progress ? `${project.progress}%` : '') ||
      project?.status ||
      ''
    );
  }

  return (
    readRawFieldDisplay(project, ['硬装方案情况', '点位完成情况', '上会情况']) ||
    (project?.progress ? `${project.progress}%` : '') ||
    project?.status ||
    ''
  );
}


export function resolveWorkflowStageDateRule(stage, discipline) {
  const rules = WORKFLOW_STAGE_DATE_RULES[discipline] || [];
  if (!stage) {
    return null;
  }
  return rules.find((rule) => rule.pattern.test(stage)) || null;
}


export function isProjectWorkflowClosed(project) {
  return isProjectLifecycleClosed(project);
}


export function readProjectClosureDate(project) {
  return (
    readRawFieldDisplay(project, PROJECT_CLOSURE_DATE_FIELDS) ||
    project?.recordMeta?.lastModifiedTime ||
    project?.updatedAt ||
    ''
  );
}


export function parseProjectSortTimestamp(value) {
  if (value === undefined || value === null || value === '') {
    return Number.NEGATIVE_INFINITY;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10000000000 ? value * 1000 : value;
  }

  const raw = String(value).trim();
  if (!raw) {
    return Number.NEGATIVE_INFINITY;
  }
  if (/^\d{10,13}$/.test(raw)) {
    const timestamp = Number(raw);
    return raw.length === 10 ? timestamp * 1000 : timestamp;
  }

  const dateOnly = raw.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (dateOnly) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }

  const timestamp = new Date(raw).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}


export function projectWorkbenchStageRank(project, keyDate) {
  if (PROJECT_WORKBENCH_STAGE_ORDER.has(keyDate.label)) {
    return PROJECT_WORKBENCH_STAGE_ORDER.get(keyDate.label);
  }

  const stageText = [keyDate.stage, readWorkflowStage(project, 'hard'), readWorkflowStage(project, 'soft')]
    .filter(Boolean)
    .join(' ');
  const stageRules = [
    [/未开始|未安排|待启动/, '上会'],
    [/上会/, '上会'],
    [/复尺/, '复尺'],
    [/平面/, '平面开始'],
    [/施工图.*审核|内审/, '施工图审核'],
    [/施工图/, '施工图初稿'],
    [/点位/, '点位'],
    [/软装方案/, '软装方案'],
    [/软装完成/, '软装完成'],
    [/产品清单/, '产品清单'],
    [/采购情况/, '采购情况'],
    [/采购/, '采购'],
    [/施工整改/, '整改'],
    [/摆场|白场/, '摆场'],
  ];
  const matched = stageRules.find(([pattern]) => pattern.test(stageText));
  if (!matched) {
    return PROJECT_WORKBENCH_STAGE_ORDER.size;
  }
  return PROJECT_WORKBENCH_STAGE_ORDER.get(matched[1]) ?? PROJECT_WORKBENCH_STAGE_ORDER.size;
}


export function readMeetingPointStatus(project) {
  const fields = [readRawFieldDisplay(project, ['上会情况'])];
  if (!isSleepStoreProject(project)) {
    fields.push(readRawFieldDisplay(project, ['点位完成情况']));
  }
  return fields
    .filter(Boolean)
    .join(' · ');
}


export function projectAreaLabel(project) {
  const rawArea = readRawFieldDisplay(project, ['面积', '门店面积']) || project?.difficulty?.area || '';
  const text = String(rawArea ?? '').trim();
  if (!text) {
    return '';
  }
  return /m2|\u33a1|\u5e73|\u5e73\u65b9/i.test(text) ? text : `${text}\u33a1`;
}

