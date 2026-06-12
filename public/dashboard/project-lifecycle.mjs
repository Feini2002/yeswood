export const LIFECYCLE_STAGE_ORDER = [
  { key: 'notStarted', label: '待上会' },
  { key: 'meeting', label: '待复尺' },
  { key: 'plan', label: '平面方案' },
  { key: 'drawing', label: '施工图' },
  { key: 'point', label: '点位设计' },
  { key: 'softEntry', label: '方案设计' },
  { key: 'purchase', label: '采购推进' },
  { key: 'site', label: '摆场交付' },
  { key: 'closed', label: '闭环完成' },
  { key: 'paused', label: '暂停/取消' },
];

const LIFECYCLE_STAGE_LABELS = Object.fromEntries(LIFECYCLE_STAGE_ORDER.map((stage) => [stage.key, stage.label]));

const FIELD_ALIASES = {
  hardStage: ['硬装项目进度', '硬装进度'],
  softStage: ['软装项目进度', '软装进度'],
  storeTier: ['店态'],
  businessType: ['业态'],
  businessGroup: ['组别'],
  status: ['项目状态', '状态'],
  projectName: ['项目名称', '门店名称'],
  meetingDate: ['上会时间', '上会日期'],
  measureDate: ['复尺时间', '复尺日期'],
  floorPlanStart: ['平面开始时间'],
  floorPlanFinish: ['躺平内部审核结束时间', '内部审核结束时间'],
  constructionDraft: ['施工图初稿完成时间（外包首次提供图纸的时间）', '施工图初稿完成时间'],
  constructionReview: ['施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）', '施工图完成审核时间'],
  pointStatus: ['点位完成情况'],
  pointDone: ['点位完成时间'],
  softSchemeStart: ['软装方案开始时间'],
  softCompletion: ['软装完成情况'],
  softDoneTime: ['软装完成时间', '软装发项目群时间', '软装发群/完成时间'],
  productListSent: ['产品清单发出时间', '产品清单接收时间', '流程记录：产品清单接收时间'],
  purchaseTime: ['采购时间'],
  purchaseStatus: ['采购完成情况', '采购情况'],
  displayFileSent: ['摆场文件发出时间(项目群）', '摆场文件发出时间（项目群）'],
  displayStart: ['摆场开始时间', '摆场时间', '现场摆场时间'],
  displayTime: ['摆场时间', '现场摆场时间'],
};

const PROJECT_FIELD_FALLBACKS = {
  hardStage: 'hardProgressStage',
  softStage: 'softProgressStage',
  storeTier: 'storeStatus',
  businessType: 'businessType',
  projectName: 'name',
};

const SLEEP_STORE_STATUS = '睡眠店';
const SLEEP_STORE_NAME_PATTERN = /睡眠店/;
const SLEEP_HARD_CLOSED_STAGE_PATTERN = /^(闭环|完成|已完成)$/;
const SLEEP_CONSTRUCTION_CLOSED_STAGE_PATTERN =
  /施工.*闭环|施工图.*完成.*审核|施工图.*审核.*完成|施工图.*审核.*通过|施工图完成审核|施工图审核通过/;
const HARD_CONSTRUCTION_START_PATTERN = /施工图|内审|审核|施工整改/;
const SOFT_POINT_START_PATTERN = /点位/;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function readRawFieldDisplay(project, fieldNames = []) {
  const rawFields = project?.rawFields || {};
  const entries = Object.entries(rawFields);
  for (const fieldName of fieldNames) {
    const exact = rawFields[fieldName]?.display;
    if (normalizeText(exact)) {
      return normalizeText(exact);
    }
  }
  for (const fieldName of fieldNames) {
    const needle = normalizeText(fieldName).toLowerCase();
    if (!needle) {
      continue;
    }
    const match = entries.find(([key, cell]) => {
      const display = normalizeText(cell?.display);
      return display && String(key).toLowerCase().includes(needle);
    });
    if (match) {
      return normalizeText(match[1]?.display);
    }
  }
  return '';
}

function readNode(project, key) {
  if (key === 'softStage' && isSleepStoreProject(project)) {
    return '';
  }
  return readRawFieldDisplay(project, FIELD_ALIASES[key] || []) || normalizeText(project?.[PROJECT_FIELD_FALLBACKS[key]]);
}

function isSleepStoreProject(project = {}) {
  const storeStatus = normalizeText(project.storeStatus) || readRawFieldDisplay(project, ['店态']);
  if (storeStatus === SLEEP_STORE_STATUS) {
    return true;
  }
  const projectName = [project.name, readRawFieldDisplay(project, ['项目名称', '门店名称'])]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
  return SLEEP_STORE_NAME_PATTERN.test(projectName);
}

function hasNode(project, key) {
  return Boolean(readNode(project, key));
}

function hasAnyNode(project, keys = []) {
  return keys.some((key) => hasNode(project, key));
}

function hasHardLifecycleEvidence(project) {
  return hasAnyNode(project, [
    'meetingDate',
    'measureDate',
    'floorPlanStart',
    'floorPlanFinish',
    'constructionDraft',
    'constructionReview',
  ]);
}

function isCompleteText(value) {
  const text = normalizeText(value);
  if (!text || /未完成|未开始|未启动|未安排|待|延期中|暂停|取消/.test(text)) {
    return false;
  }
  return /已完成|完成|准时/.test(text);
}

function isSoftCompletionDoneText(value) {
  return /准时完成|延期完成/.test(normalizeText(value));
}

function hasSoftLifecycleEvidence(project, softStage = readNode(project, 'softStage')) {
  const text = normalizeText(softStage);
  return Boolean(
    (text && !isNotStartedStage(text)) ||
      hasAnyNode(project, [
        'pointStatus',
        'pointDone',
        'softSchemeStart',
        'softCompletion',
        'softDoneTime',
        'purchaseTime',
        'purchaseStatus',
        'displayFileSent',
        'displayStart',
        'displayTime',
      ])
  );
}

function isNotStartedStage(stage) {
  const text = normalizeText(stage);
  return !text || /未开始|未启动|待启动|未安排|未排期|未排班/.test(text);
}

function isHardClosedStage(stage) {
  const text = normalizeText(stage);
  return text === '闭环' || text === '完成' || text === '已完成';
}

function isCompanyClosedStage(stage) {
  return normalizeText(stage) === '闭环';
}

const PAUSED_STAGE_PATTERN = /暂停/;
const CANCELED_STAGE_PATTERN = /取消|已取消|关闭|已关闭/;
const PAUSE_RECOVERY_PATTERN = /曾暂停|历史暂停|暂停后(?:恢复|复工|重启|继续|推进)|暂停.*(?:恢复|复工|重启|继续|推进)/;
const REPAUSED_STAGE_PATTERN = /(?:再次|重新|又).*暂停|(?:恢复|复工|重启|继续|推进)后.*暂停/;

function isCurrentPausedStage(stage) {
  const text = normalizeText(stage);
  if (!PAUSED_STAGE_PATTERN.test(text)) {
    return false;
  }
  if (REPAUSED_STAGE_PATTERN.test(text)) {
    return true;
  }
  return !PAUSE_RECOVERY_PATTERN.test(text);
}

function isCanceledStage(stage) {
  return CANCELED_STAGE_PATTERN.test(normalizeText(stage));
}

function isPausedStage(hardStage, softStage) {
  return isCurrentPausedStage(hardStage) || isCurrentPausedStage(softStage);
}

function isStoppedStage(hardStage, softStage) {
  return isCanceledStage(hardStage) || isCanceledStage(softStage) || isPausedStage(hardStage, softStage);
}

function hasHardConstructionStartSignal(project, hardStage = readNode(project, 'hardStage')) {
  const text = normalizeText(hardStage);
  return (
    hasAnyNode(project, ['floorPlanFinish', 'constructionDraft', 'constructionReview']) ||
    (text && !isStoppedStage(text, '') && HARD_CONSTRUCTION_START_PATTERN.test(text))
  );
}

function hasSoftPointStartSignal(softStage) {
  const text = normalizeText(softStage);
  return Boolean(text && !isStoppedStage('', text) && !isNotStartedStage(text) && SOFT_POINT_START_PATTERN.test(text));
}

export function deriveProjectWorkflowFacts(project) {
  const hardStage = readNode(project, 'hardStage');
  const softStage = readNode(project, 'softStage');
  const status = readRawFieldDisplay(project, FIELD_ALIASES.status) || normalizeText(project?.status);
  const paused = isStoppedStage(hardStage, softStage) || isCanceledStage(status);
  const sleepStore = isSleepStoreProject(project);
  const hardConstructionStarted = hasHardConstructionStartSignal(project, hardStage);
  const pointCompleted =
    hasNode(project, 'pointDone') ||
    isCompleteText(readNode(project, 'pointStatus')) ||
    /点位已完成|点位完成/.test(`${hardStage} ${softStage}`);
  const activePointDesignStarted =
    !sleepStore && !paused && (hardConstructionStarted || hasSoftPointStartSignal(softStage));

  return {
    hardStage,
    softStage,
    isPaused: paused,
    isSleepStore: sleepStore,
    hardConstructionStarted,
    activePointDesignStarted,
    pointCompleted,
    softStageNotStarted: isNotStartedStage(softStage),
  };
}

function hasHardLifecycleClosed(project, hardStage) {
  const text = normalizeText(hardStage);
  return (
    isHardClosedStage(text) ||
    /施工图完成审核|施工图审核|内审/.test(text) ||
    /摆场|待采购|点位/.test(text) ||
    hasNode(project, 'constructionReview')
  );
}

function hasSleepHardLifecycleClosed(project, hardStage) {
  const text = normalizeText(hardStage);
  return (
    hasNode(project, 'constructionReview') ||
    SLEEP_HARD_CLOSED_STAGE_PATTERN.test(text) ||
    SLEEP_CONSTRUCTION_CLOSED_STAGE_PATTERN.test(text)
  );
}

function hardLifecycleStage(project, hardStage) {
  const text = normalizeText(hardStage);
  const meetingDone = hasNode(project, 'meetingDate') || /(?:完成|已).*上会|上会.*(?:完成|已)/.test(text);
  const measureDone = hasNode(project, 'measureDate') || /(?:完成|已).*复尺|复尺.*(?:完成|已)/.test(text);

  if (/摆场|白场|进场/.test(text)) {
    return { key: 'site', label: lifecycleStageLabel('site') };
  }
  if (/待采购|采购/.test(text)) {
    return { key: 'purchase', label: lifecycleStageLabel('purchase') };
  }
  if (/点位已完成|点位完成/.test(text)) {
    return { key: 'softEntry', label: lifecycleStageLabel('softEntry') };
  }
  if (/点位/.test(text)) {
    return { key: 'point', label: lifecycleStageLabel('point') };
  }
  if (/施工图|内审|审核|施工整改/.test(text) || hasAnyNode(project, ['floorPlanFinish', 'constructionDraft', 'constructionReview'])) {
    return { key: 'drawing', label: lifecycleStageLabel('drawing') };
  }
  if (/平面|方案|躺平/.test(text) || hasNode(project, 'floorPlanStart') || measureDone) {
    return { key: 'plan', label: lifecycleStageLabel('plan') };
  }
  if (/复尺/.test(text) || meetingDone) {
    return { key: 'meeting', label: lifecycleStageLabel('meeting') };
  }
  if (/上会/.test(text)) {
    return { key: 'notStarted', label: lifecycleStageLabel('notStarted') };
  }

  const progress = safeNumber(project?.progress, null);
  if (progress !== null && progress <= 0) {
    return { key: 'notStarted', label: lifecycleStageLabel('notStarted') };
  }
  if (progress !== null && progress >= 55) {
    return { key: 'drawing', label: lifecycleStageLabel('drawing') };
  }
  if (progress !== null && progress >= 20) {
    return { key: 'plan', label: lifecycleStageLabel('plan') };
  }
  return { key: 'meeting', label: lifecycleStageLabel('meeting') };
}

function softLifecycleStage(project, softStage) {
  const text = normalizeText(softStage);
  const softCompletionDone = isSoftCompletionDoneText(readNode(project, 'softCompletion'));
  const pointCompleted = hasNode(project, 'pointDone') || isCompleteText(readNode(project, 'pointStatus')) || /点位已完成|点位完成/.test(text);
  const pointStarted = /点位/.test(text) || hasAnyNode(project, ['pointStatus', 'pointDone']);
  const schemeStarted = /软装方案|方案/.test(text) || hasNode(project, 'softSchemeStart') || Boolean(readNode(project, 'softCompletion'));
  const purchaseStarted = /待采购|采购/.test(text) || hasAnyNode(project, ['purchaseTime', 'purchaseStatus']);
  const displayStarted = (/摆场|白场|进场/.test(text) && !/未安排摆场/.test(text)) || hasAnyNode(project, ['displayFileSent', 'displayStart', 'displayTime']);
  if (displayStarted) {
    return { key: 'site', label: lifecycleStageLabel('site') };
  }
  if (purchaseStarted || softCompletionDone) {
    return { key: 'purchase', label: lifecycleStageLabel('purchase') };
  }
  if (pointStarted && !pointCompleted) {
    return { key: 'point', label: lifecycleStageLabel('point') };
  }
  if (pointCompleted || schemeStarted) {
    return { key: 'softEntry', label: lifecycleStageLabel('softEntry') };
  }
  if (pointStarted) {
    return { key: 'point', label: lifecycleStageLabel('point') };
  }
  return { key: 'point', label: lifecycleStageLabel('point') };
}

export function lifecycleStageLabel(key = '') {
  return LIFECYCLE_STAGE_LABELS[key] || key || '';
}

export function classifyProjectLifecycleStage(project) {
  const facts = deriveProjectWorkflowFacts(project);
  const { hardStage, softStage } = facts;

  if (facts.isPaused) {
    return { key: 'paused', label: lifecycleStageLabel('paused') };
  }

  if (facts.isSleepStore) {
    if (hasSleepHardLifecycleClosed(project, hardStage)) {
      return { key: 'closed', label: lifecycleStageLabel('closed') };
    }
    if (isNotStartedStage(hardStage) && !hasHardLifecycleEvidence(project)) {
      return { key: 'notStarted', label: lifecycleStageLabel('notStarted') };
    }
    return hardLifecycleStage(project, hardStage);
  }

  if (isCompanyClosedStage(hardStage) || isCompanyClosedStage(softStage)) {
    return { key: 'closed', label: lifecycleStageLabel('closed') };
  }

  if (isNotStartedStage(hardStage) && isNotStartedStage(softStage) && !hasHardLifecycleEvidence(project)) {
    return { key: 'notStarted', label: lifecycleStageLabel('notStarted') };
  }

  if (facts.activePointDesignStarted && facts.softStageNotStarted && !facts.pointCompleted) {
    return { key: 'point', label: lifecycleStageLabel('point') };
  }

  if (!hasHardLifecycleClosed(project, hardStage) && !hasSoftLifecycleEvidence(project, softStage)) {
    return hardLifecycleStage(project, hardStage);
  }

  return softLifecycleStage(project, softStage);
}
