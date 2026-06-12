import { state } from '../lib/state.mjs';
import { elements } from '../lib/dom.mjs';
import { escapeHtml, displayOrDash, formatDate } from '../lib/format.mjs';
import { DETAILS_WORKBENCH_VIEWS } from '../lib/constants.mjs';
import { currentPageId } from '../lib/router.mjs';
import {
  displayProjectOwner,
  displayProjectHardOwner,
  displayProjectSoftOwner,
  isSleepStoreProject,
  projectAssignmentReminderText,
  summarizeProjectAssignments,
  readRawFieldDisplay,
  isAssignmentValueMissing,
} from '../domain/project-display.mjs';
import {
  readProjectStage,
  readEffectiveWorkflowStage,
  projectStageDisplayItems,
  isPausedOrCanceledProject,
  readProjectNodeValue,
  readMeetingPointStatus,
  projectAreaLabel,
  projectWorkbenchStageRank,
  PROJECT_NODE_FIELD_ALIASES,
} from '../domain/project-workflow.mjs';
import {
  resolveProjectKeyDate,
  readProjectKeyDate,
  resolveProjectKeyDateReminders,
  projectFieldGapReminders,
  projectReminderTrackLabel,
  projectReminderTitle,
  formatProjectReminderText,
  hasHardDeadlineException,
  hardDeadlineExceptionReason,
  hardDeadlineExceptionAction,
  projectHardDeadlineExceptionReminder,
  sortProjectWorkbenchProjects,
  isEmptyProjectReminder,
} from '../domain/project-reminders.mjs';
import { renderProjectStageStack, renderProjectKeyDateStack } from './project-cell-render.mjs';
import { renderTeamHeroStat } from '../components/team-hero-stat.mjs';
import { renderEmptyState } from '../dashboard/empty-state.mjs';
import {
  renderProjectDetailModal,
  renderProjectDetailModalLoadError,
  renderProjectAssignmentAlert,
  hideProjectAssignmentAlert,
  closeProjectDetailModal,
} from './project-detail-modal.mjs';
import { refreshDrillRowsIfOpen } from '../lib/view-coordinator.mjs';
import { runtimeStore } from '../lib/runtime-flags.mjs';

export function projectWorkbenchViewKey(viewKey = state.detailsWorkbenchView) {
  return DETAILS_WORKBENCH_VIEWS[viewKey] ? viewKey : 'list';
}


export function setDetailsWorkbenchView(viewKey) {
  if (!DETAILS_WORKBENCH_VIEWS[viewKey]) {
    return;
  }
  state.detailsWorkbenchView = viewKey;
  renderDetailsViewTabs();
  renderProjectWorkbench(state.projects);
}


export function setDrillWorkbenchView(viewKey) {
  if (!DETAILS_WORKBENCH_VIEWS[viewKey]) {
    return;
  }
  state.drillWorkbenchView = viewKey;
  refreshDrillRowsIfOpen();
}


export function renderDetailsViewTabs() {
  if (!elements.detailsViewTabs) {
    return;
  }
  const activeKey = projectWorkbenchViewKey();
  elements.detailsViewTabs.querySelectorAll('[data-details-view]').forEach((button) => {
    const active = button.dataset.detailsView === activeKey;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}


export function renderDrillViewTabs() {
  if (!elements.drillProjectViewTabs) {
    return;
  }
  const activeKey = projectWorkbenchViewKey(state.drillWorkbenchView);
  elements.drillProjectViewTabs.querySelectorAll('[data-drill-view]').forEach((button) => {
    const active = button.dataset.drillView === activeKey;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}


export function renderProjectWorkbenchHead(viewKey) {
  const view = DETAILS_WORKBENCH_VIEWS[viewKey];
  if (!elements.projectWorkbenchHead || !view) {
    return;
  }
  elements.projectWorkbenchHead.className = `project-workbench-head ${view.gridClass}`;
  elements.projectWorkbenchHead.innerHTML = view.columns.map(renderProjectWorkbenchHeadCell).join('');
}


export function renderDrillProjectHead(viewKey) {
  const view = DETAILS_WORKBENCH_VIEWS[viewKey];
  if (!elements.drillProjectHead || !view) {
    return;
  }
  elements.drillProjectHead.className = `project-workbench-head drill-project-head ${view.gridClass}`;
  elements.drillProjectHead.innerHTML = view.columns.map(renderProjectWorkbenchHeadCell).join('');
}


export function renderProjectWorkbenchHeadCell(label) {
  return `<span>${escapeHtml(label)}</span>`;
}


export function renderProjectWorkbenchMainCell(project) {
  return `
    <span class="project-cell-main">
      <strong title="${escapeHtml(project.name)}">${escapeHtml(project.name || '未命名项目')}</strong>
      <small>${escapeHtml(displayOrDash(project.province))} · ${escapeHtml(displayOrDash(project.businessType))}</small>
    </span>
  `;
}


export function workbenchCell(text) {
  const value = displayOrDash(text);
  return `<span title="${escapeHtml(value)}">${escapeHtml(value)}</span>`;
}


export function missingWorkbenchCell() {
  return '<span class="project-assignment-missing" title="未填写">未填写</span>';
}


export function renderLabeledLines(items = [], className = 'project-labeled-cell') {
  const visibleItems = items
    .map((item) => ({
      label: String(item.label || '').trim(),
      value: displayOrDash(item.value),
    }))
    .filter((item) => item.value !== '--');

  if (!visibleItems.length) {
    if (className.includes('project-team-cell') || className.includes('project-designer-cell')) {
      return missingWorkbenchCell();
    }
    return workbenchCell('--');
  }

  return `
    <span class="${className}" title="${escapeHtml(visibleItems.map((item) => `${item.label}：${item.value}`).join(' / '))}">
      ${visibleItems
        .map(
          (item) => `
            <small>
              <b>${escapeHtml(item.label)}</b>
              <em>${escapeHtml(item.value)}</em>
            </small>
          `
        )
        .join('')}
    </span>
  `;
}


export function renderSingleAssignmentCell(value, className = '') {
  if (isAssignmentValueMissing(value) && (className.includes('project-team-cell') || className.includes('project-designer-cell'))) {
    return missingWorkbenchCell();
  }
  const text = displayOrDash(value);
  return `<span class="project-single-assignment-cell ${escapeHtml(className)}" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
}


export function renderProjectOwnersCell(project) {
  if (isSleepStoreProject(project)) {
    return renderSingleAssignmentCell(displayProjectHardOwner(project), 'project-owner-cell');
  }
  const items = [{ label: '硬装', value: displayProjectHardOwner(project) }];
  if (!isSleepStoreProject(project)) {
    items.push({ label: '软装', value: displayProjectSoftOwner(project) });
  }
  return renderLabeledLines(
    items,
    'project-labeled-cell project-owner-cell'
  );
}


export function renderProjectTeamCell(project) {
  if (isSleepStoreProject(project)) {
    return renderSingleAssignmentCell(readRawFieldDisplay(project, ['CD组长']), 'project-team-cell');
  }
  const items = [{ label: '硬组', value: readRawFieldDisplay(project, ['CD组长']) }];
  if (!isSleepStoreProject(project)) {
    items.push({ label: '软组', value: readRawFieldDisplay(project, ['VM组长']) });
  }
  return renderLabeledLines(
    items,
    'project-labeled-cell project-team-cell'
  );
}


export function renderProjectDesignersCell(project) {
  if (isSleepStoreProject(project)) {
    return renderSingleAssignmentCell(readRawFieldDisplay(project, ['CD设计师']), 'project-designer-cell');
  }
  const items = [{ label: '硬装', value: readRawFieldDisplay(project, ['CD设计师']) }];
  if (!isSleepStoreProject(project)) {
    items.push({ label: '软装', value: readRawFieldDisplay(project, ['VM设计师']) });
  }
  return renderLabeledLines(
    items,
    'project-labeled-cell project-designer-cell'
  );
}


export { renderProjectAssignmentReminder } from '../domain/project-display.mjs';

export {
  renderProjectFieldGapReminder,
  renderProjectStageStack,
  renderProjectKeyDateStack,
} from './project-cell-render.mjs';


export function renderProjectStoreStageCell(project) {
  const storeText = [project.storeStatus, project.businessType].filter(Boolean).join(' / ') || '--';
  const stage = displayOrDash(readProjectStage(project));
  return `
    <span class="project-store-stage-cell" title="${escapeHtml(`${storeText} / ${stage}`)}">
      <strong>${escapeHtml(storeText)}</strong>
      <small class="project-stage-summary">${renderProjectStageStack(project)}</small>
    </span>
  `;
}


export function projectWorkbenchRowCells(project, viewKey) {
  const main = renderProjectWorkbenchMainCell(project);

  if (viewKey === 'deadlineExceptions') {
    const reminder = projectHardDeadlineExceptionReminder(project);
    return [
      main,
      workbenchCell(reminder?.title || reminder?.label || '硬装 Deadline 待复核'),
      workbenchCell(hardDeadlineExceptionReason(project, reminder)),
      workbenchCell(displayProjectHardOwner(project) || displayProjectOwner(project)),
      workbenchCell(hardDeadlineExceptionAction(reminder)),
    ];
  }

  if (viewKey === 'progress') {
    return [
      main,
      workbenchCell(readEffectiveWorkflowStage(project, 'hard')),
      workbenchCell(readEffectiveWorkflowStage(project, 'soft')),
      workbenchCell(readRawFieldDisplay(project, ['硬装方案情况'])),
      workbenchCell(readMeetingPointStatus(project)),
      projectKeyDateCell(project),
    ];
  }

  return [
    main,
    renderProjectOwnersCell(project),
    renderProjectTeamCell(project),
    renderProjectDesignersCell(project),
    renderProjectStoreStageCell(project),
    projectKeyDateCell(project),
  ];
}


export function projectKeyDateCell(project) {
  const reminders = resolveProjectKeyDateReminders(project).filter((item) => !isEmptyProjectReminder(item));
  if (!reminders.length) {
    return workbenchCell('--');
  }

  const title = reminders.map((item) => projectReminderTitle(item)).join(' / ');
  return renderProjectKeyDateStack(project, title);
}


export function renderPausedProjectToggle() {
  if (!elements.pausedProjectToggle) {
    return;
  }
  const active = Boolean(state.showPausedProjects);
  elements.pausedProjectToggle.classList.toggle('active', active);
  elements.pausedProjectToggle.setAttribute('aria-pressed', active ? 'true' : 'false');
  elements.pausedProjectToggle.textContent = active ? '只看暂停/取消项目' : '查看暂停/取消项目';
}


export function setPausedProjectFilter(active) {
  state.showPausedProjects = Boolean(active);
  state.selectedProjectId = '';
  renderPausedProjectToggle();
  renderProjectWorkbench(state.projects);
}


export function renderProjectWorkbenchEmptyState(reason = 'filtered') {
  const presets = {
    filtered: {
      title: '暂无匹配项目',
      description: '调整搜索或筛选条件后再查看，当前桌面工作台会保留筛选栏状态。',
    },
    paused: {
      title: '暂无暂停/取消项目',
      description: '当前筛选范围内没有暂停或取消项目，可切回全部项目继续查看。',
    },
    incomplete: {
      title: '暂无人员配置待补全项目',
      description: '当前范围内没有组长和设计师均未填写的项目。',
    },
    deadlineExceptions: {
      title: '暂无 Deadline 待复核项目',
      description: '当前范围内没有缺字段、规则冲突或需要人工确认的硬装 Deadline。',
    },
    loading: {
      title: '正在加载匹配项目',
      description: '筛选口径已更新，项目列表刷新中。',
    },
    error: {
      title: '项目列表加载失败',
      description: '请稍后重试，或检查本地服务是否仍在运行。',
    },
  };
  const preset = presets[reason] || presets.filtered;
  return `<div class="project-workbench-empty">${renderEmptyState({ ...preset, compact: true })}</div>`;
}


export function renderProjectWorkbench(projects = []) {
  if (!elements.projectWorkbenchRows) {
    return;
  }

  const viewKey = projectWorkbenchViewKey();
  const view = DETAILS_WORKBENCH_VIEWS[viewKey];
  const baseVisibleProjects = projects.filter((project) =>
    state.showPausedProjects ? isPausedOrCanceledProject(project) : !isPausedOrCanceledProject(project)
  );
  const scopedProjects =
    viewKey === 'deadlineExceptions'
      ? baseVisibleProjects.filter((project) => hasHardDeadlineException(project))
      : baseVisibleProjects;
  const assignmentSummary = summarizeProjectAssignments(baseVisibleProjects);
  if (!assignmentSummary.total && state.showIncompleteAssignments) {
    state.showIncompleteAssignments = false;
  }
  const visibleProjects = state.showIncompleteAssignments
    ? scopedProjects.filter((project) => firstVersionAssignmentGap(project))
    : scopedProjects;
  renderDetailsViewTabs();
  renderPausedProjectToggle();
  renderProjectAssignmentAlert(assignmentSummary);
  renderProjectWorkbenchHead(viewKey);
  elements.projectWorkbenchRows.className = `project-workbench-rows ${view.gridClass}`;
  if (elements.tableTotal) {
    elements.tableTotal.textContent =
      viewKey === 'deadlineExceptions'
        ? `${visibleProjects.length} 项待复核`
        : state.showIncompleteAssignments
          ? `${visibleProjects.length} 项待补全`
          : `${visibleProjects.length} 项`;
  }

  if (!visibleProjects.length) {
    state.selectedProjectId = '';
    elements.projectWorkbenchRows.innerHTML = renderProjectWorkbenchEmptyState(
      viewKey === 'deadlineExceptions'
        ? 'deadlineExceptions'
        : state.showIncompleteAssignments
          ? 'incomplete'
          : state.showPausedProjects
            ? 'paused'
            : 'filtered'
    );
    return;
  }

  const sortedProjects = sortProjectWorkbenchProjects(visibleProjects);
  elements.projectWorkbenchRows.innerHTML = sortedProjects
    .map((project) => {
      const cells = projectWorkbenchRowCells(project, viewKey).join('');
      return `
        <div class="project-workbench-row ${view.gridClass}" role="button" tabindex="0" data-project-id="${escapeHtml(project.id)}" aria-label="查看 ${escapeHtml(project.name || '项目')} 明细">
          ${cells}
        </div>
      `;
    })
    .join('');
}


export function renderPendingDetailsDrill(pending = null) {
  if (currentPageId() !== 'details') {
    return;
  }
  const targetCount = Number(pending?.targetCount);
  if (elements.tableTotal) {
    elements.tableTotal.textContent = Number.isFinite(targetCount) ? `${targetCount} 项` : '加载中';
  }
  if (!elements.projectWorkbenchRows) {
    return;
  }

  const viewKey = projectWorkbenchViewKey();
  const view = DETAILS_WORKBENCH_VIEWS[viewKey];
  renderDetailsViewTabs();
  hideProjectAssignmentAlert();
  renderProjectWorkbenchHead(viewKey);
  elements.projectWorkbenchRows.className = `project-workbench-rows ${view.gridClass}`;
  state.selectedProjectId = '';
  elements.projectWorkbenchRows.innerHTML = renderProjectWorkbenchEmptyState('loading');
  return;
}


export function handleDetailsViewTabClick(event) {
  const button = event.target.closest('[data-details-view]');
  if (!button || !elements.detailsViewTabs?.contains(button)) {
    return;
  }
  setDetailsWorkbenchView(button.dataset.detailsView || 'list');
}


export function openProjectDetailFromRow(row) {
  if (!row) {
    return;
  }
  const projectId = row.dataset.projectId || '';
  const sourceProjects = row.closest('#drillProjectModal') ? state.drillModal.projects : state.projects;
  openProjectDetailById(projectId, sourceProjects);
}


function cachedProjectFromDetailEntry(entry) {
  if (!entry) {
    return null;
  }
  if (entry.project) {
    const signature = state.projectsCatalogSignature || '';
    if (entry.signature && signature && entry.signature !== signature) {
      return null;
    }
    return entry.project;
  }
  return entry;
}

function runtimeProjectDetailCacheProjects() {
  if (!(runtimeStore.projectDetailCache instanceof Map)) {
    return [];
  }
  return Array.from(runtimeStore.projectDetailCache.values())
    .map(cachedProjectFromDetailEntry)
    .filter(Boolean);
}

function teamCompletionDetailProjects(review = state.teamWorkCompletion) {
  const details = review?.projectDetailsById;
  if (!details || typeof details !== 'object') {
    return [];
  }
  return Object.values(details).filter(Boolean);
}

function projectDetailPools(sourceProjects = state.projects) {
  return [
    runtimeProjectDetailCacheProjects(),
    teamCompletionDetailProjects(),
    sourceProjects,
    state.allProjects,
    state.projects,
    state.drillModal?.projects,
  ].filter(Array.isArray);
}

export function projectDetailRichness(project = {}) {
  if (!project || typeof project !== 'object') {
    return 0;
  }
  let score = Object.keys(project.rawFields || {}).length * 4;
  if (project.owner || project.ownerDisplay || project.hardOwner || project.softOwner) {
    score += 2;
  }
  if (project.province || project.businessType) {
    score += 1;
  }
  if (project.hardDeadline || project.primaryReminder) {
    score += 2;
  }
  if (project.metrics && !Object.keys(project.rawFields || {}).length) {
    score += 1;
  }
  return score;
}

export function projectNeedsDetailFetch(project = {}) {
  return projectDetailRichness(project) < 4;
}

function pickRichestProject(matches = []) {
  return matches.reduce((best, current) => (projectDetailRichness(current) > projectDetailRichness(best) ? current : best));
}

function projectsMatchingReference({ projectId = '', projectName = '' } = {}, pools = []) {
  const id = String(projectId || '').trim();
  const name = String(projectName || '').trim();
  const matches = [];
  const seen = new Set();
  for (const pool of pools) {
    for (const project of pool) {
      if (!project || seen.has(project)) {
        continue;
      }
      const idMatch = id && String(project.id || '') === id;
      const recordIdMatch = id && String(project.recordMeta?.id || '') === id;
      const nameMatch = name && String(project.name || '') === name;
      if (!idMatch && !recordIdMatch && !nameMatch) {
        continue;
      }
      seen.add(project);
      matches.push(project);
    }
  }
  return matches;
}

export function findProjectByReference({ projectId = '', projectName = '' } = {}, sourceProjects = state.projects) {
  const matches = projectsMatchingReference({ projectId, projectName }, projectDetailPools(sourceProjects));
  if (!matches.length) {
    return null;
  }
  if (projectId) {
    const idMatches = matches.filter((item) => item.id === projectId || item.recordMeta?.id === projectId);
    if (idMatches.length) {
      return pickRichestProject(idMatches);
    }
  }
  const nameMatches = projectName ? matches.filter((item) => item.name === projectName) : matches;
  if (nameMatches.length === 1) {
    return pickRichestProject(nameMatches);
  }
  return nameMatches.length ? pickRichestProject(nameMatches) : null;
}

function projectMatchesDetailId(project = {}, projectId = '') {
  const id = String(projectId || '').trim();
  return Boolean(id && (project.id === id || project.recordMeta?.id === id));
}

export async function openProjectDetailByReference(reference = {}, sourceProjects = state.projects, context = null) {
  const requestId = runtimeStore.projectDetailRequestId + 1;
  runtimeStore.projectDetailRequestId = requestId;

  let project = findProjectByReference(reference, sourceProjects);
  if (!project) {
    return;
  }

  const projectId = project.id || reference.projectId || '';
  state.selectedProjectId = projectId;
  state.projectDetailContext = context;

  const renderIfCurrent = (candidate) => {
    if (requestId !== runtimeStore.projectDetailRequestId || !candidate) {
      return;
    }
    renderProjectDetailModal(candidate);
  };

  renderProjectDetailModal(project);

  const { fetchProjectDetail } = await import('../domain/project-catalog.mjs');
  try {
    const fullProject = await fetchProjectDetail(projectId);
    if (requestId !== runtimeStore.projectDetailRequestId) {
      return;
    }
    if (!fullProject || !projectMatchesDetailId(fullProject, state.selectedProjectId)) {
      return;
    }
    renderProjectDetailModal(fullProject);
  } catch (error) {
    console.warn('Project detail enrichment failed', error);
    if (requestId !== runtimeStore.projectDetailRequestId) {
      return;
    }
    if (!project || !elements.projectDetailModal || elements.projectDetailModal.hidden) {
      renderProjectDetailModalLoadError(project, error);
    }
  }
}


export function openProjectDetailById(projectId, sourceProjects = state.projects, context = null) {
  if (!projectId) {
    return;
  }
  openProjectDetailByReference({ projectId }, sourceProjects, context);
}


export function handleProjectDetailsClick(event) {
  if (event.target.closest('[data-project-detail-close]') || event.target === elements.projectDetailModal) {
    closeProjectDetailModal();
    return;
  }
  const drillViewButton = event.target.closest('[data-drill-view]');
  if (drillViewButton && elements.drillProjectViewTabs?.contains(drillViewButton)) {
    setDrillWorkbenchView(drillViewButton.dataset.drillView || 'list');
    return;
  }
  const assignmentAction = event.target.closest('[data-assignment-action]');
  if (assignmentAction && elements.projectAssignmentAlert?.contains(assignmentAction)) {
    if (assignmentAction.dataset.assignmentAction === 'toggle-filter') {
      setProjectAssignmentFilter(!state.showIncompleteAssignments);
    } else if (assignmentAction.dataset.assignmentAction === 'toggle-expanded') {
      toggleProjectAssignmentAlertExpanded();
    }
    return;
  }
  const assignmentProject = event.target.closest('[data-assignment-project-id]');
  if (assignmentProject && elements.projectAssignmentAlert?.contains(assignmentProject)) {
    openProjectDetailById(assignmentProject.dataset.assignmentProjectId || '');
    return;
  }
  const row = event.target.closest('.project-workbench-row');
  if (!row) {
    return;
  }
  openProjectDetailFromRow(row);
}


export function handleProjectDetailsKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  const row = event.target.closest('.project-workbench-row');
  if (!row || event.target !== row) {
    return;
  }
  event.preventDefault();
  openProjectDetailFromRow(row);
}


export function renderTable(projects) {
  renderProjectWorkbench(projects);
}

