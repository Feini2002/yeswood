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
const MEETING_DATE_FIELDS = ['上会日期'];
const CLOSURE_CYCLE_FIELDS = ['闭环周期', '闭环期', '项目闭环周期'];
const DISPLAY_ACTIVE_STAGE_PATTERN = /摆场/;
const NOT_STARTED_PATTERN = /未完成|未开始|未启动|未安排/;
const STOPPED_PATTERN = /暂停|停止|取消|撤销|作废|废弃|终止/;

function firstRawDisplay(project, fields) {
  return readRawDisplay(project, fields);
}

export function isReliableCompletionDate(value) {
  const text = normalizeCell(value);
  if (!text) {
    return false;
  }
  const date = new Date(text);
  return !Number.isNaN(date.getTime());
}

function readReliableDate(project, fields) {
  const value = firstRawDisplay(project, fields);
  return isReliableCompletionDate(value) ? value : '';
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
  const text = normalizeCell(dateValue);
  const match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date(text);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return utcDate.toISOString().slice(0, 10);
}

function readLifecycleCompletedAt(project) {
  const meetingDate = readReliableDate(project, MEETING_DATE_FIELDS);
  const cycleDays = parseClosureCycleDays(firstRawDisplay(project, CLOSURE_CYCLE_FIELDS));
  if (!meetingDate || cycleDays === null) {
    return '';
  }
  return addCalendarDays(meetingDate, cycleDays);
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

function stateResult(key, { completed, inProgress, status = '', completedAt = '', evidence = [] }) {
  const safeCompletedAt = isReliableCompletionDate(completedAt) ? completedAt : '';
  return {
    key,
    state: completed ? 'completed' : inProgress ? 'inProgress' : 'none',
    completed: Boolean(completed),
    inProgress: Boolean(inProgress),
    status,
    completedAt: safeCompletedAt,
    missingDate: Boolean(completed && !safeCompletedAt),
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
  const completed = Boolean(completedAt);
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  const inProgress =
    !completed &&
    !isProjectStoppedForCompletion(project) &&
    (hasStartedProgress(hardStage, DISPLAY_ACTIVE_STAGE_PATTERN) ||
      hasStartedProgress(softStage, DISPLAY_ACTIVE_STAGE_PATTERN));
  return stateResult('display', {
    completed,
    inProgress,
    status: completed ? '摆场文件已发出' : [hardStage, softStage].filter(Boolean).join(' / '),
    completedAt,
    evidence: [
      completedAt ? '摆场文件发出时间(项目群）' : '',
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
  const completedAt = completed ? readLifecycleCompletedAt(project) : '';
  return stateResult('lifecycle', {
    completed,
    inProgress:
      !completed &&
      !isProjectStoppedForCompletion(project) &&
      (hasStartedProgress(hardStage) || hasStartedProgress(softStage)),
    status: [hardStage, softStage].filter(Boolean).join(' / '),
    completedAt,
    evidence: [
      '硬装项目进度',
      isSleepStoreProject(project) ? '' : '软装项目进度',
      completedAt ? '上会日期 + 闭环周期' : '',
    ].filter(Boolean),
  });
}
