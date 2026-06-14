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

const SUMMARY_RAW_FIELD_ALIASES = [
  'CD组长',
  'VM组长',
  'CD设计师',
  'VM设计师',
  '点位设计师',
  '面积',
  '启动时间',
  '启动日期',
  '开始日期',
  '计划开业时间',
  '计划完成日期',
  '截止日期',
  '上会时间',
  '上会日期',
  '复尺时间',
  '复尺日期',
  '硬装项目进度',
  '软装项目进度',
  '硬装方案情况',
  '方案情况',
  '平面开始时间',
  '躺平内部审核结束时间',
  '内部审核结束时间',
  '硬装方案完成时间',
  '施工图初稿完成时间',
  '施工图完成审核时间',
  '施工完成时间',
  '点位完成情况',
  '点位完成时间',
  '软装方案开始时间',
  '软装完成情况',
  '软装完成时间',
  '软装发项目群时间',
  '软装发群/完成时间',
  '产品清单发出时间',
  '产品清单接收时间',
  '流程记录：产品清单接收时间',
  '采购时间',
  '采购完成情况',
  '采购情况',
  '摆场开始时间',
  '摆场时间',
  '现场摆场时间',
  '摆场文件发出时间',
];

function shouldKeepSummaryRawField(fieldName = '') {
  const normalized = String(fieldName || '').trim();
  return SUMMARY_RAW_FIELD_ALIASES.some((alias) => normalized === alias || normalized.includes(alias));
}

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

export function summarizeProjectRawFields(rawFields = {}) {
  const summary = summarizeRawFields(rawFields);
  return Object.fromEntries(Object.entries(summary).filter(([key]) => shouldKeepSummaryRawField(key)));
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
  const rawFields = summarizeProjectRawFields(project.rawFields);
  if (Object.keys(rawFields).length) {
    summary.rawFields = rawFields;
  }
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
