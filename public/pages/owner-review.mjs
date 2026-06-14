import { state } from '../lib/state.mjs';
import { elements } from '../lib/dom.mjs';
import { escapeHtml, displayOrDash, formatDate, formatDateTime } from '../lib/format.mjs';
import { bindTooltipTriggers } from '../dashboard/tooltip.mjs';
import { renderEmptyState } from '../dashboard/empty-state.mjs';
import { setPanelInsight } from '../lib/dom.mjs';
import { OWNER_REVIEW_CACHE_LIMIT } from '../lib/constants.mjs';
import { fetchJson, TEAM_RESPONSIBILITY_REVIEW_ENDPOINT } from '../lib/api.mjs';
import { currentPageId, navigateToOwnerReview, ownerReviewModuleVisible } from '../lib/router.mjs';
import {
  resolveTeamOwner,
  resolveOwnerReviewOwner,
  resolveOwnerReviewDashboardContext,
  teamOwnerDisplayName,
  ensureOwnerReviewControls,
} from '../domain/personnel.mjs';
import { openProjectDetailByReference } from '../components/project-workbench.mjs';
import { renderTeamHeroStat } from '../components/team-hero-stat.mjs';
import { enhanceOwnerReviewSelects, renderFilterSelect } from '../components/filter-bar.mjs';

const OWNER_REVIEW_STATIC_TEAM_STRUCTURE = {
  owner: '苏佳蕾',
  scopeDescription: '直营硬装 · CD设计师 · 进行中平面方案',
  groups: [
    { name: '直营1组', lead: '陈菲菲', members: ['陈菲菲', '乔玲玲', '陈晶晶', '张莹莹', '杨雪倩'] },
    { name: '直营2组', lead: '陶媛媛', members: ['陶媛媛', '梁玉贞', '安灵玲', '何赛平', '古茂琨'] },
    { name: '直营3组', lead: '杨晓芸', members: ['杨晓芸', '陈红燕', '臧传宝', '庞小琪', '禹凯鹏', '陈梦然', '占俊鑫'] },
    { name: '直营4组', lead: '刘雯蓓', members: ['刘雯蓓', '董一凡', '郭后冲', '杨莉', '牛超凡'] },
  ],
};

const INACTIVE_OWNER_REVIEW_MEMBERS = new Set(['李晓倩', '席创意', '侯喆']);

export function isInactiveOwnerReviewMember(name) {
  return INACTIVE_OWNER_REVIEW_MEMBERS.has(String(name || '').trim());
}

const OWNER_REVIEW_LOAD_LEVELS = [
  { key: 'idle', label: '空闲', min: 0, max: 0, tone: 'idle' },
  { key: 'normal', label: '正常', min: 1, max: 2, tone: 'normal' },
  { key: 'busy', label: '偏高', min: 3, max: 4, tone: 'busy' },
  { key: 'overloaded', label: '过载', min: 5, max: Infinity, tone: 'overloaded' },
];


export function ownerReviewLoadLevel(value = 0) {
  const load = Math.max(0, Number(value || 0));
  return OWNER_REVIEW_LOAD_LEVELS.find((level) => load >= level.min && load <= level.max) || OWNER_REVIEW_LOAD_LEVELS[0];
}


export function ownerReviewMemberAnomalies(person = {}) {
  const anomalies = Array.isArray(person.anomalies) ? person.anomalies.slice() : [];
  const summary = person.summary || {};
  const summaryCount = Number(summary.anomalyCount || summary.anomalies || 0);
  if (summaryCount > anomalies.length) {
    anomalies.push({
      type: '数据待核查',
      severity: '需要核对',
      message: `接口返回 ${summaryCount} 条异常，请核对来源字段。`,
    });
  }
  const hasExplicitSourceAnomaly = anomalies.some((item) =>
    /来源|字段/.test(`${item.type || ''}${item.message || ''}`)
  );
  for (const item of [...(person.floorPlan?.active || []), ...(person.floorPlan?.completed || [])]) {
    if (!item.projectName || !item.owner || (!item.status && !item.state)) {
      if (hasExplicitSourceAnomaly) {
        continue;
      }
      anomalies.push({
        type: '来源待补充',
        severity: '需要核对',
        message: '平面来源缺少项目名、负责人或状态，当前负载结论只可参考。',
      });
    }
  }
  return anomalies;
}


export function ownerReviewReviewAnomalies(review = state.ownerReview) {
  const anomalies = Array.isArray(review?.dataQuality?.anomalies) ? review.dataQuality.anomalies.slice() : [];
  const summaryCount = Number(review?.summary?.dataQualityAnomalyCount || review?.dataQuality?.anomalyCount || 0);
  if (summaryCount > anomalies.length) {
    anomalies.push({
      type: '数据待核查',
      severity: '需要核对',
      message: `接口返回 ${summaryCount} 条团队级异常，请核对来源字段。`,
    });
  }
  return anomalies;
}


export function ownerReviewSourceStatus(item = {}, fallback = '') {
  return item.status || ownerReviewMemberStateLabel(item.state) || fallback || '--';
}


export function ownerReviewSourceRows(member = {}) {
  const rows = [];
  const pushRows = (items = [], meta = {}) => {
    for (const item of items) {
      rows.push({
        ...item,
        moduleLabel: meta.moduleLabel,
        basisLabel: meta.basisLabel,
        basisClass: meta.basisClass,
        excludedReason: meta.excludedReason || '',
        status: ownerReviewSourceStatus(item, meta.statusFallback),
      });
    }
  };
  pushRows(member.floorPlan?.active || [], {
    moduleLabel: '平面方案',
    basisLabel: '计入当前负载',
    basisClass: 'included',
    statusFallback: '推进中',
  });
  pushRows(member.floorPlan?.completed || [], {
    moduleLabel: '平面方案',
    basisLabel: '仅历史完成',
    basisClass: 'history',
    excludedReason: '平面已完成，不计入当前负载。',
    statusFallback: '已完成',
  });
  pushRows(member.display?.active || [], {
    moduleLabel: '摆场',
    basisLabel: '仅摆场统计',
    basisClass: 'display',
    excludedReason: '摆场只做过程统计，不叠加到当前平面负载。',
    statusFallback: '摆场进行',
  });
  pushRows(member.display?.completed || [], {
    moduleLabel: '摆场',
    basisLabel: '仅摆场统计',
    basisClass: 'display',
    excludedReason: '摆场完成只做历史统计，不叠加到当前平面负载。',
    statusFallback: '摆场完成',
  });

  const knownIds = new Set(rows.map((item) => item.projectId).filter(Boolean));
  for (const project of member.associatedProjects || []) {
    if (project.projectId && knownIds.has(project.projectId)) {
      continue;
    }
    rows.push({
      ...project,
      moduleLabel: '关联记录',
      basisLabel: '仅关联记录',
      basisClass: 'associated',
      excludedReason: '仅说明成员曾出现在项目角色字段，不直接形成当前负载。',
      status: ownerReviewSourceStatus(project, '仅关联'),
    });
  }

  for (const anomaly of ownerReviewMemberAnomalies(member)) {
    rows.push({
      projectId: anomaly.projectId || '',
      projectName: anomaly.projectName || anomaly.type || '数据异常',
      owner: anomaly.owner || '',
      roleLabel: anomaly.severity || '数据待核查',
      moduleLabel: '异常记录',
      basisLabel: '数据异常',
      basisClass: 'anomaly',
      excludedReason: anomaly.message || '该记录需要核对来源后再用于管理判断。',
      status: anomaly.severity || '需要核对',
      completedAt: '',
    });
  }

  return rows;
}


export function ownerReviewSearchTextForPerson(person = {}) {
  const projects = [
    ...(person.floorPlan?.active || []),
    ...(person.floorPlan?.completed || []),
    ...(person.display?.active || []),
    ...(person.display?.completed || []),
    ...(person.associatedProjects || []),
  ];
  return [
    person.name,
    person.displayName,
    person.groupName,
    ...projects.flatMap((project) => [
      project.projectName,
      project.storeName,
      project.store,
      project.owner,
      project.status,
      ...(project.roleLabels || []),
    ]),
  ]
    .filter(Boolean)
    .join(' ');
}


export function ownerReviewTextMatches(value, query) {
  const keyword = String(query || '').trim().toLowerCase();
  if (!keyword) {
    return true;
  }
  return String(value || '').toLowerCase().includes(keyword);
}


export function ownerReviewHighlight(value, query) {
  const text = String(value || '');
  const keyword = String(query || '').trim();
  if (!keyword) {
    return escapeHtml(text);
  }
  const lower = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const index = lower.indexOf(lowerKeyword);
  if (index < 0) {
    return escapeHtml(text);
  }
  return `${escapeHtml(text.slice(0, index))}<mark>${escapeHtml(text.slice(index, index + keyword.length))}</mark>${escapeHtml(
    text.slice(index + keyword.length)
  )}`;
}


export function ownerReviewRowMatchesFilter(row, filter = state.ownerReviewLoadFilter) {
  const person = row.person || {};
  const summary = person.summary || {};
  const load = summary.floorPlanActiveCount || 0;
  const anomalyCount = ownerReviewMemberAnomalies(person).length;
  if (filter === 'loaded') {
    return load > 0;
  }
  if (filter === 'idle') {
    return load <= 0;
  }
  if (filter === 'attention') {
    return load >= 3;
  }
  if (filter === 'anomaly') {
    return anomalyCount > 0;
  }
  return true;
}


export function normalizeOwnerReviewStructureGroups(groups = []) {
  const normalized = [];
  const appendGroup = (group, fallbackName = '') => {
    if (!group || typeof group !== 'object') {
      return;
    }
    const rawMembers = Array.isArray(group.members) ? group.members : [];
    const nestedGroups = rawMembers.filter((member) => member && typeof member === 'object' && Array.isArray(member.members));
    const members = rawMembers
      .filter((member) => !(member && typeof member === 'object' && Array.isArray(member.members)))
      .map((member) => {
        if (typeof member === 'string') {
          return member.trim();
        }
        return String(member?.name || member?.displayName || '').trim();
      })
      .filter((name) => Boolean(name) && !isInactiveOwnerReviewMember(name));
    if (members.length) {
      normalized.push({
        name: String(group.name || fallbackName || '未命名小组').trim(),
        members,
      });
    }
    for (const nestedGroup of nestedGroups) {
      appendGroup(nestedGroup, nestedGroup.name || group.name || fallbackName);
    }
  };
  for (const group of groups) {
    appendGroup(group);
  }
  return normalized;
}


export function ownerReviewStructureGroups(review = state.ownerReview) {
  const apiGroups = (review?.team?.groups || []).filter((group) => Array.isArray(group.members) && group.members.length);
  if (apiGroups.length) {
    return normalizeOwnerReviewStructureGroups(apiGroups);
  }
  const loadGroups = new Map();
  for (const member of review?.memberLoads || []) {
    const name = String(member?.displayName || member?.name || '').trim();
    if (!name || isInactiveOwnerReviewMember(name)) {
      continue;
    }
    const groupName = String(member?.groupName || '未分组成员').trim() || '未分组成员';
    if (!loadGroups.has(groupName)) {
      loadGroups.set(groupName, []);
    }
    loadGroups.get(groupName).push(name);
  }
  if (loadGroups.size) {
    return Array.from(loadGroups, ([name, members]) => ({ name, members }));
  }
  const owner = review?.owner || resolveOwnerReviewOwner();
  return owner === OWNER_REVIEW_STATIC_TEAM_STRUCTURE.owner ? OWNER_REVIEW_STATIC_TEAM_STRUCTURE.groups : [];
}


export function ownerReviewTeamRosterUnmaintained(review = state.ownerReview) {
  return !ownerReviewStructureGroups(review).length;
}


export function ownerReviewStructureLoadModel(review = state.ownerReview) {
  const visibleReview = ownerReviewVisibleReview(review);
  const memberLoads = Array.isArray(review?.memberLoads) ? review.memberLoads : [];
  const activeMemberLoads = memberLoads.filter((person) => !isInactiveOwnerReviewMember(person.name));
  const activeVisiblePeople = (visibleReview?.people || []).filter((person) => !isInactiveOwnerReviewMember(person.name));
  const people = new Map(
    activeMemberLoads.length
      ? activeMemberLoads.map((person) => [person.name, person])
      : activeVisiblePeople.map((person) => [person.name, person])
  );
  const summary = memberLoads.length
    ? buildOwnerReviewStructureSummary(activeMemberLoads)
    : (visibleReview?.summary || review?.summary || {});
  return {
    totalLoad: summary.memberFloorPlanActiveCount || summary.responsibilityItemCount || 0,
    projectCount: summary.memberFloorPlanActiveProjectCount || summary.memberActiveProjectCount || summary.projectCount || 0,
    completedProjectCount: summary.memberFloorPlanCompletedCount || 0,
    displayActiveCount: summary.memberDisplayActiveCount || 0,
    displayCompletedCount: summary.memberDisplayCompletedCount || 0,
    associatedProjectCount: summary.memberAssociatedProjectCount || 0,
    peopleCount: summary.memberCount || summary.peopleCount || 0,
    people,
  };
}


export function buildOwnerReviewStructureSummary(memberLoads = []) {
  const associatedProjectIds = new Set();
  const floorPlanActiveProjectIds = new Set();
  const floorPlanCompletedProjectIds = new Set();
  const summary = {
    memberCount: memberLoads.length,
    memberAssociatedProjectCount: 0,
    memberActiveProjectCount: 0,
    memberCompletedProjectCount: 0,
    memberFloorPlanActiveProjectCount: 0,
    memberFloorPlanActiveCount: 0,
    memberFloorPlanCompletedCount: 0,
    memberDisplayActiveCount: 0,
    memberDisplayCompletedCount: 0,
  };
  for (const member of memberLoads) {
    const memberSummary = member.summary || {};
    summary.memberAssociatedProjectCount += memberSummary.associatedProjectCount || 0;
    summary.memberFloorPlanActiveCount += memberSummary.floorPlanActiveCount || 0;
    summary.memberFloorPlanCompletedCount += memberSummary.floorPlanCompletedCount || 0;
    summary.memberDisplayActiveCount += memberSummary.displayActiveCount || 0;
    summary.memberDisplayCompletedCount += memberSummary.displayCompletedCount || 0;
    for (const project of member.associatedProjects || []) {
      if (!project.projectId) {
        continue;
      }
      associatedProjectIds.add(project.projectId);
    }
    for (const project of member.floorPlan?.active || []) {
      if (project.projectId) {
        floorPlanActiveProjectIds.add(project.projectId);
      }
    }
    for (const project of member.floorPlan?.completed || []) {
      if (project.projectId) {
        floorPlanCompletedProjectIds.add(project.projectId);
      }
    }
  }
  summary.memberActiveProjectCount = floorPlanActiveProjectIds.size || summary.memberFloorPlanActiveCount;
  summary.memberCompletedProjectCount = floorPlanCompletedProjectIds.size || summary.memberFloorPlanCompletedCount;
  summary.memberFloorPlanActiveProjectCount = summary.memberActiveProjectCount;
  summary.memberUniqueAssociatedProjectCount = associatedProjectIds.size;
  return summary;
}


export function ownerReviewMemberLoadClass(load = 0, person = {}) {
  if (person.inactive) {
    return 'is-inactive';
  }
  if (person.supportType === 'borrowedOut') {
    return 'is-borrowed';
  }
  if (person.supportType === 'externalSupport') {
    return 'is-external';
  }
  if (load >= 8) {
    return 'is-heavy';
  }
  if (load >= 4) {
    return 'is-busy';
  }
  if (load > 0) {
    return 'is-loaded';
  }
  return 'is-empty';
}


export function renderOwnerReviewMemberLoad(member, loadModel) {
  const inactive = isInactiveOwnerReviewMember(member);
  const person = inactive ? { name: member, inactive: true } : loadModel.people.get(member) || {};
  const memberSummary = person.summary || {};
  const currentLoad = memberSummary.floorPlanActiveCount || person.responsibilityItemCount || 0;
  const floorLoad = memberSummary.floorPlanActiveCount || 0;
  const displayLoad = memberSummary.displayActiveCount || 0;
  const displayDone = memberSummary.displayCompletedCount || 0;
  const associatedLoad = memberSummary.associatedProjectCount || person.projectCount || 0;
  return `
    <button class="owner-review-member-load ${ownerReviewMemberLoadClass(currentLoad, person)}" type="button" data-owner-review-member="${escapeHtml(
      person.name || member
    )}" aria-label="查看${escapeHtml(member)}的负载详情">
      <strong>${escapeHtml(member)}</strong>
      ${
        inactive
          ? '<small>暂不在职</small>'
          : associatedLoad
          ? `<b>平面 ${escapeHtml(currentLoad)}</b><small>平面 ${escapeHtml(floorLoad)} · 摆场 ${escapeHtml(displayLoad)}/${escapeHtml(displayDone)} · 关联 ${escapeHtml(associatedLoad)}</small>`
          : '<small>未挂载关联项目</small>'
      }
    </button>
  `;
}


export function renderOwnerReviewTeamStructure(review = state.ownerReview) {
  if (!elements.ownerReviewTeamStructure) {
    return;
  }
  const groups = ownerReviewStructureGroups(review);
  const structure = {
    ...OWNER_REVIEW_STATIC_TEAM_STRUCTURE,
    owner: review?.owner || resolveOwnerReviewOwner() || OWNER_REVIEW_STATIC_TEAM_STRUCTURE.owner,
    groups,
    scopeDescription:
      review?.executionScope?.description || OWNER_REVIEW_STATIC_TEAM_STRUCTURE.scopeDescription,
  };
  const totalPeople = structure.groups.reduce((sum, group) => sum + group.members.length, 0);
  const loadModel = ownerReviewStructureLoadModel(review);
  const hasGroups = structure.groups.length > 0;
  const structureScopeSummary = hasGroups
    ? `${structure.groups.length} 个直营组 · ${totalPeople} 人`
    : '已维护成员 0 人 / 团队结构待补充';
  const groupsMarkup = hasGroups
    ? `
      <div class="owner-review-structure-groups">
        ${structure.groups
          .map((group) => {
            const groupLoads = group.members.map((member) => {
              const summary = loadModel.people.get(member)?.summary || {};
              return summary.floorPlanActiveCount || 0;
            });
            const groupLoadTotal = groupLoads.reduce((sum, value) => sum + value, 0);
            const activePeople = groupLoads.filter((value) => value > 0).length;
            return `
              <section class="owner-review-structure-group">
                <header>
                  <strong>${escapeHtml(group.name)}</strong>
                  <span>${escapeHtml(groupLoadTotal)} 项 · ${escapeHtml(activePeople)}/${escapeHtml(group.members.length)} 人</span>
                </header>
                <div class="owner-review-structure-members">
                  ${group.members.map((member) => renderOwnerReviewMemberLoad(member, loadModel)).join('')}
                </div>
              </section>
            `;
          })
          .join('')}
      </div>
    `
    : `
      <div class="owner-review-structure-empty">
        <strong>团队结构待补充</strong>
        <span>该负责人暂未维护团队成员，当前仅展示负责人级项目事实，成员负载待补齐后可用。</span>
      </div>
    `;
  elements.ownerReviewTeamStructure.innerHTML = `
    <article class="owner-review-structure-board${hasGroups ? '' : ' is-empty-structure'}">
      <header class="owner-review-structure-head">
        <div>
          <span>负责人团队情况</span>
          <strong>${escapeHtml(structure.owner)}</strong>
        </div>
        <p>${escapeHtml(structure.scopeDescription)} · ${escapeHtml(structureScopeSummary)}</p>
      </header>
      <div class="owner-review-structure-summary" aria-label="执行负载汇总">
        <span><b>${escapeHtml(loadModel.totalLoad)}</b><small>当前平面负载</small></span>
        <span><b>${escapeHtml(loadModel.projectCount)}</b><small>平面进行</small></span>
        <span><b>${escapeHtml(loadModel.completedProjectCount)}</b><small>平面完成</small></span>
        <span><b>${escapeHtml(loadModel.displayActiveCount)}/${escapeHtml(loadModel.displayCompletedCount)}</b><small>摆场进行/完成</small></span>
        <span><b>${escapeHtml(loadModel.associatedProjectCount)}</b><small>关联记录</small></span>
      </div>
      ${groupsMarkup}
    </article>
  `;
}


function renderOwnerReviewTeamStructureStatus(title, description = '') {
  if (!elements.ownerReviewTeamStructure) {
    return;
  }
  elements.ownerReviewTeamStructure.innerHTML = renderEmptyState({
    title,
    description,
    compact: true,
  });
}


function ownerReviewLoadErrorDescription(fallback = '请稍后刷新当前页面。') {
  const errorText = String(state.ownerReviewError || state.ownerReviewRefreshError || '').trim();
  return errorText ? `${fallback} 错误：${errorText}` : fallback;
}


export function ownerReviewSupportLabel(type = '') {
  return {
    team: '团队内承接',
    externalSupport: '外部支援',
    borrowedOut: '本团队外借',
    mixed: '混合承载',
  }[type] || '团队内承接';
}


export function ownerReviewEmptyCount(extra = {}) {
  return {
    itemCount: 0,
    completedThisMonth: 0,
    delayedCompletedThisMonth: 0,
    openDelayed: 0,
    missingCompletionDate: 0,
    ...extra,
  };
}


export function ownerReviewAddCount(target, item) {
  target.itemCount += 1;
  if (item.state?.completedThisMonth) {
    target.completedThisMonth += 1;
  }
  if (item.state?.delayedCompletedThisMonth) {
    target.delayedCompletedThisMonth += 1;
  }
  if (item.state?.openDelayed) {
    target.openDelayed += 1;
  }
  if (item.state?.missingCompletionDate) {
    target.missingCompletionDate += 1;
  }
}


export function ownerReviewSupportTypeFromDirections(directions = new Set()) {
  const values = Array.from(directions);
  if (values.length > 1) {
    return 'mixed';
  }
  if (values[0] === 'externalIn') {
    return 'externalSupport';
  }
  if (values[0] === 'borrowedOut') {
    return 'borrowedOut';
  }
  return 'team';
}


export function ownerReviewFinalRole(role) {
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


export function ownerReviewSortPeople(a, b) {
  const order = { team: 0, mixed: 1, externalSupport: 2, borrowedOut: 3 };
  const supportDiff = (order[a.supportType] ?? 9) - (order[b.supportType] ?? 9);
  if (supportDiff) {
    return supportDiff;
  }
  if ((b.responsibilityItemCount || 0) !== (a.responsibilityItemCount || 0)) {
    return (b.responsibilityItemCount || 0) - (a.responsibilityItemCount || 0);
  }
  return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
}


export function ownerReviewBuildPeopleFromItems(items = [], review = state.ownerReview) {
  const sourcePeople = new Map((review?.people || []).map((person) => [person.name, person]));
  const byPerson = new Map();
  for (const item of items) {
    const name = item.personName || '';
    if (!name) {
      continue;
    }
    if (!byPerson.has(name)) {
      const source = sourcePeople.get(name) || {};
      byPerson.set(name, {
        ...source,
        name,
        displayName: source.displayName || name,
        supportTypes: new Set(),
        projectIds: new Set(),
        borrowedOutProjectIds: new Set(),
        roles: new Map(),
        items: [],
        responsibilityItemCount: 0,
        ...ownerReviewEmptyCount(),
      });
    }
    const stat = byPerson.get(name);
    stat.supportTypes.add(item.direction || 'teamScope');
    stat.projectIds.add(item.projectId);
    if (item.direction === 'borrowedOut') {
      stat.borrowedOutProjectIds.add(item.projectId);
    }
    stat.responsibilityItemCount += 1;
    ownerReviewAddCount(stat, item);
    const roleKey = `${item.roleKey}:${item.deliveryKey}`;
    if (!stat.roles.has(roleKey)) {
      stat.roles.set(
        roleKey,
        ownerReviewEmptyCount({
          key: item.roleKey,
          slotKey: item.slotKey,
          label: item.roleLabel,
          discipline: item.discipline,
          deliveryKey: item.deliveryKey,
          deliveryLabel: item.deliveryLabel,
        })
      );
    }
    ownerReviewAddCount(stat.roles.get(roleKey), item);
    stat.items.push(item);
  }
  const visiblePeople = Array.from(byPerson.values())
    .map((stat) => ({
      name: stat.name,
      displayName: stat.displayName,
      position: stat.position || '',
      positionLabel: stat.positionLabel || '',
      discipline: stat.discipline || '',
      disciplineLabel: stat.disciplineLabel || '',
      supportType: ownerReviewSupportTypeFromDirections(stat.supportTypes),
      projectCount: stat.projectIds.size,
      borrowedOutCount: stat.borrowedOutProjectIds.size,
      responsibilityItemCount: stat.responsibilityItemCount,
      completedThisMonth: stat.completedThisMonth,
      delayedCompletedThisMonth: stat.delayedCompletedThisMonth,
      openDelayed: stat.openDelayed,
      missingCompletionDate: stat.missingCompletionDate,
      roles: Array.from(stat.roles.values()).map(ownerReviewFinalRole),
      items: stat.items,
    }))
    .sort(ownerReviewSortPeople);
  const sourceArray = Array.isArray(review?.people) ? review.people.slice(0, 0) : [];
  return sourceArray.concat(visiblePeople);
}


export function ownerReviewBuildDisciplinesFromItems(items = []) {
  const byDiscipline = new Map([
    ['hard', ownerReviewEmptyCount({ key: 'hard', label: '硬装' })],
    ['soft', ownerReviewEmptyCount({ key: 'soft', label: '软装' })],
  ]);
  for (const item of items) {
    const row = byDiscipline.get(item.discipline);
    if (row) {
      ownerReviewAddCount(row, item);
    }
  }
  return Array.from(byDiscipline.values());
}


export function ownerReviewBuildSummaryFromItems(items = []) {
  const summary = ownerReviewEmptyCount({
    projectCount: new Set(items.map((item) => item.projectId).filter(Boolean)).size,
    responsibilityItemCount: items.length,
    peopleCount: new Set(items.map((item) => item.personName).filter(Boolean)).size,
    externalSupportCount: new Set(items.filter((item) => item.direction === 'externalIn').map((item) => item.personName)).size,
    borrowedOutCount: new Set(items.filter((item) => item.direction === 'borrowedOut').map((item) => item.personName)).size,
  });
  for (const item of items) {
    ownerReviewAddCount(summary, item);
  }
  return summary;
}


export function ownerReviewAllItems(review = state.ownerReview) {
  return (review?.people || []).flatMap((person) =>
    (person.items || []).map((item) => ({
      ...item,
      personName: item.personName || person.name || '',
    }))
  );
}


export function ownerReviewVisibleReview(review = state.ownerReview) {
  if (!review || state.ownerReviewShowBorrowing) {
    return review;
  }
  const items = ownerReviewAllItems(review).filter((item) => item.direction === 'teamScope');
  return {
    ...review,
    summary: ownerReviewBuildSummaryFromItems(items),
    disciplines: ownerReviewBuildDisciplinesFromItems(items),
    people: ownerReviewBuildPeopleFromItems(items, review),
    borrowing: [],
  };
}


export function ownerReviewVisiblePeople(review = ownerReviewVisibleReview()) {
  return review?.people || [];
}


export function ownerReviewPreferredPersonName(review = ownerReviewVisibleReview()) {
  const people = ownerReviewVisiblePeople(review);
  return (
    people.find((item) => item.name === review?.owner)?.name ||
    people.find((item) => item.supportType === 'team')?.name ||
    people.find((item) => item.supportType === 'mixed')?.name ||
    people[0]?.name ||
    ''
  );
}


export function ownerReviewPercent(numerator, denominator) {
  const base = Number(denominator || 0);
  if (!base) {
    return 0;
  }
  return Math.round((Number(numerator || 0) / base) * 100);
}


export function ownerReviewSelectedPerson(review = state.ownerReview) {
  const visibleReview = ownerReviewVisibleReview(review);
  const people = ownerReviewVisiblePeople(visibleReview);
  return (
    people.find((item) => item.name === state.selectedOwnerReviewPerson) ||
    people.find((item) => item.name === visibleReview?.owner) ||
    people.find((item) => item.supportType === 'team') ||
    people.find((item) => item.supportType === 'mixed') ||
    people[0] ||
    null
  );
}


export function renderOwnerReviewHeroSummary(review) {
  const summary = review.summary || {};
  const chips = [
    { label: '执行负载', amount: summary.responsibilityItemCount || 0, unit: '项' },
    { label: '当前项目', amount: summary.projectCount || 0, unit: '项' },
  ];
  return chips
    .map(
      (chip) => `
        <span class="team-hero-chip${chip.tone ? ` is-${chip.tone}` : ''}">
          <span class="team-hero-chip-label">${escapeHtml(chip.label)}</span>
          <span class="team-hero-chip-value"><b>${escapeHtml(chip.amount)}</b><i>${escapeHtml(chip.unit)}</i></span>
        </span>
      `
    )
    .join('');
}


export function renderOwnerReviewResponsibilityMatrix(review = state.ownerReview) {
  const visibleReview = ownerReviewVisibleReview(review);
  const rows = visibleReview?.disciplines || [];
  if (!elements.ownerReviewResponsibilityMatrix) {
    return;
  }
  if (!rows.length) {
    elements.ownerReviewResponsibilityMatrix.innerHTML = renderEmptyState({
      title: '暂无责任域数据',
      description: '当前负责人团队还没有硬装或软装责任项。',
      compact: true,
    });
    return;
  }
  elements.ownerReviewResponsibilityMatrix.innerHTML = rows
    .map((row) => {
      const doneRate = ownerReviewPercent(row.completedThisMonth || 0, row.itemCount || 0);
      const safeDoneRate = Math.max(0, Math.min(100, doneRate));
      return `
        <article class="owner-review-matrix-card is-${escapeHtml(row.key)}">
          <header>
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(row.itemCount || 0)}</strong>
          </header>
          <div class="owner-review-matrix-line">
            <i style="width:${safeDoneRate}%"></i>
          </div>
          <dl>
            <div><dt>本月完成</dt><dd>${escapeHtml(row.completedThisMonth || 0)}</dd></div>
            <div><dt>延期完成</dt><dd>${escapeHtml(row.delayedCompletedThisMonth || 0)}</dd></div>
            <div><dt>延期未闭环</dt><dd>${escapeHtml(row.openDelayed || 0)}</dd></div>
            <div><dt>缺完成时间</dt><dd>${escapeHtml(row.missingCompletionDate || 0)}</dd></div>
          </dl>
        </article>
      `;
    })
    .join('');
}


export function renderOwnerReviewRoleChips(person) {
  return (person.roles || [])
    .map(
      (role) => `
        <span class="owner-review-role-chip is-${escapeHtml(role.discipline)}">
          ${escapeHtml(role.label)} · ${escapeHtml(role.deliveryLabel)} ${escapeHtml(role.itemCount)}
        </span>
      `
    )
    .join('');
}


export function ownerReviewFloorLoadRows(review = state.ownerReview) {
  const groups = ownerReviewStructureGroups(review);
  const loadModel = ownerReviewStructureLoadModel(review);
  const rows = [];
  groups.forEach((group, groupIndex) => {
    (group.members || []).forEach((memberName, memberIndex) => {
      if (isInactiveOwnerReviewMember(memberName)) {
        return;
      }
      const person = loadModel.people.get(memberName) || {
        name: memberName,
        displayName: memberName,
        groupName: group.name || '',
        summary: {},
        floorPlan: { active: [], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      };
      rows.push({
        person: {
          ...person,
          groupName: person.groupName || group.name || '',
          floorPlan: person.floorPlan || { active: [], completed: [] },
          display: person.display || { active: [], completed: [] },
          associatedProjects: person.associatedProjects || [],
        },
        groupIndex,
        memberIndex,
      });
    });
  });
  return rows.sort((a, b) => {
    const aLoad = a.person.summary?.floorPlanActiveCount || 0;
    const bLoad = b.person.summary?.floorPlanActiveCount || 0;
    if (bLoad !== aLoad) {
      return bLoad - aLoad;
    }
    if (a.groupIndex !== b.groupIndex) {
      return a.groupIndex - b.groupIndex;
    }
    return a.memberIndex - b.memberIndex;
  });
}


export function ownerReviewFloorLoadGroups(review = state.ownerReview) {
  const groups = ownerReviewStructureGroups(review);
  const rows = ownerReviewFloorLoadRows(review);
  const searchQuery = String(state.ownerReviewSearchQuery || '').trim();
  const filter = state.ownerReviewLoadFilter || 'all';
  const rowsByGroup = new Map();
  for (const row of rows) {
    const key = row.groupIndex;
    if (!rowsByGroup.has(key)) {
      rowsByGroup.set(key, []);
    }
    rowsByGroup.get(key).push(row);
  }

  return groups.map((group, groupIndex) => {
    const allRows = (rowsByGroup.get(groupIndex) || []).slice().sort((a, b) => {
      const aLoad = a.person.summary?.floorPlanActiveCount || 0;
      const bLoad = b.person.summary?.floorPlanActiveCount || 0;
      if (bLoad !== aLoad) {
        return bLoad - aLoad;
      }
      const anomalyDiff = ownerReviewMemberAnomalies(b.person).length - ownerReviewMemberAnomalies(a.person).length;
      if (anomalyDiff) {
        return anomalyDiff;
      }
      return a.memberIndex - b.memberIndex;
    });
    const searchedRows = searchQuery
      ? allRows.filter(({ person }) => ownerReviewTextMatches(ownerReviewSearchTextForPerson(person), searchQuery))
      : allRows;
    const groupRows = searchedRows.filter((row) => ownerReviewRowMatchesFilter(row, filter));
    const activeRows = groupRows.filter(({ person }) => (person.summary?.floorPlanActiveCount || 0) > 0);
    const idleRows = groupRows.filter(({ person }) => (person.summary?.floorPlanActiveCount || 0) <= 0);
    const allTotals = allRows.reduce(
      (acc, { person }) => {
        const summary = person.summary || {};
        acc.floorActive += summary.floorPlanActiveCount || 0;
        acc.floorDone += summary.floorPlanCompletedCount || 0;
        acc.displayActive += summary.displayActiveCount || 0;
        acc.displayDone += summary.displayCompletedCount || 0;
        acc.associated += summary.associatedProjectCount || 0;
        acc.occupied += (summary.floorPlanActiveCount || 0) > 0 ? 1 : 0;
        acc.anomaly += ownerReviewMemberAnomalies(person).length;
        acc.attention += (summary.floorPlanActiveCount || 0) >= 3 ? 1 : 0;
        acc.available += (summary.floorPlanActiveCount || 0) <= 2 && ownerReviewMemberAnomalies(person).length === 0 ? 1 : 0;
        acc.maxLoad = Math.max(acc.maxLoad, summary.floorPlanActiveCount || 0);
        return acc;
      },
      { floorActive: 0, floorDone: 0, displayActive: 0, displayDone: 0, associated: 0, occupied: 0, anomaly: 0, attention: 0, available: 0, maxLoad: 0 }
    );
    const totals = groupRows.reduce(
      (acc, { person }) => {
        const summary = person.summary || {};
        acc.floorActive += summary.floorPlanActiveCount || 0;
        acc.floorDone += summary.floorPlanCompletedCount || 0;
        acc.displayActive += summary.displayActiveCount || 0;
        acc.displayDone += summary.displayCompletedCount || 0;
        acc.associated += summary.associatedProjectCount || 0;
        return acc;
      },
      { floorActive: 0, floorDone: 0, displayActive: 0, displayDone: 0, associated: 0 }
    );
    const loadLevel = ownerReviewLoadLevel(allTotals.maxLoad);
    const searchHit = Boolean(searchQuery && groupRows.length);
    const open = searchHit;
    const suggestion =
      allTotals.anomaly > 0
        ? '需核数'
        : loadLevel.key === 'overloaded' || loadLevel.key === 'busy'
          ? '优先支援'
          : allTotals.available > 0
            ? '可承接'
            : '负载均衡';

    return {
      name: group.name || `直营${groupIndex + 1}组`,
      memberCount: group.members?.length || allRows.length,
      visibleMemberCount: groupRows.length,
      allRows,
      rows: groupRows,
      activeRows,
      idleRows,
      totals,
      allTotals,
      loadLevel,
      anomalyCount: allTotals.anomaly,
      attentionCount: allTotals.attention,
      availableCount: allTotals.available,
      searchHit,
      open,
      suggestion,
    };
  });
}


export function ownerReviewFloorProjectPreview(projects = [], searchQuery = state.ownerReviewSearchQuery) {
  if (!projects.length) {
    return '<strong>无当前平面</strong><small>可承接新平面任务</small>';
  }
  const visible = projects.slice(0, 2);
  const extra = Math.max(0, projects.length - visible.length);
  const names = visible.map((project) => project.projectName || '未命名项目').join('、');
  return `
    <strong>${ownerReviewHighlight(names, searchQuery)}${extra ? ` +${extra} 个` : ''}</strong>
    <small>${escapeHtml(visible.map((project) => project.status || '推进中').join(' / ') || '推进中')}</small>
  `;
}


export function ownerReviewFilterLabel(value = state.ownerReviewLoadFilter) {
  return {
    all: '全部成员',
    loaded: '有当前平面',
    idle: '空闲成员',
    attention: '偏高/过载',
    anomaly: '数据待核查',
  }[value] || '全部成员';
}


export function renderOwnerReviewLoadMeta(groups) {
  const visibleCount = groups.reduce((sum, group) => sum + group.visibleMemberCount, 0);
  const allCount = groups.reduce((sum, group) => sum + group.allRows.length, 0);
  const selectedGroup = ownerReviewSelectedLoadGroup(groups);
  const chips = [];
  if (state.ownerReviewSearchQuery) {
    chips.push(`找到 ${visibleCount} 个结果`);
  }
  if ((state.ownerReviewLoadFilter || 'all') !== 'all') {
    chips.push(`已筛选：${ownerReviewFilterLabel()} ${visibleCount} 人`);
  }
  if (!chips.length) {
    chips.push(`${selectedGroup ? `当前选中：${selectedGroup.name}` : '当前选中：暂无'} · ${allCount} 名成员`);
  }
  return `
    <div class="owner-review-load-meta">
      ${chips.map((chip) => `<span class="owner-review-filter-chip">${escapeHtml(chip)}</span>`).join('')}
    </div>
  `;
}


export function ownerReviewSelectedLoadGroup(groups = ownerReviewFloorLoadGroups()) {
  if (!groups.length) {
    state.ownerReviewSelectedGroup = '';
    return null;
  }
  const hasConstraint = Boolean(state.ownerReviewSearchQuery || (state.ownerReviewLoadFilter || 'all') !== 'all');
  const selected = state.ownerReviewSelectedGroup ? groups.find((group) => group.name === state.ownerReviewSelectedGroup) : null;
  if (selected && (!hasConstraint || selected.visibleMemberCount > 0)) {
    return selected;
  }
  const fallback = groups.find((group) => group.visibleMemberCount > 0) || groups[0];
  state.ownerReviewSelectedGroup = fallback?.name || '';
  return fallback || null;
}


export function renderOwnerReviewFloorRow(person, { idle = false } = {}) {
  const summary = person.summary || {};
  const floorActive = summary.floorPlanActiveCount || 0;
  const floorDone = summary.floorPlanCompletedCount || 0;
  const displayActive = summary.displayActiveCount || 0;
  const displayDone = summary.displayCompletedCount || 0;
  const associated = summary.associatedProjectCount || 0;
  const level = ownerReviewLoadLevel(floorActive);
  const anomalyCount = ownerReviewMemberAnomalies(person).length;
  const active = person.name === state.selectedOwnerReviewPerson;
  return `
    <button class="owner-review-floor-row${active ? ' is-active' : ''}${floorActive ? ' has-active-floor' : ''}${anomalyCount ? ' has-anomaly' : ''}${
      idle ? ' is-idle-floor' : ''
    }" type="button" data-owner-review-person="${escapeHtml(person.name)}">
      <span class="team-load-person">
        <strong>${ownerReviewHighlight(person.displayName || person.name, state.ownerReviewSearchQuery)}</strong>
        <small>${escapeHtml(person.groupName || '团队成员')}</small>
      </span>
      <span class="owner-review-load-level is-${escapeHtml(level.key)}">${escapeHtml(level.label)}</span>
      <span class="owner-review-floor-load">
        <b>${escapeHtml(floorActive)}</b>
        <small>当前平面</small>
      </span>
      <span class="owner-review-floor-projects">${ownerReviewFloorProjectPreview(person.floorPlan?.active || [])}</span>
      <span class="owner-review-floor-stats">
        <i><b>${escapeHtml(floorDone)}</b><span>平面完成</span></i>
        <i><b>摆场 ${escapeHtml(displayActive)}/${escapeHtml(displayDone)}</b><span>进行/完成</span></i>
        <i><b>${escapeHtml(associated)}</b><span>关联记录</span></i>
        <i class="${anomalyCount ? 'is-anomaly' : ''}"><b>${escapeHtml(anomalyCount)}</b><span>${anomalyCount ? '数据待核查' : '异常'}</span></i>
      </span>
    </button>
  `;
}


export function ownerReviewIdleGroupExpanded(groupName = '') {
  if (state.ownerReviewSearchQuery || (state.ownerReviewLoadFilter || 'all') === 'idle') {
    return true;
  }
  return Boolean(state.ownerReviewExpandedIdleGroups?.[groupName]);
}


export function renderOwnerReviewSelectedGroupPanel(group) {
  if (!group) {
    return renderEmptyState({
      title: '暂无可选直营组',
      description: '当前负责人没有可展示的团队成员平面负载。',
      compact: true,
    });
  }
  const idleCount = group.memberCount - group.allTotals.occupied;
  const headerState = group.allTotals.floorActive
    ? `当前 ${group.allTotals.floorActive} 项 · ${group.allTotals.occupied}/${group.memberCount} 人`
    : `暂无当前平面 · 0/${group.memberCount} 人`;
  const activeHtml = group.activeRows.length
    ? group.activeRows.map(({ person }) => renderOwnerReviewFloorRow(person)).join('')
    : `
      <div class="owner-review-load-group-empty">
        <strong>${group.visibleMemberCount ? '暂无当前平面负载' : '没有匹配成员'}</strong>
        <span>${group.visibleMemberCount ? '本组当前没有正在推进的平面方案。' : '试试清空搜索或筛选条件。'}</span>
      </div>
    `;
  const idleHtml = group.idleRows.length
    ? (() => {
        const idleExpanded = ownerReviewIdleGroupExpanded(group.name);
        return `
      <section class="owner-review-idle-strip${idleExpanded ? ' is-expanded' : ' is-collapsed'}">
        <button class="owner-review-idle-toggle" type="button" data-owner-review-idle-toggle="${escapeHtml(group.name)}" aria-expanded="${idleExpanded ? 'true' : 'false'}">
          <span>
            <b>无当前平面成员</b>
            <small>${escapeHtml(group.name)} · 历史完成与摆场统计</small>
          </span>
          <strong>${escapeHtml(group.idleRows.length)} 人</strong>
          <i>${idleExpanded ? '收起' : '展开'}</i>
        </button>
        ${
          idleExpanded
            ? `<div class="owner-review-idle-strip-body">
          ${group.idleRows.map(({ person }) => renderOwnerReviewFloorRow(person, { idle: true })).join('')}
        </div>`
            : ''
        }
      </section>
    `;
      })()
    : '';

  return `
    <section class="owner-review-selected-group" data-owner-review-selected-group="${escapeHtml(group.name)}">
      <header class="owner-review-selected-group-head">
        <div>
          <span>选中直营组</span>
          <h4>${escapeHtml(group.name)}</h4>
          <p>${escapeHtml(headerState)} · 占用 ${escapeHtml(group.allTotals.occupied)}/${escapeHtml(group.memberCount)} · 空载 ${escapeHtml(
            idleCount
          )} · 异常 ${escapeHtml(group.anomalyCount)}</p>
        </div>
        <em class="owner-review-load-level is-${escapeHtml(group.loadLevel.key)}">${escapeHtml(group.loadLevel.label)}</em>
      </header>
      <div class="owner-review-selected-group-kpis">
        <span><b>${escapeHtml(group.allTotals.floorActive)}</b><small>当前平面</small></span>
        <span><b>${escapeHtml(group.allTotals.occupied)}/${escapeHtml(group.memberCount)}</b><small>占用人数</small></span>
        <span><b>${escapeHtml(idleCount)}</b><small>空载</small></span>
        <span><b>${escapeHtml(group.attentionCount)}</b><small>偏高/过载</small></span>
        <span><b>${escapeHtml(group.anomalyCount)}</b><small>异常</small></span>
      </div>
      <div class="owner-review-selected-member-list">
        ${activeHtml}
        ${idleHtml}
      </div>
    </section>
  `;
}


export function renderOwnerReviewPersonRows(review = state.ownerReview) {
  if (!elements.ownerReviewPersonRows) {
    return;
  }
  const groups = ownerReviewFloorLoadGroups(review);
  const selectedGroup = ownerReviewSelectedLoadGroup(groups);
  const visibleCount = groups.reduce((sum, group) => sum + group.visibleMemberCount, 0);
  if (!groups.length) {
    const unmaintained = ownerReviewTeamRosterUnmaintained(review);
    elements.ownerReviewPersonRows.innerHTML = renderEmptyState({
      title: '暂无团队平面负载数据',
      description: unmaintained
        ? '当前没有可展示的团队成员平面负载；请先补齐团队成员，或切换负责人查看。未维护成员 roster 不代表该负责人没有项目或风险。'
        : `${teamOwnerDisplayName(review?.owner || resolveOwnerReviewOwner())}当前没有可展示的团队成员平面负载。`,
      compact: true,
    });
    return;
  }
  if (!visibleCount) {
    elements.ownerReviewPersonRows.innerHTML = `
      ${renderOwnerReviewLoadMeta(groups)}
      ${renderEmptyState({
        title: state.ownerReviewSearchQuery ? '搜索无命中' : '筛选后无结果',
        description: '没有匹配员工，试试清空搜索或筛选。',
        compact: true,
      })}
    `;
    return;
  }
  elements.ownerReviewPersonRows.innerHTML = `
    ${renderOwnerReviewLoadMeta(groups)}
    ${renderOwnerReviewSelectedGroupPanel(selectedGroup)}
  `;
}


export function ownerReviewCopySummaryText(member = ownerReviewMemberLoadByName(state.selectedOwnerReviewPerson)) {
  if (!member) {
    return '';
  }
  const summary = member.summary || {};
  const floorActive = summary.floorPlanActiveCount || 0;
  const level = ownerReviewLoadLevel(floorActive);
  const anomalies = ownerReviewMemberAnomalies(member).length;
  const sourceCount = ownerReviewSourceRows(member).filter((row) => row.basisClass !== 'anomaly').length;
  const action =
    level.key === 'overloaded'
      ? '建议优先支援或拆分承接'
      : level.key === 'busy'
        ? '建议关注承接节奏'
        : anomalies
          ? '建议先核对数据来源'
          : floorActive
            ? '建议保持当前节奏'
            : '建议作为可承接人手';
  const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return `${today}，${member.groupName || '团队成员'}${member.displayName || member.name}当前平面 ${floorActive} 个，负载等级 ${level.label}，平面完成 ${
    summary.floorPlanCompletedCount || 0
  } 个，摆场 ${summary.displayActiveCount || 0}/${summary.displayCompletedCount || 0}，来源记录 ${sourceCount} 条，${
    anomalies ? `数据待核查 ${anomalies} 条，` : ''
  }${action}。`;
}


export async function copyOwnerReviewSummary(member = ownerReviewMemberLoadByName(state.selectedOwnerReviewPerson)) {
  const text = ownerReviewCopySummaryText(member);
  if (!text) {
    return false;
  }
  try {
    await navigator.clipboard?.writeText(text);
    state.ownerReviewCopyMessage = '复盘摘要已复制';
    renderOwnerReviewDetailRows(state.ownerReview, { intoModal: true });
    return true;
  } catch {
    state.ownerReviewCopyMessage = '复制失败，请手动选择摘要文本';
    renderOwnerReviewDetailRows(state.ownerReview, { intoModal: true });
    return false;
  }
}


export function ownerReviewDecisionStats(groups = ownerReviewFloorLoadGroups(), review = state.ownerReview) {
  const rows = groups.flatMap((group) => group.allRows || []);
  const urgentRows = rows.filter(({ person }) => (person.summary?.floorPlanActiveCount || 0) >= 5);
  const availableRows = rows.filter(({ person }) => {
    const load = person.summary?.floorPlanActiveCount || 0;
    return load <= 2 && ownerReviewMemberAnomalies(person).length === 0;
  });
  const highRiskGroup = groups
    .slice()
    .sort((a, b) => {
      const riskDiff = (b.attentionCount + b.anomalyCount) - (a.attentionCount + a.anomalyCount);
      if (riskDiff) {
        return riskDiff;
      }
      return (b.allTotals?.floorActive || 0) - (a.allTotals?.floorActive || 0);
    })[0];
  const reviewAnomalies = ownerReviewReviewAnomalies(review);
  const anomalyCount = groups.reduce((sum, group) => sum + (group.anomalyCount || 0), 0) + reviewAnomalies.length;
  return {
    urgentRows,
    availableRows,
    highRiskGroup,
    anomalyCount,
    reviewAnomalies,
  };
}


export function ownerReviewDecisionMemberRowsHtml(rows = [], { emptyTitle = '暂无需要展示的成员', audit = false } = {}) {
  if (!rows.length) {
    return renderEmptyState({ title: emptyTitle, compact: true });
  }
  return `
    <div class="owner-review-decision-member-list">
      ${rows
        .map(({ person }) => {
          const summary = person.summary || {};
          const level = ownerReviewLoadLevel(summary.floorPlanActiveCount || 0);
          const anomalies = ownerReviewMemberAnomalies(person);
          const previewProjects = [
            ...(person.floorPlan?.active || []),
            ...(person.floorPlan?.completed || []),
            ...(person.display?.active || []),
          ]
            .map((item) => item.projectName || item.projectId || '')
            .filter(Boolean)
            .slice(0, 2)
            .join('、');
          return `
            <button class="owner-review-decision-member" type="button" data-owner-review-decision-person="${escapeHtml(person.name)}">
              <span>
                <strong>${escapeHtml(person.displayName || person.name)}</strong>
                <small>${escapeHtml(person.groupName || '团队成员')}</small>
              </span>
              <em class="owner-review-load-level is-${escapeHtml(level.key)}">${escapeHtml(level.label)}</em>
              <b>${escapeHtml(summary.floorPlanActiveCount || 0)}</b>
              <p>${escapeHtml(
                audit && anomalies.length
                  ? anomalies.map((item) => item.message || item.type || '数据待核查').join('；')
                  : previewProjects || '暂无当前平面项目'
              )}</p>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}


export function ownerReviewReviewAnomalyRowsHtml(anomalies = []) {
  if (!anomalies.length) {
    return '';
  }
  return `
    <div class="owner-review-decision-member-list is-review-anomalies">
      ${anomalies
        .map(
          (item) => `
            <article class="owner-review-decision-member is-audit-record">
              <span>
                <strong>${escapeHtml(item.personName || item.sourceName || item.type || '数据待核查')}</strong>
                <small>${escapeHtml([item.projectName || item.projectId || '团队级核对', item.type || ''].filter(Boolean).join(' · '))}</small>
              </span>
              <em class="owner-review-load-level is-busy">${escapeHtml(item.severity || '需要核对')}</em>
              <b>${escapeHtml(item.sourceField || '字段')}</b>
              <p>${escapeHtml(item.message || '该记录需要核对来源后再用于管理判断。')}</p>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}


export function ownerReviewAuditDecisionBodyHtml(memberRows = [], reviewAnomalies = []) {
  if (!memberRows.length && !reviewAnomalies.length) {
    return renderEmptyState({ title: '暂无数据异常', compact: true });
  }
  return [
    memberRows.length ? ownerReviewDecisionMemberRowsHtml(memberRows, { audit: true }) : '',
    ownerReviewReviewAnomalyRowsHtml(reviewAnomalies),
  ].join('');
}


export function ownerReviewDecisionModalHtml(decision = 'urgent', review = state.ownerReview) {
  const groups = ownerReviewFloorLoadGroups(review);
  const stats = ownerReviewDecisionStats(groups, review);
  const rows = groups.flatMap((group) => group.allRows || []);
  const auditMemberRows = rows.filter(({ person }) => ownerReviewMemberAnomalies(person).length > 0);
  const decisionMap = {
    urgent: {
      title: '需立即干预',
      subtitle: '过载成员优先复盘，适合马上安排支援、拆分或重新分配。',
      count: stats.urgentRows.length,
      body: ownerReviewDecisionMemberRowsHtml(stats.urgentRows, { emptyTitle: '暂无过载成员' }),
    },
    available: {
      title: '可调配人手',
      subtitle: '空闲或正常且无异常的成员，可作为承接或支援候选。',
      count: stats.availableRows.length,
      body: ownerReviewDecisionMemberRowsHtml(stats.availableRows, { emptyTitle: '暂无可调配成员' }),
    },
    audit: {
      title: '数据待核对',
      subtitle: '先核对来源字段、状态冲突和重复关联，不在前端改写业务口径。',
      count: stats.anomalyCount,
      body: ownerReviewAuditDecisionBodyHtml(auditMemberRows, stats.reviewAnomalies || []),
    },
    risk: {
      title: '高风险组',
      subtitle: stats.highRiskGroup ? `${stats.highRiskGroup.name} · ${stats.highRiskGroup.suggestion}` : '暂无高风险组',
      count: stats.highRiskGroup ? 1 : 0,
      body: stats.highRiskGroup
        ? `
          <section class="owner-review-decision-group-card">
            <header>
              <span>建议关注组</span>
              <strong>${escapeHtml(stats.highRiskGroup.name)}</strong>
              <em class="owner-review-load-level is-${escapeHtml(stats.highRiskGroup.loadLevel.key)}">${escapeHtml(stats.highRiskGroup.loadLevel.label)}</em>
            </header>
            <div class="owner-review-selected-group-kpis">
              <span><b>${escapeHtml(stats.highRiskGroup.allTotals.floorActive)}</b><small>当前平面</small></span>
              <span><b>${escapeHtml(stats.highRiskGroup.allTotals.occupied)}/${escapeHtml(stats.highRiskGroup.memberCount)}</b><small>占用人数</small></span>
              <span><b>${escapeHtml(stats.highRiskGroup.memberCount - stats.highRiskGroup.allTotals.occupied)}</b><small>空载</small></span>
              <span><b>${escapeHtml(stats.highRiskGroup.attentionCount)}</b><small>偏高/过载</small></span>
              <span><b>${escapeHtml(stats.highRiskGroup.anomalyCount)}</b><small>异常</small></span>
            </div>
            ${ownerReviewDecisionMemberRowsHtml(stats.highRiskGroup.allRows || [], { emptyTitle: '本组暂无成员' })}
          </section>
        `
        : renderEmptyState({ title: '暂无高风险组', compact: true }),
    },
  };
  const config = decisionMap[decision] || decisionMap.urgent;
  return `
    <section class="owner-review-decision-modal-head">
      <span>今日决策摘要</span>
      <h3 id="ownerReviewDecisionModalTitle">${escapeHtml(config.title)}</h3>
      <p>${escapeHtml(config.subtitle)}</p>
    </section>
    <section class="owner-review-decision-modal-count">
      <b>${escapeHtml(config.count)}</b>
      <span>条需要查看的信息</span>
    </section>
    ${config.body}
  `;
}


export function openOwnerReviewDecisionModal(decision = 'urgent') {
  if (!elements.ownerReviewDecisionModal || !elements.ownerReviewDecisionModalBody) {
    return;
  }
  state.ownerReviewDecisionModalType = decision || 'urgent';
  elements.ownerReviewDecisionModalBody.innerHTML = ownerReviewDecisionModalHtml(state.ownerReviewDecisionModalType, state.ownerReview);
  elements.ownerReviewDecisionModal.hidden = false;
  elements.ownerReviewDecisionModal.querySelector?.('[data-owner-review-decision-close]')?.focus?.();
}


export function closeOwnerReviewDecisionModal() {
  if (!elements.ownerReviewDecisionModal) {
    return;
  }
  elements.ownerReviewDecisionModal.hidden = true;
  state.ownerReviewDecisionModalType = '';
}


export function renderOwnerReviewDecisionSummary(review = state.ownerReview) {
  if (!elements.ownerReviewDecisionSummary) {
    return;
  }
  const groups = ownerReviewFloorLoadGroups(review);
  const stats = ownerReviewDecisionStats(groups, review);
  const highRiskText = stats.highRiskGroup
    ? `${stats.highRiskGroup.name} · ${stats.highRiskGroup.suggestion}`
    : '暂无高风险组';
  const cards = [
    {
      key: 'urgent',
      label: '需立即干预',
      value: stats.urgentRows.length,
      unit: '人',
      note: stats.urgentRows.length ? '过载成员优先复盘' : '暂无立即干预项',
      tone: stats.urgentRows.length ? 'hot' : 'calm',
    },
    {
      key: 'available',
      label: '可调配人手',
      value: stats.availableRows.length,
      unit: '人',
      note: '空闲或正常且无异常',
      tone: 'ready',
    },
    {
      key: 'risk',
      label: '高风险组',
      value: stats.highRiskGroup?.name || '--',
      unit: '',
      note: highRiskText,
      tone: stats.highRiskGroup?.attentionCount || stats.highRiskGroup?.anomalyCount ? 'hot' : 'calm',
    },
    {
      key: 'audit',
      label: '数据待核对',
      value: stats.anomalyCount,
      unit: '条',
      note: stats.anomalyCount ? '先核对来源字段' : '暂无数据异常',
      tone: stats.anomalyCount ? 'check' : 'calm',
    },
  ];
  elements.ownerReviewDecisionSummary.innerHTML = `
    <header>
      <span>今日决策摘要</span>
      <strong>${escapeHtml(teamOwnerDisplayName(review?.owner || resolveOwnerReviewOwner()))}</strong>
    </header>
    <div class="owner-review-decision-grid">
      ${cards
        .map(
          (card) => `
            <button class="owner-review-decision-card is-${escapeHtml(card.tone)}" type="button" data-owner-review-decision="${escapeHtml(card.key)}">
              <span>${escapeHtml(card.label)}</span>
              <strong>${escapeHtml(card.value)}${card.unit ? `<small>${escapeHtml(card.unit)}</small>` : ''}</strong>
              <em>${escapeHtml(card.note)}</em>
            </button>
          `
        )
        .join('')}
    </div>
  `;
}


export function renderOwnerReviewGroupMatrix(review = state.ownerReview) {
  if (!elements.ownerReviewGroupMatrix) {
    return;
  }
  const groups = ownerReviewFloorLoadGroups(review);
  const selectedGroup = ownerReviewSelectedLoadGroup(groups);
  if (!groups.length) {
    elements.ownerReviewGroupMatrix.innerHTML = '';
    return;
  }
  elements.ownerReviewGroupMatrix.innerHTML = `
    <header>
      <span>组间对比</span>
      <strong>默认折叠前先横向扫 4 个直营组</strong>
    </header>
    <div class="owner-review-group-matrix-grid" role="table" aria-label="直营组负载对比">
      <div class="owner-review-group-matrix-head" role="row">
        <span>直营组</span>
        <span>负载等级</span>
        <span>当前平面</span>
        <span>占用人数</span>
        <span>空闲人数</span>
        <span>偏高/过载</span>
        <span>异常</span>
        <span>可承接</span>
        <span>建议关注</span>
      </div>
      ${groups
        .map(
          (group) => {
            const selectedClass = selectedGroup?.name === group.name ? ' is-selected' : '';
            return `
            <button class="owner-review-group-matrix-row is-${escapeHtml(group.loadLevel.key)}${selectedClass}" type="button" data-owner-review-group="${escapeHtml(
              group.name
            )}" role="row" aria-pressed="${selectedGroup?.name === group.name ? 'true' : 'false'}">
              <span>${escapeHtml(group.name)}</span>
              <span><em class="owner-review-load-level is-${escapeHtml(group.loadLevel.key)}">${escapeHtml(group.loadLevel.label)}</em></span>
              <span>${escapeHtml(group.allTotals.floorActive)}</span>
              <span>${escapeHtml(group.allTotals.occupied)}/${escapeHtml(group.memberCount)}</span>
              <span>${escapeHtml(group.memberCount - group.allTotals.occupied)}</span>
              <span>${escapeHtml(group.attentionCount)}</span>
              <span>${escapeHtml(group.anomalyCount)}</span>
              <span>${escapeHtml(group.availableCount)}</span>
              <span>${escapeHtml(group.suggestion)}</span>
            </button>
          `;
          }
        )
        .join('')}
    </div>
  `;
}


export function renderOwnerReviewRulebook() {
  if (!elements.ownerReviewRulebook) {
    return;
  }
  elements.ownerReviewRulebook.innerHTML = `
    <details>
      <summary>
        <span>口径说明</span>
        <strong>当前平面计入负载，摆场 / 历史完成 / 关联记录只做统计</strong>
      </summary>
      <div class="owner-review-rulebook-body">
        <article>
          <h4>负载等级</h4>
          <p>空闲：当前平面 = 0；正常：1-2；偏高：3-4；过载：>= 5。所有等级都以文字标签展示，不只依赖颜色。</p>
        </article>
        <article>
          <h4>计入口径</h4>
          <p>只有当前未完成的平面方案计入当前负载；平面完成进入历史完成，摆场只做统计，缺设计师证据的摆场责任人进入待核对。</p>
        </article>
        <article>
          <h4>数据待核查</h4>
          <p>来源字段缺失、状态冲突、重复关联或同步时间未提供时，页面优先暴露问题，不自动替业务做责任裁决。</p>
        </article>
      </div>
    </details>
  `;
}


export function syncOwnerReviewLoadControls() {
  if (elements.ownerReviewSearchInput) {
    elements.ownerReviewSearchInput.value = state.ownerReviewSearchQuery || '';
  }
  if (elements.ownerReviewLoadFilter) {
    elements.ownerReviewLoadFilter.value = state.ownerReviewLoadFilter || 'all';
    renderFilterSelect(elements.ownerReviewLoadFilter);
  }
}


export function ownerReviewItemStatusLabel(item) {
  if (item.state?.openDelayed) {
    return '延期未闭环';
  }
  if (item.state?.delayedCompletedThisMonth) {
    return '延期完成';
  }
  if (item.state?.completedThisMonth) {
    return '准时/已完成';
  }
  if (item.state?.missingCompletionDate) {
    return '缺完成时间';
  }
  return item.state?.status || '推进中';
}


export function ownerReviewFloorDetailModalHtml(selected, rowsHtml) {
  const summary = selected.summary || {};
  const anomalies = ownerReviewMemberAnomalies(selected).length;
  const copySummary = ownerReviewCopySummaryText(selected);
  return `
    <section class="owner-review-member-modal-head owner-review-floor-detail-modal-head">
      <span>${escapeHtml(selected.groupName || '团队成员')}</span>
      <h3 id="ownerReviewMemberTitle">平面负载来源详情</h3>
      <p>${escapeHtml(selected.displayName || selected.name)} · 当前平面 ${escapeHtml(
        summary.floorPlanActiveCount || 0
      )} 项，平面完成 ${escapeHtml(summary.floorPlanCompletedCount || 0)} 项；摆场 ${escapeHtml(
        summary.displayActiveCount || 0
      )}/${escapeHtml(summary.displayCompletedCount || 0)} 仅做统计${anomalies ? `；数据待核查 ${escapeHtml(anomalies)} 条` : ''}</p>
    </section>
    <section class="owner-review-member-summary owner-review-floor-detail-summary">
      <span><b>${escapeHtml(summary.floorPlanActiveCount || 0)}</b><small>当前平面</small></span>
      <span><b>${escapeHtml(summary.floorPlanCompletedCount || 0)}</b><small>平面完成</small></span>
      <span><b>${escapeHtml(`${summary.displayActiveCount || 0}/${summary.displayCompletedCount || 0}`)}</b><small>摆场进行/完成</small></span>
      <span><b>${escapeHtml(summary.associatedProjectCount || 0)}</b><small>关联记录</small></span>
      <span><b>${escapeHtml(anomalies)}</b><small>数据待核查</small></span>
    </section>
    <section class="owner-review-floor-detail-list">
      <div class="owner-review-detail-head" aria-hidden="true">
        <span>项目</span>
        <span>来源模块</span>
        <span>计入口径</span>
        <span>状态</span>
        <span>完成时间</span>
      </div>
      <div class="owner-review-detail-rows">${rowsHtml}</div>
    </section>
    <section class="owner-review-modal-actions">
      <button type="button" data-owner-review-copy-summary>复制复盘摘要</button>
      <p>${escapeHtml(copySummary)}</p>
      ${state.ownerReviewCopyMessage ? `<span>${escapeHtml(state.ownerReviewCopyMessage)}</span>` : ''}
    </section>
  `;
}


export function renderOwnerReviewDetailRows(review = state.ownerReview, { intoModal = false } = {}) {
  const target = intoModal ? elements.ownerReviewMemberModalBody : elements.ownerReviewDetailRows;
  if (!target) {
    return;
  }
  const rows = ownerReviewFloorLoadRows(review);
  const selected =
    rows.find((row) => row.person.name === state.selectedOwnerReviewPerson)?.person ||
    rows.find((row) => (row.person.summary?.floorPlanActiveCount || 0) > 0)?.person ||
    rows[0]?.person ||
    null;
  if (!selected) {
    target.innerHTML = renderEmptyState({
      title: '暂无平面负载来源详情',
      description: ownerReviewTeamRosterUnmaintained(review)
        ? '暂无成员负载来源。未维护成员 roster 不代表该负责人没有项目或风险。'
        : '',
      compact: true,
    });
    setPanelInsight(elements.ownerReviewDetailInsight, '');
    return;
  }
  const floorActive = selected.summary?.floorPlanActiveCount || 0;
  const floorDone = selected.summary?.floorPlanCompletedCount || 0;
  const displayActive = selected.summary?.displayActiveCount || 0;
  const displayDone = selected.summary?.displayCompletedCount || 0;
  const anomalies = ownerReviewMemberAnomalies(selected).length;
  setPanelInsight(
    elements.ownerReviewDetailInsight,
    `${selected.displayName || selected.name} · 当前平面 ${floorActive} 项，平面完成 ${floorDone} 项；摆场 ${displayActive}/${displayDone} 仅做统计${anomalies ? `；数据待核查 ${anomalies} 条` : ''}`
  );
  const items = ownerReviewSourceRows(selected);
  if (!items.length) {
    target.innerHTML = renderEmptyState({
      title: '暂无该成员平面负载来源',
      description: '该成员暂无计入当前负载的平面来源，摆场和历史完成仍会在有数据时保留。',
      compact: true,
    });
    if (intoModal) {
      target.innerHTML = ownerReviewFloorDetailModalHtml(selected, target.innerHTML);
    }
    return;
  }
  target.innerHTML = items
    .map(
      (item) => {
        const status = item.status || ownerReviewMemberStateLabel(item.state);
        const completedAt = item.completedAt || item.stateDetail?.completedAt || '';
        const projectName = item.projectName || '来源待补充';
        const roleLabel = [item.personName, item.roleLabel || (item.roleLabels || []).join('、')].filter(Boolean).join(' · ') || item.owner || '来源待补充';
        return `
        <button class="owner-review-detail-row is-${escapeHtml(item.discipline)} is-basis-${escapeHtml(item.basisClass || 'associated')}" type="button" data-owner-review-project-id="${escapeHtml(
          item.projectId
        )}" data-owner-review-project-name="${escapeHtml(projectName)}" data-owner-review-person="${escapeHtml(
          item.personName
        )}" data-owner-review-delivery="${escapeHtml(item.basisLabel || item.deliveryLabel)}" data-owner-review-status="${escapeHtml(status)}">
          <span title="${escapeHtml(projectName)}"><strong>${escapeHtml(projectName)}</strong><small>${escapeHtml(item.owner || item.excludedReason || '来源待补充')}</small></span>
          <span title="${escapeHtml(roleLabel)}">${escapeHtml(item.moduleLabel || item.deliveryLabel || '--')}<small>${escapeHtml(roleLabel)}</small></span>
          <span title="${escapeHtml(item.excludedReason || item.basisLabel || '')}" class="owner-review-source-basis is-${escapeHtml(item.basisClass || 'associated')}">${escapeHtml(item.basisLabel || '仅关联记录')}</span>
          <span title="${escapeHtml(status)}" class="owner-review-status">${escapeHtml(status)}</span>
          <span title="${escapeHtml(completedAt || '--')}">${escapeHtml(completedAt || '--')}</span>
        </button>
      `;
      }
    )
    .join('');
  if (intoModal) {
    target.innerHTML = ownerReviewFloorDetailModalHtml(selected, target.innerHTML);
  }
}


export function ownerReviewMemberLoadByName(name, review = state.ownerReview) {
  const target = String(name || '').trim();
  if (!target) {
    return null;
  }
  return (
    (review?.memberLoads || []).find((member) => member.name === target || member.displayName === target) ||
    null
  );
}


export function ownerReviewMemberStateLabel(value = '') {
  return {
    active: '正在进行',
    completed: '历史完成',
    associated: '仅关联',
  }[value] || '关联';
}


export function ownerReviewMemberFilterLabel(value = '') {
  return {
    all: '全部',
    active: '正在进行',
    completed: '历史完成',
  }[value] || '全部';
}


export function ownerReviewMemberFilteredProjects(member) {
  const projects = member?.associatedProjects || [];
  const filter = state.ownerReviewMemberFilter || 'all';
  if (filter === 'active') {
    return projects.filter((project) => project.state === 'active');
  }
  if (filter === 'completed') {
    return projects.filter((project) => project.state === 'completed');
  }
  return projects;
}


export function renderOwnerReviewMemberMiniRows(items = [], emptyTitle) {
  if (!items.length) {
    return `<div class="owner-review-member-module-empty">${escapeHtml(emptyTitle)}</div>`;
  }
  return items
    .map(
      (item) => `
        <button class="owner-review-member-mini-row is-${escapeHtml(item.state)}" type="button" data-owner-review-member-project-id="${escapeHtml(
          item.projectId
        )}" data-owner-review-member-project-name="${escapeHtml(item.projectName)}">
          <span><strong>${escapeHtml(item.projectName)}</strong><small>${escapeHtml(item.owner || '--')}</small></span>
          <span>${escapeHtml(item.status || ownerReviewMemberStateLabel(item.state))}</span>
        </button>
      `
    )
    .join('');
}


export function renderOwnerReviewMemberModule(title, module = {}, emptyTitle) {
  const active = module.active || [];
  const completed = module.completed || [];
  return `
    <section class="owner-review-member-module">
      <header>
        <span>${escapeHtml(title)}</span>
        <strong>进行 ${escapeHtml(active.length)} · 完成 ${escapeHtml(completed.length)}</strong>
      </header>
      <div class="owner-review-member-module-rows">
        ${renderOwnerReviewMemberMiniRows(active, emptyTitle)}
      </div>
    </section>
  `;
}


export function renderOwnerReviewMemberFilterButton(filter, count) {
  const active = (state.ownerReviewMemberFilter || 'all') === filter;
  return `
    <button class="${active ? 'is-active' : ''}" type="button" data-owner-review-member-filter="${escapeHtml(filter)}">
      ${escapeHtml(ownerReviewMemberFilterLabel(filter))}
      <b>${escapeHtml(count)}</b>
    </button>
  `;
}


export function renderOwnerReviewMemberProjectRows(member) {
  const projects = ownerReviewMemberFilteredProjects(member);
  if (!projects.length) {
    return renderEmptyState({
      title: `${ownerReviewMemberFilterLabel(state.ownerReviewMemberFilter)}项目为空`,
      compact: true,
    });
  }
  return projects
    .map(
      (project) => `
        <button class="owner-review-member-project-row is-${escapeHtml(project.state)}" type="button" data-owner-review-member-project-id="${escapeHtml(
          project.projectId
        )}" data-owner-review-member-project-name="${escapeHtml(project.projectName)}">
          <span>
            <strong>${escapeHtml(project.projectName)}</strong>
            <small>${escapeHtml([project.owner, ...(project.roleLabels || [])].filter(Boolean).join(' · ') || '--')}</small>
          </span>
          <span>${escapeHtml(ownerReviewMemberStateLabel(project.state))}</span>
        </button>
      `
    )
    .join('');
}


export function renderOwnerReviewMemberModal() {
  if (!elements.ownerReviewMemberModal || !elements.ownerReviewMemberModalBody) {
    return;
  }
  const member = ownerReviewMemberLoadByName(state.selectedOwnerReviewMember);
  if (!member) {
    elements.ownerReviewMemberModalBody.innerHTML = renderEmptyState({
      title: '暂无成员负载详情',
      compact: true,
    });
    return;
  }
  const summary = member.summary || {};
  const associatedProjects = member.associatedProjects || [];
  const activeCount = associatedProjects.filter((project) => project.state === 'active').length;
  const completedCount = associatedProjects.filter((project) => project.state === 'completed').length;
  elements.ownerReviewMemberModalBody.innerHTML = `
    <section class="owner-review-member-modal-head">
      <span>${escapeHtml(member.groupName || '团队成员')}</span>
      <h3 id="ownerReviewMemberTitle">${escapeHtml(member.displayName || member.name)}</h3>
      <p>按成员姓名在全公司项目设计师字段查询，负责人切换只决定团队花名册。</p>
    </section>
    <section class="owner-review-member-summary">
      <span><b>${escapeHtml(summary.activeProjectCount || 0)}</b><small>正在进行</small></span>
      <span><b>${escapeHtml(summary.completedProjectCount || 0)}</b><small>历史完成</small></span>
      <span><b>${escapeHtml(summary.floorPlanActiveCount || 0)}</b><small>当前平面</small></span>
      <span><b>${escapeHtml(summary.displayActiveCount || 0)}</b><small>当前摆场</small></span>
      <span><b>${escapeHtml(summary.associatedProjectCount || 0)}</b><small>关联项目</small></span>
    </section>
    <section class="owner-review-member-modules">
      ${renderOwnerReviewMemberModule('当前平面方案', member.floorPlan, '暂无当前平面方案')}
      ${renderOwnerReviewMemberModule('当前摆场', member.display, '暂无当前正在进行的摆场')}
    </section>
    <section class="owner-review-member-projects">
      <header>
        <div>
          <span>关联项目</span>
          <strong>${escapeHtml(ownerReviewMemberFilterLabel(state.ownerReviewMemberFilter))}</strong>
        </div>
        <div class="owner-review-member-filterbar" role="group" aria-label="成员关联项目筛选">
          ${renderOwnerReviewMemberFilterButton('all', associatedProjects.length)}
          ${renderOwnerReviewMemberFilterButton('active', activeCount)}
          ${renderOwnerReviewMemberFilterButton('completed', completedCount)}
        </div>
      </header>
      <div class="owner-review-member-project-list">
        ${renderOwnerReviewMemberProjectRows(member)}
      </div>
    </section>
  `;
}


export function renderOwnerReviewRefreshBadge() {
  if (state.ownerReviewRefreshStatus === 'refreshing') {
    return `
      <span class="team-refresh-chip">
        <span class="team-refresh-dot" aria-hidden="true"></span>
        后台刷新中
      </span>
    `;
  }
  if (state.ownerReviewRefreshStatus === 'stale') {
    return `
      <span class="team-refresh-chip is-warning" title="${escapeHtml(state.ownerReviewRefreshError || '')}">
        刷新失败，沿用缓存
      </span>
    `;
  }
  return '';
}


export function openOwnerReviewMemberModal(name) {
  const nextName = String(name || '').trim();
  if (!nextName || !elements.ownerReviewMemberModal) {
    return;
  }
  state.ownerReviewMemberModalMode = 'member';
  elements.ownerReviewMemberModal.classList.remove('is-floor-detail');
  if (state.selectedOwnerReviewMember !== nextName) {
    state.ownerReviewMemberFilter = 'all';
  }
  state.selectedOwnerReviewMember = nextName;
  renderOwnerReviewMemberModal();
  elements.ownerReviewMemberModal.hidden = false;
}


export function openOwnerReviewFloorDetailModal(name) {
  const nextName = String(name || '').trim();
  if (!nextName || !elements.ownerReviewMemberModal) {
    return;
  }
  state.ownerReviewMemberModalMode = 'floorDetail';
  state.selectedOwnerReviewPerson = nextName;
  state.selectedOwnerReviewMember = '';
  elements.ownerReviewMemberModal.classList.add('is-floor-detail');
  renderOwnerReviewPersonRows(state.ownerReview);
  renderOwnerReviewDetailRows(state.ownerReview, { intoModal: true });
  elements.ownerReviewMemberModal.hidden = false;
}


export function closeOwnerReviewMemberModal() {
  if (elements.ownerReviewMemberModal) {
    elements.ownerReviewMemberModal.hidden = true;
    elements.ownerReviewMemberModal.classList.remove('is-floor-detail');
  }
}


function ownerReviewMatchesOwner(review = null, owner = '') {
  const requestedOwner = String(owner || '').trim();
  if (!review || !requestedOwner) {
    return false;
  }
  return [
    review.owner,
    review.requestedOwner,
    review.team?.owner,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .includes(requestedOwner);
}


function clearStaleOwnerReviewForCurrentOwner() {
  const owner = resolveOwnerReviewOwner() || state.selectedTeamOwner || '';
  const review = state.ownerReview;
  if (!review?.owner || !owner || ownerReviewMatchesOwner(review, owner)) {
    return false;
  }
  state.ownerReview = null;
  state.ownerReviewLoading = true;
  state.ownerReviewError = '';
  state.ownerReviewRefreshStatus = 'switching';
  state.ownerReviewRefreshError = '';
  state.selectedOwnerReviewPerson = '';
  state.selectedOwnerReviewMember = '';
  return true;
}


export function renderOwnerReviewDashboard() {
  clearStaleOwnerReviewForCurrentOwner();
  ensureOwnerReviewControls();
  renderOwnerReviewTeamStructure();
  syncOwnerReviewLoadControls();
  const ownerName = teamOwnerDisplayName(resolveOwnerReviewOwner());
  if (state.ownerReviewLoading) {
    renderOwnerReviewTeamStructureStatus(
      '正在读取团队负载',
      ownerName ? `${ownerName} 的成员负载加载中。` : '团队负载加载中。'
    );
    elements.ownerReviewTitle.textContent = '团队负载工作台';
    elements.ownerReviewHeadline.innerHTML = `
      <span class="team-refresh-chip">
        <span class="team-refresh-dot" aria-hidden="true"></span>
        ${escapeHtml(ownerName ? `正在刷新 ${ownerName}` : '正在刷新团队负载')}
      </span>
    `;
    elements.ownerReviewHeroStats.innerHTML = [
      renderTeamHeroStat('参与人员', '刷新中'),
      renderTeamHeroStat('外部支援', '刷新中'),
      renderTeamHeroStat('本团队外借', '刷新中'),
    ].join('');
    if (elements.ownerReviewResponsibilityMatrix) {
      elements.ownerReviewResponsibilityMatrix.innerHTML = renderEmptyState({ title: '正在读取执行负载数据', compact: true });
    }
    if (elements.ownerReviewDecisionSummary) {
      elements.ownerReviewDecisionSummary.innerHTML = renderEmptyState({ title: '正在生成今日决策摘要', compact: true });
    }
    if (elements.ownerReviewGroupMatrix) {
      elements.ownerReviewGroupMatrix.innerHTML = '';
    }
    if (elements.ownerReviewRulebook) {
      elements.ownerReviewRulebook.innerHTML = '';
    }
    elements.ownerReviewPersonRows.innerHTML = '';
    if (elements.ownerReviewDetailRows) {
      elements.ownerReviewDetailRows.innerHTML = '';
    }
    return;
  }
  if (state.ownerReviewError) {
    renderOwnerReviewTeamStructureStatus('团队负载加载失败', ownerReviewLoadErrorDescription());
    elements.ownerReviewHeadline.textContent = '';
    elements.ownerReviewHeroStats.innerHTML = '';
    if (elements.ownerReviewResponsibilityMatrix) {
      elements.ownerReviewResponsibilityMatrix.innerHTML = renderEmptyState({
        title: '团队负载加载失败',
        description: ownerReviewLoadErrorDescription(),
        compact: true,
      });
    }
    if (elements.ownerReviewDecisionSummary) {
      elements.ownerReviewDecisionSummary.innerHTML = renderEmptyState({
        title: '团队负载同步失败',
        description: ownerReviewLoadErrorDescription('保留旧数据时请优先核对最后一次成功同步时间。'),
        compact: true,
      });
    }
    if (elements.ownerReviewGroupMatrix) {
      elements.ownerReviewGroupMatrix.innerHTML = '';
    }
    if (elements.ownerReviewRulebook) {
      renderOwnerReviewRulebook();
    }
    elements.ownerReviewPersonRows.innerHTML = '';
    if (elements.ownerReviewDetailRows) {
      elements.ownerReviewDetailRows.innerHTML = '';
    }
    return;
  }
  const review = state.ownerReview;
  if (!review?.owner) {
    renderOwnerReviewTeamStructureStatus('暂无负责人数据', '请选择负责人后查看团队负载。');
    elements.ownerReviewHeadline.textContent = '';
    elements.ownerReviewHeroStats.innerHTML = '';
    if (elements.ownerReviewResponsibilityMatrix) {
      elements.ownerReviewResponsibilityMatrix.innerHTML = renderEmptyState({
        title: '暂无负责人数据',
        description: '请选择负责人后查看团队负载。',
        compact: true,
      });
    }
    if (elements.ownerReviewDecisionSummary) {
      elements.ownerReviewDecisionSummary.innerHTML = renderEmptyState({
        title: '暂无负责人数据',
        description: '请选择负责人后查看今日决策摘要。',
        compact: true,
      });
    }
    if (elements.ownerReviewGroupMatrix) {
      elements.ownerReviewGroupMatrix.innerHTML = '';
    }
    if (elements.ownerReviewRulebook) {
      renderOwnerReviewRulebook();
    }
    elements.ownerReviewPersonRows.innerHTML = '';
    if (elements.ownerReviewDetailRows) {
      elements.ownerReviewDetailRows.innerHTML = '';
    }
    setPanelInsight(elements.ownerReviewMatrixInsight, '');
    setPanelInsight(elements.ownerReviewPeopleInsight, '');
    setPanelInsight(elements.ownerReviewDetailInsight, '');
    return;
  }

  const visibleReview = ownerReviewVisibleReview(review);
  const loadReview = review;
  const loadModel = ownerReviewStructureLoadModel(loadReview);
  const loadGroups = ownerReviewFloorLoadGroups(loadReview);
  const loadStats = ownerReviewDecisionStats(loadGroups, loadReview);
  renderOwnerReviewTeamStructure(loadReview);
  elements.ownerReviewTitle.textContent = `${teamOwnerDisplayName(review.owner)} · 团队负载情况`;
  elements.ownerReviewHeadline.innerHTML = `${renderOwnerReviewHeroSummary(visibleReview)}${renderOwnerReviewRefreshBadge()}`;
  elements.ownerReviewHeroStats.innerHTML = [
    renderTeamHeroStat('参与人员', loadModel.peopleCount || visibleReview.summary?.peopleCount || 0),
    renderTeamHeroStat('当前平面', loadModel.totalLoad || 0),
    renderTeamHeroStat('可调配人手', loadStats.availableRows?.length || 0, { tone: loadStats.availableRows?.length ? '' : 'muted' }),
  ].join('');
  setPanelInsight(
    elements.ownerReviewPeopleInsight,
    '负载只统计当前平面方案；摆场仅保留进行/完成数量，不叠加到负载。'
  );
  renderOwnerReviewDecisionSummary(loadReview);
  renderOwnerReviewGroupMatrix(loadReview);
  renderOwnerReviewRulebook();
  renderOwnerReviewPersonRows(loadReview);
}


export function handleOwnerReviewContextClick(event) {
  const button = event.target.closest('[data-owner-review-context]');
  if (!button) {
    return null;
  }
  const dashboardContext = button.dataset.ownerReviewContext || '';
  const owner = resolveOwnerReviewOwner();
  navigateToOwnerReview(owner, dashboardContext);
  return { owner, dashboardContext };
}


export function rerenderOwnerReviewInteractiveSections() {
  syncOwnerReviewLoadControls();
  renderOwnerReviewDecisionSummary(state.ownerReview);
  renderOwnerReviewGroupMatrix(state.ownerReview);
  renderOwnerReviewPersonRows(state.ownerReview);
}


export function handleOwnerReviewSearchInput(event) {
  state.ownerReviewSearchQuery = event.target.value || '';
  state.ownerReviewSelectedGroup = '';
  rerenderOwnerReviewInteractiveSections();
}


export function handleOwnerReviewLoadFilterChange(event) {
  state.ownerReviewLoadFilter = event.target.value || 'all';
  state.ownerReviewSelectedGroup = '';
  rerenderOwnerReviewInteractiveSections();
}


export function handleOwnerReviewDecisionClick(event) {
  const button = event.target.closest('[data-owner-review-decision]');
  if (!button) {
    return;
  }
  openOwnerReviewDecisionModal(button.dataset.ownerReviewDecision || '');
}


export function handleOwnerReviewGroupMatrixClick(event) {
  const row = event.target.closest('[data-owner-review-group]');
  if (!row) {
    return;
  }
  state.ownerReviewSelectedGroup = row.dataset.ownerReviewGroup || '';
  state.ownerReviewSearchQuery = '';
  state.ownerReviewLoadFilter = 'all';
  rerenderOwnerReviewInteractiveSections();
}


export function handleOwnerReviewKeydown(event) {
  if (!ownerReviewModuleVisible()) {
    return;
  }
  if (event.key === '/' && elements.ownerReviewSearchInput && document.activeElement !== elements.ownerReviewSearchInput) {
    event.preventDefault();
    elements.ownerReviewSearchInput.focus();
    return;
  }
  if (event.key !== 'Escape') {
    return;
  }
  if (elements.ownerReviewDecisionModal && !elements.ownerReviewDecisionModal.hidden) {
    closeOwnerReviewDecisionModal();
    return;
  }
  if (elements.ownerReviewMemberModal && !elements.ownerReviewMemberModal.hidden) {
    closeOwnerReviewMemberModal();
    return;
  }
  if (state.ownerReviewSearchQuery || (state.ownerReviewLoadFilter || 'all') !== 'all') {
    state.ownerReviewSearchQuery = '';
    state.ownerReviewLoadFilter = 'all';
    rerenderOwnerReviewInteractiveSections();
  }
}


export function handleOwnerReviewPersonClick(event) {
  const idleToggle = event.target.closest('[data-owner-review-idle-toggle]');
  if (idleToggle) {
    event.preventDefault();
    event.stopPropagation();
    const groupName = idleToggle.dataset.ownerReviewIdleToggle || '';
    state.ownerReviewExpandedIdleGroups = {
      ...(state.ownerReviewExpandedIdleGroups || {}),
      [groupName]: !state.ownerReviewExpandedIdleGroups?.[groupName],
    };
    renderOwnerReviewPersonRows(state.ownerReview);
    return;
  }

  const detailRow = event.target.closest('[data-owner-review-project-id], [data-owner-review-project-name]');
  if (detailRow) {
    const projectId = detailRow.dataset.ownerReviewProjectId || '';
    const projectName = detailRow.dataset.ownerReviewProjectName || '';
    const delivery = detailRow.dataset.ownerReviewDelivery || '';
    const status = detailRow.dataset.ownerReviewStatus || '';
    const personName = detailRow.dataset.ownerReviewPerson || state.selectedOwnerReviewPerson || '';
    openProjectDetailByReference({ projectId, projectName }, state.projects, {
      action: '执行负载',
      reason: [delivery, status].filter(Boolean).join(' · ') || ownerReviewItemStatusLabel({ state: {} }),
      meta: personName,
    });
    return;
  }

  const personRow = event.target.closest('[data-owner-review-person]');
  if (personRow) {
    openOwnerReviewFloorDetailModal(personRow.dataset.ownerReviewPerson || '');
    return;
  }
}


export function handleOwnerReviewTeamStructureClick(event) {
  const memberButton = event.target.closest('[data-owner-review-member]');
  if (!memberButton) {
    return;
  }
  openOwnerReviewMemberModal(memberButton.dataset.ownerReviewMember || '');
}


export function handleOwnerReviewMemberModalClick(event) {
  if (!elements.ownerReviewMemberModal) {
    return;
  }
  if (event.target.closest('[data-owner-review-member-close]') || event.target === elements.ownerReviewMemberModal) {
    closeOwnerReviewMemberModal();
    return;
  }
  if (event.target.closest('[data-owner-review-copy-summary]')) {
    const member = ownerReviewMemberLoadByName(state.selectedOwnerReviewPerson || state.selectedOwnerReviewMember);
    copyOwnerReviewSummary(member);
    return;
  }
  const detailRow = event.target.closest('[data-owner-review-project-id], [data-owner-review-project-name]');
  if (detailRow) {
    const projectId = detailRow.dataset.ownerReviewProjectId || '';
    const projectName = detailRow.dataset.ownerReviewProjectName || '';
    const delivery = detailRow.dataset.ownerReviewDelivery || '';
    const status = detailRow.dataset.ownerReviewStatus || '';
    const personName = detailRow.dataset.ownerReviewPerson || state.selectedOwnerReviewPerson || '';
    openProjectDetailByReference({ projectId, projectName }, state.projects, {
      action: '执行负载',
      reason: [delivery, status].filter(Boolean).join(' / ') || ownerReviewItemStatusLabel({ state: {} }),
      meta: personName,
    });
    return;
  }
  const filterButton = event.target.closest('[data-owner-review-member-filter]');
  if (filterButton) {
    state.ownerReviewMemberFilter = filterButton.dataset.ownerReviewMemberFilter || 'all';
    renderOwnerReviewMemberModal();
    return;
  }
  const projectRow = event.target.closest('[data-owner-review-member-project-id], [data-owner-review-member-project-name]');
  if (projectRow) {
    const projectId = projectRow.dataset.ownerReviewMemberProjectId || '';
    const projectName = projectRow.dataset.ownerReviewMemberProjectName || '';
    openProjectDetailByReference({ projectId, projectName }, state.projects, {
      action: '成员负载详情',
      reason: ownerReviewMemberFilterLabel(state.ownerReviewMemberFilter),
      meta: state.selectedOwnerReviewMember || '',
    });
  }
}


export function handleOwnerReviewDecisionModalClick(event) {
  if (!elements.ownerReviewDecisionModal) {
    return;
  }
  if (event.target.closest('[data-owner-review-decision-close]') || event.target === elements.ownerReviewDecisionModal) {
    closeOwnerReviewDecisionModal();
    return;
  }
  const memberButton = event.target.closest('[data-owner-review-decision-person]');
  if (memberButton) {
    closeOwnerReviewDecisionModal();
    openOwnerReviewFloorDetailModal(memberButton.dataset.ownerReviewDecisionPerson || '');
  }
}

