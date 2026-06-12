import { formatDate } from '../lib/format.mjs';
import {
  isSleepStoreProject,
  readRawFieldDisplay,
  displayProjectHardOwner,
  displayProjectSoftOwner,
} from './project-display.mjs';
import { resolveProjectStageReminder } from './project-stage-reminder-rules.mjs';
import {
  readProjectNodeValue,
  hasProjectNodeValue,
  isCanceledWorkflowStage,
  isPausedWorkflowStage,
  hasActivePointDesignStartSignal,
  needsPointCompletionEvidence,
  readFirstFilledProjectField,
  projectFieldGapOwner,
  isProjectMeetingStageComplete,
  isProjectMeasureStageComplete,
  inferHardNodeProgress,
  shouldPromptHardNode,
  readWorkflowStage,
  readEffectiveWorkflowStage,
  isHardWorkflowClosed,
  isSoftDesignClosed,
  isCompanyLifecycleClosed,
  isSoftCompletionDone,
  resolvePrimaryWorkflowDiscipline,
  resolveWorkflowStageDateRule,
  isProjectNodeStatusComplete,
  isPausedOrCanceledProject,
  projectStopState,
  PROJECT_NODE_FIELD_ALIASES,
  HARD_SCHEME_COMPLETION_DATE_FIELDS,
  FOLLOW_UP_STAGE_PATTERN,
  projectWorkbenchStageRank,
  isProjectWorkflowClosed,
  readProjectClosureDate,
  parseProjectSortTimestamp,
} from './project-workflow.mjs';

const HARD_DEADLINE_REMINDER_TYPES = new Set(['missing_field', 'manual_review', 'conflict', 'due_soon', 'overdue']);
const HARD_DEADLINE_REMINDER_SOURCES = new Set(['system_deadline', 'missing_field', 'manual_review', 'form_conflict']);

export function projectFieldGapReminders(project) {
  if (isProjectWorkflowClosed(project) || isPausedOrCanceledProject(project)) {
    return [];
  }

  const reminders = [];
  const hardSchemeStatus = readProjectNodeValue(project, 'hardSchemeStatus');
  if (isProjectNodeStatusComplete(hardSchemeStatus) && !readFirstFilledProjectField(project, HARD_SCHEME_COMPLETION_DATE_FIELDS)) {
    reminders.push({
      key: 'hardSchemeCompletionDate',
      title: '硬装方案时间缺失',
      track: '硬装',
      basis: `硬装方案情况：${hardSchemeStatus}`,
      owner: projectFieldGapOwner(project, ['CD设计师'], displayProjectHardOwner(project)),
      missingFields: HARD_SCHEME_COMPLETION_DATE_FIELDS,
    });
  }

  if (!isSleepStoreProject(project) && needsPointCompletionEvidence(project) && !hasProjectNodeValue(project, 'pointDone')) {
    const basis =
      readProjectNodeValue(project, 'pointStatus') ||
      readWorkflowStage(project, 'soft') ||
      '软装点位已完成';
    reminders.push({
      key: 'pointCompletionTime',
      title: '点位完成时间缺失',
      track: '软装',
      basis: `点位依据：${basis}`,
      owner: projectFieldGapOwner(project, ['点位' + '设计师', 'VM设计师'], displayProjectSoftOwner(project)),
      missingFields: ['点位完成时间'],
    });
  }

  if (!isSleepStoreProject(project) && hasProjectNodeValue(project, 'pointDone') && !readProjectNodeValue(project, 'pointStatus')) {
    reminders.push({
      key: 'pointCompletionStatus',
      title: '点位完成情况缺失',
      track: '软装',
      basis: `点位完成时间：${readProjectNodeValue(project, 'pointDone')}`,
      owner: projectFieldGapOwner(project, ['点位' + '设计师', 'VM设计师'], displayProjectSoftOwner(project)),
      missingFields: ['点位完成情况'],
    });
  }

  return reminders;
}


export function makeProjectReminder({
  label,
  raw = '',
  discipline = '',
  stage = '',
  message = '',
  missing = false,
  kind = 'node',
} = {}) {
  return {
    label,
    raw,
    formatted: raw ? formatDate(raw) : '--',
    discipline,
    stage,
    message,
    missing,
    kind,
  };
}

export function isHardDeadlineReminder(reminder = {}) {
  if (!reminder || reminder.discipline !== 'hard') {
    return false;
  }
  const nodeKey = String(reminder.nodeKey || '');
  return (
    HARD_DEADLINE_REMINDER_SOURCES.has(reminder.source) ||
    HARD_DEADLINE_REMINDER_TYPES.has(reminder.type) ||
    nodeKey === 'ruleBasis' ||
    nodeKey.startsWith('floorPlan') ||
    nodeKey.startsWith('construction') ||
    nodeKey.startsWith('mall')
  );
}


export function normalizeSystemProjectReminder(reminder = {}) {
  if (!reminder || !reminder.label || !isHardDeadlineReminder(reminder)) {
    return null;
  }
  const dueDate = reminder.dueDate || reminder.remindDate || '';
  const message = [reminder.title, reminder.message].filter(Boolean).join(' · ');
  return {
    ...makeProjectReminder({
      label: reminder.label,
      raw: dueDate,
      discipline: reminder.discipline || 'hard',
      stage: reminder.nodeKey || '硬装 Deadline',
      message,
      missing: ['missing_field', 'manual_review'].includes(reminder.type),
      kind: reminder.source === 'system_deadline' ? 'system_deadline' : reminder.type || 'deadline',
    }),
    ...reminder,
    raw: dueDate,
    formatted: dueDate ? formatDate(dueDate) : '--',
    message,
  };
}


export function projectReminderTrackLabel(reminder = {}) {
  if (reminder.kind === 'system_deadline' || reminder.source === 'system_deadline') {
    return '系统 Deadline';
  }
  if (reminder.discipline === 'followup' || reminder.kind === 'followup') {
    return '后续跟进';
  }
  if (reminder.kind === 'status') {
    return '状态';
  }
  return reminder.discipline === 'soft' ? '软装' : '硬装';
}


export function projectHardDeadlineExceptionReminder(project = {}) {
  const reminders = Array.isArray(project.reminders) ? project.reminders : [];
  return reminders.find(
    (reminder) =>
      isHardDeadlineReminder(reminder) &&
      (['manual_review', 'missing_field', 'conflict'].includes(reminder.type) || reminder.source === 'missing_field')
  ) || (project.hardDeadline?.status === 'needs_manual_review' ? normalizeSystemProjectReminder(project.primaryReminder) : null);
}


export function hasHardDeadlineException(project = {}) {
  return Boolean(projectHardDeadlineExceptionReminder(project) || project.hardDeadline?.status === 'needs_manual_review');
}


export function isHardDeadlineKeyDateException(reminder = {}) {
  if (!reminder || !isHardDeadlineReminder(reminder)) {
    return false;
  }
  const title = String(reminder.title || '');
  const message = String(reminder.message || '');
  const combined = `${title}${message}`;
  return (
    ['manual_review', 'missing_field', 'conflict'].includes(reminder.type) ||
    reminder.source === 'missing_field' ||
    reminder.nodeKey === 'ruleBasis' ||
    reminder.missing ||
    /硬装\s*Deadline/i.test(combined) ||
    /暂不能计算|暂不统计|待复核/.test(combined)
  );
}


export function hardDeadlineExceptionReason(project = {}, reminder = null) {
  if (reminder?.message) {
    return reminder.message;
  }
  const missing = project.hardDeadline?.missing || [];
  if (missing.length) {
    const labels = missing.map((item) => (item === 'measureDate' ? '复尺时间' : item === 'areaBucket' ? '面积' : item));
    return `缺少${labels.join('、')}，暂不能计算系统 Deadline。`;
  }
  return project.hardDeadline?.reason || '系统与表单或规则基础需人工复核。';
}


export function hardDeadlineExceptionAction(reminder = null) {
  if (reminder?.source === 'missing_field') {
    return '补齐字段 / 标记规则暂不适用';
  }
  if (reminder?.type === 'conflict') {
    return '复核表单与系统差异';
  }
  return '打开详情查看依据';
}


export function readNormalizedProjectDate(project, fieldNames = []) {
  return readRawFieldDisplay(project, fieldNames);
}


export function resolvePrimaryProjectKeyDate(project) {
  return resolveProjectStageReminder(project).primaryReminder;
}


export function isEmptyProjectReminder(reminder) {
  return !reminder?.label && !reminder?.raw && reminder?.formatted === '--' && !reminder?.message;
}


export function projectReminderIdentity(reminder) {
  return [reminder?.discipline || '', reminder?.label || '', reminder?.message || '', reminder?.kind || ''].join('|');
}


export function resolvePointHandoffReminder(project) {
  if (
    isSleepStoreProject(project) ||
    isCompanyLifecycleClosed(project) ||
    !hasActivePointDesignStartSignal(project) ||
    isPausedOrCanceledProject(project) ||
    isSoftDesignClosed(project) ||
    hasProjectNodeValue(project, 'pointDone')
  ) {
    return null;
  }
  return makeProjectReminder({
    label: '点位完成',
    discipline: 'soft',
    stage: readEffectiveWorkflowStage(project, 'soft') || '点位设计',
    message: '待点位完成',
    missing: true,
  });
}


export function resolveProjectKeyDateReminders(project) {
  const stageReminderResult = resolveProjectStageReminder(project);
  const statusReminder = stageReminderResult.primaryReminder;
  if (statusReminder.kind === 'status' && ['暂停', '取消'].includes(statusReminder.label)) {
    return [statusReminder];
  }
  if (isEmptyProjectReminder(statusReminder)) {
    return [statusReminder];
  }
  const systemPrimary = normalizeSystemProjectReminder(project?.primaryReminder);
  if (systemPrimary && !isHardDeadlineKeyDateException(systemPrimary)) {
    return [systemPrimary];
  }
  const reminders = (stageReminderResult.reminders || []).filter((item) => !isEmptyProjectReminder(item));
  const pointReminder = resolvePointHandoffReminder(project);
  if (pointReminder && !reminders.some((item) => projectReminderIdentity(item) === projectReminderIdentity(pointReminder))) {
    reminders.push(pointReminder);
  }
  return reminders.length ? reminders : [statusReminder];
}


export function resolveProjectKeyDate(project) {
  return resolveProjectKeyDateReminders(project)[0];
}


export function formatProjectReminderText(keyDate) {
  if (keyDate.source === 'system_deadline' || keyDate.kind === 'system_deadline') {
    const title = String(keyDate.title || '');
    const detail = /硬装\s*Deadline/i.test(title) ? keyDate.message || '' : title || keyDate.message;
    return [keyDate.label, keyDate.formatted !== '--' ? keyDate.formatted : '', detail]
      .filter(Boolean)
      .join(' · ');
  }
  if (keyDate.missing && keyDate.message) {
    return keyDate.message;
  }
  if (keyDate.formatted === '--' && !keyDate.message) {
    return keyDate.label || '--';
  }
  if (keyDate.formatted === '--') {
    return keyDate.label ? `${keyDate.label} · ${keyDate.message}` : keyDate.message;
  }
  return keyDate.label ? `${keyDate.label} · ${keyDate.formatted}` : keyDate.formatted;
}


export function readProjectKeyDate(project) {
  if (isProjectWorkflowClosed(project) && !isPausedOrCanceledProject(project)) {
    return '--';
  }

  const reminders = resolveProjectKeyDateReminders(project).filter((item) => !isEmptyProjectReminder(item));
  if (!reminders.length) {
    return '--';
  }
  return reminders.map((item) => formatProjectReminderText(item)).join(' / ');
}


export function projectReminderTitle(keyDate) {
  const trackLabel = projectReminderTrackLabel(keyDate);
  return [
    keyDate.stage ? `${trackLabel}节点：${keyDate.stage}` : trackLabel,
    keyDate.label ? `${keyDate.label}${keyDate.raw ? `：${keyDate.raw}` : ''}` : '',
    keyDate.message,
  ].filter(Boolean).join(' · ');
}


export function sortProjectWorkbenchProjects(projects = []) {
  return projects
    .map((project, index) => {
      const keyDate = resolveProjectKeyDate(project);
      const closed = isProjectWorkflowClosed(project);
      return {
        project,
        index,
        keyDate,
        closed,
        stageRank: projectWorkbenchStageRank(project, keyDate),
        activeAt: parseProjectSortTimestamp(keyDate.raw || project?.recordMeta?.createdTime || project?.updatedAt),
        closedAt: parseProjectSortTimestamp(readProjectClosureDate(project)),
      };
    })
    .sort((a, b) => {
      if (a.closed !== b.closed) {
        return a.closed ? 1 : -1;
      }
      if (a.closed && b.closed && a.closedAt !== b.closedAt) {
        return b.closedAt - a.closedAt;
      }
      if (!a.closed && !b.closed && a.stageRank !== b.stageRank) {
        return a.stageRank - b.stageRank;
      }
      if (!a.closed && !b.closed && a.activeAt !== b.activeAt) {
        return b.activeAt - a.activeAt;
      }
      return a.index - b.index;
    })
    .map((item) => item.project);
}

