import { isSleepHardDecorationClosed, isSleepStoreProject } from '../projectTypeRules.mjs';
import { normalizeCell, readRawDisplay, readWorkflowStage } from './fieldSemantics.mjs';

const HARD_SCHEME_STATUS_FIELDS = ['硬装方案情况（每周五刷新）', '硬装方案情况', '方案情况'];
const HARD_SCHEME_START_FIELDS = [
  '平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）',
  '平面开始时间',
];
const HARD_SCHEME_COMPLETION_DATE_FIELDS = ['躺平内部审核结束时间', '内部审核结束时间', '硬装方案完成时间'];
const DISPLAY_COMPLETION_DATE_FIELDS = [
  '摆场文件发出时间(项目群）',
  '摆场文件发出时间（项目群）',
];
const DISPLAY_START_DATE_FIELDS = ['摆场开始时间', '摆场时间', '现场摆场时间'];
const MEETING_DATE_FIELDS = ['上会时间', '上会日期'];
const CLOSURE_CYCLE_FIELDS = ['闭环周期', '闭环期', '项目闭环周期'];
const LIFECYCLE_COMPLETION_DATE_FIELDS = ['项目闭环时间', '项目闭环日期', '闭环时间', '闭环日期', '闭环完成时间'];
const PROJECT_DEADLINE_DATE_FIELDS = ['项目 Deadline', '项目Deadline', '计划开业时间'];
const DISPLAY_ACTIVE_STAGE_PATTERN = /摆场/;
const NOT_STARTED_PATTERN = /未完成|未开始|未启动|未安排/;
const STOPPED_PATTERN = /暂停|停止|取消|撤销|作废|废弃|终止/;

function firstRawDisplay(project, fields) {
  return readRawDisplay(project, fields);
}

function formatDateParts(year, month, day) {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    return '';
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

function normalizeReliableCompletionDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return '';
    }
    return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const text = normalizeCell(value).replace(/,/g, '');
  if (!text) {
    return '';
  }
  const explicit = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (explicit) {
    return formatDateParts(Number(explicit[1]), Number(explicit[2]), Number(explicit[3]));
  }
  return '';
}

export function isReliableCompletionDate(value) {
  return Boolean(normalizeReliableCompletionDate(value));
}

function readReliableDate(project, fields) {
  const value = firstRawDisplay(project, fields);
  return normalizeReliableCompletionDate(value);
}

function readReliableRawDateWithEvidence(project, fields, evidenceLabel = '') {
  for (const field of fields) {
    const value = firstRawDisplay(project, [field]);
    const date = normalizeReliableCompletionDate(value);
    if (date) {
      return { date, evidence: evidenceLabel || field };
    }
  }
  return { date: '', evidence: '' };
}

function readProjectDeadlineDate(project) {
  const rawDeadline = readReliableRawDateWithEvidence(project, PROJECT_DEADLINE_DATE_FIELDS, '项目 Deadline');
  if (rawDeadline.date) {
    return rawDeadline;
  }
  const dueDate = normalizeReliableCompletionDate(project?.dueDate);
  return dueDate ? { date: dueDate, evidence: '项目 Deadline' } : { date: '', evidence: '' };
}

function parseClosureCycleDays(value) {
  const text = normalizeCell(value);
  if (!text) {
    return null;
  }
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const number = Number(match[0]);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }
  return Math.trunc(number);
}

function addCalendarDays(dateValue, days) {
  const normalizedDate = normalizeReliableCompletionDate(dateValue);
  const match = normalizedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : new Date('');
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return utcDate.toISOString().slice(0, 10);
}

function readLifecycleCompletedAt(project) {
  const explicitDate = readReliableRawDateWithEvidence(project, LIFECYCLE_COMPLETION_DATE_FIELDS);
  if (explicitDate.date) {
    return explicitDate;
  }
  const meetingDate = readReliableDate(project, MEETING_DATE_FIELDS);
  const cycleDays = parseClosureCycleDays(firstRawDisplay(project, CLOSURE_CYCLE_FIELDS));
  if (meetingDate && cycleDays !== null) {
    return {
      date: addCalendarDays(meetingDate, cycleDays),
      evidence: '上会时间/上会日期 + 闭环周期',
    };
  }
  return readProjectDeadlineDate(project);
}

export function isProjectStoppedForCompletion(project) {
  const text = [
    project?.status,
    readWorkflowStage(project, { discipline: 'hard' }),
    readWorkflowStage(project, { discipline: 'soft' }),
    firstRawDisplay(project, ['项目状态', '状态']),
  ]
    .map(normalizeCell)
    .filter(Boolean)
    .join(' ');
  return STOPPED_PATTERN.test(text);
}

function hasStartedProgress(value, activePattern = null) {
  const text = normalizeCell(value);
  if (!text || STOPPED_PATTERN.test(text) || NOT_STARTED_PATTERN.test(text)) {
    return false;
  }
  return activePattern ? activePattern.test(text) : true;
}

function stateResult(key, { completed, inProgress, status = '', completedAt = '', evidence = [], missingDate = null }) {
  const safeCompletedAt = normalizeReliableCompletionDate(completedAt);
  const resolvedMissingDate = missingDate === null ? Boolean(completed && !safeCompletedAt) : Boolean(missingDate);
  return {
    key,
    state: completed ? 'completed' : inProgress ? 'inProgress' : 'none',
    completed: Boolean(completed),
    inProgress: Boolean(inProgress),
    status,
    completedAt: safeCompletedAt,
    missingDate: resolvedMissingDate,
    evidence,
  };
}

export function resolveFloorPlanCompletionState(project) {
  const status = firstRawDisplay(project, HARD_SCHEME_STATUS_FIELDS);
  const startedAt = firstRawDisplay(project, HARD_SCHEME_START_FIELDS);
  const completedAt = readReliableDate(project, HARD_SCHEME_COMPLETION_DATE_FIELDS);
  const completed = Boolean(completedAt);
  const started = Boolean(startedAt);
  const inProgress = !completed && !isProjectStoppedForCompletion(project) && started;
  return stateResult('floorPlan', {
    completed,
    inProgress,
    status: status || startedAt,
    completedAt,
    evidence: [startedAt ? '平面开始时间' : '', completedAt ? '躺平内部审核结束时间' : ''].filter(Boolean),
  });
}

export function resolveDisplayCompletionState(project) {
  if (isSleepStoreProject(project)) {
    return stateResult('display', { completed: false, inProgress: false });
  }
  const completedAt = readReliableDate(project, DISPLAY_COMPLETION_DATE_FIELDS);
  const startedAt = readReliableDate(project, DISPLAY_START_DATE_FIELDS);
  const completed = Boolean(completedAt);
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  const inProgress =
    !completed &&
    !isProjectStoppedForCompletion(project) &&
    (Boolean(startedAt) ||
      hasStartedProgress(hardStage, DISPLAY_ACTIVE_STAGE_PATTERN) ||
      hasStartedProgress(softStage, DISPLAY_ACTIVE_STAGE_PATTERN));
  return stateResult('display', {
    completed,
    inProgress,
    status: completed ? '摆场文件已发出' : startedAt ? '摆场已开始' : [hardStage, softStage].filter(Boolean).join(' / '),
    completedAt,
    evidence: [
      completedAt ? '摆场文件发出时间(项目群）' : '',
      !completed && startedAt ? '摆场开始时间' : '',
      !completed && hardStage ? '硬装项目进度' : '',
      !completed && softStage ? '软装项目进度' : '',
    ].filter(Boolean),
  });
}

function isClosedWorkflowStage(stage) {
  return normalizeCell(stage) === '闭环';
}

export function isCompanyLifecycleClosed(project) {
  if (isSleepStoreProject(project)) {
    return isSleepHardDecorationClosed(project);
  }
  return (
    isClosedWorkflowStage(readWorkflowStage(project, { discipline: 'hard' })) ||
    isClosedWorkflowStage(readWorkflowStage(project, { discipline: 'soft' }))
  );
}

export function resolveCompanyLifecycleState(project) {
  const completed = isCompanyLifecycleClosed(project);
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  const completionDate = completed ? readLifecycleCompletedAt(project) : { date: '', evidence: '' };
  const completedAt = completionDate.date;
  return stateResult('lifecycle', {
    completed,
    inProgress:
      !completed &&
      !isProjectStoppedForCompletion(project) &&
      (hasStartedProgress(hardStage) || hasStartedProgress(softStage)),
    status: [hardStage, softStage].filter(Boolean).join(' / '),
    completedAt,
    missingDate: false,
    evidence: [
      '硬装项目进度',
      isSleepStoreProject(project) ? '' : '软装项目进度',
      completionDate.evidence,
    ].filter(Boolean),
  });
}
