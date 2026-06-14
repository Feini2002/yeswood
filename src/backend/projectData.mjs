import crypto from 'node:crypto';

import { normalizePersonnelArchitecture } from './personnelArchitecture.mjs';
import { classifyProjectLifecycleStage } from '../../public/dashboard/project-lifecycle.mjs';
import { provinceDisplayName } from '../../public/dashboard/province-display.mjs';
import { isClassifiableStoreStatus } from '../../public/lib/constants.mjs';
import { resolveOwnerDisplayTitle } from './personnelOwners.mjs';
import { composeDashboardMetrics } from './metrics/composeDashboard.mjs';
import { isOpenDelayed, isSchemeDelayed, matchesMetricProject } from './metrics/calculators.mjs';
import {
  calculateHardOwnerMetrics,
  isHardOwnerMetricKey,
  matchesHardOwnerMetricProject,
} from './metrics/hardOwnerMetrics.mjs';
import {
  hasOpenDesignResponsibility,
  isOpenDesignResponsibilityDelayed,
  isHardWorkflowClosed,
  isDesignResponsibilityClosed,
  isProjectInProgress,
  isSoftWorkflowClosed,
  matchesOwnerMonthlyTier,
  readSchemeStatus,
  readSoftCompletionStatus,
  readStoreNatureKey,
  readStoreTier,
  readStoreTierLabel,
  normalizePriorityStatus,
} from './metrics/fieldSemantics.mjs';
import {
  countCanceledProjects,
  countPausedOrCanceledProjects,
  countPausedProjects,
  excludePausedProjects,
} from './metrics/pausedProjects.mjs';
import { resolveOwnerMonthlyProjects, resolveProfileProjects } from './metrics/projectScopes.mjs';
import {
  buildPersonDisplayLookup,
  enrichProjectsForDisplay,
  formatPersonnelDisplay,
} from './personnelDisplay.mjs';
import {
  CD_OWNER_FIELDS,
  EMPTY_PERSONNEL_VALUES,
  VM_OWNER_FIELDS,
  buildCanonicalPersonnelNameLookup,
  canonicalizePersonnelNames,
  readNamesFromRawField,
  readProjectOwnerNames,
  resolveCanonicalPersonnelName,
  splitPersonnelNames,
} from './personnelNames.mjs';
import { buildEntryRhythmAdvice } from './agents/entryRhythmAdviceAgent.mjs';
import { scoreProjectDifficulty } from './projectDifficulty.mjs';
import { applySleepStoreHardOnlyProjectRule, applySoleDualOwnerProjectRule } from './projectOwnerRules.mjs';
import { isTerminalProjectStatus } from './projectStatus.mjs';
import { isSleepStoreProject } from './projectTypeRules.mjs';
import { aggregatePersonnelStatsFromProjects } from './responsibilityRepository.mjs';
import { findResponsibilityIdentity } from './responsibilityIdentities.mjs';

const DEFAULT_FIELD_MAP = {
  name: ['项目名称', '项目', '门店名称', 'name', 'projectName'],
  province: ['省份', '省', 'province'],
  businessType: ['业态', 'businessType', 'format'],
  storeStatus: ['店态', 'storeStatus', 'storeState'],
  status: ['项目状态', '状态', 'status'],
  owner: ['负责人', 'owner', 'assignee'],
  progress: ['进度', '完成进度', 'progress'],
  hardProgressStage: ['硬装项目进度', '硬装进度'],
  softProgressStage: ['软装项目进度', '软装进度'],
  startDate: ['启动时间', '启动日期', '开始日期', 'startDate'],
  dueDate: ['计划开业时间', '计划完成日期', '截止日期', 'dueDate', 'deadline'],
  riskLevel: ['风险等级', '风险', 'riskLevel'],
  riskNotes: ['风险说明', '风险备注', 'riskNotes'],
  updatedAt: ['更新时间', '最后更新时间', 'updatedAt'],
};

const HIGH_RISK = ['高', 'high', '严重'];
const MEDIUM_RISK = ['中', 'medium', '一般'];
const UNKNOWN_RISK = ['未知', '未设置', '未填写', '未填', '暂无', '无'];
const CORE_FIELD_KEYS = ['province', 'businessType', 'storeStatus', 'owner', 'startDate', 'dueDate'];
const EXTRA_CORE_FIELD_NAMES = ['组别', '店铺性质', '面积'];
const MIN_CORE_FIELD_COUNT = 4;
const EXCLUDED_DINGTALK_PROJECT_FIELD_NAMES = new Set(['硬装资料', '软装资料', '备注']);
const DINGTALK_DATE_TIME_ZONE = 'Asia/Shanghai';
const MONTHLY_RESPONSIBLE_WORKLOAD_PRESSURE_CAP = 24;
const MONTHLY_ENTRY_PRESSURE_COUNT_CAP = 24;
const STORE_NATURE_ENTRY_PRESSURE_COUNT_CAP = 16;
const PERSONNEL_ROLES = [
  {
    key: 'owner',
    label: '负责人',
    fields: ['负责人', 'CD负责人', '硬装负责人', 'VM负责人', '软装负责人'],
    fallback: (project) => project.owner,
  },
  { key: 'cdLead', label: '硬装组长', fields: ['CD组长'] },
  { key: 'vmLead', label: '软装组长', fields: ['VM组长'] },
];
const TEAM_COLLABORATION_ROLES = [
  { key: 'cdLead', label: '硬装组长', fields: ['CD组长'], discipline: 'hard' },
  { key: 'vmLead', label: '软装组长', fields: ['VM组长'], discipline: 'soft' },
  { key: 'cdDesigner', label: '硬装设计师', fields: ['CD设计师'], discipline: 'hard' },
  { key: 'vmDesigner', label: '软装设计师', fields: ['VM设计师'], discipline: 'soft' },
];

function teamCollaborationRolesForOwnerDiscipline(ownerDiscipline = '') {
  if (ownerDiscipline === 'hard' || ownerDiscipline === 'soft') {
    return TEAM_COLLABORATION_ROLES.filter((role) => role.discipline === ownerDiscipline);
  }
  return TEAM_COLLABORATION_ROLES;
}

export {
  splitPersonnelNames,
  EMPTY_PERSONNEL_VALUES,
  readProjectOwnerNames,
  primaryProjectOwner,
} from './personnelNames.mjs';
const STAGE_PROGRESS = [
  { pattern: /闭环|准时完成|延期完成|已完成/, value: 100 },
  { pattern: /摆场/, value: 90 },
  { pattern: /施工整改/, value: 85 },
  { pattern: /点位已完成/, value: 80 },
  { pattern: /施工图完成审核/, value: 75 },
  { pattern: /待采购/, value: 65 },
  { pattern: /施工图/, value: 55 },
  { pattern: /软装方案中/, value: 45 },
  { pattern: /完成上会/, value: 35 },
  { pattern: /完成复尺/, value: 25 },
  { pattern: /平面躺平/, value: 20 },
  { pattern: /暂停/, value: 10 },
  { pattern: /未开始|未安排|空/, value: 0 },
];

function asFieldNames(mappingValue, fallback) {
  if (Array.isArray(mappingValue)) {
    return mappingValue;
  }
  if (typeof mappingValue === 'string' && mappingValue.trim()) {
    return [mappingValue];
  }
  return fallback;
}

function normalizeCell(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map(normalizeCell).filter(Boolean).join('、');
  }

  if (typeof value === 'object') {
    const preferred = value.text ?? value.name ?? value.title ?? value.label ?? value.value ?? value.displayValue;
    if (preferred !== undefined && preferred !== value) {
      return normalizeCell(preferred);
    }
    return JSON.stringify(value);
  }

  return String(value).trim();
}

function isUnixTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return false;
  }

  const milliseconds = String(Math.trunc(number)).length === 10 ? number * 1000 : number;
  return milliseconds >= 946684800000 && milliseconds <= 4102444800000;
}

function timestampMilliseconds(value) {
  const milliseconds = String(Math.trunc(Number(value))).length === 10 ? Number(value) * 1000 : Number(value);
  return milliseconds;
}

function formatDateInDingTalkZone(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DINGTALK_DATE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${partMap.year}-${partMap.month}-${partMap.day}`;
}

function normalizeRawNumber(value) {
  if (!isUnixTimestamp(value)) {
    return String(value);
  }

  return formatDateInDingTalkZone(new Date(timestampMilliseconds(value)));
}

function rawKind(value) {
  if (value === null || value === undefined || value === '') {
    return 'empty';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'number') {
    return isUnixTimestamp(value) ? 'date' : 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'object') {
    if (value.link) {
      return 'link';
    }
    return 'object';
  }
  return 'string';
}

export function formatRawDingTalkValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value.map(formatRawDingTalkValue).filter(Boolean).join('、');
  }

  if (typeof value === 'number') {
    return normalizeRawNumber(value);
  }

  if (typeof value === 'object') {
    if (value.link) {
      const text = normalizeCell(value.text || value.name || value.title || value.link);
      return text && text !== value.link ? `${text} (${value.link})` : String(value.link);
    }

    return normalizeCell(value);
  }

  return normalizeCell(value);
}

function createRawFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      {
        rawValue: value,
        display: formatRawDingTalkValue(value),
        kind: rawKind(value),
      },
    ])
  );
}

function filterDingTalkProjectFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => !EXCLUDED_DINGTALK_PROJECT_FIELD_NAMES.has(key))
  );
}

function readOwnerFieldText(project, fieldNames) {
  const names = new Set();
  for (const fieldName of fieldNames) {
    for (const name of readNamesFromRawField(project, fieldName)) {
      names.add(name);
    }
  }
  return Array.from(names).join('、');
}

function pickField(fields, fieldNames) {
  for (const name of fieldNames) {
    if (Object.hasOwn(fields, name)) {
      return normalizeCell(fields[name]);
    }
  }
  return '';
}

function getRecordFields(record) {
  if (record?.fields && typeof record.fields === 'object') {
    return record.fields;
  }

  if (record?.rawFields && typeof record.rawFields === 'object') {
    return Object.fromEntries(
      Object.entries(record.rawFields).map(([key, value]) => [key, value?.display ?? value])
    );
  }

  return record || {};
}

function uniqueFieldNames(fieldNames) {
  return Array.from(new Set(fieldNames.filter(Boolean)));
}

function countCoreFields(fields, mergedMap) {
  const coreFieldNames = uniqueFieldNames([
    ...CORE_FIELD_KEYS.flatMap((key) => asFieldNames(mergedMap[key], DEFAULT_FIELD_MAP[key] || [])),
    ...EXTRA_CORE_FIELD_NAMES,
  ]);

  return coreFieldNames.filter((name) => Object.hasOwn(fields, name) && normalizeCell(fields[name])).length;
}

export function classifyProjectRecord(record, { fieldMap = {} } = {}) {
  const fields = getRecordFields(record);
  const mergedMap = { ...DEFAULT_FIELD_MAP, ...fieldMap };
  const name = pickField(fields, asFieldNames(mergedMap.name, DEFAULT_FIELD_MAP.name));
  const coreFieldCount = countCoreFields(fields, mergedMap);
  const valid = Boolean(name) && coreFieldCount >= MIN_CORE_FIELD_COUNT;

  return {
    valid,
    reason: valid ? 'valid' : name ? 'missing-core-fields' : 'missing-name',
    name,
    coreFieldCount,
    minCoreFieldCount: MIN_CORE_FIELD_COUNT,
  };
}

export function isValidProjectRecord(record, options = {}) {
  return classifyProjectRecord(record, options).valid;
}

function parseProgress(value) {
  if (typeof value === 'number') {
    return Math.max(0, Math.min(100, value <= 1 ? Math.round(value * 100) : Math.round(value)));
  }

  const raw = normalizeCell(value);
  const number = Number(raw.replace('%', '').trim());
  if (!Number.isFinite(number)) {
    const stage = STAGE_PROGRESS.find((item) => item.pattern.test(raw));
    if (stage) {
      return stage.value;
    }
    return 0;
  }
  return Math.max(0, Math.min(100, number <= 1 ? Math.round(number * 100) : Math.round(number)));
}

function normalizeDate(value) {
  const raw = normalizeCell(value);
  if (!raw) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const date = /^\d{10,13}$/.test(raw) ? new Date(timestampMilliseconds(raw)) : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return formatDateInDingTalkZone(date);
}

function normalizeDateTime(value) {
  const raw = normalizeCell(value);
  if (!raw) {
    return '';
  }

  const date = /^\d{10,13}$/.test(raw) ? new Date(timestampMilliseconds(raw)) : new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function normalizeRisk(value) {
  const raw = normalizeCell(value);
  if (!raw) {
    return '未知';
  }
  if (UNKNOWN_RISK.some((item) => raw.includes(item))) {
    return '未知';
  }
  const lower = raw.toLowerCase();
  if (HIGH_RISK.some((item) => lower.includes(item))) {
    return '高';
  }
  if (MEDIUM_RISK.some((item) => lower.includes(item))) {
    return '中';
  }
  return '低';
}

export function scheduleStatusFor(dueDate, delayed) {
  if (!dueDate) {
    return 'missingDueDate';
  }
  return delayed ? 'overdue' : 'scheduled';
}

const DELAY_EXEMPT_COMPLETED_STATUSES = new Set(['完成', '已完成']);

function isCompleted(status) {
  const normalized = String(status ?? '').trim();
  return isTerminalProjectStatus(normalized) || DELAY_EXEMPT_COMPLETED_STATUSES.has(normalized);
}

function isDelayed(dueDate, status) {
  if (!dueDate || isCompleted(status)) {
    return false;
  }

  const date = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

export function cleanProjectRecord(record, { fieldMap = {} } = {}) {
  const fields = filterDingTalkProjectFields(getRecordFields(record));
  const mergedMap = { ...DEFAULT_FIELD_MAP, ...fieldMap };
  const read = (key) => pickField(fields, asFieldNames(mergedMap[key], DEFAULT_FIELD_MAP[key]));

  const rawStatus = read('status');
  const status = normalizePriorityStatus(rawStatus);
  const dueDate = normalizeDate(read('dueDate'));
  const id = record.recordId || record.id || fields.recordId || fields.id || crypto.randomUUID();
  const rawFields = createRawFields(fields);

  const delayed = isDelayed(dueDate, rawStatus);
  const project = {
    id,
    recordMeta: {
      id,
      createdTime: normalizeDateTime(record.createdTime || ''),
      lastModifiedTime: normalizeDateTime(record.lastModifiedTime || record.updatedAt || ''),
    },
    rawFields,
    name: read('name') || `未命名项目 ${id}`,
    province: provinceDisplayName(read('province')) || '未填写',
    businessType: read('businessType') || '未填写',
    storeStatus: read('storeStatus') || '未填写',
    status,
    owner: read('owner') || '',
    progress: parseProgress(read('progress')),
    hardProgressStage: read('hardProgressStage'),
    softProgressStage: read('softProgressStage'),
    startDate: normalizeDate(read('startDate')),
    dueDate,
    riskLevel: normalizeRisk(read('riskLevel')),
    riskNotes: read('riskNotes'),
    updatedAt: normalizeDateTime(read('updatedAt') || record.lastModifiedTime || record.updatedAt),
    isDelayed: delayed,
    scheduleStatus: scheduleStatusFor(dueDate, delayed),
    source: 'dingtalk-ai-table',
  };
  project.cdOwner = readOwnerFieldText(project, CD_OWNER_FIELDS);
  project.vmOwner = readOwnerFieldText(project, VM_OWNER_FIELDS);
  applySleepStoreHardOnlyProjectRule(project);
  const ownerNames = readProjectOwnerNames(project);
  if (ownerNames.length) {
    project.owner = ownerNames.join('、');
  } else if (!project.owner) {
    project.owner = '未分配';
  }
  applySoleDualOwnerProjectRule(project);
  const difficulty = scoreProjectDifficulty(project);

  return {
    ...project,
    difficulty,
    difficultyScore: difficulty.score,
    difficultyLevel: difficulty.level,
    difficultyWeight: difficulty.weight,
    difficultyWorkdays: difficulty.workdays,
  };
}

function countBy(items, selector) {
  const counts = new Map();
  for (const item of items) {
    const key = selector(item) || '未填写';
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts, ([label, value]) => ({ label, value })).sort((a, b) => {
    if (b.value !== a.value) {
      return b.value - a.value;
    }
    return 0;
  });
}

const DIFFICULTY_LEVEL_ORDER = ['低', '中', '难', '重', '未判定'];
const DIFFICULTY_LEVEL_TONES = {
  低: 'light',
  中: 'medium',
  难: 'hard',
  重: 'heavy',
  未判定: 'unknown',
};

function normalizeDifficultyLevelLabel(level = '') {
  if (level === '轻') {
    return '低';
  }
  return level || '未判定';
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function emptyDifficultySegment() {
  return { score: 0, workdays: 0, weight: 0 };
}

function normalizeDifficultySegment(segment = {}) {
  return {
    score: Number(segment.score || 0),
    workdays: Number(segment.workdays || 0),
    weight: Number(segment.weight || 0),
  };
}

function normalizeProjectDifficulty(project = {}) {
  const difficulty = project.difficulty || {};
  const score = Number(difficulty.score ?? project.difficultyScore ?? 0);
  const level = normalizeDifficultyLevelLabel(difficulty.level || project.difficultyLevel || (score ? '未判定' : '未判定'));
  return {
    ...difficulty,
    score,
    level,
    weight: Number(difficulty.weight ?? project.difficultyWeight ?? 0),
    workdays: Number(difficulty.workdays ?? project.difficultyWorkdays ?? 0),
    hard: normalizeDifficultySegment(difficulty.hard),
    soft: normalizeDifficultySegment(difficulty.soft),
    design: normalizeDifficultySegment(difficulty.design),
  };
}

function combinedDifficultySegments(...segments) {
  const workdays = round1(segments.reduce((sum, segment) => sum + Number(segment?.workdays || 0), 0));
  const weight = round2(segments.reduce((sum, segment) => sum + Number(segment?.weight || 0), 0));
  return {
    score: Math.round(workdays),
    workdays,
    weight,
  };
}

function responsibleDifficultySegment(difficulty, ownerDiscipline = '') {
  if (ownerDiscipline === 'hard') {
    return difficulty.hard || emptyDifficultySegment();
  }
  if (ownerDiscipline === 'soft') {
    return difficulty.soft || emptyDifficultySegment();
  }
  if (ownerDiscipline === 'both') {
    return combinedDifficultySegments(difficulty.hard, difficulty.soft, difficulty.design);
  }
  return {
    score: Number(difficulty.score || 0),
    workdays: Number(difficulty.workdays || 0),
    weight: Number(difficulty.weight || 0),
  };
}

function createDifficultyBucket(extra = {}) {
  return {
    projectCount: 0,
    measuredProjectCount: 0,
    workdays: 0,
    weightedWorkload: 0,
    responsibleWorkdays: 0,
    responsibleWeightedWorkload: 0,
    scoreTotal: 0,
    ...extra,
  };
}

function addDifficultyToBucket(bucket, difficulty, responsible) {
  bucket.projectCount += 1;
  bucket.workdays += Number(difficulty.workdays || 0);
  bucket.weightedWorkload += Number(difficulty.weight || 0);
  bucket.responsibleWorkdays += Number(responsible.workdays || 0);
  bucket.responsibleWeightedWorkload += Number(responsible.weight || 0);
  if (Number(difficulty.score || 0) > 0) {
    bucket.measuredProjectCount += 1;
    bucket.scoreTotal += Number(difficulty.score || 0);
  }
}

function finalizeDifficultyBucket(bucket) {
  const finalized = {
    ...bucket,
    workdays: round1(bucket.workdays),
    weightedWorkload: round2(bucket.weightedWorkload),
    responsibleWorkdays: round1(bucket.responsibleWorkdays),
    responsibleWeightedWorkload: round2(bucket.responsibleWeightedWorkload),
    avgScore: bucket.measuredProjectCount ? Math.round(bucket.scoreTotal / bucket.measuredProjectCount) : 0,
    avgWeight: bucket.projectCount ? round2(bucket.weightedWorkload / bucket.projectCount) : 0,
  };
  delete finalized.scoreTotal;
  return finalized;
}

function createDisciplineBucket() {
  return { projectCount: 0, workdays: 0, weightedWorkload: 0 };
}

function addDisciplineSegment(bucket, segment) {
  if (!segment || (!segment.workdays && !segment.weight)) {
    return;
  }
  bucket.projectCount += 1;
  bucket.workdays += Number(segment.workdays || 0);
  bucket.weightedWorkload += Number(segment.weight || 0);
}

function finalizeDisciplineBucket(bucket) {
  return {
    projectCount: bucket.projectCount,
    workdays: round1(bucket.workdays),
    weightedWorkload: round2(bucket.weightedWorkload),
  };
}

function compareDifficultyLevels(a, b) {
  const indexA = DIFFICULTY_LEVEL_ORDER.indexOf(a);
  const indexB = DIFFICULTY_LEVEL_ORDER.indexOf(b);
  return (indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA) - (indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB);
}

function buildDifficultySummary(projects, options = {}) {
  const tierOrder = options.tierOrder || [];
  const tierLabels = options.tierLabels || {};
  const ownerDiscipline = options.ownerDiscipline || '';
  const total = createDifficultyBucket({
    ownerDiscipline,
    levelOrder: DIFFICULTY_LEVEL_ORDER.slice(),
    levelTones: { ...DIFFICULTY_LEVEL_TONES },
  });
  const byLevel = new Map();
  const byStoreTier = new Map();
  const matrix = new Map();
  const byDiscipline = {
    hard: createDisciplineBucket(),
    soft: createDisciplineBucket(),
    design: createDisciplineBucket(),
  };

  for (const project of projects) {
    const difficulty = normalizeProjectDifficulty(project);
    const responsible = responsibleDifficultySegment(difficulty, ownerDiscipline);
    const level = difficulty.level || '未判定';
    const storeTier = readStoreTier(project) || 'other';
    const storeTierLabel = tierLabels[storeTier] || readStoreTierLabel(project) || storeTier;

    addDifficultyToBucket(total, difficulty, responsible);

    if (!byLevel.has(level)) {
      byLevel.set(level, createDifficultyBucket({ label: level, tone: DIFFICULTY_LEVEL_TONES[level] || 'unknown' }));
    }
    addDifficultyToBucket(byLevel.get(level), difficulty, responsible);

    if (!byStoreTier.has(storeTier)) {
      byStoreTier.set(
        storeTier,
        createDifficultyBucket({
          key: storeTier,
          label: storeTierLabel,
          byLevel: new Map(),
        })
      );
    }
    const tierBucket = byStoreTier.get(storeTier);
    addDifficultyToBucket(tierBucket, difficulty, responsible);
    if (!tierBucket.byLevel.has(level)) {
      tierBucket.byLevel.set(level, createDifficultyBucket({ label: level, tone: DIFFICULTY_LEVEL_TONES[level] || 'unknown' }));
    }
    addDifficultyToBucket(tierBucket.byLevel.get(level), difficulty, responsible);

    const matrixKey = `${storeTier}::${level}`;
    if (!matrix.has(matrixKey)) {
      matrix.set(
        matrixKey,
        createDifficultyBucket({
          storeTier,
          storeTierLabel,
          level,
          tone: DIFFICULTY_LEVEL_TONES[level] || 'unknown',
        })
      );
    }
    addDifficultyToBucket(matrix.get(matrixKey), difficulty, responsible);

    addDisciplineSegment(byDiscipline.hard, difficulty.hard);
    addDisciplineSegment(byDiscipline.soft, difficulty.soft);
    addDisciplineSegment(byDiscipline.design, difficulty.design);
  }

  const storeTierSortIndex = new Map(tierOrder.map((tier, index) => [tier, index]));
  const storeTierRows = Array.from(byStoreTier.values()).sort((a, b) => {
    const indexA = storeTierSortIndex.has(a.key) ? storeTierSortIndex.get(a.key) : Number.MAX_SAFE_INTEGER;
    const indexB = storeTierSortIndex.has(b.key) ? storeTierSortIndex.get(b.key) : Number.MAX_SAFE_INTEGER;
    if (indexA !== indexB) {
      return indexA - indexB;
    }
    return String(a.label).localeCompare(String(b.label), 'zh-Hans-CN');
  });

  return {
    ...finalizeDifficultyBucket(total),
    byLevel: Array.from(byLevel.values())
      .sort((a, b) => compareDifficultyLevels(a.label, b.label))
      .map(finalizeDifficultyBucket),
    byStoreTier: storeTierRows.map((bucket) => {
      const byLevelRows = Array.from(bucket.byLevel.values())
        .sort((a, b) => compareDifficultyLevels(a.label, b.label))
        .map(finalizeDifficultyBucket);
      const finalized = finalizeDifficultyBucket(bucket);
      return {
        ...finalized,
        byLevel: byLevelRows,
      };
    }),
    matrixByStoreTierAndLevel: Array.from(matrix.values())
      .sort((a, b) => {
        const tierA = storeTierSortIndex.has(a.storeTier) ? storeTierSortIndex.get(a.storeTier) : Number.MAX_SAFE_INTEGER;
        const tierB = storeTierSortIndex.has(b.storeTier) ? storeTierSortIndex.get(b.storeTier) : Number.MAX_SAFE_INTEGER;
        if (tierA !== tierB) {
          return tierA - tierB;
        }
        return compareDifficultyLevels(a.level, b.level);
      })
      .map(finalizeDifficultyBucket),
    byDiscipline: {
      hard: finalizeDisciplineBucket(byDiscipline.hard),
      soft: finalizeDisciplineBucket(byDiscipline.soft),
      design: finalizeDisciplineBucket(byDiscipline.design),
    },
  };
}

function difficultyLevelFromScore(score) {
  const number = Number(score || 0);
  if (!number) return '未判定';
  if (number < 18) return '低';
  if (number < 36) return '中';
  if (number < 55) return '难';
  return '重';
}

function percentOf(value, total) {
  return total ? Math.round((Number(value || 0) / Number(total || 0)) * 100) : 0;
}

function monthlyPressureLevel(score) {
  const number = Number(score || 0);
  if (number >= 78) return '高压';
  if (number >= 58) return '偏高';
  if (number >= 36) return '中压';
  return '低压';
}

function monthlyPressureTone(score) {
  const number = Number(score || 0);
  if (number >= 78) return 'heavy';
  if (number >= 58) return 'hard';
  if (number >= 36) return 'medium';
  return number > 0 ? 'light' : 'unknown';
}

function createMonthlyDifficultyBucket(label) {
  return createDifficultyBucket({
    label,
    highDifficultyCount: 0,
    byLevel: new Map(),
  });
}

function addMonthlyDifficultyToBucket(bucket, difficulty, responsible) {
  const level = normalizeDifficultyLevelLabel(difficulty.level);
  addDifficultyToBucket(bucket, difficulty, responsible);
  if (level === '难' || level === '重') {
    bucket.highDifficultyCount += 1;
  }
  if (!bucket.byLevel.has(level)) {
    bucket.byLevel.set(level, createDifficultyBucket({ label: level, tone: DIFFICULTY_LEVEL_TONES[level] || 'unknown' }));
  }
  addDifficultyToBucket(bucket.byLevel.get(level), difficulty, responsible);
}

function monthlyDifficultyTone(row, maxResponsibleWorkload) {
  const avgScore = Number(row.avgScore || 0);
  const workload = Number(row.responsibleWeightedWorkload || 0);
  const highDifficultyCount = Number(row.highDifficultyCount || 0);
  if (!workload && !avgScore) return 'unknown';
  if ((highDifficultyCount > 0 && workload >= maxResponsibleWorkload * 0.8) || avgScore >= 55) return 'heavy';
  if (highDifficultyCount > 0 || avgScore >= 36 || workload >= maxResponsibleWorkload * 0.65) return 'hard';
  if (avgScore >= 18) return 'medium';
  return 'light';
}

function monthlyDifficultyPressureScore(row) {
  const workload = Number(row.responsibleWeightedWorkload || 0);
  const avgScore = Number(row.avgScore || 0);
  const highDifficultyShare = row.projectCount ? Number(row.highDifficultyCount || 0) / Number(row.projectCount || 1) : 0;
  if (!workload && !avgScore && !highDifficultyShare) {
    return 0;
  }
  const workloadScore = Math.min(workload / MONTHLY_RESPONSIBLE_WORKLOAD_PRESSURE_CAP, 1) * 56;
  const difficultyScore = Math.min(avgScore / 60, 1) * 24;
  const highScore = Math.min(highDifficultyShare, 1) * 20;
  return Math.round(Math.min(100, workloadScore + difficultyScore + highScore));
}

function finalizeMonthlyDifficultyBucket(bucket, maxResponsibleWorkload, totalResponsibleWorkload) {
  const byLevel = Array.from(bucket.byLevel.values())
    .sort((a, b) => compareDifficultyLevels(a.label, b.label))
    .map(finalizeDifficultyBucket);
  const finalized = finalizeDifficultyBucket(bucket);
  const level = difficultyLevelFromScore(finalized.avgScore);
  const pressureScore = monthlyDifficultyPressureScore(finalized);
  return {
    ...finalized,
    label: bucket.label,
    level,
    tone: monthlyDifficultyTone(finalized, maxResponsibleWorkload),
    pressureScore,
    pressureLevel: monthlyPressureLevel(pressureScore),
    pressureTone: monthlyPressureTone(pressureScore),
    highDifficultyCount: bucket.highDifficultyCount,
    responsibleWorkloadShare: percentOf(finalized.responsibleWeightedWorkload, totalResponsibleWorkload),
    byLevel,
  };
}

function monthlyDifficultySeriesFromProjects(projects, selector, options = {}) {
  const ownerDiscipline = options.ownerDiscipline || '';
  const buckets = new Map();

  for (const project of projects) {
    const month = selector(project);
    if (!month || month === '未知') {
      continue;
    }
    if (!buckets.has(month)) {
      buckets.set(month, createMonthlyDifficultyBucket(month));
    }
    const difficulty = normalizeProjectDifficulty(project);
    const responsible = responsibleDifficultySegment(difficulty, ownerDiscipline);
    addMonthlyDifficultyToBucket(buckets.get(month), difficulty, responsible);
  }

  const preliminary = Array.from(buckets.values());
  const maxResponsibleWorkload = Math.max(...preliminary.map((bucket) => Number(bucket.responsibleWeightedWorkload || 0)), 0);
  const totalResponsibleWorkload = preliminary.reduce((sum, bucket) => sum + Number(bucket.responsibleWeightedWorkload || 0), 0);
  return preliminary
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
    .map((bucket) => finalizeMonthlyDifficultyBucket(bucket, maxResponsibleWorkload, totalResponsibleWorkload));
}

function readPersonnelNames(project, role, canonicalNameLookup = null) {
  const names = [];

  for (const fieldName of role.fields) {
    names.push(...splitPersonnelNames(project.rawFields?.[fieldName]?.display));
  }

  if (!names.length && role.fallback) {
    names.push(...splitPersonnelNames(role.fallback(project)));
  }

  return canonicalNameLookup ? canonicalizePersonnelNames(names, canonicalNameLookup) : Array.from(new Set(names));
}

function disciplineLabel(value) {
  if (value === 'hard') return '硬装';
  if (value === 'soft') return '软装';
  if (value === 'both') return '硬装+软装';
  return value || '';
}

function createPersonStat(name, personnelArchitecture = {}, role = {}) {
  const localPerson = personnelArchitecture.people?.[name] || {};
  const roleDiscipline = personnelArchitecture.roleDisciplines?.[role.key] || personnelArchitecture.groups?.[role.key]?.discipline;
  const discipline = localPerson.discipline || roleDiscipline;
  const stat = { name, value: 0, delayed: 0, highRisk: 0 };
  for (const key of [
    'id',
    'displayName',
    'role',
    'position',
    'positionLabel',
    'category',
    'categoryLabel',
    'status',
    'source',
  ]) {
    if (localPerson[key]) {
      stat[key] = localPerson[key];
    }
  }
  if (discipline) stat.discipline = discipline;
  if (localPerson.disciplineLabel || discipline) stat.disciplineLabel = localPerson.disciplineLabel || disciplineLabel(discipline);
  return stat;
}

function normalizedDesignDiscipline(value = '') {
  return ['hard', 'soft'].includes(value) ? value : '';
}

function hasOpenResponsibilityForDiscipline(project, discipline = '') {
  const normalized = normalizedDesignDiscipline(discipline);
  return normalized
    ? hasOpenDesignResponsibility(project, { discipline: normalized })
    : hasOpenDesignResponsibility(project);
}

function isOpenResponsibilityDelayedForDiscipline(project, discipline = '') {
  const normalized = normalizedDesignDiscipline(discipline);
  return normalized
    ? isOpenDesignResponsibilityDelayed(project, { discipline: normalized })
    : isOpenDesignResponsibilityDelayed(project);
}

function addProjectToPersonStat(stat, project) {
  stat.value += 1;
  if (isOpenResponsibilityDelayedForDiscipline(project, stat.discipline)) {
    stat.delayed += 1;
  }
  if (hasOpenResponsibilityForDiscipline(project, stat.discipline) && project.riskLevel === '高') {
    stat.highRisk += 1;
  }
}

function shouldSkipResponsibilityWorkload(project, discipline) {
  return !hasOpenResponsibilityForDiscipline(project, discipline);
}

function annotateResponsibilityDelay(project, discipline = '') {
  return {
    ...project,
    responsibilityDelayed: isOpenResponsibilityDelayedForDiscipline(project, discipline),
  };
}

function sortPersonnelStats(items) {
  return items.sort((a, b) => {
    if (b.value !== a.value) {
      return b.value - a.value;
    }
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
}

function mapToSortedStats(map, limit = 8) {
  return sortPersonnelStats(Array.from(map.values())).slice(0, limit);
}

function localRoleNamesForRole(personnelArchitecture, role) {
  if (role.key === 'owner') {
    const teamOwners = Array.isArray(personnelArchitecture.teams)
      ? personnelArchitecture.teams.map((team) => team.owner).filter(Boolean)
      : [];
    return teamOwners.length ? Array.from(new Set(teamOwners)) : null;
  }

  const roleGroup = personnelArchitecture.roleGroups?.[role.key] || personnelArchitecture.groups?.[role.key];
  if (roleGroup && Array.isArray(roleGroup.people)) {
    return Array.from(new Set(roleGroup.people.filter(Boolean)));
  }

  return null;
}

export function calculatePersonnelMetrics(projects, { personnelArchitecture = {} } = {}) {
  const normalizedPersonnelArchitecture = normalizePersonnelArchitecture(personnelArchitecture);
  const stats = aggregatePersonnelStatsFromProjects(excludePausedProjects(projects), {
    personnelArchitecture: normalizedPersonnelArchitecture,
  });

  const roles = stats.roles.map((role) => {
    const roleDiscipline =
      normalizedPersonnelArchitecture.roleDisciplines?.[role.key] ||
      normalizedPersonnelArchitecture.groups?.[role.key]?.discipline ||
      role.discipline;
    const enrichedPeople = role.people.map((person) => {
      const base = createPersonStat(person.sourceName || person.name, normalizedPersonnelArchitecture, {
        key: role.key,
        discipline: roleDiscipline,
      });
      return { ...base, ...person, value: person.value, delayed: person.delayed, highRisk: person.highRisk };
    });
    return {
      ...role,
      discipline: roleDiscipline || role.discipline || '',
      disciplineLabel: disciplineLabel(roleDiscipline || role.discipline),
      people: enrichedPeople,
      topPeople: enrichedPeople.slice(0, 8),
    };
  });

  return {
    summary: stats.summary,
    roles,
    designerRoles: stats.designerRoles,
    routingReview: stats.routingReview,
  };
}

function monthKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '未知';
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export { enrichProjectsForDisplay } from './personnelDisplay.mjs';

export function calculateDashboardMetrics(projects, options = {}) {
  const normalizedArchitecture = normalizePersonnelArchitecture(options.personnelArchitecture || {});
  const pausedCount = countPausedProjects(projects);
  const canceledCount = countCanceledProjects(projects);
  const pausedOrCanceledCount = countPausedOrCanceledProjects(projects);
  const activeProjects = excludePausedProjects(projects);
  const responsibilityProjects = activeProjects.filter((project) => hasOpenDesignResponsibility(project));
  const totalProjects = activeProjects.length;
  const delayedProjects = responsibilityProjects.filter((project) => isOpenDelayed(project)).length;
  const planOverdueProjects = responsibilityProjects.filter((project) => project.isDelayed).length;
  const missingDueDateProjects = responsibilityProjects.filter((project) => project.scheduleStatus === 'missingDueDate' || !project.dueDate).length;
  const highRiskProjects = responsibilityProjects.filter((project) => project.riskLevel === '高').length;
  const activeProjectsInProgress = responsibilityProjects.length;
  const averageProgress =
    totalProjects === 0
      ? 0
      : Math.round(
          activeProjects.reduce((sum, project) => sum + Number(project.progress || 0), 0) / totalProjects
        );

  const riskProjects = responsibilityProjects
    .filter((project) => isOpenDelayed(project) || project.riskLevel === '高')
    .sort((a, b) => {
      if (a.riskLevel !== b.riskLevel) {
        return a.riskLevel === '高' ? -1 : 1;
      }
      return String(a.dueDate).localeCompare(String(b.dueDate));
    })
    .map(annotateResponsibilityDelay)
    .slice(0, 12);

  const monthlyTrend = countBy(activeProjects, (project) => monthKey(project.updatedAt)).sort((a, b) =>
    a.label.localeCompare(b.label)
  );

  return {
    summary: {
      totalProjects,
      activeProjects: activeProjectsInProgress,
      delayedProjects,
      planOverdueProjects,
      missingDueDateProjects,
      highRiskProjects,
      averageProgress,
      pausedProjects: pausedCount,
      canceledProjects: canceledCount,
      pausedOrCanceledProjects: pausedOrCanceledCount,
    },
    pausedCount,
    canceledCount,
    pausedOrCanceledCount,
    totalScopeCount: projects.length,
    statusCounts: countBy(responsibilityProjects, (project) => project.status),
    priorityStatusCounts: countBy(responsibilityProjects, (project) => project.status),
    riskCounts: countBy(responsibilityProjects, (project) => project.riskLevel),
    ownerLoad: buildOwnerLoad(responsibilityProjects, normalizedArchitecture).slice(0, 10),
    provinceCounts: countBy(activeProjects, (project) => provinceDisplayName(project.province) || project.province),
    businessTypeCounts: countBy(activeProjects, (project) => project.businessType),
    storeStatusCounts: countBy(activeProjects, (project) => project.storeStatus),
    personnel: calculatePersonnelMetrics(projects, options),
    monthlyTrend,
    riskProjects,
  };
}

function matchesValue(projectValue, expected) {
  return !expected || expected === '全部' || String(projectValue) === String(expected);
}

function normalizeProvinceFilterValue(value = '') {
  const normalized = provinceDisplayName(value);
  return normalized || String(value ?? '').trim();
}

function matchesProvince(projectValue, expected) {
  if (!expected || expected === '全部') {
    return true;
  }
  return normalizeProvinceFilterValue(projectValue) === normalizeProvinceFilterValue(expected);
}

function matchesLifecycleStage(project, expected) {
  return !expected || classifyProjectLifecycleStage(project).key === expected;
}

function normalizeStoreNatureFilter(value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw === '全部') {
    return '';
  }
  if (raw === 'newStore' || /新店/.test(raw)) {
    return 'newStore';
  }
  if (raw === 'renovated' || /老店|翻新|改造|扩店|换址|重装/.test(raw)) {
    return 'renovated';
  }
  if (raw === 'other' || /其他/.test(raw)) {
    return 'other';
  }
  return raw;
}

function matchesStoreNature(project, expected) {
  const normalized = normalizeStoreNatureFilter(expected);
  return !normalized || readStoreNatureKey(project) === normalized;
}

function resolveFilterScope(projects, filters, personnelArchitecture) {
  if (filters.owner) {
    return resolveOwnerMonthlyProjects(projects, filters.owner, {
      dashboardContext: filters.dashboardContext || 'all',
      personnelArchitecture,
    });
  }

  if (filters.profile) {
    return resolveProfileProjects(projects, filters.profile, { personnelArchitecture });
  }

  return projects;
}

function drillMetricOptions(filters, personnelArchitecture) {
  const profileId = filters.profile || (filters.owner ? 'ownerMonthly' : 'department');
  const owner = filters.owner || '';
  const ownerIdentity = findResponsibilityIdentity(owner, personnelArchitecture);
  return {
    profileId,
    owner,
    ownerDiscipline: owner ? ownerIdentity?.discipline || personnelArchitecture.people?.[owner]?.discipline || '' : '',
    personnelArchitecture,
  };
}

function shouldUseAllContextForOwnerIdentity(identity = null) {
  return identity?.sourceName === '杨锦帆' && identity?.discipline === 'hard';
}

function isEnabledFilter(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function matchesCollaborationResponsibility(
  project,
  collaborator = '',
  collaborationDiscipline = '',
  personnelArchitecture = {}
) {
  const targetName = String(collaborator || '').trim();
  if (!targetName) {
    return true;
  }
  const canonicalNameLookup = buildCanonicalPersonnelNameLookup(personnelArchitecture);
  const canonicalTarget = resolveCanonicalPersonnelName(targetName, canonicalNameLookup);
  return teamCollaborationRolesForOwnerDiscipline(collaborationDiscipline).some((role) =>
    readPersonnelNames(project, role, canonicalNameLookup).includes(canonicalTarget)
  );
}

function readTeamProjectOwnerNames(project, canonicalNameLookup = null) {
  const names = [
    ...splitPersonnelNames(project?.cdOwner),
    ...splitPersonnelNames(project?.vmOwner),
  ];
  if (!Object.prototype.hasOwnProperty.call(project || {}, 'cdOwner')) {
    for (const fieldName of CD_OWNER_FIELDS) {
      for (const name of readNamesFromRawField(project, fieldName)) {
        names.push(name);
      }
    }
  }
  if (!Object.prototype.hasOwnProperty.call(project || {}, 'vmOwner')) {
    for (const fieldName of VM_OWNER_FIELDS) {
      for (const name of readNamesFromRawField(project, fieldName)) {
        names.push(name);
      }
    }
  }
  return canonicalNameLookup ? canonicalizePersonnelNames(names, canonicalNameLookup) : Array.from(new Set(names));
}

function matchesTeamProjectOwner(project, teamProjectOwner = '', personnelArchitecture = {}) {
  const targetName = String(teamProjectOwner || '').trim();
  if (!targetName) {
    return true;
  }
  const identity = findResponsibilityIdentity(targetName, personnelArchitecture);
  if (identity) {
    return resolveOwnerMonthlyProjects([project], identity.identityId, {
      personnelArchitecture,
      dashboardContext: 'all',
    }).length > 0;
  }
  const canonicalNameLookup = buildCanonicalPersonnelNameLookup(personnelArchitecture);
  const canonicalTarget = resolveCanonicalPersonnelName(targetName, canonicalNameLookup);
  const names = readTeamProjectOwnerNames(project, canonicalNameLookup);
  return names.includes(canonicalTarget);
}

export function filterProjects(projects, filters = {}, options = {}) {
  const search = String(filters.search || '').trim().toLowerCase();
  const collaborator = String(filters.collaborator || '').trim();
  const collaborationDiscipline = String(filters.collaborationDiscipline || '').trim();
  const teamProjectOwner = String(filters.teamProjectOwner || filters.ownerPressurePerson || '').trim();
  const personnelArchitecture = normalizePersonnelArchitecture(options.personnelArchitecture || {});
  const scopedProjects = resolveFilterScope(projects, filters, personnelArchitecture);
  const baseProjects = isEnabledFilter(filters.excludePaused) ? excludePausedProjects(scopedProjects) : scopedProjects;
  const metricOptions = drillMetricOptions(filters, personnelArchitecture);
  const tier = filters.tier || '';
  const metric = filters.metric || '';
  const hardOwnerMetric = isHardOwnerMetricKey(metric);
  const activeResponsibilityOnly = isEnabledFilter(filters.activeResponsibility);

  return baseProjects.filter((project) => {
    const rawFieldText = Object.values(project.rawFields || {})
      .map((field) => field.display)
      .join(' ');
    const searchableText = [
      project.name,
      project.owner,
      project.ownerDisplay,
      project.province,
      project.businessType,
      project.storeStatus,
      rawFieldText,
    ]
      .join(' ')
      .toLowerCase();

    return (
      (!search || searchableText.includes(search)) &&
      matchesProvince(project.province, filters.province) &&
      matchesValue(project.businessType, filters.businessType) &&
      matchesValue(project.storeStatus, filters.storeStatus) &&
      matchesValue(project.status, filters.status) &&
      matchesValue(project.riskLevel, filters.riskLevel) &&
      matchesStoreNature(project, filters.storeNature) &&
      matchesCollaborationResponsibility(project, collaborator, collaborationDiscipline, personnelArchitecture) &&
      matchesTeamProjectOwner(project, teamProjectOwner, personnelArchitecture) &&
      (!activeResponsibilityOnly || hasOpenResponsibilityForDiscipline(project, metricOptions.ownerDiscipline)) &&
      matchesLifecycleStage(project, filters.lifecycleStage) &&
      (hardOwnerMetric || !tier || matchesMetricProject(project, 'projectCount', tier, metricOptions)) &&
      (!metric ||
        (hardOwnerMetric
          ? matchesHardOwnerMetricProject(project, metric, metricOptions)
          : matchesMetricProject(project, metric, tier, metricOptions))) &&
      (!filters.delayed || metric || matchesMetricProject(project, 'openDelayed', tier, metricOptions))
    );
  });
}

function uniqueSorted(projects, selector) {
  return Array.from(new Set(projects.map(selector).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function createFieldCatalog(projects) {
  const catalog = new Map();

  for (const project of projects) {
    for (const [key, rawField] of Object.entries(project.rawFields || {})) {
      if (!catalog.has(key)) {
        catalog.set(key, {
          key,
          label: key,
          kind: rawField.kind,
          nonEmpty: rawField.display ? 1 : 0,
        });
        continue;
      }

      const item = catalog.get(key);
      if (rawField.kind !== 'empty' && item.kind !== rawField.kind) {
        item.kind = item.kind === 'empty' ? rawField.kind : 'mixed';
      }
      if (rawField.display) {
        item.nonEmpty += 1;
      }
    }
  }

  return Array.from(catalog.values());
}

export function createFilterOptions(projects) {
  return {
    provinces: uniqueSorted(projects, (project) => provinceDisplayName(project.province) || project.province),
    businessTypes: uniqueSorted(projects, (project) => project.businessType),
    storeStatuses: uniqueSorted(projects, (project) => project.storeStatus).filter(isClassifiableStoreStatus),
    statuses: uniqueSorted(projects, (project) => project.status),
    riskLevels: uniqueSorted(projects, (project) => project.riskLevel),
  };
}

const SCHEME_STATUS_FIELDS = ['硬装方案情况（每周五刷新）', '硬装方案情况', '方案情况'];
const STORE_NATURE_FIELDS = ['店铺性质'];
const SOFT_DONE_TIME_FIELDS = ['软装完成时间'];
const HARD_SCHEME_DONE_TIME_FIELDS = ['硬装方案完成时间', '躺平内部审核结束时间', '内部审核结束时间'];
const POINT_DONE_STATUS_FIELDS = ['点位完成情况'];
const POINT_DONE_TIME_FIELDS = ['点位完成时间'];
const SOFT_STAGE_REQUIRING_POINT_EVIDENCE_PATTERN = /点位已完成|点位完成|软装方案|软装完成|产品清单|待采购|采购|摆场|闭环|^完成$|已完成/;
const HEALTH_FIELD_DEFINITIONS = [
  {
    key: 'owner',
    label: '负责人',
    fields: ['负责人', 'CD负责人', '硬装负责人', 'VM负责人', '软装负责人'],
    required: true,
    fallback: (project) => project.owner,
  },
  { key: 'group', label: '组别', fields: ['组别'], required: true },
  { key: 'storeTier', label: '店态', fields: ['店态'], required: true, fallback: (project) => project.storeStatus },
  { key: 'hardStage', label: '硬装项目进度', fields: ['硬装项目进度', '硬装进度'], required: true },
  { key: 'softStage', label: '软装项目进度', fields: ['软装项目进度', '软装进度'], required: true, skip: isSleepStoreProject },
  { key: 'hardScheme', label: '硬装方案情况', fields: SCHEME_STATUS_FIELDS, required: false },
  { key: 'meeting', label: '上会情况', fields: ['上会情况'], required: false },
  { key: 'softCompletion', label: '软装完成情况', fields: ['软装完成情况'], required: false, skip: isSleepStoreProject },
  { key: 'dueDate', label: '计划开业时间', fields: ['计划开业时间'], required: true, fallback: (project) => project.dueDate },
  { key: 'startDate', label: '启动时间', fields: ['启动时间'], required: true, fallback: (project) => project.startDate },
  { key: 'softDoneTime', label: '软装完成时间', fields: SOFT_DONE_TIME_FIELDS, required: false, skip: isSleepStoreProject },
];

function readRawFieldDisplay(project, fieldNames) {
  for (const fieldName of fieldNames) {
    const display = project.rawFields?.[fieldName]?.display;
    if (display) {
      return normalizeCell(display);
    }
  }
  return '';
}

function classifyStoreNature(project) {
  const semanticNature = readStoreNatureKey(project);
  if (semanticNature === 'newStore') {
    return 'new';
  }
  if (semanticNature === 'renovated') {
    return 'old';
  }

  const nature = readRawFieldDisplay(project, STORE_NATURE_FIELDS);
  if (/新/.test(nature)) {
    return 'new';
  }
  if (/老|改造|翻新|扩店|换址|重装/.test(nature)) {
    return 'old';
  }

  const storeStatus = normalizeCell(project.storeStatus);
  if (/新/.test(storeStatus)) {
    return 'new';
  }
  if (/老|改造|翻新|扩店|换址|重装/.test(storeStatus)) {
    return 'old';
  }
  return 'other';
}

function projectEntryDate(project) {
  return project.startDate || '';
}

function projectEntryMonthInfo(project, { allowUpdatedAtFallback = true } = {}) {
  const entryDate = projectEntryDate(project);
  if (entryDate) {
    const startMonth = monthKey(`${entryDate}T00:00:00`);
    if (startMonth !== '未知') {
      return { month: startMonth, source: 'startDate', hasValidStartDate: true, usedFallback: false };
    }
  }

  if (allowUpdatedAtFallback && project.updatedAt) {
    const fallbackMonth = monthKey(project.updatedAt);
    if (fallbackMonth !== '未知') {
      return {
        month: fallbackMonth,
        source: entryDate ? 'updatedAtFallbackInvalidStartDate' : 'updatedAtFallbackMissingStartDate',
        hasValidStartDate: false,
        usedFallback: true,
      };
    }
  }

  return {
    month: '未知',
    source: entryDate ? 'invalidStartDate' : 'missingStartDate',
    hasValidStartDate: false,
    usedFallback: false,
  };
}

function projectEntryMonth(project, { allowUpdatedAtFallback = true } = {}) {
  return projectEntryMonthInfo(project, { allowUpdatedAtFallback }).month;
}

function isInCurrentYear(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return date.getFullYear() === new Date().getFullYear();
}

function isInCurrentMonth(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function monthlySeriesFromProjects(projects, selector) {
  const counts = new Map();
  for (const project of projects) {
    const month = selector(project);
    if (month === '未知') {
      continue;
    }
    counts.set(month, (counts.get(month) || 0) + 1);
  }
  return Array.from(counts, ([label, value]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label));
}

function rowByLabel(rows = [], label = '') {
  return rows.find((item) => item.label === label) || null;
}

function monthlyValueByLabel(rows = [], label = '') {
  return Number(rowByLabel(rows, label)?.value || 0);
}

function compactMonthlyDifficulty(row = null) {
  return {
    projectCount: Number(row?.projectCount || 0),
    measuredProjectCount: Number(row?.measuredProjectCount || 0),
    responsibleWeightedWorkload: Number(row?.responsibleWeightedWorkload || 0),
    avgScore: Number(row?.avgScore || 0),
    highDifficultyCount: Number(row?.highDifficultyCount || 0),
    pressureScore: Number(row?.pressureScore || 0),
    pressureLevel: row?.pressureLevel || monthlyPressureLevel(row?.pressureScore),
    pressureTone: row?.pressureTone || monthlyPressureTone(row?.pressureScore),
  };
}

function storeNaturePressureScore({ count = 0, difficulty = null } = {}) {
  if (!count && !difficulty?.pressureScore) {
    return 0;
  }
  const countScore = Math.min(Number(count || 0) / STORE_NATURE_ENTRY_PRESSURE_COUNT_CAP, 1) * 42;
  const difficultyScore = Math.min(Number(difficulty?.pressureScore || 0), 100) * 0.58;
  return Math.round(Math.min(100, countScore + difficultyScore));
}

function totalEntryPressureScore({ total = 0, difficulty = null } = {}) {
  if (!total && !difficulty?.pressureScore) {
    return 0;
  }
  const countScore = Math.min(Number(total || 0) / MONTHLY_ENTRY_PRESSURE_COUNT_CAP, 1) * 38;
  const difficultyScore = Math.min(Number(difficulty?.pressureScore || 0), 100) * 0.62;
  return Math.round(Math.min(100, countScore + difficultyScore));
}

function monthlyEntryPressureSeries({
  newStore = [],
  oldStore = [],
  difficultyByMonth = [],
  newStoreDifficultyByMonth = [],
  oldStoreDifficultyByMonth = [],
  owner = '',
  disciplineLabel = '',
} = {}) {
  const labels = Array.from(
    new Set(
      [
        ...newStore,
        ...oldStore,
        ...newStoreDifficultyByMonth,
        ...oldStoreDifficultyByMonth,
      ]
        .map((item) => item.label)
        .filter(Boolean)
    )
  ).sort();
  return labels.map((label) => {
    const newStoreCount = monthlyValueByLabel(newStore, label);
    const oldStoreCount = monthlyValueByLabel(oldStore, label);
    const totalEntryCount = newStoreCount + oldStoreCount;
    const difficulty = compactMonthlyDifficulty(rowByLabel(difficultyByMonth, label));
    const newStoreDifficulty = compactMonthlyDifficulty(rowByLabel(newStoreDifficultyByMonth, label));
    const oldStoreDifficulty = compactMonthlyDifficulty(rowByLabel(oldStoreDifficultyByMonth, label));
    const newStorePressureScore = storeNaturePressureScore({
      count: newStoreCount,
      difficulty: newStoreDifficulty,
    });
    const oldStorePressureScore = storeNaturePressureScore({
      count: oldStoreCount,
      difficulty: oldStoreDifficulty,
    });
    const pressureScore = totalEntryPressureScore({ total: totalEntryCount, difficulty });

    return {
      label,
      owner,
      disciplineLabel,
      newStoreCount,
      oldStoreCount,
      totalEntryCount,
      newStoreDifficulty,
      oldStoreDifficulty,
      difficulty,
      newStorePressureScore,
      oldStorePressureScore,
      pressureScore,
      pressureLevel: monthlyPressureLevel(pressureScore),
      pressureTone: monthlyPressureTone(pressureScore),
    };
  });
}

export function filterProjectsForTeam(projects, team, options = {}) {
  if (!team?.owner) {
    return [];
  }
  return resolveOwnerMonthlyProjects(projects, team.owner, {
    dashboardContext: options.dashboardContext || 'all',
    personnelArchitecture: options.personnelArchitecture,
  });
}

function buildOwnerLoad(projects, personnelArchitecture = {}) {
  const displayLookup = buildPersonDisplayLookup(personnelArchitecture);
  const canonicalNameLookup = buildCanonicalPersonnelNameLookup(personnelArchitecture);
  const counts = new Map();
  for (const project of projects) {
    const ownerRole = PERSONNEL_ROLES.find((role) => role.key === 'owner');
    const names = readPersonnelNames(project, ownerRole, canonicalNameLookup);
    for (const name of names) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return Array.from(counts, ([label, value]) => ({
    label: formatPersonnelDisplay(label, displayLookup),
    value,
  })).sort((a, b) => {
    if (b.value !== a.value) {
      return b.value - a.value;
    }
    return a.label.localeCompare(b.label, 'zh-Hans-CN');
  });
}

function ownerDisciplineLabel(person = {}, personnelArchitecture = {}) {
  const fromPolicy = resolveOwnerDisplayTitle(person, personnelArchitecture.categories || {});
  if (fromPolicy) {
    return fromPolicy;
  }
  const discipline = disciplineLabel(person.discipline);
  const position = person.position === 'owner' ? '负责人' : '';
  return discipline && position ? `${discipline}${position}` : discipline || position || '负责人';
}

function appendRoleLabel(current = '', label = '') {
  const labels = String(current || '')
    .split('、')
    .map((item) => item.trim())
    .filter(Boolean);
  const nextLabel = String(label || '').trim();
  if (nextLabel && !labels.includes(nextLabel)) {
    labels.push(nextLabel);
  }
  return labels.join('、');
}

function ownerCollaborationTitle(name, personnelArchitecture = {}) {
  const localPerson = personnelArchitecture.people?.[name] || {};
  if (localPerson.position !== 'owner' && !localPerson.dualDisciplineOwner) {
    return '';
  }
  return ownerDisciplineLabel({ name, ...localPerson }, personnelArchitecture);
}

function collaborationRoleLabel(name, personnelArchitecture = {}, role = {}) {
  return appendRoleLabel(ownerCollaborationTitle(name, personnelArchitecture), role.label);
}

function buildLeadLoad(projects, personnelArchitecture = {}, collaborationRoles = TEAM_COLLABORATION_ROLES) {
  const stats = new Map();
  const canonicalNameLookup = buildCanonicalPersonnelNameLookup(personnelArchitecture);

  for (const project of projects) {
    const projectNames = new Set();
    for (const role of collaborationRoles) {
      for (const name of readPersonnelNames(project, role, canonicalNameLookup)) {
        if (!stats.has(name)) {
          stats.set(name, {
            ...createPersonStat(name, personnelArchitecture, role),
            role: role.key,
            roleLabel: collaborationRoleLabel(name, personnelArchitecture, role),
          });
        } else {
          const stat = stats.get(name);
          stat.roleLabel = appendRoleLabel(stat.roleLabel, role.label);
        }
        projectNames.add(name);
      }
    }

    for (const name of projectNames) {
      addProjectToPersonStat(stats.get(name), project);
    }
  }

  return sortPersonnelStats(Array.from(stats.values()));
}

function addProjectWorkloadToPersonStat(stat, project, discipline) {
  if (shouldSkipResponsibilityWorkload(project, discipline)) {
    return false;
  }
  const difficulty = normalizeProjectDifficulty(project);
  const segment = responsibleDifficultySegment(difficulty, discipline);
  stat.workdays = Number(stat.workdays || 0) + Number(segment.workdays || 0);
  stat.weightedWorkload = Number(stat.weightedWorkload || 0) + Number(segment.weight || 0);
  if (discipline === 'hard') {
    stat.hardWorkdays = Number(stat.hardWorkdays || 0) + Number(segment.workdays || 0);
    stat.hardWeightedWorkload = Number(stat.hardWeightedWorkload || 0) + Number(segment.weight || 0);
  }
  if (discipline === 'soft') {
    stat.softWorkdays = Number(stat.softWorkdays || 0) + Number(segment.workdays || 0);
    stat.softWeightedWorkload = Number(stat.softWeightedWorkload || 0) + Number(segment.weight || 0);
  }
  if (Number(difficulty.score || 0) > 0) {
    stat.scoreTotal = Number(stat.scoreTotal || 0) + Number(difficulty.score || 0);
    stat.measuredProjectCount = Number(stat.measuredProjectCount || 0) + 1;
  }
  return true;
}

function finalizeWeightedPersonStat(stat) {
  const finalized = {
    ...stat,
    workdays: round1(stat.workdays),
    weightedWorkload: round2(stat.weightedWorkload),
    hardWorkdays: round1(stat.hardWorkdays),
    hardWeightedWorkload: round2(stat.hardWeightedWorkload),
    softWorkdays: round1(stat.softWorkdays),
    softWeightedWorkload: round2(stat.softWeightedWorkload),
    avgScore: stat.measuredProjectCount ? Math.round(stat.scoreTotal / stat.measuredProjectCount) : 0,
  };
  delete finalized.scoreTotal;
  return finalized;
}

function buildWeightedLeadLoad(projects, personnelArchitecture = {}, collaborationRoles = TEAM_COLLABORATION_ROLES) {
  const stats = new Map();
  const canonicalNameLookup = buildCanonicalPersonnelNameLookup(personnelArchitecture);

  for (const project of projects) {
    const projectNames = new Set();
    const workloadCredits = new Set();
    for (const role of collaborationRoles) {
      for (const name of readPersonnelNames(project, role, canonicalNameLookup)) {
        if (!stats.has(name)) {
          stats.set(name, {
            ...createPersonStat(name, personnelArchitecture, role),
            role: role.key,
            roleLabel: collaborationRoleLabel(name, personnelArchitecture, role),
            workdays: 0,
            weightedWorkload: 0,
            hardWorkdays: 0,
            hardWeightedWorkload: 0,
            softWorkdays: 0,
            softWeightedWorkload: 0,
            measuredProjectCount: 0,
            scoreTotal: 0,
          });
        } else {
          const stat = stats.get(name);
          stat.roleLabel = appendRoleLabel(stat.roleLabel, role.label);
        }
        const workloadCreditKey = `${name}::${role.discipline}`;
        if (!workloadCredits.has(workloadCreditKey)) {
          addProjectWorkloadToPersonStat(stats.get(name), project, role.discipline);
          workloadCredits.add(workloadCreditKey);
        }
        projectNames.add(name);
      }
    }

    for (const name of projectNames) {
      addProjectToPersonStat(stats.get(name), project);
    }
  }

  return Array.from(stats.values())
    .map(finalizeWeightedPersonStat)
    .sort((a, b) => {
      if (b.weightedWorkload !== a.weightedWorkload) {
        return b.weightedWorkload - a.weightedWorkload;
      }
      if (b.value !== a.value) {
        return b.value - a.value;
      }
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
}

function fieldCoverageRate(projects, predicate) {
  if (!projects.length) {
    return 0;
  }
  const covered = projects.filter(predicate).length;
  return Math.round((covered / projects.length) * 100);
}

function readHealthField(project, definition) {
  const raw = readRawFieldDisplay(project, definition.fields || []);
  if (raw) {
    return raw;
  }
  return definition.fallback ? normalizeCell(definition.fallback(project)) : '';
}

function buildCoverageItem(projects, definition) {
  const scopedProjects = definition.skip ? projects.filter((project) => !definition.skip(project)) : projects;
  const count = scopedProjects.filter((project) => Boolean(readHealthField(project, definition))).length;
  const total = scopedProjects.length;
  const rate = total ? Math.round((count / total) * 100) : 0;
  const warnAt = definition.required ? 95 : 50;
  return {
    key: definition.key,
    label: definition.label,
    count,
    total,
    rate,
    warnAt,
    required: Boolean(definition.required),
    scope: 'data_quality',
    status: rate >= warnAt ? 'ok' : 'warn',
  };
}

function checkDatePast(project) {
  return Boolean(project.isDelayed);
}

function projectHealthSamples(projects) {
  return projects.slice(0, 5).map((project) => ({
    id: project.id,
    name: project.name,
    owner: project.ownerDisplay || project.owner,
    storeTier: readStoreTierLabel(project),
    dueDate: project.dueDate || '',
  }));
}

function createHealthCheck(
  projects,
  { key, label, severity = 'warn', description, predicate, suppressRiskItem = false, scope = 'data_quality', affectsQuality = true }
) {
  const matched = projects.filter(predicate);
  return {
    key,
    label,
    severity,
    description,
    suppressRiskItem,
    scope,
    affectsQuality,
    count: matched.length,
    samples: projectHealthSamples(matched),
  };
}

function buildDataHealthLimitations(fieldCoverage, checks) {
  const coverageLimitations = fieldCoverage
    .filter((item) => item.status === 'warn')
    .map((item) => `${item.label}覆盖率 ${item.rate}%，对应指标仅供参考`);
  const checkLimitations = checks
    .filter((item) => item.severity === 'warn' && item.count > 0)
    .map((item) => `${item.label} ${item.count} 条，需回源表核对`);
  return [...coverageLimitations, ...checkLimitations];
}

function dataHealthQualityLevel(fieldCoverage, checks) {
  const hasVeryLowCoverage = fieldCoverage.some((item) => item.status === 'warn' && item.rate < 50);
  const hasCheckWarnings = checks.some((item) => item.affectsQuality !== false && item.severity === 'warn' && item.count > 0);
  if (hasVeryLowCoverage || hasCheckWarnings) {
    return 'low';
  }
  if (fieldCoverage.some((item) => item.status === 'warn')) {
    return 'medium';
  }
  return 'high';
}

function isDelayText(value) {
  return /延期/.test(value || '');
}

function isDoneText(value) {
  const text = String(value || '').trim();
  return Boolean(text && !/未完成|延期中/.test(text) && /完成/.test(text));
}

function isSoftCompletionDoneText(value) {
  return /准时完成|延期完成/.test(value || '');
}

function needsPointCompletionEvidence(project) {
  if (isSleepStoreProject(project)) {
    return false;
  }
  return Boolean(
    isDoneText(readRawFieldDisplay(project, POINT_DONE_STATUS_FIELDS)) ||
      readRawFieldDisplay(project, POINT_DONE_TIME_FIELDS) ||
      SOFT_STAGE_REQUIRING_POINT_EVIDENCE_PATTERN.test(readRawFieldDisplay(project, ['软装项目进度', '软装进度']))
  );
}

function buildTeamDataHealth(projects) {
  const fieldCoverage = HEALTH_FIELD_DEFINITIONS.map((definition) => buildCoverageItem(projects, definition));
  const checks = [
    createHealthCheck(projects, {
      key: 'hardSchemeMeetingConflict',
      label: '方案情况与上会情况冲突',
      severity: 'warn',
      description: '硬装方案情况和上会情况不是同一口径，冲突记录需要回到源表核对。',
      predicate: (project) => {
        const scheme = readSchemeStatus(project);
        const meeting = readRawFieldDisplay(project, ['上会情况']);
        return Boolean(scheme && meeting && isDoneText(scheme) && isDoneText(meeting) && isDelayText(scheme) !== isDelayText(meeting));
      },
    }),
    createHealthCheck(projects, {
      key: 'softCompletionStageConflict',
      label: '软装完成情况与软装进度不同步',
      severity: 'warn',
      description: '完成类指标以软装完成情况为准，未闭环类指标以软装项目进度为准；不同步记录建议在源表修正。',
      predicate: (project) => {
        if (isSleepStoreProject(project)) {
          return false;
        }
        const completion = readSoftCompletionStatus(project);
        return Boolean((isSoftCompletionDoneText(completion) && !isSoftWorkflowClosed(project)) || (isSoftWorkflowClosed(project) && !completion));
      },
    }),
    createHealthCheck(projects, {
      key: 'closedButPlanPast',
      label: '已闭环但计划开业过期（管理边界）',
      severity: 'info',
      description: '这些记录只作为计划日期与实际进度的历史校准，不进入设计师延期风险。',
      suppressRiskItem: true,
      scope: 'delivery_boundary',
      predicate: (project) => checkDatePast(project) && isDesignResponsibilityClosed(project),
    }),
    createHealthCheck(projects, {
      key: 'openPlanPast',
      label: '未闭环但计划开业过期（管理边界）',
      severity: 'info',
      description: '计划开业过期只代表管理边界需校准，不单独构成设计责任延期。',
      suppressRiskItem: true,
      scope: 'delivery_boundary',
      predicate: (project) => checkDatePast(project) && !isDesignResponsibilityClosed(project),
    }),
    createHealthCheck(projects, {
      key: 'softDelayDoneMissingDate',
      label: '软装延期完成缺少完成时间',
      severity: 'warn',
      description: '软装完成情况写了延期完成，但软装完成时间为空，本月延期完成无法按月份准确归属。',
      predicate: (project) =>
        !isSleepStoreProject(project) &&
        /延期完成/.test(readSoftCompletionStatus(project)) &&
        !readRawFieldDisplay(project, SOFT_DONE_TIME_FIELDS),
    }),
    createHealthCheck(projects, {
      key: 'hardSchemeDoneMissingDate',
      label: '硬装方案完成缺少完成时间',
      severity: 'warn',
      description: '硬装方案情况写了准时/延期完成，但方案完成或审核结束时间为空，方案完成无法准确归属到月份。',
      suppressRiskItem: true,
      affectsQuality: false,
      predicate: (project) => isDoneText(readSchemeStatus(project)) && !readRawFieldDisplay(project, HARD_SCHEME_DONE_TIME_FIELDS),
    }),
    createHealthCheck(projects, {
      key: 'pointDoneMissingTime',
      label: '点位完成缺少完成时间',
      severity: 'warn',
      description: '点位完成情况或软装进度已进入点位完成及后续阶段，但点位完成时间为空，点位推进无法准确归属到月份。',
      suppressRiskItem: true,
      affectsQuality: false,
      predicate: (project) => needsPointCompletionEvidence(project) && !readRawFieldDisplay(project, POINT_DONE_TIME_FIELDS),
    }),
    createHealthCheck(projects, {
      key: 'pointTimeMissingStatus',
      label: '点位完成时间缺少完成情况',
      severity: 'warn',
      description: '点位完成时间已填写，但点位完成情况为空，点位状态统计缺少准时/延期口径。',
      suppressRiskItem: true,
      affectsQuality: false,
      predicate: (project) =>
        !isSleepStoreProject(project) &&
        Boolean(readRawFieldDisplay(project, POINT_DONE_TIME_FIELDS)) &&
        !readRawFieldDisplay(project, POINT_DONE_STATUS_FIELDS),
    }),
    createHealthCheck(projects, {
      key: 'hardStageSchemeConflict',
      label: '硬装进度与方案情况不同步',
      severity: 'info',
      description: '硬装进度未闭环但方案已完成，通常是进度和方案两个字段更新节奏不同。',
      predicate: (project) => isDoneText(readSchemeStatus(project)) && !isHardWorkflowClosed(project),
    }),
  ];
  const warningCount = checks.filter((item) => item.severity === 'warn').reduce((sum, item) => sum + item.count, 0);
  const issueCount = checks.reduce((sum, item) => sum + item.count, 0);
  const lowCoverageFields = fieldCoverage.filter((item) => item.status === 'warn').length;
  const limitations = buildDataHealthLimitations(fieldCoverage, checks);

  return {
    totalProjects: projects.length,
    issueCount,
    warningCount,
    lowCoverageFields,
    qualityLevel: dataHealthQualityLevel(fieldCoverage, checks),
    riskPolicy: 'data_quality_only',
    limitations,
    summary: warningCount
      ? `发现 ${warningCount} 条需核对记录，优先看红色提示`
      : lowCoverageFields
        ? `发现 ${lowCoverageFields} 个字段覆盖率偏低`
        : '字段状态良好',
    fieldCoverage,
    checks,
  };
}

export function calculateTeamDashboardMetrics(allProjects, team, personnelArchitecture = {}, options = {}) {
  const normalizedPersonnelArchitecture = normalizePersonnelArchitecture(personnelArchitecture);
  const ownerName = team?.owner || '';
  const ownerIdentity = findResponsibilityIdentity(ownerName, normalizedPersonnelArchitecture);
  const ownerPerson = ownerIdentity ? {} : normalizedPersonnelArchitecture.people?.[ownerName] || {};
  const ownerDiscipline = ownerIdentity?.discipline || ownerPerson.discipline || '';
  const ownerDisciplineDisplay = ownerIdentity
    ? ownerDisciplineLabel({ position: 'owner', discipline: ownerIdentity.discipline }, normalizedPersonnelArchitecture)
    : ownerDisciplineLabel(ownerPerson, normalizedPersonnelArchitecture);
  const dashboardContext = shouldUseAllContextForOwnerIdentity(ownerIdentity)
    ? 'all'
    : options.dashboardContext || team.dashboardContext || 'all';
  const scopeOptions = {
    dashboardContext,
    personnelArchitecture: normalizedPersonnelArchitecture,
  };
  const teamScopeProjects = filterProjectsForTeam(allProjects, team, scopeOptions);
  const teamPausedCount = countPausedProjects(teamScopeProjects);
  const teamProjects = excludePausedProjects(teamScopeProjects);
  const dashboard = composeDashboardMetrics(allProjects, 'ownerMonthly', {
    team,
    owner: ownerName,
    dashboardContext,
    personnelArchitecture: normalizedPersonnelArchitecture,
    ownerDiscipline,
  });
  const hardOwnerMetrics =
    ownerDiscipline === 'hard'
      ? calculateHardOwnerMetrics(teamProjects, {
          today: options.today,
          now: options.now,
          year: options.year,
          month: options.month,
        })
      : null;
  const totals = dashboard.totals || {};
  const totalProjects = teamProjects.length;
  const teamMetricOptions = {
    profileId: 'ownerMonthly',
    owner: ownerName,
    ownerDiscipline,
    dashboardContext,
    personnelArchitecture: normalizedPersonnelArchitecture,
  };
  const companyInProgressProjects = teamProjects.filter((project) => isProjectInProgress(project));
  const delayedProjects =
    totals.openDelayed ?? companyInProgressProjects.filter((project) =>
      isOpenResponsibilityDelayedForDiscipline(project, ownerDiscipline)
    ).length;
  const highRiskProjects = companyInProgressProjects.filter((project) => project.riskLevel === '高').length;
  const activeBucketCount = totals.inProgress ?? companyInProgressProjects.length;
  const notStartedBucketCount = totals.notStarted ?? 0;
  const closedInScopeProjects = teamProjects.filter(
    (project) =>
      isDesignResponsibilityClosed(project) &&
      !matchesMetricProject(project, 'inProgress', '', teamMetricOptions) &&
      !matchesMetricProject(project, 'notStarted', '', teamMetricOptions)
  ).length;
  const unbucketedInScopeProjects = Math.max(
    0,
    totalProjects - activeBucketCount - notStartedBucketCount - closedInScopeProjects
  );
  const averageProgress =
    totalProjects === 0
      ? 0
      : Math.round(teamProjects.reduce((sum, project) => sum + Number(project.progress || 0), 0) / totalProjects);

  const newStoreProjects = teamProjects.filter((project) => classifyStoreNature(project) === 'new');
  const oldStoreProjects = teamProjects.filter((project) => classifyStoreNature(project) === 'old');
  const entryMonthSelector = (project) => projectEntryMonth(project);
  const monthlyNewStore = monthlySeriesFromProjects(newStoreProjects, entryMonthSelector);
  const monthlyOldStore = monthlySeriesFromProjects(oldStoreProjects, entryMonthSelector);

  const byStoreTier = {};
  const inProgressNewStoreProjects = companyInProgressProjects.filter((project) => classifyStoreNature(project) === 'new');
  const inProgressOldStoreProjects = companyInProgressProjects.filter((project) => classifyStoreNature(project) === 'old');
  for (const tier of dashboard.tierOrder || []) {
    const label = dashboard.tierLabels?.[tier] || readStoreTierLabel(teamProjects.find((project) => readStoreTier(project) === tier)) || tier;
    byStoreTier[label] = monthlySeriesFromProjects(
      teamProjects.filter((project) => matchesOwnerMonthlyTier(project, tier)),
      entryMonthSelector
    );
  }

  const riskProjects = companyInProgressProjects
    .filter((project) => isOpenResponsibilityDelayedForDiscipline(project, ownerDiscipline) || project.riskLevel === '高')
    .sort((a, b) => {
      if (a.riskLevel !== b.riskLevel) {
        return a.riskLevel === '高' ? -1 : 1;
      }
      return String(a.dueDate).localeCompare(String(b.dueDate));
    })
    .map((project) => annotateResponsibilityDelay(project, ownerDiscipline))
    .slice(0, 12);
  const openDelayedProjects = companyInProgressProjects
    .filter((project) => {
      const tiersForProject = (dashboard.tierOrder || []).filter((tier) => matchesOwnerMonthlyTier(project, tier));
      const candidateTiers = tiersForProject.length ? tiersForProject : [''];
      return candidateTiers.some((tier) => matchesMetricProject(project, 'openDelayed', tier, teamMetricOptions));
    })
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .map((project) => annotateResponsibilityDelay(project, ownerDiscipline))
    .slice(0, 12);
  const urgentStatusProjects = companyInProgressProjects
    .filter((project) => normalizePriorityStatus(project.status) === '紧急')
    .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    .slice(0, 12);

  const currentYear = String(new Date().getFullYear());
  const totalAssignedYtd = teamProjects.filter((project) => projectEntryMonthInfo(project).month.startsWith(`${currentYear}-`)).length;
  const entryMonthInfos = teamProjects.map((project) => projectEntryMonthInfo(project));
  const entryDateCoverage = fieldCoverageRate(teamProjects, (project) =>
    projectEntryMonthInfo(project, { allowUpdatedAtFallback: false }).hasValidStartDate
  );
  const usesUpdatedAtFallback = entryMonthInfos.some((item) => item.usedFallback);
  const storeNatureCoverage = fieldCoverageRate(
    teamProjects,
    (project) => classifyStoreNature(project) !== 'other'
  );
  const schemeStatusCoverage = fieldCoverageRate(teamProjects, (project) => Boolean(readRawFieldDisplay(project, SCHEME_STATUS_FIELDS)));
  const collaborationRoles = teamCollaborationRolesForOwnerDiscipline(ownerDiscipline);
  const difficultySummary = buildDifficultySummary(companyInProgressProjects, {
    tierOrder: dashboard.tierOrder || [],
    tierLabels: dashboard.tierLabels || {},
    ownerDiscipline,
  });
  const difficultyByMonth = monthlyDifficultySeriesFromProjects(companyInProgressProjects, entryMonthSelector, {
    ownerDiscipline,
  });
  const newStoreDifficultyByMonth = monthlyDifficultySeriesFromProjects(inProgressNewStoreProjects, entryMonthSelector, {
    ownerDiscipline,
  });
  const oldStoreDifficultyByMonth = monthlyDifficultySeriesFromProjects(inProgressOldStoreProjects, entryMonthSelector, {
    ownerDiscipline,
  });
  const pressureByMonth = monthlyEntryPressureSeries({
    newStore: monthlyNewStore,
    oldStore: monthlyOldStore,
    difficultyByMonth,
    newStoreDifficultyByMonth,
    oldStoreDifficultyByMonth,
    owner: ownerName,
    disciplineLabel: ownerDisciplineDisplay,
  });
  const monthlyEntry = {
    newStore: monthlyNewStore,
    oldStore: monthlyOldStore,
    byStoreTier,
    difficultyByMonth,
    newStoreDifficultyByMonth,
    oldStoreDifficultyByMonth,
    pressureByMonth,
    usesUpdatedAtFallback,
  };
  monthlyEntry.rhythmAdvice = buildEntryRhythmAdvice({
    context: {
      owner: ownerName,
      disciplineLabel: ownerDisciplineDisplay,
      dashboardContext,
      windowMonths: Math.max(monthlyNewStore.length, monthlyOldStore.length, difficultyByMonth.length, pressureByMonth.length),
    },
    entry: {
      newStore: monthlyEntry.newStore,
      oldStore: monthlyEntry.oldStore,
      pressureByMonth,
      coverage: {
        entryDate: entryDateCoverage,
        storeNature: storeNatureCoverage,
        usesUpdatedAtFallback: monthlyEntry.usesUpdatedAtFallback,
      },
    },
    difficulty: {
      monthly: difficultyByMonth,
      overall: difficultySummary,
    },
    risk: {
      delayedProjects,
      highRiskProjects,
    },
  });

  return {
    ...dashboard,
    owner: ownerName,
    ownerDiscipline,
    dashboardContext,
    displayName: ownerIdentity?.displayName || ownerPerson.displayName || ownerName,
    sourceOwner: ownerIdentity?.sourceName || undefined,
    ownerIdentity: ownerIdentity || undefined,
    disciplineLabel: ownerDisciplineDisplay,
    hardOwnerMetrics,
    soleDualDisciplineOwner: normalizedPersonnelArchitecture.soleDualDisciplineOwner || null,
    pausedCount: teamPausedCount,
    totalScopeCount: teamScopeProjects.length,
    team: {
      owner: ownerName,
    },
    summary: {
      totalProjects,
      pausedProjects: teamPausedCount,
      activeProjects: activeBucketCount,
      notStarted: notStartedBucketCount,
      delayedProjects,
      highRiskProjects,
      averageProgress,
    },
    alerts: {
      schemeDelayedThisMonth: totals.schemeDelayDoneMonth ?? 0,
      schemeDelayedYtd: totals.schemeDelayDoneYtd ?? 0,
      openDelayed: totals.openDelayed ?? 0,
      unscheduled: totals.notStarted ?? 0,
    },
    scopeBreakdown: {
      closedInScope: closedInScopeProjects,
      unbucketedInScope: unbucketedInScopeProjects,
    },
    monthlyEntry,
    statusCounts: countBy(companyInProgressProjects, (project) => project.status),
    storeStatusCounts: countBy(teamProjects, (project) => project.storeStatus),
    businessTypeCounts: countBy(teamProjects, (project) => project.businessType),
    difficultySummary,
    leadLoad: buildLeadLoad(companyInProgressProjects, normalizedPersonnelArchitecture, collaborationRoles),
    weightedLeadLoad: buildWeightedLeadLoad(companyInProgressProjects, normalizedPersonnelArchitecture, collaborationRoles),
    riskProjects,
    openDelayedProjects,
    urgentStatusProjects,
    yearSummary: {
      completedSchemes: totals.schemeDoneYtd ?? 0,
      totalAssignedYtd,
    },
    fieldCoverage: {
      ...dashboard.fieldCoverage,
      entryDate: entryDateCoverage,
      storeNature: storeNatureCoverage,
      schemeStatus: schemeStatusCoverage,
    },
    dataHealth: buildTeamDataHealth(teamProjects),
    total: totalProjects,
  };
}

export { isSchemeDelayed };
