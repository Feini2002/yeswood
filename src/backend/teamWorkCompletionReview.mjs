import { matchesDashboardContext } from './metrics/projectScopes.mjs';
import { normalizeCell, readRawDisplay } from './metrics/fieldSemantics.mjs';
import { PROJECT_STAGE_KEYS, resolveProjectStageReminder } from '../../public/domain/project-stage-reminder-rules.mjs';
import {
  resolveCompanyLifecycleState,
  resolveDisplayCompletionState,
  resolveFloorPlanCompletionState,
} from './metrics/workCompletionSemantics.mjs';
import { compactProjectForDetailReadModel } from './projectDetailPayload.mjs';
import { buildProjectTeamAssociations, buildTeamRoster } from './teamProjectAssociations.mjs';
import { teamWithStaticGroups } from './teamStructureFallbacks.mjs';
import { chinaToday } from './hardDecorationDeadlineRules.mjs';

export const TEAM_WORK_COMPLETION_DATA_QUALITY_NOTE_LIMIT = 32;
export const TEAM_WORK_COMPLETION_PROCESSING_QUEUE_LIMIT = 5;

const METRICS = [
  { key: 'floorPlan', label: '平面方案躺平完成量', monthlyKey: 'floorPlanCompleted', inProgressMonthlyKey: 'floorPlanInProgress' },
  { key: 'display', label: '方案摆场完成量', monthlyKey: 'displayCompleted', inProgressMonthlyKey: 'displayInProgress' },
  { key: 'lifecycle', label: '项目总闭环情况', monthlyKey: 'lifecycleCompleted', inProgressMonthlyKey: 'lifecycleInProgress' },
];

const PRIORITY_STATUS_FIELDS = ['项目状态', '状态', '紧急程度', '项目优先级', '优先级'];
const QUEUE_START_DATE_FIELDS = ['启动时间', '启动日期', '开始日期'];
const QUEUE_DUE_DATE_FIELDS = ['计划开业时间', '计划完成日期', '截止日期'];
const QUEUE_AREA_FIELDS = ['面积', '门店面积'];
const URGENT_TEXT_PATTERN = /紧急/;
const NON_URGENT_TEXT_PATTERN = /不紧急|非紧急|一般/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERY_RISK_RANK = {
  overdue: 0,
  due_today: 1,
  due_soon: 2,
  near_deadline: 3,
  future: 4,
  date_missing: 5,
};
const STAGE_LAG_RANKS = {
  severe: new Set([
    PROJECT_STAGE_KEYS.meeting,
    PROJECT_STAGE_KEYS.measured,
    PROJECT_STAGE_KEYS.floorPlanInProgress,
    PROJECT_STAGE_KEYS.floorPlanDone,
    PROJECT_STAGE_KEYS.constructionInProgress,
    PROJECT_STAGE_KEYS.constructionReviewDone,
    PROJECT_STAGE_KEYS.pointInProgress,
    PROJECT_STAGE_KEYS.pointDone,
    PROJECT_STAGE_KEYS.softInProgress,
  ]),
  moderate: new Set([
    PROJECT_STAGE_KEYS.softDone,
    PROJECT_STAGE_KEYS.productListReady,
    PROJECT_STAGE_KEYS.purchaseInProgress,
    PROJECT_STAGE_KEYS.purchaseDone,
    PROJECT_STAGE_KEYS.displayInProgress,
    PROJECT_STAGE_KEYS.displayFinished,
  ]),
};
const PROCESSING_QUEUE_ACTION_STAGE_KEYS = new Set([
  PROJECT_STAGE_KEYS.meeting,
  PROJECT_STAGE_KEYS.measured,
  PROJECT_STAGE_KEYS.floorPlanInProgress,
  PROJECT_STAGE_KEYS.floorPlanDone,
  PROJECT_STAGE_KEYS.constructionInProgress,
  PROJECT_STAGE_KEYS.constructionReviewDone,
  PROJECT_STAGE_KEYS.pointInProgress,
  PROJECT_STAGE_KEYS.pointDone,
  PROJECT_STAGE_KEYS.softInProgress,
  PROJECT_STAGE_KEYS.softDone,
  PROJECT_STAGE_KEYS.productListReady,
  PROJECT_STAGE_KEYS.purchaseInProgress,
  PROJECT_STAGE_KEYS.purchaseDone,
  PROJECT_STAGE_KEYS.displayInProgress,
  PROJECT_STAGE_KEYS.displayFinished,
]);

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

function resolveAsOfDate(options = {}) {
  const today = normalizeQueueDate(options.today);
  if (today) {
    return today;
  }
  const now = normalizeQueueDate(options.now);
  if (now) {
    return now;
  }
  return chinaToday();
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
  const stageReminder = resolveProjectStageReminder(project);
  const unifiedActionStage = normalizeCell(stageReminder.primaryReminder?.message);
  if (unifiedActionStage) {
    return unifiedActionStage;
  }
  if (states.lifecycle?.completed || stageReminder.currentStage?.key === 'closed') {
    return '已闭环';
  }
  return stageReminder.currentStage?.label || states.lifecycle?.status || '阶段待核对';
}

function resolveProcessingQueueDateQuality({ startDate = '', targetDate = '', windowDays = null } = {}) {
  if (!targetDate) {
    return 'missing_target';
  }
  if (!startDate) {
    return 'missing_start';
  }
  if (typeof windowDays === 'number' && Number.isFinite(windowDays) && windowDays < 0) {
    return 'anomaly';
  }
  return 'ok';
}

function resolveDeliveryRisk(targetDate = '', asOfDate = '') {
  const targetMs = dateTimestamp(targetDate);
  const asOfMs = dateTimestamp(asOfDate);
  if (targetMs === null || asOfMs === null) {
    return {
      targetDeltaDays: null,
      riskStatus: 'date_missing',
      riskLabel: '目标待核对',
    };
  }
  const targetDeltaDays = Math.round((targetMs - asOfMs) / DAY_MS);
  if (targetDeltaDays < 0) {
    return {
      targetDeltaDays,
      riskStatus: 'overdue',
      riskLabel: `逾期${Math.abs(targetDeltaDays)}天`,
    };
  }
  if (targetDeltaDays === 0) {
    return {
      targetDeltaDays,
      riskStatus: 'due_today',
      riskLabel: '今日交付',
    };
  }
  if (targetDeltaDays <= 7) {
    return {
      targetDeltaDays,
      riskStatus: 'due_soon',
      riskLabel: `剩余${targetDeltaDays}天`,
    };
  }
  if (targetDeltaDays <= 14) {
    return {
      targetDeltaDays,
      riskStatus: 'near_deadline',
      riskLabel: `剩余${targetDeltaDays}天`,
    };
  }
  return {
    targetDeltaDays,
    riskStatus: 'future',
    riskLabel: `剩余${targetDeltaDays}天`,
  };
}

function resolveStageLagLevel(stageKey = '', risk = {}) {
  if (risk.riskStatus === 'date_missing' || risk.targetDeltaDays === null || risk.targetDeltaDays > 14) {
    return 0;
  }
  const severe = STAGE_LAG_RANKS.severe.has(stageKey);
  const moderate = STAGE_LAG_RANKS.moderate.has(stageKey);
  if (risk.targetDeltaDays < 0 || risk.targetDeltaDays <= 7) {
    if (severe) {
      return 3;
    }
    if (moderate) {
      return 2;
    }
    return 0;
  }
  if (risk.targetDeltaDays <= 14) {
    if (severe) {
      return 2;
    }
    if (moderate) {
      return 1;
    }
  }
  return 0;
}

function buildRiskReasons({ risk = {}, actionStage = '', stageLagLevel = 0, dateQualityStatus = 'ok' } = {}) {
  const reasons = [];
  if (risk.riskStatus === 'overdue') {
    reasons.push('逾期未闭环');
  } else if (risk.riskStatus === 'due_today') {
    reasons.push('今日交付');
  } else if (risk.riskStatus === 'due_soon') {
    reasons.push('临期交付');
  } else if (risk.riskStatus === 'near_deadline') {
    reasons.push('交付观察');
  }
  if (stageLagLevel > 0 && actionStage) {
    reasons.push(`${risk.targetDeltaDays < 0 ? '逾期' : '临期'}且${actionStage}`);
  }
  if (dateQualityStatus === 'missing_target') {
    reasons.push('目标待核对');
  } else if (dateQualityStatus === 'missing_start') {
    reasons.push('启动待核对');
  } else if (dateQualityStatus === 'anomaly') {
    reasons.push('周期异常');
  }
  return Array.from(new Set(reasons));
}

function buildProcessingQueueProject(project = {}, projectId = '', states = {}, association = {}, roster = {}, asOfDate = chinaToday()) {
  const start = readQueueRawDate(project, QUEUE_START_DATE_FIELDS, project.startDate, '启动时间');
  const target = readQueueTargetDate(project);
  const startMs = dateTimestamp(start.date);
  const targetMs = dateTimestamp(target.date);
  const windowDays = startMs === null || targetMs === null ? null : Math.round((targetMs - startMs) / DAY_MS);
  const urgent = isUrgentProcessingProject(project);
  const stage = states.lifecycle?.status || [project?.hardProgressStage, project?.softProgressStage].filter(Boolean).join(' / ');
  const stageReminder = resolveProjectStageReminder(project);
  const actionStage = resolveProcessingQueueActionStage(project, states);
  const risk = resolveDeliveryRisk(target.date, asOfDate);
  const stageLagLevel = resolveStageLagLevel(stageReminder.currentStage?.key, risk);
  const dateQualityStatus = resolveProcessingQueueDateQuality({ startDate: start.date, targetDate: target.date, windowDays });
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
    actionStage,
    startDate: start.date,
    startDateSource: start.source,
    targetDate: target.date,
    targetDateSource: target.source,
    windowDays,
    windowLabel: windowDays === null ? '日期待核对' : `${windowDays}天`,
    asOfDate,
    targetDeltaDays: risk.targetDeltaDays,
    riskStatus: risk.riskStatus,
    riskLabel: risk.riskLabel,
    stageLagLevel,
    dateQualityStatus,
    riskReasons: buildRiskReasons({ risk, actionStage, stageLagLevel, dateQualityStatus }),
    urgent,
    memberNames: association.memberNames?.slice?.() || [],
    groupNames: association.groupNames?.slice?.() || [],
    ...assignment,
  };
}

function shouldIncludeProcessingQueueProject(project = {}, states = {}) {
  if (
    states.lifecycle?.inProgress ||
    states.display?.inProgress ||
    (states.display?.completed && !states.lifecycle?.completed)
  ) {
    return true;
  }
  if (states.lifecycle?.completed) {
    return false;
  }
  const stageReminder = resolveProjectStageReminder(project);
  return PROCESSING_QUEUE_ACTION_STAGE_KEYS.has(stageReminder.currentStage?.key);
}

function compareProcessingQueueProjects(a, b) {
  const aRisk = DELIVERY_RISK_RANK[a.riskStatus] ?? DELIVERY_RISK_RANK.date_missing;
  const bRisk = DELIVERY_RISK_RANK[b.riskStatus] ?? DELIVERY_RISK_RANK.date_missing;
  if (aRisk !== bRisk) {
    return aRisk - bRisk;
  }
  const aDelta = Number(a.targetDeltaDays);
  const bDelta = Number(b.targetDeltaDays);
  if (Number.isFinite(aDelta) && Number.isFinite(bDelta) && aDelta !== bDelta) {
    return aDelta - bDelta;
  }
  if (a.stageLagLevel !== b.stageLagLevel) {
    return Number(b.stageLagLevel || 0) - Number(a.stageLagLevel || 0);
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

function shouldCountCompletedStateForYear(state, selectedYear) {
  if (!state.completed) {
    return false;
  }
  if (state.missingDate) {
    return true;
  }
  const parsed = parseYearMonth(state.completedAt);
  return !parsed || parsed.year === selectedYear;
}

function addMetricState(scope, metricKey, state, projectId, selectedYear) {
  const metric = scope.metrics[metricKey];
  if (!metric || state.state === 'none') {
    return;
  }
  metric.projectIds.add(projectId);
  if (shouldCountCompletedStateForYear(state, selectedYear)) {
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
    addMetricState(scope, metric.key, states[metric.key], projectId, selectedYear);
    addMonthlyMetricState(scope.monthly, metric, states[metric.key], project, projectId, selectedYear);
  }
}

function addMonthlyMetricState(monthly, metric, state, project, projectId, selectedYear) {
  if (!state.completed || state.monthlyEligible === false) {
    return;
  }
  const monthKey = metric.monthlyKey;
  const projectIdsKey = metric.key;
  const parsed = parseYearMonth(state.completedAt);
  if (state.missingDate) {
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
  const asOfDate = resolveAsOfDate(options);
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
    if (shouldIncludeProcessingQueueProject(project, states)) {
      processingQueueProjects.push(buildProcessingQueueProject(project, projectId, states, association, roster, asOfDate));
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
    asOfDate,
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
