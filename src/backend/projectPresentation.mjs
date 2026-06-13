/**
 * Slim project payloads for list/overview APIs. Detail views can request view=full or ?id=.
 */

import {
  compactProjectStageReminder,
  compactProjectWorkflowFacts,
  resolveProjectStageReminder,
} from '../../public/domain/project-stage-reminder-rules.mjs';
import { readFranchiseScope, readWorkflowStage } from './metrics/fieldSemantics.mjs';

const SUMMARY_PROJECT_FIELDS = [
  'id',
  'name',
  'province',
  'businessType',
  'storeStatus',
  'status',
  'owner',
  'ownerDisplay',
  'hardOwner',
  'softOwner',
  'cdOwner',
  'vmOwner',
  'progress',
  'hardProgressStage',
  'softProgressStage',
  'franchiseScope',
  'startDate',
  'dueDate',
  'updatedAt',
  'isDelayed',
  'scheduleStatus',
  'riskLevel',
  'riskNotes',
  'localNotes',
  'source',
  'difficultyScore',
  'difficultyLevel',
  'difficultyWeight',
  'difficultyWorkdays',
  'primaryReminder',
];

export function summarizeRawFields(rawFields = {}) {
  const summary = {};
  for (const [key, cell] of Object.entries(rawFields)) {
    const display = String(cell?.display ?? '').trim();
    if (!display) {
      continue;
    }
    summary[key] = {
      display,
      kind: cell?.kind || 'text',
    };
  }
  return summary;
}

export function summarizeProject(project = {}) {
  if (!project || typeof project !== 'object') {
    return project;
  }
  const summary = {};
  for (const key of SUMMARY_PROJECT_FIELDS) {
    if (project[key] !== undefined) {
      summary[key] = project[key];
    }
  }
  const stageReminder = resolveProjectStageReminder(project);
  summary.hardProgressStage = summary.hardProgressStage || readWorkflowStage(project, { discipline: 'hard' });
  summary.softProgressStage = summary.softProgressStage || readWorkflowStage(project, { discipline: 'soft' });
  summary.franchiseScope = summary.franchiseScope || project.franchiseScope || readFranchiseScope(project);
  summary.stageReminder = compactProjectStageReminder(stageReminder);
  summary.workflowFacts = compactProjectWorkflowFacts(stageReminder.facts);
  if (project.recordMeta) {
    summary.recordMeta = {
      id: project.recordMeta.id,
      lastModifiedTime: project.recordMeta.lastModifiedTime,
    };
  }
  return summary;
}

export function summarizeProjects(projects = []) {
  return Array.isArray(projects) ? projects.map(summarizeProject) : [];
}

export function findProjectInSnapshot(projects = [], projectId = '') {
  const needle = String(projectId || '').trim();
  if (!needle) {
    return null;
  }
  return (
    projects.find((project) => project.id === needle || project.recordMeta?.id === needle) || null
  );
}
