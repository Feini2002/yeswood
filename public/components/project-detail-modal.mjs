import { state } from '../lib/state.mjs';
import { elements } from '../lib/dom.mjs';
import { runtimeStore } from '../lib/runtime-flags.mjs';
import { escapeHtml, displayOrDash, formatDate, formatDateTime } from '../lib/format.mjs';
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
  renderProjectFieldGapReminder,
  renderProjectStatusConflictReminder,
  renderProjectStageStack,
  renderProjectKeyDateStack,
} from './project-cell-render.mjs';
import { refreshDrillRowsIfOpen, refreshProjectWorkbenchAfterModal } from '../lib/view-coordinator.mjs';
import {
  readEffectiveWorkflowStage,
  readProjectStage,
  readProjectNodeValue,
  isProjectWorkflowClosed,
  isPausedOrCanceledProject,
  isSingleTrackLifecycleClosure,
  projectAreaLabel,
  PROJECT_NODE_FIELD_ALIASES,
} from '../domain/project-workflow.mjs';
import {
  readProjectKeyDate,
  resolveProjectKeyDateReminders,
  projectReminderTrackLabel,
  isHardDeadlineReminder,
  normalizeSystemProjectReminder,
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
    key: 'progress',
    title: '当前推进',
    open: true,
    fields: [
      { label: '硬装项目进度', value: (project) => displayOrDash(readEffectiveWorkflowStage(project, 'hard')) },
      { label: '点位/软装进度', value: (project) => displayOrDash(readEffectiveWorkflowStage(project, 'soft')) },
      { label: '硬装方案情况', fields: ['硬装方案情况'] },
      { label: '点位完成情况', fields: ['点位完成情况'] },
      { label: '上会情况', fields: ['上会情况'] },
      { label: '软装完成情况', fields: ['软装完成情况'] },
    ],
  },
  {
    key: 'reminders',
    title: '日期与提醒',
    open: false,
    fields: [
      { label: '下一提醒', value: (project) => readProjectKeyDate(project), always: true },
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
      { label: '启动时间', fields: PROJECT_NODE_FIELD_ALIASES.managementStart, value: (project) => formatDate(project.startDate || readProjectNodeValue(project, 'managementStart')), always: true },
      { label: '计划开业时间', fields: PROJECT_NODE_FIELD_ALIASES.managementOpen, value: (project) => formatDate(project.dueDate || readProjectNodeValue(project, 'managementOpen')), always: true },
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
      { label: '摆场设计师', fields: ['摆场设计师'] },
    ],
  },
  {
    key: 'assets',
    title: '资料与备注',
    open: false,
    fields: [
      { label: '硬装资料', fields: ['硬装资料'] },
      { label: '软装资料', fields: ['软装资料'] },
      { label: '备注', fields: ['备注'] },
    ],
  },
];
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


export function projectDetailFieldApplies(project, group, field) {
  const label = String(field.label || '');
  if ((isProjectWorkflowClosed(project) || isPausedOrCanceledProject(project)) && group.key === 'reminders' && label === '下一提醒') {
    return false;
  }
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
  if (isSleepStoreProject(project) && group.key === 'people') {
    return sleepStorePeopleDetailValues(project);
  }
  return group.fields
    .filter((field) => projectDetailFieldApplies(project, group, field))
    .map((field) => ({
      label: projectDetailFieldLabel(project, group, field),
      value: projectDetailFieldValue(project, field),
      always: Boolean(field.always),
    }))
    .filter((item) => item.always || item.value !== '--');
}


export function renderDetailGroup(project, group) {
  const values = projectDetailGroupValues(project, group);

  const body = values.length
    ? values
        .map(
          (item) => `
            <div class="detail-kv-row">
              <span>${escapeHtml(item.label)}</span>
              <strong title="${escapeHtml(item.value)}">${escapeHtml(item.value)}</strong>
            </div>
          `
        )
        .join('')
    : '<div class="detail-kv-empty">暂无数据</div>';

  return `
    <details class="project-detail-section" ${group.open ? 'open' : ''}>
      <summary>
        <span>${escapeHtml(group.title)}</span>
        <small>${values.length} 项</small>
      </summary>
      <div class="detail-kv-grid">${body}</div>
    </details>
  `;
}


export function renderProjectDetailContext(context = null, project = null) {
  if (project && (isProjectWorkflowClosed(project) || isPausedOrCanceledProject(project))) {
    return '';
  }
  if (!context?.action && !context?.reason) {
    return '';
  }
  const facts = [
    context.reason ? `原因：${context.reason}` : '',
    context.meta || '',
    context.owner ? `责任人：${context.owner}` : '',
    context.due && context.due !== '--' ? `截止：${context.due}` : '',
  ].filter(Boolean);
  return `
    <div class="project-detail-action-note" role="note">
      <strong>今日动作建议</strong>
      <div>
        ${context.action ? `<b>${escapeHtml(context.action)}</b>` : ''}
        ${facts.length ? `<span>${escapeHtml(facts.join(' · '))}</span>` : ''}
      </div>
    </div>
  `;
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


export function hardDeadlineStatusLabel(status = '') {
  const labels = {
    calculated: '已计算',
    needs_manual_review: '待复核',
  };
  return labels[status] || status || '--';
}


export function hardDeadlineFloorStatusLabel(status = '') {
  const labels = {
    on_time_start: '准时启动',
    delayed_start: '延期启动',
    delayed_start_open: '启动已超期',
    pending_start: '待启动',
    on_time_complete: '准时完成',
    delayed_complete: '延期完成',
    delayed_open: '已超平面截止',
    pending_complete: '待完成',
  };
  return labels[status] || status || '--';
}


export function hardDeadlineEfficiencyLabel(status = '', summary = '') {
  const labels = {
    not_started: '尚未启动',
    ok: '效率 OK',
    overtime: '效率超时',
    overtime_open: '效率已超时',
    pending: '效率观察中',
  };
  return [labels[status] || status || '', summary].filter(Boolean).join(' · ') || '--';
}

function hardDeadlineFinalSourceLabel(source = '') {
  const labels = {
    form: '表单优先',
    system_fallback: '系统兜底',
    system_deadline: '系统规则',
  };
  return labels[source] || source || '--';
}

function hardDeadlineReviewLabel(conflictReview = {}) {
  if (conflictReview?.needsReview) {
    return '待复核：表单与系统规则不一致';
  }
  return '无需复核';
}

function hardDeadlineFormStatusLabel(floorPlan = {}, project = {}) {
  const formStatus = floorPlan.formStatus || {};
  if (formStatus.rawText) {
    return formStatus.rawText;
  }
  if (formStatus.status) {
    return hardDeadlineFloorStatusLabel(formStatus.status);
  }
  return readRawFieldDisplay(project, ['硬装方案情况（每周五刷新）', '硬装方案情况', '方案情况']) || '未填写';
}

function hardDeadlineSystemStatusLabel(floorPlan = {}) {
  const systemStatus = floorPlan.systemStatus || {};
  return hardDeadlineFloorStatusLabel(systemStatus.status || floorPlan.completionStatus || floorPlan.startStatus);
}

function hardDeadlineBooleanDelayLabel(delayStatus = {}) {
  if (!('isDelayed' in delayStatus)) {
    return '';
  }
  if (!delayStatus.status && !delayStatus.source && !delayStatus.date) {
    return '';
  }
  return delayStatus.isDelayed ? '延期' : '未延期';
}

function hardDeadlineFinalStatusLabel(floorPlan = {}) {
  const finalDelayStatus = floorPlan.finalDelayStatus || {};
  const status = finalDelayStatus.status || floorPlan.completionStatus || floorPlan.startStatus;
  return status ? hardDeadlineFloorStatusLabel(status) : hardDeadlineBooleanDelayLabel(finalDelayStatus) || '--';
}

function hardDeadlineEfficiencySummaryLabel(floorPlan = {}) {
  const efficiencyModel = floorPlan.efficiencyStatusModel || {};
  return hardDeadlineEfficiencyLabel(
    efficiencyModel.status || floorPlan.efficiencyStatus,
    floorPlan.efficiencySummary
  );
}


export function hardDeadlineReminderItems(project = {}) {
  const reminders = Array.isArray(project.reminders) ? project.reminders : [];
  const normalized = reminders
    .filter(isHardDeadlineReminder)
    .map(normalizeSystemProjectReminder)
    .filter(Boolean);
  if (normalized.length) {
    return normalized;
  }
  const primary = normalizeSystemProjectReminder(project.primaryReminder);
  return primary ? [primary] : [];
}


export function projectDeadlineReminderBody(reminder = {}) {
  const message = String(reminder.message || '').trim();
  const title = String(reminder.title || '').trim();
  if (message && title && message.startsWith(`${title} · `)) {
    return message.slice(title.length + 3).trim();
  }
  return message || title;
}


export function renderProjectHardDeadlineSummary(project = {}) {
  const hardDeadline = project.hardDeadline;
  if (!hardDeadline) {
    return '';
  }
  const floorPlan = hardDeadline.floorPlan || {};
  const finalDelayStatus = floorPlan.finalDelayStatus || {};
  const reminders = hardDeadlineReminderItems(project);
  const summaryItems = [
    { label: '规则状态', value: hardDeadlineStatusLabel(hardDeadline.status) },
    { label: '面积档', value: hardDeadline.areaBucket?.label || (hardDeadline.reason ? '待复核' : '') },
    { label: '复尺时间', value: hardDeadline.measureDate },
    { label: '平面启动', value: floorPlan.startDueDate },
    { label: '提醒触发', value: floorPlan.warnDueDate },
    { label: '平面截止', value: floorPlan.dueDate },
    { label: '最终延期状态', value: hardDeadlineFinalStatusLabel(floorPlan) },
    { label: '最终来源', value: hardDeadlineFinalSourceLabel(finalDelayStatus.source) },
    { label: '表单判断', value: hardDeadlineFormStatusLabel(floorPlan, project) },
    { label: '规则判断', value: hardDeadlineSystemStatusLabel(floorPlan) },
    { label: '复核状态', value: hardDeadlineReviewLabel(floorPlan.conflictReview) },
    { label: '效率判断', value: hardDeadlineEfficiencySummaryLabel(floorPlan) },
  ].filter((item) => item.value !== undefined && item.value !== null && String(item.value).trim());

  return `
    <section class="project-detail-deadline" aria-label="硬装 Deadline">
      <div class="project-detail-deadline-head">
        <div>
          <span>硬装 Deadline</span>
          <strong>最终状态与规则复核</strong>
        </div>
        <small>${escapeHtml(hardDeadline.ruleVersion || '规则版本待记录')}</small>
      </div>
      <div class="project-detail-deadline-grid">
        ${summaryItems
          .map(
            (item) => `
              <div>
                <span>${escapeHtml(item.label)}</span>
                <strong title="${escapeHtml(displayOrDash(item.value))}">${escapeHtml(displayOrDash(item.value))}</strong>
              </div>
            `
          )
          .join('')}
      </div>
      ${
        reminders.length
          ? `
            <div class="project-detail-deadline-reminders">
              ${reminders
                .map(
                  (reminder) => `
                    <article class="project-detail-deadline-reminder is-${escapeHtml(reminder.severity || 'info')}">
                      <span>${escapeHtml(reminder.label || '系统提醒')}</span>
                      <strong>${escapeHtml(reminder.title || reminder.message || '硬装 Deadline 提醒')}</strong>
                      <p>${escapeHtml(projectDeadlineReminderBody(reminder))}</p>
                    </article>
                  `
                )
                .join('')}
            </div>
          `
          : ''
      }
    </section>
  `;
}


export function renderProjectDetailModalLoading(project = {}) {
  if (!elements.projectDetailModal || !elements.projectDetailModalBody) {
    return;
  }

  elements.projectDetailModalBody.innerHTML = `
    <header class="project-detail-hero">
      <div>
        <p class="eyebrow">单项项目</p>
        <h3 id="projectDetailTitle" title="${escapeHtml(project.name || '')}">${escapeHtml(project.name || '未命名项目')}</h3>
      </div>
    </header>
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
    <header class="project-detail-hero">
      <div>
        <p class="eyebrow">单项项目</p>
        <h3 id="projectDetailTitle" title="${escapeHtml(project.name || '')}">${escapeHtml(project.name || '未命名项目')}</h3>
      </div>
    </header>
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
  const stage = displayOrDash(readProjectStage(project));
  const closed = isProjectWorkflowClosed(project);
  const closedForReminder = closed && !stopped;
  const keyDateText = closedForReminder ? '' : readProjectKeyDate(project);
  const assignmentReminder = stopped ? '' : renderProjectAssignmentReminder(project);
  const fieldGapReminder = stopped ? '' : renderProjectFieldGapReminder(project);
  const statusConflictReminder = stopped ? '' : renderProjectStatusConflictReminder(project);
  const hardDeadlineSummary = stopped ? '' : renderProjectHardDeadlineSummary(project);
  const singleTrackLifecycleNote = stopped ? '' : renderSingleTrackLifecycleNote(project);

  elements.projectDetailModalBody.innerHTML = `
    <header class="project-detail-hero">
      <div>
        <p class="eyebrow">单项项目</p>
        <h3 id="projectDetailTitle" title="${escapeHtml(project.name)}">${escapeHtml(project.name || '未命名项目')}</h3>
      </div>
    </header>
    ${renderProjectDetailContext(state.projectDetailContext, project)}
    ${singleTrackLifecycleNote}
    ${assignmentReminder}
    ${fieldGapReminder}
    ${statusConflictReminder}
    ${hardDeadlineSummary}
    <div class="project-detail-meta">
      ${metaItems
        .map(
          (item) => `
            <div>
              <span>${escapeHtml(item.label)}</span>
              <strong title="${escapeHtml(displayOrDash(item.value))}">${escapeHtml(displayOrDash(item.value))}</strong>
            </div>
          `
        )
        .join('')}
    </div>
    <div class="project-detail-progress">
      <div>
        <span>当前节点</span>
        <strong title="${escapeHtml(stage)}">${renderProjectStageStack(project)}</strong>
      </div>
      ${
        closedForReminder
          ? ''
          : `<div>
              <span>下一提醒</span>
              <strong title="${escapeHtml(keyDateText)}">${renderProjectKeyDateStack(project)}</strong>
            </div>`
      }
    </div>
    ${buildProjectDetailFieldGroups().map((group) => renderDetailGroup(project, group)).join('')}
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

