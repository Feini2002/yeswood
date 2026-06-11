import { isSleepHardDecorationClosed, isSleepStoreProject } from '../projectTypeRules.mjs';
import { normalizeCell, readRawDisplay, readWorkflowStage } from './fieldSemantics.mjs';

const HARD_SCHEME_STATUS_FIELDS = ['硬装方案情况（每周五刷新）', '硬装方案情况', '方案情况'];
const HARD_SCHEME_COMPLETION_DATE_FIELDS = ['硬装方案完成时间', '躺平内部审核结束时间', '内部审核结束时间'];
const POINT_STATUS_FIELDS = ['点位完成情况'];
const POINT_COMPLETION_DATE_FIELDS = ['点位完成时间'];
const SOFT_COMPLETION_STATUS_FIELDS = ['软装完成情况'];
const SOFT_COMPLETION_DATE_FIELDS = ['软装完成时间'];
const DISPLAY_COMPLETION_DATE_FIELDS = [
  '摆场文件发出时间(项目群）',
  '摆场文件发出时间（项目群）',
  '摆场时间',
  '现场摆场时间',
  '摆场开始时间',
];
const COMPLETE_STATUS_PATTERN = /准时完成|延期完成|已完成|完成|闭环/;
const INCOMPLETE_STATUS_PATTERN = /未完成|未开始|未启动|未安排|待|延期中|暂停/;
const DISPLAY_ACTIVE_STAGE_PATTERN = /点位|软装方案|产品清单|待采购|采购|摆场/;
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

function isCompleteStatus(value) {
  const text = normalizeCell(value);
  if (!text || INCOMPLETE_STATUS_PATTERN.test(text)) {
    return false;
  }
  return COMPLETE_STATUS_PATTERN.test(text);
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
  const completedAt = readReliableDate(project, HARD_SCHEME_COMPLETION_DATE_FIELDS);
  const completed = isCompleteStatus(status) || Boolean(completedAt);
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  const started =
    Boolean(completedAt) ||
    hasStartedProgress(status) ||
    hasStartedProgress(hardStage, /平面|方案|施工图|施工|审核|闭环/);
  const inProgress = !completed && !isProjectStoppedForCompletion(project) && started;
  return stateResult('floorPlan', {
    completed,
    inProgress,
    status: status || hardStage,
    completedAt,
    evidence: [status ? '硬装方案情况' : '', completedAt ? '硬装方案完成时间' : ''].filter(Boolean),
  });
}

export function resolveDisplayCompletionState(project) {
  if (isSleepStoreProject(project)) {
    return stateResult('display', { completed: false, inProgress: false });
  }
  const pointStatus = firstRawDisplay(project, POINT_STATUS_FIELDS);
  const softCompletionStatus = firstRawDisplay(project, SOFT_COMPLETION_STATUS_FIELDS);
  const completedAt =
    readReliableDate(project, POINT_COMPLETION_DATE_FIELDS) ||
    readReliableDate(project, SOFT_COMPLETION_DATE_FIELDS) ||
    readReliableDate(project, DISPLAY_COMPLETION_DATE_FIELDS);
  const completed = isCompleteStatus(pointStatus) || isCompleteStatus(softCompletionStatus) || Boolean(completedAt);
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  const inProgress =
    !completed && !isProjectStoppedForCompletion(project) && hasStartedProgress(softStage, DISPLAY_ACTIVE_STAGE_PATTERN);
  return stateResult('display', {
    completed,
    inProgress,
    status: pointStatus || softCompletionStatus || softStage,
    completedAt,
    evidence: [
      pointStatus ? '点位完成情况' : '',
      softCompletionStatus ? '软装完成情况' : '',
      completedAt ? '点位/软装/摆场完成时间' : '',
      !completed && softStage ? '软装项目进度' : '',
    ].filter(Boolean),
  });
}

export function isCompanyLifecycleClosed(project) {
  if (isSleepStoreProject(project)) {
    return isSleepHardDecorationClosed(project);
  }
  return (
    readWorkflowStage(project, { discipline: 'hard' }) === '闭环' &&
    readWorkflowStage(project, { discipline: 'soft' }) === '闭环'
  );
}

export function resolveCompanyLifecycleState(project) {
  const completed = isCompanyLifecycleClosed(project);
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  return {
    ...stateResult('lifecycle', {
      completed,
      inProgress:
        !completed &&
        !isProjectStoppedForCompletion(project) &&
        (hasStartedProgress(hardStage) || hasStartedProgress(softStage)),
      status: [hardStage, softStage].filter(Boolean).join(' / '),
      completedAt: '',
      evidence: ['硬装项目进度', isSleepStoreProject(project) ? '' : '软装项目进度'].filter(Boolean),
    }),
    completedAt: '',
    missingDate: false,
  };
}
