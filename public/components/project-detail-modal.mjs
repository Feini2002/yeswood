import { state } from '../lib/state.mjs';
import { elements } from '../lib/dom.mjs';
import { runtimeStore } from '../lib/runtime-flags.mjs';
import { escapeHtml, displayOrDash, formatDate } from '../lib/format.mjs';
import {
  isSleepStoreProject,
  readRawFieldDisplay,
  displayProjectHardOwner,
  displayProjectSoftOwner,
  displayProjectOwner,
  projectAssignmentDetailLabel,
  projectAssignmentStatusLabel,
  renderProjectAssignmentReminder,
} from '../domain/project-display.mjs';
import {
  renderProjectStatusConflictReminder,
} from './project-cell-render.mjs';
import { refreshDrillRowsIfOpen, refreshProjectWorkbenchAfterModal } from '../lib/view-coordinator.mjs';
import {
  readEffectiveWorkflowStage,
  readProjectNodeValue,
  isProjectWorkflowClosed,
  isPausedOrCanceledProject,
  isSingleTrackLifecycleClosure,
  projectAreaLabel,
  PROJECT_NODE_FIELD_ALIASES,
} from '../domain/project-workflow.mjs';
import {
  resolveProjectKeyDateReminders,
  isEmptyProjectReminder,
  projectReminderTrackLabel,
  isHardDeadlineReminder,
} from '../domain/project-reminders.mjs';

function buildProjectDetailFieldGroups() {
  return [
  {
    key: 'overview',
    title: '项目概况',
    open: true,
    fields: [
      { label: '项目名称', value: (project) => project.name },
      { label: '硬装负责人', value: (project) => displayProjectHardOwner(project) },
      { label: '软装负责人', value: (project) => displayProjectSoftOwner(project) },
      { label: '省份', value: (project) => project.province },
      { label: '店态', value: (project) => project.storeStatus },
      { label: '业态', value: (project) => project.businessType },
      { label: '面积', value: (project) => projectAreaLabel(project) },
      { label: '紧急程度', value: (project) => project.status },
    ],
  },
  {
    key: 'reminders',
    title: '关键日期',
    open: false,
    fields: [
      { label: '启动时间', fields: PROJECT_NODE_FIELD_ALIASES.managementStart, value: (project) => formatDate(project.startDate || readProjectNodeValue(project, 'managementStart')), always: true },
      { label: '计划开业时间', fields: PROJECT_NODE_FIELD_ALIASES.managementOpen, value: (project) => formatDate(project.dueDate || readProjectNodeValue(project, 'managementOpen')), always: true },
      { label: '上会日期', fields: PROJECT_NODE_FIELD_ALIASES.meetingDate, value: (project) => formatDate(readProjectNodeValue(project, 'meetingDate')), always: true },
      { label: '复尺时间', fields: PROJECT_NODE_FIELD_ALIASES.measureDate, value: (project) => formatDate(readProjectNodeValue(project, 'measureDate')), always: true },
      { label: '平面开始时间', fields: PROJECT_NODE_FIELD_ALIASES.floorPlanStart, value: (project) => formatDate(readProjectNodeValue(project, 'floorPlanStart')), always: true },
      { label: '躺平内部审核结束时间', fields: PROJECT_NODE_FIELD_ALIASES.floorPlanFinish, value: (project) => formatDate(readProjectNodeValue(project, 'floorPlanFinish')), always: true },
      { label: '施工图初稿完成时间', fields: PROJECT_NODE_FIELD_ALIASES.constructionDraft, value: (project) => formatDate(readProjectNodeValue(project, 'constructionDraft')), always: true },
      { label: '施工图完成审核时间', fields: PROJECT_NODE_FIELD_ALIASES.constructionReview, value: (project) => formatDate(readProjectNodeValue(project, 'constructionReview')), always: true },
      { label: '点位完成情况', fields: PROJECT_NODE_FIELD_ALIASES.pointStatus, always: true },
      { label: '点位完成时间', fields: PROJECT_NODE_FIELD_ALIASES.pointDone, value: (project) => formatDate(readProjectNodeValue(project, 'pointDone')), always: true },
      { label: '软装方案开始时间', fields: PROJECT_NODE_FIELD_ALIASES.softSchemeStart, value: (project) => formatDate(readProjectNodeValue(project, 'softSchemeStart')), always: true },
      { label: '软装完成情况', fields: PROJECT_NODE_FIELD_ALIASES.softDoneStatus, always: true },
      { label: '软装发群/完成时间', fields: PROJECT_NODE_FIELD_ALIASES.softDoneTime, value: (project) => formatDate(readProjectNodeValue(project, 'softDoneTime')), always: true },
      { label: '流程记录：产品清单接收时间', fields: PROJECT_NODE_FIELD_ALIASES.productListSent, value: (project) => formatDate(readProjectNodeValue(project, 'productListSent')), always: true },
      { label: '采购时间', fields: PROJECT_NODE_FIELD_ALIASES.purchaseTime, value: (project) => formatDate(readProjectNodeValue(project, 'purchaseTime')), always: true },
      { label: '采购完成情况', fields: PROJECT_NODE_FIELD_ALIASES.purchaseStatus, always: true },
      { label: '摆场开始时间', fields: PROJECT_NODE_FIELD_ALIASES.displayStart, value: (project) => formatDate(readProjectNodeValue(project, 'displayStart')), always: true },
      { label: '摆场文件发出时间', fields: PROJECT_NODE_FIELD_ALIASES.displayFileSent, value: (project) => formatDate(readProjectNodeValue(project, 'displayFileSent')), always: true },
      { label: '摆场时间', fields: PROJECT_NODE_FIELD_ALIASES.displayTime, value: (project) => formatDate(readProjectNodeValue(project, 'displayTime')), always: true },
    ],
  },
  {
    key: 'people',
    title: '人员协作',
    open: false,
    fields: [
      { label: '硬装组长', fields: ['CD组长'] },
      { label: '软装组长', fields: ['VM组长'] },
      { label: '硬装设计师', fields: ['CD设计师'] },
      { label: '软装设计师', fields: ['VM设计师'] },
    ],
  },
];
}

function projectDetailGroupTone(group = {}) {
  const tones = {
    overview: 'overview',
    progress: 'progress',
    reminders: 'date',
    people: 'people',
  };
  return tones[group.key] || 'overview';
}

export function projectDetailFieldValue(project, field) {
  if (typeof field.value === 'function') {
    return displayOrDash(field.value(project));
  }
  if (field.fields) {
    return displayOrDash(readRawFieldDisplay(project, field.fields));
  }
  return displayOrDash(project[field.key]);
}

function projectDetailReminderProject(project = {}) {
  const primaryReminder = isHardDeadlineReminder(project.primaryReminder) ? null : project.primaryReminder;
  const reminders = Array.isArray(project.reminders)
    ? project.reminders.filter((reminder) => !isHardDeadlineReminder(reminder))
    : project.reminders;
  return {
    ...project,
    primaryReminder,
    reminders,
  };
}


export function projectDetailFieldApplies(project, group, field) {
  const label = String(field.label || '');
  if (!isSleepStoreProject(project)) {
    return true;
  }
  if (group.key === 'overview') {
    return label !== '软装负责人';
  }
  if (group.key === 'progress') {
    return !/软装|点位/.test(label);
  }
  if (group.key === 'reminders') {
    return !/软装|点位|采购|摆场|产品清单|后续协同/.test(label);
  }
  if (group.key === 'people') {
    return !/软装|VM|点位|摆场/.test(label);
  }
  if (group.key === 'assets') {
    return !/软装|采购/.test(label);
  }
  return true;
}


export function projectDetailFieldLabel(project, group, field) {
  if (isSleepStoreProject(project) && group.key === 'overview' && field.label === '硬装负责人') {
    return '负责人';
  }
  return field.label;
}


function projectDetailProgressValue(project = {}, discipline = 'hard') {
  const rawFields = discipline === 'soft' ? ['软装项目进度'] : ['硬装项目进度'];
  return readRawFieldDisplay(project, rawFields) || displayOrDash(readEffectiveWorkflowStage(project, discipline));
}


function projectDetailProgressItems(project = {}) {
  const items = [
    { key: 'hard', label: '硬装项目进度', value: projectDetailProgressValue(project, 'hard') },
  ];
  if (!isSleepStoreProject(project)) {
    items.push({ key: 'soft', label: '软装项目进度', value: projectDetailProgressValue(project, 'soft') });
  }
  return items.filter((item) => displayOrDash(item.value) !== '--');
}


export function sleepStorePeopleDetailValues(project) {
  return [
    { label: '负责人', value: displayProjectHardOwner(project) },
    { label: '组长', value: readRawFieldDisplay(project, ['CD组长']) },
    { label: '设计师', value: readRawFieldDisplay(project, ['CD设计师']) },
  ]
    .map((field) => ({
      label: field.label,
      value: displayOrDash(field.value),
      always: false,
    }))
    .filter((item) => item.value !== '--');
}


export function projectDetailGroupValues(project, group) {
  const detailProject = group.key === 'reminders' ? projectDetailReminderProject(project) : project;
  if (isSleepStoreProject(project) && group.key === 'people') {
    return sleepStorePeopleDetailValues(project);
  }
  return group.fields
    .filter((field) => projectDetailFieldApplies(detailProject, group, field))
    .map((field) => ({
      label: projectDetailFieldLabel(detailProject, group, field),
      value: projectDetailFieldValue(detailProject, field),
      always: Boolean(field.always),
    }))
    .filter((item) => item.always || item.value !== '--');
}

function renderProjectDetailHero(project = {}) {
  const subtitle = [
    displayOrDash(project.storeStatus),
    displayOrDash(project.businessType),
    displayOrDash(projectAreaLabel(project)),
  ].filter((item) => item && item !== '--');

  return `
    <header class="project-detail-hero">
      <div>
        <p class="eyebrow">单项项目</p>
        <h3 id="projectDetailTitle" title="${escapeHtml(project.name || '')}">${escapeHtml(project.name || '未命名项目')}</h3>
        ${subtitle.length ? `<p class="project-detail-hero-subtitle">${escapeHtml(subtitle.join(' · '))}</p>` : ''}
      </div>
    </header>
  `;
}

function projectDetailSnapshotTone(item, index) {
  const label = String(item?.label || '');
  if (/软装/.test(label)) {
    return 'soft';
  }
  if (/硬装|负责人/.test(label)) {
    return 'hard';
  }
  if (/地区|店态|业态/.test(label)) {
    return index % 2 ? 'amber' : 'teal';
  }
  return 'neutral';
}

function renderProjectDetailSnapshot(items = []) {
  if (!items.length) {
    return '';
  }
  return `
    <section class="project-detail-snapshot" aria-label="项目概况">
      ${items
        .map((item, index) => {
          const value = displayOrDash(item.value);
          return `
            <div class="project-detail-snapshot-item is-${escapeHtml(projectDetailSnapshotTone(item, index))}">
              <span>${escapeHtml(item.label)}</span>
              <strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
            </div>
          `;
        })
        .join('')}
    </section>
  `;
}

function isProjectDetailAdminReminder(reminder = {}) {
  const text = [reminder.label, reminder.message, reminder.title, reminder.raw, reminder.stage].filter(Boolean).join(' ');
  return /补录|待填|缺失|缺日期|缺时间|字段/.test(text);
}

function projectDetailSplitReminders(project = {}, { closedForReminder = false } = {}) {
  if (closedForReminder) {
    return { stageReminders: [], adminReminders: [] };
  }
  const reminders = resolveProjectKeyDateReminders(project).filter((item) => !isEmptyProjectReminder(item));
  return {
    stageReminders: reminders.filter((item) => !isProjectDetailAdminReminder(item)),
    adminReminders: reminders.filter(isProjectDetailAdminReminder),
  };
}

function projectDetailStageReminderTitle(reminder = {}) {
  if (reminder.stage) {
    return `当前${reminder.stage}`;
  }
  return projectReminderTrackLabel(reminder) || reminder.label || '当前阶段';
}

function projectDetailStageReminderAction(reminder = {}) {
  const action = reminder.message || (reminder.label ? `待${reminder.label}` : '');
  return action || displayOrDash(reminder.label);
}

function projectDetailStageReminderMeta(reminder = {}) {
  return [reminder.formatted && reminder.formatted !== '--' ? reminder.formatted : '', projectReminderTrackLabel(reminder)]
    .filter(Boolean)
    .join(' · ');
}

function projectDetailAdminReminderTitle(reminder = {}) {
  return reminder.message || (reminder.label ? `${reminder.label}待补录` : '表单字段待补录');
}

function projectDetailAdminReminderMeta(reminder = {}) {
  return [projectReminderTrackLabel(reminder), reminder.stage ? `阶段：${reminder.stage}` : '管理补录']
    .filter(Boolean)
    .join(' · ');
}

function renderProjectDetailStageRows(rows = [], emptyText = '暂无信息') {
  if (!rows.length) {
    return `<span class="project-detail-stage-empty">${escapeHtml(emptyText)}</span>`;
  }
  return rows
    .map(
      (row) => `
        <span class="project-detail-stage-row is-${escapeHtml(row.tone || 'neutral')}">
          <b>${escapeHtml(row.title)}</b>
          <em>${escapeHtml(row.value)}</em>
          ${row.meta ? `<small>${escapeHtml(row.meta)}</small>` : ''}
        </span>
      `
    )
    .join('');
}

function renderProjectDetailStageStream(stream = {}) {
  return `
    <div class="project-detail-stage-stream is-${escapeHtml(stream.tone || 'neutral')}">
      <div class="project-detail-stage-stream-head">
        <span>${escapeHtml(stream.label)}</span>
        ${stream.caption ? `<small>${escapeHtml(stream.caption)}</small>` : ''}
      </div>
      <div class="project-detail-stage-stream-body">
        ${renderProjectDetailStageRows(stream.rows, stream.emptyText)}
      </div>
    </div>
  `;
}

function renderProjectDetailStagePanel(project, { closedForReminder = false, detailReminderProject = project } = {}) {
  const { stageReminders, adminReminders } = projectDetailSplitReminders(detailReminderProject, { closedForReminder });
  const streams = [
    {
      key: 'facts',
      tone: 'hard',
      label: '阶段事实',
      emptyText: '暂无项目进度',
      rows: projectDetailProgressItems(project).map((item) => ({
        tone: item.key,
        title: item.label,
        value: displayOrDash(item.value),
      })),
    },
    {
      key: 'next',
      tone: 'date',
      label: '下一阶段动作',
      emptyText: '暂无阶段提醒',
      rows: stageReminders.map((reminder) => ({
        tone: reminder.discipline || 'date',
        title: projectDetailStageReminderTitle(reminder),
        value: projectDetailStageReminderAction(reminder),
        meta: projectDetailStageReminderMeta(reminder),
      })),
    },
    {
      key: 'admin',
      tone: 'admin',
      label: '表单补录',
      emptyText: '暂无补录提醒',
      rows: adminReminders.map((reminder) => ({
        tone: 'admin',
        title: projectDetailAdminReminderTitle(reminder),
        value: '待补录',
        meta: projectDetailAdminReminderMeta(reminder),
      })),
    },
  ];
  const reminderCount = stageReminders.length + adminReminders.length;

  return `
    <section class="project-detail-stage-panel" aria-label="当前状态">
      <div class="project-detail-section-head">
        <span>当前状态</span>
        <small>${reminderCount} 条提醒</small>
      </div>
      <div class="project-detail-stage-grid">
        ${streams.map(renderProjectDetailStageStream).join('')}
      </div>
    </section>
  `;
}

function renderProjectDetailNotices(html = '') {
  if (!String(html || '').trim()) {
    return '';
  }
  return `<section class="project-detail-alerts" aria-label="项目提醒">${html}</section>`;
}


export function renderDetailGroup(project, group) {
  const values = projectDetailGroupValues(project, group);
  const tone = projectDetailGroupTone(group);

  const body = values.length
    ? values
        .map(
          (item) => {
            const stateClass = displayOrDash(item.value) === '--' ? 'is-empty-value' : 'is-filled-value';
            return `
            <div class="detail-kv-row ${stateClass}">
              <span>${escapeHtml(item.label)}</span>
              <strong title="${escapeHtml(item.value)}">${escapeHtml(item.value)}</strong>
            </div>
          `;
          }
        )
        .join('')
    : '<div class="detail-kv-empty">暂无数据</div>';

  return `
    <section class="project-detail-section is-${escapeHtml(tone)}" aria-label="${escapeHtml(group.title)}">
      <div class="project-detail-section-head">
        <span>${escapeHtml(group.title)}</span>
        <small>${values.length} 项</small>
      </div>
      <div class="detail-kv-grid">${body}</div>
    </section>
  `;
}


export function renderProjectDetailContext(context = null, project = null) {
  return '';
}

export function renderSingleTrackLifecycleNote(project = {}) {
  if (!isSingleTrackLifecycleClosure(project)) {
    return '';
  }
  return `
    <div class="project-detail-action-note project-detail-lifecycle-note" role="note">
      <strong>单轨闭环提醒</strong>
      <div>
        <b>项目总闭环已按当前主口径计入</b>
        <span>另一轨道可能漏填写或未更新，请在原始表单中复核。</span>
      </div>
    </div>
  `;
}


export function renderProjectDetailModalLoading(project = {}) {
  if (!elements.projectDetailModal || !elements.projectDetailModalBody) {
    return;
  }

  elements.projectDetailModalBody.innerHTML = `
    ${renderProjectDetailHero(project)}
    ${renderProjectDetailContext(state.projectDetailContext, project)}
    <div class="project-detail-empty project-detail-loading" role="status" aria-live="polite">
      <strong>正在加载项目明细</strong>
      <span>正在读取完整字段，请稍候…</span>
    </div>
  `;
  elements.projectDetailModal.hidden = false;
}


export function renderProjectDetailModalLoadError(project = {}, error = null) {
  if (!elements.projectDetailModal || !elements.projectDetailModalBody) {
    return;
  }

  const message = error?.message ? String(error.message) : '项目明细暂时无法读取，请稍后重试。';
  elements.projectDetailModalBody.innerHTML = `
    ${renderProjectDetailHero(project)}
    ${renderProjectDetailContext(state.projectDetailContext, project)}
    <div class="project-detail-empty project-detail-loading is-error" role="alert">
      <strong>项目明细加载失败</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
  elements.projectDetailModal.hidden = false;
}


export function renderProjectDetailModal(project) {
  if (!elements.projectDetailModal || !elements.projectDetailModalBody || !project) {
    return;
  }

  const sleepStore = isSleepStoreProject(project);
  const stopped = isPausedOrCanceledProject(project);
  const metaItems = [
    { label: sleepStore ? '负责人' : '硬装负责人', value: displayProjectHardOwner(project) },
    { label: '软装负责人', value: displayProjectSoftOwner(project) },
    { label: '地区', value: project.province },
    { label: '店态', value: project.storeStatus },
    { label: '业态', value: project.businessType },
    { label: '面积', value: projectAreaLabel(project) },
  ].filter((item) => !sleepStore || item.label !== '软装负责人');
  const closed = isProjectWorkflowClosed(project);
  const closedForReminder = closed && !stopped;
  const detailReminderProject = projectDetailReminderProject(project);
  const assignmentReminder = stopped ? '' : renderProjectAssignmentReminder(project);
  const statusConflictReminder = stopped ? '' : renderProjectStatusConflictReminder(project);
  const singleTrackLifecycleNote = stopped ? '' : renderSingleTrackLifecycleNote(project);
  const noticeHtml = [renderProjectDetailContext(state.projectDetailContext, project), singleTrackLifecycleNote, assignmentReminder, statusConflictReminder]
    .filter(Boolean)
    .join('');
  const detailGroups = buildProjectDetailFieldGroups().filter((group) => group.key !== 'overview');

  elements.projectDetailModalBody.innerHTML = `
    ${renderProjectDetailHero(project)}
    ${renderProjectDetailSnapshot(metaItems)}
    ${renderProjectDetailNotices(noticeHtml)}
    ${renderProjectDetailStagePanel(project, { closedForReminder, detailReminderProject })}
    <div class="project-detail-sections">
      ${detailGroups.map((group) => renderDetailGroup(project, group)).join('')}
    </div>
  `;
  elements.projectDetailModal.hidden = false;
}


export function closeProjectDetailModal() {
  runtimeStore.projectDetailRequestId += 1;
  if (elements.projectDetailModal) {
    elements.projectDetailModal.hidden = true;
  }
  state.selectedProjectId = '';
  state.projectDetailContext = null;
  refreshProjectWorkbenchAfterModal(state.projects);
  if (state.drillModal.open) {
    refreshDrillRowsIfOpen();
  }
}


export function hideProjectAssignmentAlert() {
  if (!elements.projectAssignmentAlert) {
    return;
  }
  elements.projectAssignmentAlert.hidden = true;
  elements.projectAssignmentAlert.innerHTML = '';
}


export function setProjectAssignmentFilter(active) {
  state.showIncompleteAssignments = Boolean(active);
  state.selectedProjectId = '';
  refreshProjectWorkbenchAfterModal(state.projects);
}


export function toggleProjectAssignmentAlertExpanded() {
  state.assignmentAlertExpanded = !state.assignmentAlertExpanded;
  refreshProjectWorkbenchAfterModal(state.projects);
}


export function renderProjectAssignmentList(items = []) {
  const visibleItems = items.slice(0, 8);
  const extraCount = Math.max(0, items.length - visibleItems.length);
  return `
    <div class="assignment-alert-list" aria-label="人员配置待补全项目">
      <div class="assignment-alert-list-head" aria-hidden="true">
        <span>项目</span>
        <span>缺失项</span>
        <span>负责人</span>
        <span>门店阶段</span>
      </div>
      ${visibleItems
        .map(({ project, gap }) => {
          const storeStage = [project.storeStatus, project.businessType].filter(Boolean).join(' / ') || '--';
          return `
            <div class="assignment-alert-row">
              <button type="button" data-assignment-project-id="${escapeHtml(project.id)}" title="${escapeHtml(project.name || '未命名项目')}">${escapeHtml(project.name || '未命名项目')}</button>
              <span title="${escapeHtml(projectAssignmentDetailLabel(gap))}">${escapeHtml(projectAssignmentDetailLabel(gap))}</span>
              <span title="${escapeHtml(displayOrDash(displayProjectOwner(project)))}">${escapeHtml(displayOrDash(displayProjectOwner(project)))}</span>
              <span title="${escapeHtml(storeStage)}">${escapeHtml(storeStage)}</span>
            </div>
          `;
        })
        .join('')}
      ${extraCount ? `<p class="assignment-alert-more">还有 ${escapeHtml(String(extraCount))} 个待补全项目，可点击“只看待补全”查看。</p>` : ''}
    </div>
  `;
}


export function renderProjectAssignmentAlert(summary) {
  if (!elements.projectAssignmentAlert) {
    return;
  }
  if (!summary?.total) {
    hideProjectAssignmentAlert();
    return;
  }

  const previewItems = summary.items.slice(0, 4);
  const extraCount = Math.max(0, summary.total - previewItems.length);
  elements.projectAssignmentAlert.hidden = false;
  elements.projectAssignmentAlert.classList.toggle('is-filtering', state.showIncompleteAssignments);
  elements.projectAssignmentAlert.innerHTML = `
    <div class="assignment-alert-main">
      <div class="assignment-alert-copy">
        <div class="assignment-alert-title">
          <span class="assignment-alert-marker" aria-hidden="true"></span>
          <strong>人员配置待补全</strong>
          <span>当前筛选下 ${escapeHtml(String(summary.total))} 个项目组长和设计师均未填写</span>
        </div>
        <div class="assignment-alert-stats" aria-label="待补全分类统计">
          <span>组长未填写 ${escapeHtml(String(summary.missingLeader))}</span>
          <span>设计师未填写 ${escapeHtml(String(summary.missingDesigner))}</span>
          <span>两项均未填写 ${escapeHtml(String(summary.missingBoth))}</span>
        </div>
      </div>
      <div class="assignment-alert-actions">
        <button type="button" data-assignment-action="toggle-filter">${state.showIncompleteAssignments ? '查看全部' : '只看待补全'}</button>
        <button type="button" data-assignment-action="toggle-expanded">${state.assignmentAlertExpanded ? '收起' : '展开'}</button>
      </div>
    </div>
    <div class="assignment-alert-preview" aria-label="待补全项目预览">
      ${previewItems
        .map(
          ({ project, gap }) => `
            <button type="button" data-assignment-project-id="${escapeHtml(project.id)}" title="${escapeHtml(`${project.name || '未命名项目'} · ${projectAssignmentDetailLabel(gap)}`)}">
              <strong>${escapeHtml(project.name || '未命名项目')}</strong>
              <span>${escapeHtml(projectAssignmentStatusLabel(gap))}</span>
            </button>
          `
        )
        .join('')}
      ${extraCount ? `<span class="assignment-alert-extra">还有 ${escapeHtml(String(extraCount))} 项</span>` : ''}
    </div>
    ${state.assignmentAlertExpanded ? renderProjectAssignmentList(summary.items) : ''}
  `;
}

