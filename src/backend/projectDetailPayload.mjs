import { summarizeRawFields } from './projectPresentation.mjs';

const DETAIL_PROJECT_FIELDS = [
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
  'startDate',
  'dueDate',
  'updatedAt',
  'progress',
  'hardProgressStage',
  'softProgressStage',
  'primaryReminder',
  'reminders',
  'hardDeadline',
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
];

const VOLATILE_ATTACHMENT_PATTERN = /(expires=|signature=|x-amz-|ossaccesskeyid=|token=)/i;

function isVolatileRawField(cell = {}) {
  const display = String(cell?.display ?? '').trim();
  const kind = String(cell?.kind || '').toLowerCase();
  if (kind === 'attachment') {
    return true;
  }
  return VOLATILE_ATTACHMENT_PATTERN.test(display);
}

function summarizeDetailRawFields(rawFields = {}) {
  const summary = summarizeRawFields(rawFields);
  for (const [key, cell] of Object.entries(summary)) {
    if (isVolatileRawField(cell)) {
      delete summary[key];
    }
  }
  return summary;
}

export function compactProjectForDetailReadModel(project = {}) {
  if (!project || typeof project !== 'object') {
    return project;
  }
  const detail = {};
  for (const key of DETAIL_PROJECT_FIELDS) {
    if (project[key] !== undefined) {
      detail[key] = project[key];
    }
  }
  const rawFields = summarizeDetailRawFields(project.rawFields);
  if (Object.keys(rawFields).length) {
    detail.rawFields = rawFields;
  }
  if (project.recordMeta) {
    detail.recordMeta = {
      id: project.recordMeta.id,
      lastModifiedTime: project.recordMeta.lastModifiedTime,
    };
  }
  detail.detailLite = true;
  return detail;
}
