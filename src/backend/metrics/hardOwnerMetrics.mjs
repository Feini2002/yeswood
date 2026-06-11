import {
  DEFAULT_HARD_DECORATION_CALENDAR,
  calculateHardDecorationDeadlineRecord,
  chinaToday,
  normalizeDate,
  readHardDecorationField,
} from '../hardDecorationDeadlineRules.mjs';
import {
  hasClassifiableStoreStatus,
  isHardNotStarted,
  isHardWorkflowClosed,
  isSoftWorkflowClosed,
  readRawDisplay,
  readSchemeStatus,
  readStoreTier,
  readStoreTierLabel,
  readWorkflowStage,
} from './fieldSemantics.mjs';

const HARD_OWNER_METRIC_META = {
  notStarted: { label: '未开始', tone: 'amber' },
  hardStageInProgress: { label: '硬装阶段进行中', tone: 'teal' },
  hardSchemeDelayMonth: { label: '本月硬装方案延期', tone: 'coral', alert: true },
  hardSchemeDelayYtd: { label: '全年硬装方案延期', tone: 'coral', alert: true },
  delayedProjects: { label: '已延期项目', tone: 'red', alert: true },
  hardStageCompletedYtd: { label: '全年硬装阶段完成量', tone: 'green' },
  projectClosed: { label: '项目闭环', tone: 'green' },
};

export const HARD_OWNER_METRIC_ORDER = Object.keys(HARD_OWNER_METRIC_META);
export const HARD_OWNER_METRIC_KEYS = new Set(HARD_OWNER_METRIC_ORDER);

const HARD_SCHEME_FINISH_FIELDS = [
  '硬装方案完成时间',
  '躺平内部审核结束时间',
  '内部审核结束时间',
];
const HARD_CONSTRUCTION_REVIEW_FIELDS = [
  '施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）',
  '施工图完成审核时间',
  '施工图终稿完成时间',
  '商场审核完成时间',
];
const HARD_DELAY_NOTE_FIELDS = [
  '硬装方案延期',
  '硬装延期',
  '平面延期',
  '躺平延期',
  '方案延期',
  '延期说明',
  '项目情况 / 延期说明',
  '项目情况/延期说明',
  '项目情况',
];
const HARD_DELAY_CONTEXT = /硬装|平面|躺平|方案|施工图|复尺|CD/i;
const SOFT_ONLY_DELAY_CONTEXT = /软装|点位|产品清单|VM/i;
const HARD_STAGE_ACTIVE_PATTERN = /复尺|平面|躺平|施工图/;
const HARD_STAGE_AFTER_ACTIVE_PATTERN = /摆场|采购|待采购|施工整改|点位|闭环|已完成|^完成$/;

function metricMeta(key) {
  return HARD_OWNER_METRIC_META[key] || { label: key, tone: 'teal' };
}

export function isHardOwnerMetricKey(metricKey = '') {
  return HARD_OWNER_METRIC_KEYS.has(metricKey);
}

function normalizeMetricDate(value = '') {
  return normalizeDate(value) || normalizeDate(String(value || '').slice(0, 10));
}

function resolveToday(options = {}) {
  if (options.today) {
    return normalizeMetricDate(options.today) || String(options.today).slice(0, 10);
  }
  if (options.now) {
    return normalizeMetricDate(options.now instanceof Date ? options.now.toISOString() : options.now);
  }
  return chinaToday();
}

function resolveYear(today, options = {}) {
  const explicit = Number(options.year);
  if (Number.isInteger(explicit) && explicit > 0) {
    return explicit;
  }
  return Number(String(today || '').slice(0, 4)) || new Date().getFullYear();
}

function resolveMonth(today, options = {}) {
  const explicit = String(options.month || '').trim();
  if (/^\d{4}-\d{2}$/.test(explicit)) {
    return explicit;
  }
  return String(today || '').slice(0, 7);
}

function isInYear(dateText, year) {
  return Boolean(dateText && String(dateText).startsWith(`${year}-`));
}

function isInMonth(dateText, month) {
  return Boolean(dateText && month && String(dateText).startsWith(month));
}

function isPastCurrentYearDue(project, today, year) {
  const dueDate = normalizeMetricDate(project?.dueDate || readRawDisplay(project, ['计划开业时间', '计划完成日期']));
  return Boolean(dueDate && isInYear(dueDate, year) && dueDate < today);
}

function readHardSchemeFinishDate(project) {
  return normalizeMetricDate(readHardDecorationField(project, HARD_SCHEME_FINISH_FIELDS));
}

function readConstructionReviewDate(project) {
  return normalizeMetricDate(readHardDecorationField(project, HARD_CONSTRUCTION_REVIEW_FIELDS));
}

function isHardStageInProgress(project) {
  if (readConstructionReviewDate(project)) {
    return false;
  }
  const stage = readWorkflowStage(project, { discipline: 'hard' });
  if (!stage || isHardNotStarted(project) || HARD_STAGE_AFTER_ACTIVE_PATTERN.test(stage)) {
    return false;
  }
  return HARD_STAGE_ACTIVE_PATTERN.test(stage);
}

function hardDelayNoteText(project) {
  const notes = [];
  const rawFields = project?.rawFields || {};
  for (const fieldName of HARD_DELAY_NOTE_FIELDS) {
    const value = readRawDisplay(project, [fieldName]);
    if (/延期/.test(value) || (/硬装方案延期|硬装延期|平面延期|躺平延期|方案延期/.test(fieldName) && value)) {
      notes.push(`${fieldName} ${value}`);
    }
  }
  for (const [fieldName, cell] of Object.entries(rawFields)) {
    const value = cell?.display ?? cell?.text ?? cell?.value ?? '';
    const schemeStatusDelay = /方案情况/.test(fieldName) && /延期/.test(value);
    const hardFieldDelay = /硬装|平面|躺平|施工图|方案/.test(fieldName) && /延期/.test(value);
    if (schemeStatusDelay || hardFieldDelay) {
      notes.push(`${fieldName} ${value}`);
    }
  }
  return notes.join('；');
}

function explicitHardSchemeDelay(project) {
  const schemeStatus = readSchemeStatus(project);
  const noteText = hardDelayNoteText(project);
  const text = [schemeStatus, noteText].filter(Boolean).join('；');
  if (!/延期/.test(text)) {
    return null;
  }
  if (SOFT_ONLY_DELAY_CONTEXT.test(text) && !HARD_DELAY_CONTEXT.test(text)) {
    return null;
  }
  if (!HARD_DELAY_CONTEXT.test(text) && !/延期/.test(schemeStatus)) {
    return null;
  }
  const date =
    readHardSchemeFinishDate(project) ||
    normalizeMetricDate(readRawDisplay(project, ['更新时间', '最后更新时间']) || project?.updatedAt) ||
    normalizeMetricDate(project?.startDate) ||
    '';
  return { source: 'explicit', date };
}

function systemHardSchemeDelay(project, today) {
  let record = null;
  try {
    record = calculateHardDecorationDeadlineRecord(project, {
      calendar: DEFAULT_HARD_DECORATION_CALENDAR,
      today,
    });
  } catch {
    return null;
  }
  const completion = record?.floorPlan?.completion || {};
  if (!['delayed_complete', 'delayed_open'].includes(completion.status)) {
    return null;
  }
  const date = normalizeMetricDate(completion.actualDate || completion.dueDate);
  return date ? { source: 'deadline', date } : null;
}

function hardSchemeDelayEvidences(project, today) {
  return [explicitHardSchemeDelay(project), systemHardSchemeDelay(project, today)].filter(Boolean);
}

function isProjectClosed(project) {
  return isHardWorkflowClosed(project) && isSoftWorkflowClosed(project);
}

function metricContext(options = {}) {
  const today = resolveToday(options);
  return {
    today,
    year: resolveYear(today, options),
    month: resolveMonth(today, options),
  };
}

export function matchesHardOwnerMetricProject(project, metricKey = '', options = {}) {
  const context = metricContext(options);
  switch (metricKey) {
    case 'notStarted':
      return isHardNotStarted(project);
    case 'hardStageInProgress':
      return isHardStageInProgress(project);
    case 'hardSchemeDelayMonth': {
      const evidences = hardSchemeDelayEvidences(project, context.today);
      return evidences.some((evidence) => isInMonth(evidence.date, context.month));
    }
    case 'hardSchemeDelayYtd': {
      const evidences = hardSchemeDelayEvidences(project, context.today);
      return evidences.some((evidence) => isInYear(evidence.date, context.year));
    }
    case 'delayedProjects':
      return isPastCurrentYearDue(project, context.today, context.year);
    case 'hardStageCompletedYtd':
      return isInYear(readConstructionReviewDate(project), context.year);
    case 'projectClosed':
      return isProjectClosed(project);
    default:
      return false;
  }
}

function calculateHardOwnerMetricValues(projects = [], options = {}) {
  return Object.fromEntries(
    HARD_OWNER_METRIC_ORDER.map((key) => [
      key,
      projects.filter((project) => matchesHardOwnerMetricProject(project, key, options)).length,
    ])
  );
}


const HARD_OWNER_STORE_STATUS_ORDER = ['regular', 'sinking', 'other'];

function compareHardOwnerStoreStatusRows(a, b) {
  const indexA = HARD_OWNER_STORE_STATUS_ORDER.indexOf(a.key);
  const indexB = HARD_OWNER_STORE_STATUS_ORDER.indexOf(b.key);
  if (indexA !== -1 || indexB !== -1) {
    return (indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA) - (indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB);
  }
  return String(a.label || a.key).localeCompare(String(b.label || b.key), 'zh-Hans-CN');
}


function calculateHardOwnerStoreStatusRows(projects = [], options = {}) {
  const rowsByKey = new Map();
  for (const project of projects) {
    if (!hasClassifiableStoreStatus(project)) {
      continue;
    }
    const label = readStoreTierLabel(project);
    const key = readStoreTier(project) || `custom:${label}`;
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        key,
        label,
        storeStatus: label,
        projects: [],
      });
    }
    rowsByKey.get(key).projects.push(project);
  }

  return Array.from(rowsByKey.values())
    .sort(compareHardOwnerStoreStatusRows)
    .map((row) => {
      const values = calculateHardOwnerMetricValues(row.projects, options);
      return {
        key: row.key,
        label: row.label,
        storeStatus: row.storeStatus,
        projectCount: row.projects.length,
        values,
        items: HARD_OWNER_METRIC_ORDER.map((key) => ({
          key,
          ...metricMeta(key),
          value: values[key] || 0,
        })),
      };
    });
}


export function calculateHardOwnerMetrics(projects = [], options = {}) {
  const values = calculateHardOwnerMetricValues(projects, options);
  return {
    enabled: true,
    values,
    items: HARD_OWNER_METRIC_ORDER.map((key) => ({
      key,
      ...metricMeta(key),
      value: values[key] || 0,
    })),
    rows: calculateHardOwnerStoreStatusRows(projects, options),
  };
}
