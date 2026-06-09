import { readWorkflowStage } from './fieldSemantics.mjs';

/** 看板统计口径：硬装或软装项目进度含「暂停」视为暂停店铺，不参与 KPI。 */
export function isPausedProject(project) {
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  return hardStage.includes('暂停') || softStage.includes('暂停');
}

export function partitionProjectsByPaused(projects) {
  const active = [];
  const paused = [];
  for (const project of projects) {
    if (isPausedProject(project)) {
      paused.push(project);
    } else {
      active.push(project);
    }
  }
  return { active, paused };
}

export function excludePausedProjects(projects) {
  return partitionProjectsByPaused(projects).active;
}

export function countPausedProjects(projects) {
  return partitionProjectsByPaused(projects).paused.length;
}
