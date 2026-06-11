import { matchesDashboardContext } from './metrics/projectScopes.mjs';
import {
  resolveCompanyLifecycleState,
  resolveDisplayCompletionState,
  resolveFloorPlanCompletionState,
} from './metrics/workCompletionSemantics.mjs';
import { buildProjectTeamAssociations, buildTeamRoster } from './teamProjectAssociations.mjs';
import { teamWithStaticGroups } from './teamStructureFallbacks.mjs';

export const TEAM_WORK_COMPLETION_DATA_QUALITY_NOTE_LIMIT = 32;

const METRICS = [
  { key: 'floorPlan', label: '平面方案躺平完成量', monthlyKey: 'floorPlanCompleted', inProgressMonthlyKey: 'floorPlanInProgress' },
  { key: 'display', label: '方案摆场完成量', monthlyKey: 'displayCompleted', inProgressMonthlyKey: 'displayInProgress' },
  { key: 'lifecycle', label: '项目总闭环情况', monthlyKey: 'lifecycleCompleted', inProgressMonthlyKey: 'lifecycleInProgress' },
];

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
    addProjectToScope(teamScope, project, projectId, states, selectedYear);

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
    projectsById,
    dataQuality: serializedDataQuality,
  };
}
