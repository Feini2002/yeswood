import { isSleepStoreProject, readRawFieldDisplay } from './project-display.mjs';

export const PROJECT_STAGE_KEYS = {
  canceled: 'canceled',
  paused: 'paused',
  closed: 'closed',
  displayFinished: 'displayFinished',
  displayInProgress: 'displayInProgress',
  purchaseDone: 'purchaseDone',
  purchaseInProgress: 'purchaseInProgress',
  productListReady: 'productListReady',
  softDone: 'softDone',
  softInProgress: 'softInProgress',
  pointDone: 'pointDone',
  pointInProgress: 'pointInProgress',
  constructionReviewDone: 'constructionReviewDone',
  constructionInProgress: 'constructionInProgress',
  floorPlanDone: 'floorPlanDone',
  floorPlanInProgress: 'floorPlanInProgress',
  measured: 'measured',
  meeting: 'meeting',
  notStarted: 'notStarted',
};

export const PROJECT_STAGE_FIELD_ALIASES = {
  hardStage: ['硬装项目进度', '硬装进度'],
  softStage: ['软装项目进度', '软装进度'],
  status: ['项目状态', '状态'],
  meetingDate: ['上会时间', '上会日期'],
  measureDate: ['复尺时间', '复尺日期'],
  floorPlanStart: ['平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）', '平面开始时间'],
  floorPlanFinish: ['躺平内部审核结束时间', '内部审核结束时间', '硬装方案完成时间'],
  constructionDraft: ['施工图初稿完成时间（外包首次提供图纸的时间）', '施工图初稿完成时间'],
  constructionReview: [
    '施工图完成审核时间（施工图终稿完成时间 商场审核完成时间）',
    '施工图完成审核时间',
  ],
  pointStatus: ['点位完成情况'],
  pointDone: ['点位完成时间'],
  softSchemeStart: ['软装方案开始时间'],
  softDoneStatus: ['软装完成情况'],
  softDoneTime: ['软装完成时间', '软装发项目群时间', '软装发群/完成时间'],
  productListSent: ['产品清单发出时间', '产品清单接收时间', '流程记录：产品清单接收时间'],
  purchaseTime: ['采购时间'],
  purchaseStatus: ['采购完成情况', '采购情况'],
  displayStart: ['摆场开始时间', '摆场时间', '现场摆场时间'],
  displayFileSent: ['摆场文件发出时间(项目群）', '摆场文件发出时间（项目群）'],
};

const STAGE_META = {
  [PROJECT_STAGE_KEYS.canceled]: { label: '取消', rank: 1000 },
  [PROJECT_STAGE_KEYS.paused]: { label: '暂停', rank: 990 },
  [PROJECT_STAGE_KEYS.closed]: { label: '闭环完成', rank: 980 },
  [PROJECT_STAGE_KEYS.displayFinished]: { label: '摆场结束', rank: 900 },
  [PROJECT_STAGE_KEYS.displayInProgress]: { label: '摆场中', rank: 880 },
  [PROJECT_STAGE_KEYS.purchaseDone]: { label: '采购完成', rank: 820 },
  [PROJECT_STAGE_KEYS.purchaseInProgress]: { label: '采购中', rank: 800 },
  [PROJECT_STAGE_KEYS.productListReady]: { label: '产品清单已接收', rank: 760 },
  [PROJECT_STAGE_KEYS.softDone]: { label: '软装完成', rank: 720 },
  [PROJECT_STAGE_KEYS.softInProgress]: { label: '软装方案中', rank: 680 },
  [PROJECT_STAGE_KEYS.pointDone]: { label: '点位完成', rank: 640 },
  [PROJECT_STAGE_KEYS.pointInProgress]: { label: '点位设计', rank: 600 },
  [PROJECT_STAGE_KEYS.constructionReviewDone]: { label: '施工图审核完成', rank: 560 },
  [PROJECT_STAGE_KEYS.constructionInProgress]: { label: '施工图', rank: 520 },
  [PROJECT_STAGE_KEYS.floorPlanDone]: { label: '平面方案完成', rank: 480 },
  [PROJECT_STAGE_KEYS.floorPlanInProgress]: { label: '平面方案', rank: 440 },
  [PROJECT_STAGE_KEYS.measured]: { label: '复尺完成', rank: 360 },
  [PROJECT_STAGE_KEYS.meeting]: { label: '上会', rank: 320 },
  [PROJECT_STAGE_KEYS.notStarted]: { label: '未开始', rank: 0 },
};

const NOT_STARTED_PATTERN = /未开始|未启动|未安排|未排期|待启动|待开始/;
const PAUSED_PATTERN = /暂停/;
const CANCELED_PATTERN = /取消|已取消|关闭|已关闭|撤销|作废/;
const PAUSE_RECOVERY_PATTERN = /曾暂停|历史暂停|暂停后(?:恢复|复工|重启|继续|推进)|暂停.*(?:恢复|复工|重启|继续|推进)/;
const REPAUSED_PATTERN = /(?:再次|重新|又).*暂停|(?:恢复|复工|重启|继续|推进)后.*暂停/;
const COMPLETE_TEXT_PATTERN = /已完成|完成|准时完成|延期完成|已发出|已接收|已采购|通过/;
const INCOMPLETE_TEXT_PATTERN = /未完成|未开始|未启动|未安排|待|延期中|暂停|取消/;
const DISPLAY_ACTIVE_PATTERN = /摆场|白场|进场/;
const DISPLAY_NOT_ACTIVE_PATTERN = /未安排摆场|未开始|未启动|暂停|取消/;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function readField(project, key) {
  return readRawFieldDisplay(project, PROJECT_STAGE_FIELD_ALIASES[key] || []);
}

function hasValue(value) {
  return Boolean(normalizeText(value));
}

function hasNode(nodes, key) {
  return hasValue(nodes[key]);
}

function stageText(project, nodes) {
  return [nodes.hardStage, nodes.softStage, project?.hardProgressStage, project?.softProgressStage]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
}

function isCompleteText(value) {
  const text = normalizeText(value);
  return Boolean(text && !INCOMPLETE_TEXT_PATTERN.test(text) && COMPLETE_TEXT_PATTERN.test(text));
}

function isCurrentPausedText(value) {
  const text = normalizeText(value);
  if (!PAUSED_PATTERN.test(text)) {
    return false;
  }
  if (REPAUSED_PATTERN.test(text)) {
    return true;
  }
  return !PAUSE_RECOVERY_PATTERN.test(text);
}

function isCanceledText(value) {
  return CANCELED_PATTERN.test(normalizeText(value));
}

function hasActiveDisplayText(text) {
  const normalized = normalizeText(text);
  return DISPLAY_ACTIVE_PATTERN.test(normalized) && !DISPLAY_NOT_ACTIVE_PATTERN.test(normalized);
}

function stageInfo(key, overrides = {}) {
  const meta = STAGE_META[key] || STAGE_META[PROJECT_STAGE_KEYS.notStarted];
  return { key, label: meta.label, rank: meta.rank, ...overrides };
}

function makeReminder({ label = '', raw = '', discipline = 'followup', stage = '', message = '', kind = 'stage_action', missing = false } = {}) {
  return {
    label,
    raw,
    formatted: raw || '--',
    discipline,
    stage,
    message,
    kind,
    missing,
  };
}

function makeDataGap(key, label, message, stage = '') {
  return {
    key,
    label,
    message,
    stage,
    kind: 'data_gap',
    missing: true,
  };
}

function gapToReminder(gap) {
  return makeReminder({
    label: gap.label,
    discipline: 'data',
    stage: gap.stage,
    message: gap.message,
    kind: 'data_gap',
    missing: true,
  });
}

function readStageNodes(project) {
  const nodes = Object.fromEntries(Object.keys(PROJECT_STAGE_FIELD_ALIASES).map((key) => [key, readField(project, key)]));
  nodes.hardStage = nodes.hardStage || normalizeText(project?.hardProgressStage);
  nodes.softStage = isSleepStoreProject(project) ? '' : nodes.softStage || normalizeText(project?.softProgressStage);
  nodes.status = nodes.status || normalizeText(project?.status);
  return nodes;
}

function expandCompactWorkflowFacts(project = {}) {
  const compact = project?.workflowFacts;
  if (!compact || typeof compact !== 'object') {
    return null;
  }
  const hardStage = normalizeText(project?.hardProgressStage);
  const softStage = isSleepStoreProject(project) ? '' : normalizeText(project?.softProgressStage);
  const status = normalizeText(project?.status);
  return {
    projectId: project?.id || '',
    hardStage,
    softStage,
    status,
    sleepStore: isSleepStoreProject(project),
    canceled: Boolean(compact.canceled),
    paused: Boolean(compact.paused),
    closed: Boolean(compact.lifecycleClosed),
    stageText: [hardStage, softStage, status].filter(Boolean).join(' '),
    statusConflicts: Array.isArray(compact.statusConflicts) ? compact.statusConflicts : [],
    dataConflicts: Array.isArray(compact.dataConflicts) ? compact.dataConflicts : [],
    nodes: {
      displayStarted: Boolean(compact.displayStarted),
      displayStart: compact.displayStartedAt || '',
      displayStartedDirect: Boolean(compact.displayStartedAt || compact.displayStarted),
      displayStartedByStage: false,
      displayEnded: Boolean(compact.displayEnded),
      displayFileSent: compact.displayEndedAt || '',
      displayEndedDirect: Boolean(compact.displayEndedAt || compact.displayEnded),
      purchaseStarted: Boolean(compact.purchaseStarted),
      purchaseDone: Boolean(compact.purchaseDone),
      purchaseDoneDirect: Boolean(compact.purchaseDone),
      productListReady: Boolean(compact.productListReady),
      softDone: Boolean(compact.softDone),
    },
  };
}

export function resolveProjectWorkflowFacts(project = {}) {
  if (!project?.rawFields && project?.stageReminder?.facts) {
    return project.stageReminder.facts;
  }
  if (!project?.rawFields) {
    const compactFacts = expandCompactWorkflowFacts(project);
    if (compactFacts) {
      return compactFacts;
    }
  }
  const nodes = readStageNodes(project);
  const text = stageText(project, nodes);
  const sleepStore = isSleepStoreProject(project);
  const canceled = isCanceledText(nodes.status) || isCanceledText(nodes.hardStage) || isCanceledText(nodes.softStage);
  const paused = !canceled && (isCurrentPausedText(nodes.hardStage) || isCurrentPausedText(nodes.softStage));
  const sleepHardClosed =
    sleepStore &&
    (hasNode(nodes, 'constructionReview') ||
      /施工.*闭环|施工图.*(完成审核|审核完成|审核通过)|施工图完成审核|施工图审核通过/.test(nodes.hardStage) ||
      /^(闭环|完成|已完成)$/.test(nodes.hardStage));
  const closed = !canceled && !paused && (sleepHardClosed || normalizeText(nodes.hardStage) === '闭环' || normalizeText(nodes.softStage) === '闭环');

  const displayEndedDirect = hasNode(nodes, 'displayFileSent');
  const displayStartedDirect = hasNode(nodes, 'displayStart');
  const displayStartedByStage = !sleepStore && hasActiveDisplayText(text);
  const displayEnded = displayEndedDirect;
  const displayStarted = !sleepStore && (displayStartedDirect || displayStartedByStage || displayEnded);

  const purchaseStatusDone = isCompleteText(nodes.purchaseStatus);
  const purchaseStartedByStage = /待采购|采购/.test(text) && !/未采购|未开始采购/.test(text);
  const purchaseStartedDirect = hasNode(nodes, 'purchaseTime');
  const purchaseDoneByStage = /已采购|采购.*完成/.test(text) && !/待采购完成|待采购|未采购|未开始采购/.test(text);
  const purchaseDoneDirect = purchaseStatusDone || purchaseDoneByStage;
  const purchaseDone = purchaseDoneDirect || displayStarted || displayEnded;
  const purchaseStarted = purchaseDone || purchaseStartedDirect || purchaseStartedByStage || hasNode(nodes, 'purchaseStatus');

  const productListReady =
    hasNode(nodes, 'productListSent') || purchaseStarted || purchaseDone || displayStarted || displayEnded || /产品清单|采购|摆场|闭环/.test(text);

  const softDoneStatusFilled = hasValue(nodes.softDoneStatus);
  const softDoneStatusDone = isCompleteText(nodes.softDoneStatus);
  const softDoneTimeDirect = hasNode(nodes, 'softDoneTime');
  const softDoneStatusBlocksCompletion = softDoneStatusFilled && !softDoneStatusDone && !softDoneTimeDirect;
  const softDoneDirect = softDoneStatusDone || softDoneTimeDirect;
  const softDone =
    !sleepStore &&
    (softDoneDirect ||
      productListReady ||
      purchaseStarted ||
      displayStarted ||
      displayEnded ||
      /软装完成|产品清单|采购|摆场|闭环/.test(text));
  const softStarted =
    !sleepStore &&
    (hasNode(nodes, 'softSchemeStart') || softDone || /软装方案|软装完成|产品清单|采购|摆场|闭环/.test(text));

  const statusConflicts = [];
  if (
    softDoneStatusFilled &&
    !softDoneStatusDone &&
    (softDoneTimeDirect || productListReady || purchaseStarted || displayStarted || displayEnded)
  ) {
    statusConflicts.push({
      key: 'softDoneStatusWithDownstreamFacts',
      field: 'softDoneStatus',
      value: nodes.softDoneStatus,
      message: 'softDoneStatus is unfinished but downstream workflow facts exist',
    });
  }
  const dataConflicts = statusConflicts;

  const pointDone =
    !sleepStore &&
    (hasNode(nodes, 'pointDone') || isCompleteText(nodes.pointStatus) || softStarted || softDone || /点位.*完成|软装|产品清单|采购|摆场|闭环/.test(text));
  const pointStarted = !sleepStore && (pointDone || /点位/.test(text));

  const floorPlanDoneDirect = hasNode(nodes, 'floorPlanFinish');
  const constructionReviewDone =
    hasNode(nodes, 'constructionReview') ||
    /施工图.*(完成审核|审核完成|审核通过)|施工图完成审核|施工图审核通过/.test(nodes.hardStage);
  const constructionStarted =
    constructionReviewDone ||
    hasNode(nodes, 'constructionDraft') ||
    (floorPlanDoneDirect && /施工图|内审|审核|施工整改/.test(nodes.hardStage));
  const floorPlanDone = floorPlanDoneDirect || constructionStarted || constructionReviewDone || /点位|软装|产品清单|采购|摆场|闭环/.test(text);
  const floorPlanStarted = hasNode(nodes, 'floorPlanStart') || floorPlanDone || /平面|躺平|方案/.test(text);
  const measured = hasNode(nodes, 'measureDate') || floorPlanStarted || floorPlanDone || constructionStarted;
  const meeting = hasNode(nodes, 'meetingDate') || measured || /上会/.test(text);

  return {
    projectId: project?.id || '',
    hardStage: nodes.hardStage,
    softStage: nodes.softStage,
    status: nodes.status,
    sleepStore,
    canceled,
    paused,
    closed,
    stageText: text,
    statusConflicts,
    dataConflicts,
    nodes: {
      ...nodes,
      displayStarted,
      displayStartedDirect,
      displayStartedByStage,
      displayEnded,
      displayEndedDirect,
      purchaseStarted,
      purchaseStartedDirect,
      purchaseDoneDirect,
      purchaseDoneByStage,
      purchaseDone,
      productListReady,
      softDoneStatusFilled,
      softDoneStatusDone,
      softDoneStatusBlocksCompletion,
      softDoneTimeDirect,
      softDoneDirect,
      softDone,
      softStarted,
      pointStarted,
      pointDone,
      constructionStarted,
      constructionReviewDone,
      floorPlanStarted,
      floorPlanDone,
      measured,
      meeting,
    },
  };
}

function resolveStageFromFacts(facts) {
  const nodes = facts.nodes;
  if (facts.canceled) return stageInfo(PROJECT_STAGE_KEYS.canceled);
  if (facts.paused) return stageInfo(PROJECT_STAGE_KEYS.paused);
  if (facts.closed) return stageInfo(PROJECT_STAGE_KEYS.closed);
  if (nodes.displayEnded) return stageInfo(PROJECT_STAGE_KEYS.displayFinished);
  if (nodes.displayStarted) return stageInfo(PROJECT_STAGE_KEYS.displayInProgress);
  if (nodes.purchaseDone) return stageInfo(PROJECT_STAGE_KEYS.purchaseDone);
  if (nodes.purchaseStarted) return stageInfo(PROJECT_STAGE_KEYS.purchaseInProgress);
  if (nodes.productListReady) return stageInfo(PROJECT_STAGE_KEYS.productListReady);
  if (nodes.softDone) return stageInfo(PROJECT_STAGE_KEYS.softDone);
  if (nodes.softStarted) return stageInfo(PROJECT_STAGE_KEYS.softInProgress);
  if (nodes.pointDone) return stageInfo(PROJECT_STAGE_KEYS.pointDone);
  if (nodes.pointStarted) return stageInfo(PROJECT_STAGE_KEYS.pointInProgress);
  if (nodes.constructionReviewDone) return stageInfo(PROJECT_STAGE_KEYS.constructionReviewDone);
  if (nodes.constructionStarted) return stageInfo(PROJECT_STAGE_KEYS.constructionInProgress);
  if (nodes.floorPlanDone) return stageInfo(PROJECT_STAGE_KEYS.floorPlanDone);
  if (nodes.floorPlanStarted) return stageInfo(PROJECT_STAGE_KEYS.floorPlanInProgress);
  if (nodes.measured) return stageInfo(PROJECT_STAGE_KEYS.measured);
  if (nodes.meeting) return stageInfo(PROJECT_STAGE_KEYS.meeting);
  return stageInfo(PROJECT_STAGE_KEYS.notStarted);
}

function resolveDataGaps(facts, currentStage) {
  const nodes = facts.nodes;
  const gaps = [];
  if ((nodes.softDoneTime || nodes.productListReady || nodes.purchaseStarted || nodes.displayStarted || nodes.displayEnded) && !nodes.softDoneStatusDone && !hasValue(nodes.softDoneStatus)) {
    gaps.push(makeDataGap('softDoneStatusMissing', '软装完成情况', '软装完成情况待补录', currentStage.label));
  }
  if (nodes.displayEnded && !nodes.displayStartedDirect) {
    gaps.push(makeDataGap('displayStartMissing', '摆场开始时间', '摆场开始时间待补录', currentStage.label));
  }
  if ((nodes.purchaseStarted || nodes.purchaseDone || nodes.displayStarted || nodes.displayEnded) && !hasValue(nodes.productListSent)) {
    gaps.push(makeDataGap('productListMissing', '产品清单接收时间', '产品清单接收时间待补录', currentStage.label));
  }
  if ((nodes.displayStarted || nodes.displayEnded) && !nodes.purchaseDoneDirect && !hasValue(nodes.purchaseStatus)) {
    gaps.push(makeDataGap('purchaseStatusMissing', '采购完成情况', '采购完成情况待补录', currentStage.label));
  }
  return gaps;
}

function resolvePrimaryReminder(facts, currentStage) {
  const nodes = facts.nodes;
  if (facts.canceled) {
    return makeReminder({ label: '取消', discipline: 'status', stage: currentStage.label, message: '项目已取消', kind: 'status' });
  }
  if (facts.paused) {
    return makeReminder({ label: '暂停', discipline: 'status', stage: currentStage.label, message: '项目暂停中', kind: 'status' });
  }
  if (facts.closed) {
    return makeReminder({ discipline: 'status', stage: currentStage.label, kind: 'status' });
  }
  if (nodes.displayEnded) {
    return makeReminder({ label: '闭环', discipline: 'followup', stage: currentStage.label, message: '项目待闭环' });
  }
  if (nodes.displayStarted) {
    return makeReminder({
      label: '摆场结束',
      raw: nodes.displayStart,
      discipline: 'followup',
      stage: currentStage.label,
      message: '等待摆场结束',
      missing: true,
    });
  }
  if (nodes.purchaseDone) {
    return makeReminder({ label: '摆场', discipline: 'followup', stage: currentStage.label, message: '待摆场', missing: true });
  }
  if (nodes.purchaseStarted) {
    return makeReminder({ label: '采购完成', discipline: 'followup', stage: currentStage.label, message: '待采购完成', missing: true });
  }
  if (nodes.productListReady) {
    return makeReminder({ label: '采购', discipline: 'followup', stage: currentStage.label, message: '待采购', missing: true });
  }
  if (nodes.softDone) {
    return makeReminder({ label: '产品清单接收', discipline: 'followup', stage: currentStage.label, message: '待产品清单接收', missing: true });
  }
  if (nodes.softDoneTime && !nodes.softDoneStatusDone) {
    return makeReminder({ label: '软装完成情况', raw: nodes.softDoneTime, discipline: 'soft', stage: currentStage.label, message: '待软装完成情况', missing: true });
  }
  if (nodes.softStarted) {
    return makeReminder({ label: '软装完成', raw: nodes.softSchemeStart, discipline: 'soft', stage: currentStage.label, message: '待软装完成', missing: true });
  }
  if (nodes.pointDone) {
    return makeReminder({ label: '软装方案', discipline: 'soft', stage: currentStage.label, message: '待软装方案', missing: true });
  }
  if (nodes.pointStarted) {
    return makeReminder({ label: '点位完成', discipline: 'soft', stage: currentStage.label, message: '待点位完成', missing: true });
  }
  if (nodes.constructionReviewDone) {
    return makeReminder({ label: '点位', discipline: 'soft', stage: currentStage.label, message: '待点位跟进', missing: true });
  }
  if (nodes.constructionStarted) {
    return makeReminder({ label: '施工图审核', discipline: 'hard', stage: currentStage.label, message: '待施工图审核', missing: true });
  }
  if (nodes.floorPlanDone) {
    return makeReminder({ label: '施工图初稿', discipline: 'hard', stage: currentStage.label, message: '待施工图初稿', missing: true });
  }
  if (nodes.floorPlanStarted) {
    return makeReminder({ label: '平面结束', raw: nodes.floorPlanStart, discipline: 'hard', stage: currentStage.label, message: '待平面结束', missing: true });
  }
  if (nodes.measured) {
    return makeReminder({ label: '平面开始', discipline: 'hard', stage: currentStage.label, message: '待平面开始', missing: true });
  }
  if (nodes.meeting) {
    return makeReminder({ label: '复尺', discipline: 'hard', stage: currentStage.label, message: '待复尺', missing: true });
  }
  return makeReminder({ label: '上会', discipline: 'hard', stage: currentStage.label, message: '待上会', missing: true });
}

export function resolveProjectStageReminder(project = {}) {
  if (!project?.rawFields && project?.stageReminder?.currentStage && project?.stageReminder?.primaryReminder) {
    const facts = project.stageReminder.facts || resolveProjectWorkflowFacts(project);
    const statusConflicts = project.stageReminder.statusConflicts || facts.statusConflicts || [];
    const dataConflicts = project.stageReminder.dataConflicts || facts.dataConflicts || [];
    return {
      facts,
      currentStage: project.stageReminder.currentStage,
      primaryReminder: project.stageReminder.primaryReminder,
      dataGaps: project.stageReminder.dataGaps || [],
      statusConflicts,
      dataConflicts,
      reminders: project.stageReminder.reminders || [project.stageReminder.primaryReminder],
    };
  }
  const facts = resolveProjectWorkflowFacts(project);
  const currentStage = resolveStageFromFacts(facts);
  const primaryReminder = resolvePrimaryReminder(facts, currentStage);
  const dataGaps = resolveDataGaps(facts, currentStage);
  const statusConflicts = facts.statusConflicts || [];
  const dataConflicts = facts.dataConflicts || [];
  return {
    facts,
    currentStage,
    primaryReminder,
    dataGaps,
    statusConflicts,
    dataConflicts,
    reminders: [primaryReminder, ...dataGaps.map(gapToReminder)],
  };
}

export function compactProjectWorkflowFacts(facts = {}) {
  const nodes = facts.nodes || {};
  return {
    canceled: Boolean(facts.canceled),
    paused: Boolean(facts.paused),
    lifecycleClosed: Boolean(facts.closed),
    displayStarted: Boolean(nodes.displayStarted),
    displayStartedAt: nodes.displayStart || '',
    displayEnded: Boolean(nodes.displayEnded),
    displayEndedAt: nodes.displayFileSent || '',
    purchaseStarted: Boolean(nodes.purchaseStarted),
    purchaseDone: Boolean(nodes.purchaseDone),
    productListReady: Boolean(nodes.productListReady),
    softDone: Boolean(nodes.softDone),
    statusConflicts: Array.isArray(facts.statusConflicts) ? facts.statusConflicts : [],
    dataConflicts: Array.isArray(facts.dataConflicts) ? facts.dataConflicts : [],
  };
}

export function compactProjectStageReminder(stageReminder = {}, { includeFacts = false } = {}) {
  const dataGaps = Array.isArray(stageReminder.dataGaps) ? stageReminder.dataGaps : [];
  const reminders = Array.isArray(stageReminder.reminders) ? stageReminder.reminders : [];
  const statusConflicts = Array.isArray(stageReminder.statusConflicts) ? stageReminder.statusConflicts : [];
  const dataConflicts = Array.isArray(stageReminder.dataConflicts) ? stageReminder.dataConflicts : [];
  return {
    ...(includeFacts ? { facts: stageReminder.facts || {} } : {}),
    currentStage: stageReminder.currentStage || stageInfo(PROJECT_STAGE_KEYS.notStarted),
    primaryReminder: stageReminder.primaryReminder || makeReminder(),
    dataGapCount: dataGaps.length,
    dataGaps,
    statusConflicts,
    dataConflicts,
    reminders,
  };
}

export function projectStageRank(stageKey) {
  return STAGE_META[stageKey]?.rank ?? STAGE_META[PROJECT_STAGE_KEYS.notStarted].rank;
}
