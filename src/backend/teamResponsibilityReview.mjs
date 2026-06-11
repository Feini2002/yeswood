import {
  buildHardDecorationDeadlineSummary,
  chinaToday,
  DEFAULT_HARD_DECORATION_CALENDAR,
} from './hardDecorationDeadlineRules.mjs';
import { normalizePersonnelArchitecture } from './personnelArchitecture.mjs';
import { readNamesFromRawField } from './personnelNames.mjs';
import {
  hasOpenHardDesignResponsibility,
  hasOpenPointDesignResponsibility,
  hasOpenSoftSchemeDesignResponsibility,
  readRawDisplay,
  readMetricDate,
  readSchemeStatus,
  readSoftCompletionStatus,
  readWorkflowStage,
  isHardWorkflowClosed,
  isSoftWorkflowClosed,
} from './metrics/fieldSemantics.mjs';
import { excludePausedProjects } from './metrics/pausedProjects.mjs';
import { matchesDashboardContext, resolveOwnerMonthlyProjects } from './metrics/projectScopes.mjs';
import { expandOwnerNames } from './responsibilityRepository.mjs';
import { findResponsibilityIdentity } from './responsibilityIdentities.mjs';
import { teamWithStaticGroups } from './teamStructureFallbacks.mjs';

const HARD_SCHEME_DATE_FIELDS = ['硬装方案完成时间', '躺平内部审核结束时间', '内部审核结束时间'];
const POINT_STATUS_FIELDS = ['点位完成情况'];
const POINT_DATE_FIELDS = ['点位完成时间'];
const SOFT_SCHEME_DATE_FIELDS = ['软装完成时间'];
const DISPLAY_PROGRESS_DATE_FIELDS = ['摆场文件发出时间(项目群）', '摆场文件发出时间（项目群）', '摆场时间', '现场摆场时间', '摆场开始时间'];

const RESPONSIBILITY_DEFINITIONS = [
  {
    key: 'cdOwner',
    slotKey: 'cd_owner',
    label: '硬装负责人',
    discipline: 'hard',
    fields: ['CD负责人', '硬装负责人'],
    deliveries: ['hardScheme'],
  },
  {
    key: 'cdLead',
    slotKey: 'cd_lead',
    label: '硬装组长',
    discipline: 'hard',
    fields: ['CD组长'],
    deliveries: ['hardScheme'],
  },
  {
    key: 'cdDesigner',
    slotKey: 'cd_designer',
    label: '硬装设计师',
    discipline: 'hard',
    fields: ['CD设计师'],
    deliveries: ['hardScheme'],
  },
  {
    key: 'vmOwner',
    slotKey: 'vm_owner',
    label: '软装负责人',
    discipline: 'soft',
    fields: ['VM负责人', '软装负责人'],
    deliveries: ['point', 'softScheme'],
  },
  {
    key: 'vmLead',
    slotKey: 'vm_lead',
    label: '软装组长',
    discipline: 'soft',
    fields: ['VM组长'],
    deliveries: ['point', 'softScheme'],
  },
  {
    key: 'pointDesigner',
    slotKey: 'point_designer',
    label: '点位设计师',
    discipline: 'soft',
    fields: ['点位设计师'],
    deliveries: ['point'],
  },
  {
    key: 'vmDesigner',
    slotKey: 'vm_designer',
    label: '软装设计师',
    discipline: 'soft',
    fields: ['VM设计师', '软装设计师'],
    deliveries: ['softScheme'],
  },
];

const DELIVERY_LABELS = {
  hardScheme: '硬装方案',
  point: '点位设计',
  softScheme: '方案设计',
};

const MEMBER_ASSOCIATION_DEFINITIONS = [
  {
    key: 'cdDesigner',
    slotKey: 'cd_designer',
    label: '硬装设计师',
    discipline: 'hard',
    fields: ['CD设计师'],
    module: 'floorPlan',
  },
  {
    key: 'pointDesigner',
    slotKey: 'point_designer',
    label: '点位设计师',
    discipline: 'soft',
    fields: ['点位设计师'],
    module: 'association',
  },
  {
    key: 'vmDesigner',
    slotKey: 'vm_designer',
    label: '软装设计师',
    discipline: 'soft',
    fields: ['VM设计师', '软装设计师'],
    module: 'association',
  },
  {
    key: 'displayDesigner',
    slotKey: 'display_designer',
    label: '摆场设计师',
    discipline: 'display',
    fields: ['摆场设计师'],
    module: 'display',
  },
];

const DISPLAY_ASSIGNEE_FIELD = '摆场设计师';
const DESIGNER_EVIDENCE_FIELDS = ['CD设计师', '点位设计师', 'VM设计师', '软装设计师'];

const SUPPORT_TYPE_ORDER = {
  team: 0,
  mixed: 1,
  externalSupport: 2,
  borrowedOut: 3,
};

const EXECUTION_SCOPE_BY_DISCIPLINE = {
  hard: {
    key: 'hard',
    name: '硬装执行负载',
    description: '硬装负责人视角 · CD设计师 · 进行中平面方案',
    slotKeys: ['cd_designer'],
    roleKeys: ['cdDesigner'],
    deliveryKeys: ['hardScheme'],
  },
  soft: {
    key: 'soft',
    name: '软装执行负载',
    description: '软装负责人视角 · 点位设计师 / VM设计师 · 进行中点位与方案',
    slotKeys: ['point_designer', 'vm_designer'],
    roleKeys: ['pointDesigner', 'vmDesigner'],
    deliveryKeys: ['point', 'softScheme'],
  },
  both: {
    key: 'both',
    name: '全案执行负载',
    description: '创意负责人视角 · CD设计师 / 点位设计师 / VM设计师 · 进行中设计交付',
    slotKeys: ['cd_designer', 'point_designer', 'vm_designer'],
    roleKeys: ['cdDesigner', 'pointDesigner', 'vmDesigner'],
    deliveryKeys: ['hardScheme', 'point', 'softScheme'],
  },
};

const DEFAULT_EXECUTION_SCOPE = {
  key: 'execution',
  name: '执行端设计负载',
  description: '执行设计师视角 · CD设计师 / 点位设计师 / VM设计师 · 进行中设计交付',
  slotKeys: ['cd_designer', 'point_designer', 'vm_designer'],
  roleKeys: ['cdDesigner', 'pointDesigner', 'vmDesigner'],
  deliveryKeys: ['hardScheme', 'point', 'softScheme'],
};

const INACTIVE_TEAM_MEMBER_NAMES = new Set(['李晓倩', '席创意', '侯喆']);

const HARD_EXECUTION_AFTER_FLOOR_PLAN_PATTERN = /施工图|施工整改|待采购|摆场|闭环|已完成|^完成$|点位/;
const DISPLAY_ACTIVE_STAGE_PATTERN = /摆场|白场|进场/;
const DISPLAY_NOT_ACTIVE_STAGE_PATTERN = /未安排摆场|未开始|未启动|暂停/;

function normalizeMonth(value, now = new Date()) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(text)) {
    return text;
  }
  const date = text ? new Date(text) : now;
  const safeDate = Number.isNaN(date.getTime()) ? now : date;
  return `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, '0')}`;
}

function monthKey(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function deliveryEvidence(project, deliveryKey) {
  if (deliveryKey === 'hardScheme') {
    return {
      status: readSchemeStatus(project),
      completedAt: readMetricDate(project, HARD_SCHEME_DATE_FIELDS),
    };
  }
  if (deliveryKey === 'point') {
    return {
      status: readRawDisplay(project, POINT_STATUS_FIELDS),
      completedAt: readMetricDate(project, POINT_DATE_FIELDS),
    };
  }
  return {
    status: readSoftCompletionStatus(project),
    completedAt: readMetricDate(project, SOFT_SCHEME_DATE_FIELDS),
  };
}

function isCompleteStatus(status, completedAt) {
  const text = String(status || '').trim();
  if (/未完成|未开始|未启动|未安排|待|延期中|暂停/.test(text)) {
    return false;
  }
  return /准时完成|延期完成|已完成|完成|闭环/.test(text) || Boolean(completedAt);
}

function itemState(project, deliveryKey, selectedMonth) {
  const evidence = deliveryEvidence(project, deliveryKey);
  const delayed = /延期/.test(evidence.status || '');
  const completed = isCompleteStatus(evidence.status, evidence.completedAt);
  const completedMonth = monthKey(evidence.completedAt);
  const completedThisMonth = completed && completedMonth === selectedMonth;
  return {
    status: evidence.status,
    completedAt: evidence.completedAt,
    completed,
    delayed,
    completedThisMonth,
    delayedCompletedThisMonth: completedThisMonth && delayed,
    openDelayed: delayed && !completed,
    missingCompletionDate: completed && !evidence.completedAt,
  };
}

function hasOpenDeliveryResponsibility(project, deliveryKey) {
  if (deliveryKey === 'hardScheme') {
    const stage = readWorkflowStage(project, { discipline: 'hard' });
    return hasOpenHardDesignResponsibility(project) && !HARD_EXECUTION_AFTER_FLOOR_PLAN_PATTERN.test(stage);
  }
  if (deliveryKey === 'point') {
    return hasOpenPointDesignResponsibility(project);
  }
  if (deliveryKey === 'softScheme') {
    return hasOpenSoftSchemeDesignResponsibility(project);
  }
  return false;
}

function canonicalPersonName(name, architecture) {
  const raw = String(name || '').trim();
  if (!raw) {
    return '';
  }
  const identity = findResponsibilityIdentity(raw, architecture);
  if (identity) {
    return identity.sourceName;
  }
  const people = architecture.people || {};
  if (people[raw]) {
    return people[raw].name || raw;
  }
  for (const [personKey, person] of Object.entries(people)) {
    const variants = new Set([personKey, person?.name, person?.displayName, ...(person?.aliases || [])].filter(Boolean));
    if (variants.has(raw)) {
      return person?.name || personKey;
    }
  }
  for (const [canonical, aliases] of Object.entries(architecture.aliases || {})) {
    if (canonical === raw || (aliases || []).includes(raw)) {
      return canonical;
    }
  }
  return raw;
}

function addExpandedCoreName(coreNames, name, architecture) {
  const canonical = canonicalPersonName(name, architecture);
  if (!canonical) {
    return;
  }
  coreNames.add(canonical);
  for (const variant of expandOwnerNames(name, architecture)) {
    coreNames.add(variant);
    coreNames.add(canonicalPersonName(variant, architecture));
  }
  for (const variant of expandOwnerNames(canonical, architecture)) {
    coreNames.add(variant);
    coreNames.add(canonicalPersonName(variant, architecture));
  }
}

function readRoleNames(project, definition, architecture) {
  const names = new Set();
  for (const fieldName of definition.fields) {
    for (const name of readNamesFromRawField(project, fieldName)) {
      const canonical = canonicalPersonName(name, architecture);
      if (canonical) {
        names.add(canonical);
      }
    }
  }
  return Array.from(names);
}

function ownerDiscipline(team, architecture) {
  const identity = findResponsibilityIdentity(team?.owner, architecture);
  if (identity) {
    return identity.discipline;
  }
  const canonicalOwner = canonicalPersonName(team?.owner, architecture);
  const ownerPerson = architecture.people?.[canonicalOwner] || architecture.people?.[team?.owner] || {};
  return team?.discipline || ownerPerson.discipline || '';
}

function executionScopeForTeam(team, architecture) {
  const discipline = ownerDiscipline(team, architecture);
  return EXECUTION_SCOPE_BY_DISCIPLINE[discipline] || DEFAULT_EXECUTION_SCOPE;
}

function executionDefinitions(scope) {
  const slotKeys = new Set(scope.slotKeys || []);
  return RESPONSIBILITY_DEFINITIONS.filter((definition) => slotKeys.has(definition.slotKey));
}

function projectIdentity(project) {
  return {
    projectId: project.id || '',
    projectName: project.name || '未命名项目',
    owner: project.ownerDisplay || project.owner || '',
    storeStatus: project.storeStatus || '',
    status: project.status || '',
    riskLevel: project.riskLevel || '',
    dueDate: project.dueDate || '',
  };
}

function collectKnownDesignerNames(projects = [], architecture) {
  const names = new Set();
  const addName = (name) => {
    const canonical = canonicalPersonName(name, architecture);
    if (canonical) {
      names.add(canonical);
    }
  };

  for (const [personKey, person] of Object.entries(architecture.people || {})) {
    if (person?.position === 'designer') {
      addName(person.name || personKey);
    }
  }
  for (const roleKey of ['cdDesigner', 'vmDesigner']) {
    for (const name of architecture.roleGroups?.[roleKey]?.people || []) {
      addName(name);
    }
  }
  for (const project of projects || []) {
    for (const fieldName of DESIGNER_EVIDENCE_FIELDS) {
      for (const name of readNamesFromRawField(project, fieldName)) {
        addName(name);
      }
    }
  }

  return names;
}

function displayAssigneeReviewScope(project, assigneeNames, teamProjectIds, coreNames, architecture) {
  if (teamProjectIds.has(project.id)) {
    return true;
  }
  return assigneeNames.some((name) => coreNames.has(canonicalPersonName(name, architecture)));
}

function buildDataQualityReview(projects = [], teamProjectIds, coreNames, architecture) {
  const knownDesignerNames = collectKnownDesignerNames(projects, architecture);
  const anomalies = [];
  const seen = new Set();

  for (const project of excludePausedProjects(projects || [])) {
    const assigneeNames = readNamesFromRawField(project, DISPLAY_ASSIGNEE_FIELD);
    if (!assigneeNames.length || !displayAssigneeReviewScope(project, assigneeNames, teamProjectIds, coreNames, architecture)) {
      continue;
    }
    for (const rawName of assigneeNames) {
      const canonicalName = canonicalPersonName(rawName, architecture);
      if (!canonicalName || knownDesignerNames.has(canonicalName)) {
        continue;
      }
      const key = `${project.id || project.name || 'unknown'}:${canonicalName}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      anomalies.push({
        type: '摆场责任人待核对',
        severity: '需要核对',
        sourceField: DISPLAY_ASSIGNEE_FIELD,
        personName: canonicalName,
        sourceName: rawName,
        ...projectIdentity(project),
        message: `${DISPLAY_ASSIGNEE_FIELD}字段填写「${rawName}」，但未匹配到已维护设计师或项目 CD/VM/点位设计师；未确认前不计入真实负载。`,
      });
    }
  }

  return {
    anomalyCount: anomalies.length,
    anomalies,
  };
}

function memberRosterEntries(team, architecture) {
  const entries = [];
  const seen = new Set();
  const addEntry = (name, groupName = '') => {
    const canonical = canonicalPersonName(name, architecture);
    if (!canonical || seen.has(canonical)) {
      return;
    }
    seen.add(canonical);
    const local = architecture.people?.[canonical] || {};
    entries.push({
      name: canonical,
      displayName: local.displayName || canonical,
      groupName,
      position: local.position || '',
      positionLabel: local.positionLabel || '',
      discipline: local.discipline || '',
      disciplineLabel: local.disciplineLabel || '',
    });
  };
  for (const group of team?.groups || []) {
    if (group?.lead) {
      addEntry(group.lead, group.name || '');
    }
    for (const member of group?.members || []) {
      addEntry(member, group.name || '');
    }
  }
  for (const member of [...(team?.members || []), ...(team?.designers || [])]) {
    addEntry(member, '');
  }
  return entries;
}

function memberMatchedRoles(project, memberName, architecture) {
  return MEMBER_ASSOCIATION_DEFINITIONS.filter((definition) =>
    readRoleNames(project, definition, architecture).includes(memberName)
  ).map((definition) => ({
    key: definition.key,
    slotKey: definition.slotKey,
    label: definition.label,
    discipline: definition.discipline,
    module: definition.module,
  }));
}

function memberProjectDirection(project, teamProjectIds) {
  return teamProjectIds.has(project.id) ? 'teamScope' : 'borrowedOut';
}

function memberWorkItemBase(project, memberName, teamProjectIds, extra = {}) {
  return {
    ...projectIdentity(project),
    personName: memberName,
    direction: memberProjectDirection(project, teamProjectIds),
    hardStage: readWorkflowStage(project, { discipline: 'hard' }),
    softStage: readWorkflowStage(project, { discipline: 'soft' }),
    ...extra,
  };
}

function buildMemberFloorPlanItem(project, memberName, teamProjectIds, selectedMonth, options = {}) {
  const state = itemState(project, 'hardScheme', selectedMonth);
  const active = hasOpenDeliveryResponsibility(project, 'hardScheme') && !state.completed;
  if (!active && !state.completed) {
    return null;
  }
  const hardDeadline = buildHardDecorationDeadlineSummary(project, options);
  const loadState = state.completed ? 'completed' : 'active';
  return memberWorkItemBase(project, memberName, teamProjectIds, {
    module: 'floorPlan',
    deliveryKey: 'floorPlan',
    deliveryLabel: '平面方案',
    roleKey: 'cdDesigner',
    slotKey: 'cd_designer',
    roleLabel: '硬装设计师',
    state: loadState,
    status: state.status || (state.completed ? '已完成' : '推进中'),
    completedAt: state.completedAt || '',
    stateDetail: state,
    hardDeadline,
  });
}

function displayStageState(project) {
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  const stageText = `${hardStage} ${softStage}`.trim();
  const completed = isHardWorkflowClosed(project) || isSoftWorkflowClosed(project);
  const displayDate = readMetricDate(project, DISPLAY_PROGRESS_DATE_FIELDS);
  const active =
    !completed &&
    !DISPLAY_NOT_ACTIVE_STAGE_PATTERN.test(stageText) &&
    (DISPLAY_ACTIVE_STAGE_PATTERN.test(stageText) || Boolean(displayDate));
  return {
    hardStage,
    softStage,
    status: softStage || hardStage || '',
    completed,
    active,
    completedAt: completed ? displayDate : '',
    missingCompletionDate: completed && !displayDate,
  };
}

function buildMemberDisplayItem(project, memberName, teamProjectIds) {
  const state = displayStageState(project);
  if (!state.active && !state.completed) {
    return null;
  }
  return memberWorkItemBase(project, memberName, teamProjectIds, {
    module: 'display',
    deliveryKey: 'display',
    deliveryLabel: '摆场',
    roleKey: 'displayDesigner',
    slotKey: 'display_designer',
    roleLabel: '摆场设计师',
    state: state.completed ? 'completed' : 'active',
    status: state.status || (state.completed ? '已完成' : '摆场'),
    completedAt: state.completedAt || '',
    stateDetail: state,
  });
}

function associatedProjectState(floorItem, displayItem) {
  if (floorItem?.state === 'active' || displayItem?.state === 'active') {
    return 'active';
  }
  if (floorItem?.state === 'completed' || displayItem?.state === 'completed') {
    return 'completed';
  }
  return 'associated';
}

function buildAssociatedProjectItem(project, memberName, roles, teamProjectIds, floorItem, displayItem) {
  return memberWorkItemBase(project, memberName, teamProjectIds, {
    state: associatedProjectState(floorItem, displayItem),
    matchedRoles: roles,
    roleLabels: roles.map((role) => role.label),
    floorPlanState: floorItem?.state || '',
    displayState: displayItem?.state || '',
  });
}

function buildMemberLoads(allProjects, team, teamProjectIds, selectedMonth, architecture, options = {}) {
  const roster = memberRosterEntries(team, architecture).filter((member) => !INACTIVE_TEAM_MEMBER_NAMES.has(member.name));
  return roster.map((member) => {
    const floorPlan = { active: [], completed: [] };
    const display = { active: [], completed: [] };
    const associatedProjects = [];
    for (const project of allProjects || []) {
      const roles = memberMatchedRoles(project, member.name, architecture);
      if (!roles.length) {
        continue;
      }
      const hasFloorPlanRole = roles.some((role) => role.module === 'floorPlan');
      const hasDisplayRole = roles.some((role) => role.module === 'display');
      const floorItem = hasFloorPlanRole
        ? buildMemberFloorPlanItem(project, member.name, teamProjectIds, selectedMonth, options)
        : null;
      const displayItem = hasDisplayRole ? buildMemberDisplayItem(project, member.name, teamProjectIds) : null;

      if (floorItem) {
        floorPlan[floorItem.state].push(floorItem);
      }
      if (displayItem) {
        display[displayItem.state].push(displayItem);
      }
      associatedProjects.push(buildAssociatedProjectItem(project, member.name, roles, teamProjectIds, floorItem, displayItem));
    }
    const activeProjectIds = new Set([
      ...floorPlan.active.map((item) => item.projectId),
      ...display.active.map((item) => item.projectId),
    ]);
    const completedProjectIds = new Set([
      ...floorPlan.completed.map((item) => item.projectId),
      ...display.completed.map((item) => item.projectId),
    ]);
    return {
      ...member,
      summary: {
        associatedProjectCount: associatedProjects.length,
        activeProjectCount: activeProjectIds.size,
        completedProjectCount: completedProjectIds.size,
        floorPlanActiveCount: floorPlan.active.length,
        floorPlanCompletedCount: floorPlan.completed.length,
        displayActiveCount: display.active.length,
        displayCompletedCount: display.completed.length,
        borrowedOutCount: associatedProjects.filter((item) => item.direction === 'borrowedOut').length,
      },
      floorPlan,
      display,
      associatedProjects,
    };
  });
}

function buildMemberLoadSummary(memberLoads) {
  const associatedProjectIds = new Set();
  const activeProjectIds = new Set();
  const completedProjectIds = new Set();
  const summary = {
    memberCount: memberLoads.length,
    memberAssociatedProjectCount: 0,
    memberActiveProjectCount: 0,
    memberCompletedProjectCount: 0,
    memberFloorPlanActiveCount: 0,
    memberFloorPlanCompletedCount: 0,
    memberDisplayActiveCount: 0,
    memberDisplayCompletedCount: 0,
  };
  for (const member of memberLoads) {
    summary.memberAssociatedProjectCount += member.summary.associatedProjectCount;
    summary.memberFloorPlanActiveCount += member.summary.floorPlanActiveCount;
    summary.memberFloorPlanCompletedCount += member.summary.floorPlanCompletedCount;
    summary.memberDisplayActiveCount += member.summary.displayActiveCount;
    summary.memberDisplayCompletedCount += member.summary.displayCompletedCount;
    for (const item of member.associatedProjects || []) {
      associatedProjectIds.add(item.projectId);
      if (item.state === 'active') {
        activeProjectIds.add(item.projectId);
      }
      if (item.state === 'completed') {
        completedProjectIds.add(item.projectId);
      }
    }
  }
  summary.memberUniqueAssociatedProjectCount = associatedProjectIds.size;
  summary.memberActiveProjectCount = activeProjectIds.size;
  summary.memberCompletedProjectCount = completedProjectIds.size;
  return summary;
}

function addCount(target, item) {
  target.itemCount += 1;
  if (item.state.completedThisMonth) {
    target.completedThisMonth += 1;
  }
  if (item.state.delayedCompletedThisMonth) {
    target.delayedCompletedThisMonth += 1;
  }
  if (item.state.openDelayed) {
    target.openDelayed += 1;
  }
  if (item.state.missingCompletionDate) {
    target.missingCompletionDate += 1;
  }
}

function emptyCount(extra = {}) {
  return {
    itemCount: 0,
    completedThisMonth: 0,
    delayedCompletedThisMonth: 0,
    openDelayed: 0,
    missingCompletionDate: 0,
    ...extra,
  };
}

function createPersonStat(name, architecture, supportType) {
  const local = architecture.people?.[name] || {};
  return {
    name,
    displayName: local.displayName || name,
    position: local.position || '',
    positionLabel: local.positionLabel || '',
    discipline: local.discipline || '',
    disciplineLabel: local.disciplineLabel || '',
    supportType,
    supportTypes: new Set([supportType]),
    projectIds: new Set(),
    borrowedOutProjectIds: new Set(),
    roles: new Map(),
    items: [],
    ...emptyCount({ responsibilityItemCount: 0 }),
  };
}

function supportTypeFromDirections(directions) {
  const values = Array.from(directions);
  if (values.length > 1) {
    return 'mixed';
  }
  if (values[0] === 'borrowedOut') {
    return 'borrowedOut';
  }
  if (values[0] === 'externalIn') {
    return 'externalSupport';
  }
  return 'team';
}

function finalRole(role) {
  return {
    key: role.key,
    slotKey: role.slotKey,
    label: role.label,
    discipline: role.discipline,
    deliveryKey: role.deliveryKey,
    deliveryLabel: role.deliveryLabel,
    itemCount: role.itemCount,
    completedThisMonth: role.completedThisMonth,
    delayedCompletedThisMonth: role.delayedCompletedThisMonth,
    openDelayed: role.openDelayed,
    missingCompletionDate: role.missingCompletionDate,
  };
}

function finalPerson(stat) {
  const supportType = supportTypeFromDirections(stat.supportTypes);
  return {
    name: stat.name,
    displayName: stat.displayName,
    position: stat.position,
    positionLabel: stat.positionLabel,
    discipline: stat.discipline,
    disciplineLabel: stat.disciplineLabel,
    supportType,
    projectCount: stat.projectIds.size,
    borrowedOutCount: stat.borrowedOutProjectIds.size,
    responsibilityItemCount: stat.responsibilityItemCount,
    completedThisMonth: stat.completedThisMonth,
    delayedCompletedThisMonth: stat.delayedCompletedThisMonth,
    openDelayed: stat.openDelayed,
    missingCompletionDate: stat.missingCompletionDate,
    roles: Array.from(stat.roles.values()).map(finalRole),
    items: stat.items,
  };
}

function teamCoreNames(team, architecture) {
  const coreNames = new Set();
  const directNames = [
    team?.owner,
    ...(team?.cdLeads || []),
    ...(team?.vmLeads || []),
    ...(team?.members || []),
    ...(team?.designers || []),
  ];
  for (const group of team?.groups || []) {
    directNames.push(group?.lead, ...(group?.members || []));
  }
  for (const name of directNames) {
    addExpandedCoreName(coreNames, name, architecture);
  }
  return coreNames;
}

function assignmentDirection(project, teamProjectIds, coreNames, name) {
  if (teamProjectIds.has(project.id)) {
    return coreNames.has(name) ? 'teamScope' : 'externalIn';
  }
  return coreNames.has(name) ? 'borrowedOut' : '';
}

function buildAssignments(projects, teamProjectIds, coreNames, selectedMonth, architecture, executionScope) {
  const assignments = [];
  const deliveryKeys = new Set(executionScope.deliveryKeys || []);
  for (const project of projects) {
    for (const definition of executionDefinitions(executionScope)) {
      const names = readRoleNames(project, definition, architecture);
      for (const name of names) {
        const direction = assignmentDirection(project, teamProjectIds, coreNames, name);
        if (!direction) {
          continue;
        }
        for (const deliveryKey of definition.deliveries) {
          if (!deliveryKeys.has(deliveryKey) || !hasOpenDeliveryResponsibility(project, deliveryKey)) {
            continue;
          }
          const state = itemState(project, deliveryKey, selectedMonth);
          if (state.completed) {
            continue;
          }
          assignments.push({
            ...projectIdentity(project),
            personName: name,
            direction,
            roleKey: definition.key,
            slotKey: definition.slotKey,
            roleLabel: definition.label,
            discipline: definition.discipline,
            deliveryKey,
            deliveryLabel: DELIVERY_LABELS[deliveryKey],
            state,
          });
        }
      }
    }
  }
  return assignments;
}

function borrowingItem(assignment) {
  return {
    projectId: assignment.projectId,
    projectName: assignment.projectName,
    personName: assignment.personName,
    direction: assignment.direction === 'externalIn' ? 'externalIn' : 'borrowedOut',
    roleLabel: assignment.roleLabel,
    deliveryLabel: assignment.deliveryLabel,
    owner: assignment.owner,
  };
}

function sortPeople(a, b) {
  const supportDiff = (SUPPORT_TYPE_ORDER[a.supportType] ?? 9) - (SUPPORT_TYPE_ORDER[b.supportType] ?? 9);
  if (supportDiff) {
    return supportDiff;
  }
  if (b.responsibilityItemCount !== a.responsibilityItemCount) {
    return b.responsibilityItemCount - a.responsibilityItemCount;
  }
  return a.name.localeCompare(b.name, 'zh-Hans-CN');
}

function buildDisciplineSummaries(assignments) {
  const byDiscipline = new Map([
    ['hard', emptyCount({ key: 'hard', label: '硬装' })],
    ['soft', emptyCount({ key: 'soft', label: '软装' })],
  ]);
  for (const assignment of assignments) {
    addCount(byDiscipline.get(assignment.discipline), assignment);
  }
  return Array.from(byDiscipline.values());
}

function buildPeople(assignments, architecture) {
  const byPerson = new Map();
  for (const assignment of assignments) {
    const supportType = assignment.direction === 'externalIn' ? 'externalIn' : assignment.direction;
    if (!byPerson.has(assignment.personName)) {
      byPerson.set(assignment.personName, createPersonStat(assignment.personName, architecture, supportType));
    }
    const stat = byPerson.get(assignment.personName);
    stat.supportTypes.add(supportType);
    stat.projectIds.add(assignment.projectId);
    if (assignment.direction === 'borrowedOut') {
      stat.borrowedOutProjectIds.add(assignment.projectId);
    }
    stat.responsibilityItemCount += 1;
    addCount(stat, assignment);

    const roleKey = `${assignment.roleKey}:${assignment.deliveryKey}`;
    if (!stat.roles.has(roleKey)) {
      stat.roles.set(
        roleKey,
        emptyCount({
          key: assignment.roleKey,
          slotKey: assignment.slotKey,
          label: assignment.roleLabel,
          discipline: assignment.discipline,
          deliveryKey: assignment.deliveryKey,
          deliveryLabel: assignment.deliveryLabel,
        })
      );
    }
    addCount(stat.roles.get(roleKey), assignment);
    stat.items.push(assignment);
  }
  return Array.from(byPerson.values()).map(finalPerson).sort(sortPeople);
}

function buildSummary(teamProjects, assignments) {
  const summary = emptyCount({
    projectCount: new Set(assignments.map((item) => item.projectId).filter(Boolean)).size,
    teamProjectCount: teamProjects.length,
    responsibilityItemCount: assignments.length,
    peopleCount: new Set(assignments.map((item) => item.personName)).size,
    externalSupportCount: new Set(assignments.filter((item) => item.direction === 'externalIn').map((item) => item.personName)).size,
    borrowedOutCount: new Set(assignments.filter((item) => item.direction === 'borrowedOut').map((item) => item.personName)).size,
  });
  for (const assignment of assignments) {
    addCount(summary, assignment);
  }
  return summary;
}

export function buildTeamResponsibilityReview(allProjects, team, options = {}) {
  const architecture = normalizePersonnelArchitecture(options.personnelArchitecture || {});
  const ownerIdentity = findResponsibilityIdentity(team?.owner, architecture);
  const reviewTeam = teamWithStaticGroups(team || {});
  const dashboardContext = options.dashboardContext || 'all';
  const selectedMonth = normalizeMonth(options.month, options.now);
  const activeProjects = excludePausedProjects(allProjects || []).filter((project) =>
    matchesDashboardContext(project, dashboardContext)
  );
  const teamProjects = excludePausedProjects(
    resolveOwnerMonthlyProjects(allProjects || [], reviewTeam.owner || '', {
      dashboardContext,
      personnelArchitecture: architecture,
    })
  );
  const teamProjectIds = new Set(teamProjects.map((project) => project.id));
  const coreNames = teamCoreNames(reviewTeam, architecture);
  const executionScope = executionScopeForTeam(reviewTeam, architecture);
  const assignments = buildAssignments(activeProjects, teamProjectIds, coreNames, selectedMonth, architecture, executionScope);
  const dataQuality = buildDataQualityReview(allProjects || [], teamProjectIds, coreNames, architecture);
  const memberLoads = buildMemberLoads(allProjects || [], reviewTeam, teamProjectIds, selectedMonth, architecture, {
    calendar: options.hardDecorationCalendar || DEFAULT_HARD_DECORATION_CALENDAR,
    today: options.today || chinaToday(),
  });
  const summary = {
    ...buildSummary(teamProjects, assignments),
    ...buildMemberLoadSummary(memberLoads),
    dataQualityAnomalyCount: dataQuality.anomalyCount,
  };

  return {
    owner: reviewTeam.owner || '',
    displayName: ownerIdentity?.displayName || reviewTeam.owner || '',
    sourceOwner: ownerIdentity?.sourceName || undefined,
    ownerIdentity: ownerIdentity || undefined,
    dashboardContext,
    month: selectedMonth,
    readOnly: true,
    executionScope,
    team: {
      owner: reviewTeam.owner || '',
      cdLeads: reviewTeam.cdLeads || [],
      vmLeads: reviewTeam.vmLeads || [],
      members: reviewTeam.members || [],
      groups: reviewTeam.groups || [],
      coreNames: Array.from(coreNames),
    },
    summary,
    disciplines: buildDisciplineSummaries(assignments),
    people: buildPeople(assignments, architecture),
    memberLoads,
    dataQuality,
    borrowing: assignments.filter((item) => item.direction !== 'teamScope').map(borrowingItem),
  };
}

export { RESPONSIBILITY_DEFINITIONS };
