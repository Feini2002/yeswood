import { matchesDashboardContext } from './metrics/projectScopes.mjs';
import { normalizeCell, readRawDisplay, readWorkflowStage } from './metrics/fieldSemantics.mjs';
import { resolveProjectStageReminder } from '../../public/domain/project-stage-reminder-rules.mjs';
import {
  resolveCompanyLifecycleState,
  resolveDisplayCompletionState,
  resolveFloorPlanCompletionState,
} from './metrics/workCompletionSemantics.mjs';
import { compactProjectForDetailReadModel } from './projectDetailPayload.mjs';
import { buildProjectTeamAssociations, buildTeamRoster } from './teamProjectAssociations.mjs';
import { teamWithStaticGroups } from './teamStructureFallbacks.mjs';

export const TEAM_WORK_COMPLETION_DATA_QUALITY_NOTE_LIMIT = 32;
export const TEAM_WORK_COMPLETION_PROCESSING_QUEUE_LIMIT = 5;

const METRICS = [
  { key: 'floorPlan', label: '平面方案躺平完成量', monthlyKey: 'floorPlanCompleted', inProgressMonthlyKey: 'floorPlanInProgress' },
  { key: 'display', label: '方案摆场完成量', monthlyKey: 'displayCompleted', inProgressMonthlyKey: 'displayInProgress' },
  { key: 'lifecycle', label: '项目总闭环情况', monthlyKey: 'lifecycleCompleted', inProgressMonthlyKey: 'lifecycleInProgress' },
];

const PRIORITY_STATUS_FIELDS = ['项目状态', '状态', '紧急程度', '项目优先级', '优先级'];
const QUEUE_START_DATE_FIELDS = ['启动时间', '启动日期', '开始日期'];
const QUEUE_DELIVERY_DATE_FIELDS = ['商场交付时间', '商场交付日期', '商场交付'];
const QUEUE_DUE_DATE_FIELDS = ['计划开业时间', '计划完成日期', '截止日期'];
const QUEUE_AREA_FIELDS = ['面积', '门店面积'];
const QUEUE_NODE_FIELD_ALIASES = {
  meetingDate: ['上会时间', '上会日期'],
  measureDate: ['复尺时间', '复尺日期'],
  floorPlanStart: [
    '平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）',
    '平面开始时间',
  ],
  floorPlanFinish: ['躺平内部审核结束时间', '内部审核结束时间', '硬装方案完成时间'],
  constructionDraft: ['施工图初稿完成时间（外包首次提供图纸的时间）', '施工图初稿完成时间'],
  constructionReview: ['施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）', '施工图完成审核时间'],
  pointDone: ['点位完成时间'],
  pointStatus: ['点位完成情况'],
  softSchemeStart: ['软装方案开始时间'],
  softDoneTime: ['软装完成时间', '软装发项目群时间', '软装发群/完成时间'],
  softDoneStatus: ['软装完成情况'],
  productListSent: ['产品清单发出时间', '产品清单接收时间', '流程记录：产品清单接收时间'],
  purchaseTime: ['采购时间'],
  purchaseStatus: ['采购完成情况', '采购情况'],
  displayFileSent: ['摆场文件发出时间(项目群）', '摆场文件发出时间（项目群）'],
  displayStart: ['摆场开始时间', '摆场时间', '现场摆场时间'],
  displayTime: ['摆场时间', '现场摆场时间'],
};
const URGENT_TEXT_PATTERN = /紧急/;
const NON_URGENT_TEXT_PATTERN = /不紧急|非紧急|一般/;
const DAY_MS = 24 * 60 * 60 * 1000;

function createMetricAccumulator(metric) {
  return {
    key: metric.key,
    label: metric.label,
    projectIds: new Set(),
    completedProjectIds: new Set(),
    inProgressProjectIds: new Set(),
    missingDateProjectIds: new Set(),
  };
}

function createScopeAccumulator(base = {}) {
  return {
    ...base,
    projectIds: new Set(),
    metrics: Object.fromEntries(METRICS.map((metric) => [metric.key, createMetricAccumulator(metric)])),
    monthly: createMonthlyAccumulator(),
  };
}

function createMonth(month) {
  const entry = {
    month,
    label: `${month}月`,
    projectIds: {},
  };
  for (const metric of METRICS) {
    entry[metric.monthlyKey] = 0;
    entry[metric.inProgressMonthlyKey] = 0;
    entry.projectIds[metric.key] = [];
    entry.projectIds[metric.inProgressMonthlyKey] = [];
  }
  return entry;
}

function createMonthlyAccumulator() {
  return {
    months: Array.from({ length: 12 }, (_, index) => createMonth(index + 1)),
  };
}

function projectDisplayId(project, association) {
  return association?.key || project?.id || project?.rawId || project?.name || 'unknown-project';
}

function parseYearMonth(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const explicit = text.match(/^(\d{4})[-/.年](\d{1,2})/);
  if (explicit) {
    return { year: Number(explicit[1]), month: Number(explicit[2]) };
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

function addUnique(list, value) {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

function normalizeQueueDate(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const numericTimestamp = text.match(/^\d{10,13}$/);
  if (numericTimestamp) {
    const timestamp = Number(text);
    const date = new Date(text.length === 10 ? timestamp * 1000 : timestamp);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
  const explicit = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (explicit) {
    const date = new Date(Date.UTC(Number(explicit[1]), Number(explicit[2]) - 1, Number(explicit[3])));
    if (
      date.getUTCFullYear() === Number(explicit[1]) &&
      date.getUTCMonth() === Number(explicit[2]) - 1 &&
      date.getUTCDate() === Number(explicit[3])
    ) {
      return date.toISOString().slice(0, 10);
    }
    return '';
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function dateTimestamp(dateText = '') {
  const normalized = normalizeQueueDate(dateText);
  if (!normalized) {
    return null;
  }
  const [year, month, day] = normalized.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function readQueueRawDate(project = {}, fieldNames = [], fallbackValue = '', fallbackLabel = '') {
  for (const fieldName of fieldNames) {
    const value = readRawDisplay(project, [fieldName]);
    const date = normalizeQueueDate(value);
    if (date) {
      return { date, source: fieldName };
    }
  }
  const date = normalizeQueueDate(fallbackValue);
  return date ? { date, source: fallbackLabel } : { date: '', source: '' };
}

function readQueueTargetDate(project = {}) {
  const delivery = readQueueRawDate(project, QUEUE_DELIVERY_DATE_FIELDS);
  if (delivery.date) {
    return delivery;
  }
  return readQueueRawDate(project, QUEUE_DUE_DATE_FIELDS, project.dueDate, '计划开业时间');
}

function priorityTextValues(project = {}) {
  const values = [project.status, project.priority, readRawDisplay(project, PRIORITY_STATUS_FIELDS)];
  for (const [fieldName, cell] of Object.entries(project.rawFields || {})) {
    const key = normalizeCell(fieldName);
    if (/状态|紧急|优先/.test(key)) {
      values.push(cell);
    }
  }
  return values.map(normalizeCell).map((value) => value.replace(/\s+/g, '')).filter(Boolean);
}

function isUrgentProcessingProject(project = {}) {
  return priorityTextValues(project).some((value) => URGENT_TEXT_PATTERN.test(value) && !NON_URGENT_TEXT_PATTERN.test(value));
}

function readQueueNode(project = {}, nodeKey = '') {
  return readRawDisplay(project, QUEUE_NODE_FIELD_ALIASES[nodeKey] || []);
}

function hasQueueNode(project = {}, nodeKey = '') {
  return Boolean(readQueueNode(project, nodeKey));
}

function normalizeQueueStage(value = '') {
  return normalizeCell(value).replace(/\s+/g, '');
}

function isNegativeQueueStage(value = '') {
  return /未开始|未安排|未启动|未完成|待开始|待安排|待启动|待完成|待采购/.test(normalizeQueueStage(value));
}

function positiveQueueStage(value = '') {
  const text = normalizeQueueStage(value);
  return text && !isNegativeQueueStage(text) ? text : '';
}

function stageMatches(stage = '', pattern) {
  const text = positiveQueueStage(stage);
  return Boolean(text && pattern.test(text));
}

function queueStatusDone(value = '') {
  const text = normalizeQueueStage(value);
  if (!text || /未完成|未开始|未安排|待|缺|暂无|无/.test(text)) {
    return false;
  }
  return /已完成|完成|准时完成|延期完成|已采购|采购完成|已发|发出|通过/.test(text);
}

function formatQueueAreaLabel(project = {}) {
  const rawArea = readRawDisplay(project, QUEUE_AREA_FIELDS) || project?.area || project?.difficulty?.area || '';
  const text = String(rawArea ?? '').trim();
  if (!text) {
    return '';
  }
  return /m2|㎡|平|平方/i.test(text) ? text : `${text}㎡`;
}

function shortDesignerRoleLabel(role = '') {
  if (/点位/.test(role)) {
    return '点位';
  }
  if (/软装|VM|摆场/.test(role)) {
    return /摆场/.test(role) ? '摆场' : '软装';
  }
  if (/硬装|CD/.test(role)) {
    return '硬装';
  }
  return '';
}

function memberDisplayName(name = '', roster = {}) {
  return roster.membersByName?.get?.(name)?.displayName || name;
}

function buildProcessingQueueAssignment(association = {}, roster = {}) {
  const groupsById = new Map((roster.groups || []).map((group) => [group.id, group]));
  const groups = (association.groupIds || [])
    .map((groupId) => groupsById.get(groupId))
    .filter(Boolean);
  const groupNames = [];
  const groupLeads = [];
  for (const group of groups) {
    addUnique(groupNames, group.name);
    const lead = group.leadDisplay && group.leadDisplay !== '组长未配置' ? group.leadDisplay : group.lead;
    addUnique(groupLeads, lead);
  }

  const designerParts = [];
  for (const memberName of association.memberNames || []) {
    const designerRoles = (association.roleLabelsByMember?.[memberName] || []).filter((role) => /设计师/.test(role));
    if (!designerRoles.length) {
      continue;
    }
    const shortRoles = designerRoles.map(shortDesignerRoleLabel).filter(Boolean);
    const suffix = shortRoles.length ? `（${Array.from(new Set(shortRoles)).join('/')}）` : '';
    addUnique(designerParts, `${memberDisplayName(memberName, roster)}${suffix}`);
  }

  return {
    teamGroupText: groupNames.length
      ? `${groupNames.join('、')} · 组长：${groupLeads.join('、') || '待核对'}`
      : '团队小组待核对',
    teamDesignerText: designerParts.length ? `设计师：${designerParts.join('、')}` : '设计师待核对',
  };
}

function resolveProcessingQueueActionStage(project = {}, states = {}) {
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  const positiveHardStage = positiveQueueStage(hardStage);
  const positiveSoftStage = positiveQueueStage(softStage);
  const positiveStageText = [positiveHardStage, positiveSoftStage].filter(Boolean).join(' ');
  const fulfillmentStageText = [
    positiveSoftStage,
    /产品清单|采购|摆场|闭环/.test(positiveHardStage) ? positiveHardStage : '',
  ].filter(Boolean).join(' ');

  const atOrAfterMeasure = /复尺|平面|施工图|点位|软装|产品清单|采购|摆场|闭环|完成/.test(positiveStageText);
  const atOrAfterFloorPlan = /平面|施工图|点位|软装|产品清单|采购|摆场|闭环|完成/.test(positiveStageText);
  const atOrAfterConstructionReview =
    /施工图.*(完成审核|审核完成|审核通过)|点位|软装|产品清单|采购|摆场|闭环|完成/.test(positiveStageText);
  const downstreamOfSoftPlan = /软装完成|产品清单|采购|摆场|闭环/.test(positiveSoftStage);
  const downstreamOfProductList = /产品清单|采购|摆场|闭环/.test(fulfillmentStageText);
  const downstreamOfPurchase = /采购.*(完成|已)|已采购|摆场|闭环/.test(fulfillmentStageText);

  const meetingDone = hasQueueNode(project, 'meetingDate') || atOrAfterMeasure;
  if (!meetingDone) {
    return '待上会';
  }

  const measureDone = hasQueueNode(project, 'measureDate') || atOrAfterFloorPlan;
  if (!measureDone) {
    return '待复尺';
  }

  const floorPlanStarted = hasQueueNode(project, 'floorPlanStart') || atOrAfterFloorPlan;
  if (!floorPlanStarted) {
    return '平面方案待开始';
  }

  const constructionReviewDone = hasQueueNode(project, 'constructionReview') || atOrAfterConstructionReview;
  const floorPlanDone =
    hasQueueNode(project, 'floorPlanFinish') ||
    constructionReviewDone ||
    /施工图|点位|软装|产品清单|采购|摆场|闭环|完成/.test(positiveStageText);
  if (!floorPlanDone) {
    return '平面方案待完成';
  }

  const constructionDraftDone =
    hasQueueNode(project, 'constructionDraft') ||
    constructionReviewDone ||
    /点位|软装|产品清单|采购|摆场|闭环|完成/.test(positiveStageText);
  if (!constructionDraftDone) {
    return '施工图初稿待完成';
  }

  if (!constructionReviewDone) {
    return '施工图待审核';
  }

  const pointDone =
    queueStatusDone(readQueueNode(project, 'pointStatus')) ||
    hasQueueNode(project, 'pointDone') ||
    stageMatches(hardStage, /点位.*完成|软装|产品清单|采购|摆场|闭环/) ||
    stageMatches(softStage, /点位.*完成|软装方案|软装完成|产品清单|采购|摆场|闭环|完成/);
  if (!pointDone) {
    return '点位待完成';
  }

  const softPlanDone =
    queueStatusDone(readQueueNode(project, 'softDoneStatus')) ||
    hasQueueNode(project, 'softDoneTime') ||
    downstreamOfSoftPlan;
  if (!hasQueueNode(project, 'softSchemeStart') && !softPlanDone) {
    return '软装方案待开始';
  }
  if (!softPlanDone) {
    return '软装方案待完成';
  }

  const purchaseDone =
    queueStatusDone(readQueueNode(project, 'purchaseStatus')) ||
    hasQueueNode(project, 'purchaseTime') ||
    downstreamOfPurchase;
  const productListReady = hasQueueNode(project, 'productListSent') || purchaseDone || downstreamOfProductList;
  if (!productListReady) {
    return '产品清单待接收';
  }
  if (!purchaseDone) {
    return '采购待完成';
  }

  const stageReminder = resolveProjectStageReminder(project);
  const unifiedActionStage = stageReminder.primaryReminder?.message || '';
  if (['待摆场', '等待摆场结束', '项目待闭环'].includes(unifiedActionStage)) {
    return unifiedActionStage;
  }

  if (!hasQueueNode(project, 'displayFileSent') || !hasQueueNode(project, 'displayTime')) {
    return '待摆场';
  }

  return states.lifecycle?.completed ? '已闭环' : '项目待闭环';
}

function buildProcessingQueueProject(project = {}, projectId = '', states = {}, association = {}, roster = {}) {
  const start = readQueueRawDate(project, QUEUE_START_DATE_FIELDS, project.startDate, '启动时间');
  const target = readQueueTargetDate(project);
  const startMs = dateTimestamp(start.date);
  const targetMs = dateTimestamp(target.date);
  const windowDays = startMs === null || targetMs === null ? null : Math.round((targetMs - startMs) / DAY_MS);
  const urgent = isUrgentProcessingProject(project);
  const stage = states.lifecycle?.status || [project?.hardProgressStage, project?.softProgressStage].filter(Boolean).join(' / ');
  const assignment = buildProcessingQueueAssignment(association, roster);
  return {
    id: projectId,
    name: project?.name || projectId,
    province: project?.province || '',
    businessType: project?.businessType || '',
    storeStatus: project?.storeStatus || '',
    areaLabel: formatQueueAreaLabel(project),
    status: project?.status || '',
    stage,
    actionStage: resolveProcessingQueueActionStage(project, states),
    startDate: start.date,
    startDateSource: start.source,
    targetDate: target.date,
    targetDateSource: target.source,
    windowDays,
    windowLabel: windowDays === null ? '日期待核对' : `${windowDays}天`,
    urgent,
    memberNames: association.memberNames?.slice?.() || [],
    groupNames: association.groupNames?.slice?.() || [],
    ...assignment,
  };
}

function compareProcessingQueueProjects(a, b) {
  const aMissing = a.windowDays === null ? 1 : 0;
  const bMissing = b.windowDays === null ? 1 : 0;
  if (aMissing !== bMissing) {
    return aMissing - bMissing;
  }
  if (a.windowDays !== b.windowDays) {
    return Number(a.windowDays ?? Number.POSITIVE_INFINITY) - Number(b.windowDays ?? Number.POSITIVE_INFINITY);
  }
  const aTarget = dateTimestamp(a.targetDate) ?? Number.POSITIVE_INFINITY;
  const bTarget = dateTimestamp(b.targetDate) ?? Number.POSITIVE_INFINITY;
  if (aTarget !== bTarget) {
    return aTarget - bTarget;
  }
  return String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''), 'zh-Hans-CN');
}

function buildProcessingQueue(items = [], { includeProjects = false } = {}) {
  const projects = items.slice().sort(compareProcessingQueueProjects);
  const queue = {
    totalCount: projects.length,
    topProjects: projects.slice(0, TEAM_WORK_COMPLETION_PROCESSING_QUEUE_LIMIT),
  };
  if (includeProjects) {
    queue.projects = projects;
  }
  return queue;
}

function buildProcessingQueues(items = []) {
  const urgent = items.filter((item) => item.urgent);
  const normal = items.filter((item) => !item.urgent);
  return {
    urgent: buildProcessingQueue(urgent, { includeProjects: true }),
    normal: buildProcessingQueue(normal),
  };
}

function addMetricState(scope, metricKey, state, projectId) {
  const metric = scope.metrics[metricKey];
  if (!metric || state.state === 'none') {
    return;
  }
  metric.projectIds.add(projectId);
  if (state.completed) {
    metric.completedProjectIds.add(projectId);
  }
  if (state.inProgress) {
    metric.inProgressProjectIds.add(projectId);
  }
  if (state.missingDate) {
    metric.missingDateProjectIds.add(projectId);
  }
}

function addProjectToScope(scope, project, projectId, states, selectedYear) {
  scope.projectIds.add(projectId);
  for (const metric of METRICS) {
    addMetricState(scope, metric.key, states[metric.key], projectId);
    addMonthlyMetricState(scope.monthly, metric, states[metric.key], project, projectId, selectedYear);
  }
}

function addMonthlyMetricState(monthly, metric, state, project, projectId, selectedYear) {
  if (!state.completed && !state.inProgress) {
    return;
  }
  const monthKey = state.completed ? metric.monthlyKey : metric.inProgressMonthlyKey;
  const projectIdsKey = state.completed ? metric.key : metric.inProgressMonthlyKey;
  const parsed = parseYearMonth(state.completed ? state.completedAt : project?.updatedAt);
  if (state.completed && state.missingDate) {
    return;
  }
  if (!parsed || parsed.year !== selectedYear || parsed.month < 1 || parsed.month > 12) {
    return;
  }
  const entry = monthly.months[parsed.month - 1];
  addUnique(entry.projectIds[projectIdsKey], projectId);
  entry[monthKey] = entry.projectIds[projectIdsKey].length;
}

function serializeMetric(metric) {
  return {
    key: metric.key,
    label: metric.label,
    projectCount: metric.projectIds.size,
    completedCount: metric.completedProjectIds.size,
    inProgressCount: metric.inProgressProjectIds.size,
    missingDateCount: metric.missingDateProjectIds.size,
    projectIds: Array.from(metric.projectIds),
    completedProjectIds: Array.from(metric.completedProjectIds),
    inProgressProjectIds: Array.from(metric.inProgressProjectIds),
    missingDateProjectIds: Array.from(metric.missingDateProjectIds),
  };
}

function serializeSummary(scope) {
  return Object.fromEntries(METRICS.map((metric) => [metric.key, serializeMetric(scope.metrics[metric.key])]));
}

function serializeScope(scope, extra = {}) {
  return {
    ...extra,
    projectCount: scope.projectIds.size,
    projectIds: Array.from(scope.projectIds),
    summary: serializeSummary(scope),
    monthly: scope.monthly,
  };
}

function createDataQuality() {
  return {
    unmappedMemberCount: 0,
    weakProjectKeyCount: 0,
    missingDateCompletionCount: 0,
    notes: [],
  };
}

function appendDataQualityNotes(dataQuality, project, projectId, association, states) {
  if (association.weak) {
    dataQuality.weakProjectKeyCount += 1;
    dataQuality.notes.push({
      type: 'weakProjectKey',
      projectId,
      projectName: project?.name || '',
      message: '项目缺少稳定 id，已用名称生成临时 key。',
    });
  }

  for (const unmapped of association.unmappedNames || []) {
    dataQuality.unmappedMemberCount += 1;
    dataQuality.notes.push({
      type: 'unmappedMember',
      projectId,
      projectName: project?.name || '',
      ...unmapped,
      message: `项目人员「${unmapped.sourceName}」未匹配到当前团队花名册。`,
    });
  }

  for (const metric of METRICS) {
    const state = states[metric.key];
    if (!state.missingDate) {
      continue;
    }
    dataQuality.missingDateCompletionCount += 1;
    dataQuality.notes.push({
      type: 'missingCompletionDate',
      projectId,
      projectName: project?.name || '',
      metric: metric.key,
      label: metric.label,
      message: `${metric.label}已完成但缺少可靠完成日期，未进入月度柱状图。`,
    });
  }
}

function buildProjectRef(project, projectId, association, states) {
  return {
    id: projectId,
    key: association.key,
    weakKey: Boolean(association.weak),
    name: project?.name || '',
    status: project?.status || '',
    storeStatus: project?.storeStatus || '',
    memberNames: association.memberNames.slice(),
    groupIds: association.groupIds.slice(),
    groupNames: association.groupNames.slice(),
    roleLabelsByMember: association.roleLabelsByMember,
    metrics: {
      floorPlan: states.floorPlan,
      display: states.display,
      lifecycle: states.lifecycle,
    },
  };
}

function resolveMetricStates(project) {
  return {
    floorPlan: resolveFloorPlanCompletionState(project),
    display: resolveDisplayCompletionState(project),
    lifecycle: resolveCompanyLifecycleState(project),
  };
}

export function buildTeamWorkCompletionReview(allProjects = [], team = {}, options = {}) {
  const personnelArchitecture = options.personnelArchitecture || {};
  const selectedYear = Number(options.year) || new Date().getFullYear();
  const dashboardContext = options.dashboardContext || 'all';
  const reviewTeam = teamWithStaticGroups(team || {}, { fillMissingLeads: true });
  const roster = buildTeamRoster(reviewTeam, personnelArchitecture);
  const teamScope = createScopeAccumulator();
  const dataQuality = createDataQuality();
  const projectsById = {};
  const projectDetailsById = {};

  const groupScopes = new Map(
    roster.groups.map((group) => [
      group.id,
      createScopeAccumulator({
        id: group.id,
        name: group.name,
        lead: group.lead,
        leadDisplay: group.leadDisplay,
        memberNames: group.members.slice(),
      }),
    ])
  );
  const memberScopes = new Map(
    roster.members.map((member) => [
      member.name,
      createScopeAccumulator({
        name: member.name,
        displayName: member.displayName,
        groupId: member.groupId,
        groupName: member.groupName,
      }),
    ])
  );
  const processingQueueProjects = [];

  for (const project of allProjects || []) {
    if (!matchesDashboardContext(project, dashboardContext)) {
      continue;
    }

    const association = buildProjectTeamAssociations(project, roster, personnelArchitecture);
    const projectId = projectDisplayId(project, association);
    const states = resolveMetricStates(project);

    if (!association.memberNames.length) {
      continue;
    }

    appendDataQualityNotes(dataQuality, project, projectId, association, states);
    projectsById[projectId] = buildProjectRef(project, projectId, association, states);
    projectDetailsById[projectId] = compactProjectForDetailReadModel({ ...project, id: projectId });
    addProjectToScope(teamScope, project, projectId, states, selectedYear);
    if (states.lifecycle?.inProgress) {
      processingQueueProjects.push(buildProcessingQueueProject(project, projectId, states, association, roster));
    }

    for (const groupId of association.groupIds) {
      const groupScope = groupScopes.get(groupId);
      if (groupScope) {
        addProjectToScope(groupScope, project, projectId, states, selectedYear);
      }
    }

    for (const memberName of association.memberNames) {
      const memberScope = memberScopes.get(memberName);
      if (memberScope) {
        addProjectToScope(memberScope, project, projectId, states, selectedYear);
      }
    }
  }

  const cappedNotes = dataQuality.notes.slice(0, TEAM_WORK_COMPLETION_DATA_QUALITY_NOTE_LIMIT);
  const serializedDataQuality = {
    ...dataQuality,
    notes: cappedNotes,
    notesTruncated: dataQuality.notes.length > cappedNotes.length,
    notesTotal: dataQuality.notes.length,
  };

  return {
    readOnly: true,
    owner: roster.owner,
    requestedOwner: options.requestedOwner || reviewTeam.owner || roster.owner,
    displayName: reviewTeam.displayName || reviewTeam.owner || roster.owner,
    dashboardContext,
    year: selectedYear,
    team: {
      owner: roster.owner,
      groupCount: roster.groupCount,
      memberCount: roster.memberCount,
      groups: roster.groups.map((group) => ({
        id: group.id,
        name: group.name,
        lead: group.lead,
        leadDisplay: group.leadDisplay,
        memberNames: group.members.slice(),
      })),
      members: roster.members.map((member) => ({
        name: member.name,
        displayName: member.displayName,
        groupId: member.groupId,
        groupName: member.groupName,
      })),
    },
    ...serializeScope(teamScope),
    monthly: teamScope.monthly,
    groups: Array.from(groupScopes.values()).map((scope) =>
      serializeScope(scope, {
        id: scope.id,
        name: scope.name,
        lead: scope.lead,
        leadDisplay: scope.leadDisplay,
        memberNames: scope.memberNames,
      })
    ),
    members: Array.from(memberScopes.values()).map((scope) =>
      serializeScope(scope, {
        name: scope.name,
        displayName: scope.displayName,
        groupId: scope.groupId,
        groupName: scope.groupName,
      })
    ),
    processingQueues: buildProcessingQueues(processingQueueProjects),
    projectsById,
    projectDetailsById,
    dataQuality: serializedDataQuality,
  };
}
