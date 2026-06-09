import { formatDate } from '../lib/format.mjs';
import {
  isSleepStoreProject,
  readRawFieldDisplay,
  displayProjectHardOwner,
  displayProjectSoftOwner,
} from './project-display.mjs';
import {
  readProjectNodeValue,
  hasProjectNodeValue,
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
  PROJECT_NODE_FIELD_ALIASES,
  HARD_SCHEME_COMPLETION_DATE_FIELDS,
  PAUSED_STAGE_PATTERN,
  FOLLOW_UP_STAGE_PATTERN,
  projectWorkbenchStageRank,
  isProjectWorkflowClosed,
  readProjectClosureDate,
  parseProjectSortTimestamp,
} from './project-workflow.mjs';

const HARD_DEADLINE_REMINDER_TYPES = new Set(['missing_field', 'manual_review', 'conflict', 'due_soon', 'overdue']);
const HARD_DEADLINE_REMINDER_SOURCES = new Set(['system_deadline', 'missing_field', 'manual_review', 'form_conflict']);

export function projectFieldGapReminders(project) {
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
  const rawHardStage = readWorkflowStage(project, 'hard');
  const rawSoftStage = readWorkflowStage(project, 'soft');
  const hardStage = readEffectiveWorkflowStage(project, 'hard');
  const softStage = readEffectiveWorkflowStage(project, 'soft');
  const hardClosed = isHardWorkflowClosed(project);
  const softClosed = isSoftDesignClosed(project);
  const companyClosed = isCompanyLifecycleClosed(project);

  if (PAUSED_STAGE_PATTERN.test(rawHardStage) || PAUSED_STAGE_PATTERN.test(rawSoftStage)) {
    return makeProjectReminder({
      label: '暂停',
      discipline: PAUSED_STAGE_PATTERN.test(rawSoftStage) ? 'soft' : 'hard',
      stage: PAUSED_STAGE_PATTERN.test(rawSoftStage) ? rawSoftStage : rawHardStage,
      message: '项目暂停中',
      kind: 'status',
    });
  }

  if (companyClosed) {
    return makeProjectReminder({
      label: '闭环',
      discipline: isSleepStoreProject(project) ? 'hard' : 'soft',
      stage: softStage || hardStage,
      message: '项目已闭环',
      kind: 'status',
    });
  }

  if (!hardClosed) {
    const meetingStageComplete = isProjectMeetingStageComplete(project);
    const measureStageComplete = isProjectMeasureStageComplete(project);
    const hardNodeProgress = inferHardNodeProgress(project, hardStage, softStage);

    if (!meetingStageComplete && !measureStageComplete && shouldPromptHardNode(hardNodeProgress, 'meeting')) {
      return makeProjectReminder({
        label: '上会',
        discipline: 'hard',
        stage: hardStage,
        message: '待填上会日期',
        missing: true,
      });
    }
    if (!measureStageComplete && shouldPromptHardNode(hardNodeProgress, 'measure')) {
      return makeProjectReminder({
        label: '复尺',
        discipline: 'hard',
        stage: hardStage,
        message: '待填复尺时间',
        missing: true,
      });
    }
    if (!hasProjectNodeValue(project, 'floorPlanStart') && shouldPromptHardNode(hardNodeProgress, 'floorPlanStart')) {
      return makeProjectReminder({
        label: '平面开始',
        discipline: 'hard',
        stage: hardStage,
        message: '待填平面开始时间',
        missing: true,
      });
    }
    if (!hasProjectNodeValue(project, 'floorPlanFinish') && shouldPromptHardNode(hardNodeProgress, 'floorPlanFinish')) {
      return makeProjectReminder({
        label: '平面结束',
        raw: readProjectNodeValue(project, 'floorPlanStart'),
        discipline: 'hard',
        stage: hardStage || '平面阶段',
        message: '待填躺平内部审核结束时间',
        missing: true,
      });
    }
    if (!hasProjectNodeValue(project, 'constructionDraft') && shouldPromptHardNode(hardNodeProgress, 'constructionDraft')) {
      return makeProjectReminder({
        label: '施工图初稿',
        discipline: 'hard',
        stage: hardStage || '施工图阶段',
        message: '待填施工图初稿完成时间',
        missing: true,
      });
    }
    if (!hasProjectNodeValue(project, 'constructionReview') && shouldPromptHardNode(hardNodeProgress, 'constructionReview')) {
      return makeProjectReminder({
        label: '施工图审核',
        raw: readProjectNodeValue(project, 'constructionDraft'),
        discipline: 'hard',
        stage: hardStage || '施工图阶段',
        message: '待填施工图完成审核时间',
        missing: true,
      });
    }
  }

  if (!softClosed && !isSleepStoreProject(project)) {
    const pointEvidenceExpected = needsPointCompletionEvidence(project, softStage);
    if (!pointEvidenceExpected) {
      return makeProjectReminder({
        label: '点位',
        discipline: 'soft',
        stage: softStage,
        message: '软装点位待跟进',
        missing: true,
      });
    }
    if (!hasProjectNodeValue(project, 'pointDone')) {
      return makeProjectReminder({
        label: '点位完成',
        discipline: 'soft',
        stage: softStage,
        message: '待填点位完成时间',
        missing: true,
      });
    }
    if (!hasProjectNodeValue(project, 'softSchemeStart')) {
      return makeProjectReminder({
        label: '软装方案',
        discipline: 'soft',
        stage: softStage,
        message: '待填软装方案开始时间',
        missing: true,
      });
    }
    const softDoneRaw = readProjectNodeValue(project, 'softDoneTime') || readProjectNodeValue(project, 'displayFileSent');
    if (!softDoneRaw) {
      return makeProjectReminder({
        label: '软装完成',
        raw: readProjectNodeValue(project, 'softSchemeStart'),
        discipline: 'soft',
        stage: softStage,
        message: '待填软装发项目群时间',
        missing: true,
      });
    }
    if (!isSoftCompletionDone(project)) {
      return makeProjectReminder({
        label: '软装完成情况',
        raw: softDoneRaw,
        discipline: 'soft',
        stage: softStage,
        message: '待填软装完成情况',
        missing: true,
      });
    }
  }

  if (!isSleepStoreProject(project) && isSoftCompletionDone(project)) {
    if (!hasProjectNodeValue(project, 'productListSent')) {
      return makeProjectReminder({
        label: '产品清单接收',
        discipline: 'followup',
        stage: softStage,
        message: '待填产品清单接收时间',
        missing: true,
        kind: 'followup',
      });
    }
    if (!hasProjectNodeValue(project, 'purchaseTime')) {
      return makeProjectReminder({
        label: '采购',
        discipline: 'followup',
        stage: softStage,
        message: '待填采购时间',
        missing: true,
        kind: 'followup',
      });
    }
    if (!hasProjectNodeValue(project, 'purchaseStatus')) {
      return makeProjectReminder({
        label: '采购情况',
        discipline: 'followup',
        stage: softStage,
        message: '待填采购完成情况',
        missing: true,
        kind: 'followup',
      });
    }
    if (/施工整改/.test(hardStage)) {
      return makeProjectReminder({
        label: '整改',
        discipline: 'followup',
        stage: hardStage,
        message: '施工整改期',
        kind: 'status',
      });
    }
    if (!hasProjectNodeValue(project, 'displayFileSent') && !hasProjectNodeValue(project, 'displayTime')) {
      return makeProjectReminder({
        label: '摆场',
        discipline: 'followup',
        stage: softStage,
        message: '待填摆场文件或摆场时间',
        missing: true,
        kind: 'followup',
      });
    }
  }

  const currentDiscipline = resolvePrimaryWorkflowDiscipline(project);
  const currentStage = readEffectiveWorkflowStage(project, currentDiscipline);
  const rule = resolveWorkflowStageDateRule(currentStage, currentDiscipline);
  if (rule) {
    const raw = readNormalizedProjectDate(project, rule.fields);
    if (raw) {
      return makeProjectReminder({
        label: rule.label,
        raw,
        discipline: FOLLOW_UP_STAGE_PATTERN.test(currentStage) ? 'followup' : currentDiscipline,
        stage: currentStage,
        kind: FOLLOW_UP_STAGE_PATTERN.test(currentStage) ? 'followup' : 'node',
      });
    }
  }

  const displayRaw = isSleepStoreProject(project) ? '' : readProjectNodeValue(project, 'displayTime') || readProjectNodeValue(project, 'displayFileSent');
  if (displayRaw) {
    return makeProjectReminder({
      label: '摆场',
      raw: displayRaw,
      discipline: 'followup',
      stage: softStage,
      message: '摆场节点跟进',
      kind: 'followup',
    });
  }

  return { label: '', raw: '', formatted: '--', discipline: currentDiscipline, stage: currentStage, message: '' };
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
    isPausedWorkflowStage(readWorkflowStage(project, 'hard')) ||
    isPausedWorkflowStage(readWorkflowStage(project, 'soft')) ||
    isSoftDesignClosed(project) ||
    hasProjectNodeValue(project, 'pointDone')
  ) {
    return null;
  }
  return makeProjectReminder({
    label: '点位完成',
    discipline: 'soft',
    stage: readEffectiveWorkflowStage(project, 'soft') || '点位设计',
    message: '待填点位完成时间',
    missing: true,
  });
}


export function resolveProjectKeyDateReminders(project) {
  const systemPrimary = normalizeSystemProjectReminder(project?.primaryReminder);
  if (systemPrimary) {
    return [systemPrimary];
  }
  const primary = resolvePrimaryProjectKeyDate(project);
  const reminders = isEmptyProjectReminder(primary) ? [] : [primary];
  const pointReminder = resolvePointHandoffReminder(project);
  if (pointReminder && !reminders.some((item) => projectReminderIdentity(item) === projectReminderIdentity(pointReminder))) {
    reminders.push(pointReminder);
  }
  return reminders.length ? reminders : [primary];
}


export function resolveProjectKeyDate(project) {
  return resolveProjectKeyDateReminders(project)[0];
}


export function formatProjectReminderText(keyDate) {
  if (keyDate.source === 'system_deadline' || keyDate.kind === 'system_deadline') {
    return [keyDate.label, keyDate.formatted !== '--' ? keyDate.formatted : '', keyDate.title || keyDate.message]
      .filter(Boolean)
      .join(' · ');
  }
  if (keyDate.missing && keyDate.message) {
    return keyDate.label ? `${keyDate.label} · ${keyDate.message}` : keyDate.message;
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

