import {
  isCanceledWorkflowStageText,
  isCurrentPausedWorkflowStageText,
  readWorkflowStage,
} from './fieldSemantics.mjs';
import { readProjectStatusFromRawFields } from '../projectStatus.mjs';

export function isCurrentPausedWorkflowStage(stage) {
  return isCurrentPausedWorkflowStageText(stage);
}

export function isCanceledWorkflowStage(stage) {
  return isCanceledWorkflowStageText(stage);
}

function readProjectStatus(project = {}) {
  return readProjectStatusFromRawFields(project?.rawFields, project?.status);
}

export function isCanceledProject(project) {
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  return (
    isCanceledWorkflowStage(hardStage) ||
    isCanceledWorkflowStage(softStage) ||
    isCanceledWorkflowStage(readProjectStatus(project))
  );
}

/** 看板统计口径：当前硬装或软装项目进度为「暂停」视为暂停店铺，不参与当前 KPI。 */
export function isPausedProject(project) {
  if (isCanceledProject(project)) {
    return false;
  }
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  return isCurrentPausedWorkflowStage(hardStage) || isCurrentPausedWorkflowStage(softStage);
}

export function projectStopState(project) {
  if (isCanceledProject(project)) {
    return { key: 'canceled', label: '取消', message: '项目已取消' };
  }
  if (isPausedProject(project)) {
    return { key: 'paused', label: '暂停', message: '项目暂停中' };
  }
  return { key: 'active', label: '', message: '' };
}

export function isPausedOrCanceledProject(project) {
  return projectStopState(project).key !== 'active';
}

export function partitionProjectsByPaused(projects) {
  const active = [];
  const paused = [];
  const canceled = [];
  const stopped = [];
  for (const project of projects) {
    const state = projectStopState(project);
    if (state.key === 'canceled') {
      canceled.push(project);
      stopped.push(project);
    } else if (state.key === 'paused') {
      paused.push(project);
      stopped.push(project);
    } else {
      active.push(project);
    }
  }
  return { active, paused, canceled, stopped };
}

export function excludePausedProjects(projects) {
  return partitionProjectsByPaused(projects).active;
}

export function countPausedProjects(projects) {
  return partitionProjectsByPaused(projects).paused.length;
}

export function countCanceledProjects(projects) {
  return partitionProjectsByPaused(projects).canceled.length;
}

export function countPausedOrCanceledProjects(projects) {
  return partitionProjectsByPaused(projects).stopped.length;
}
