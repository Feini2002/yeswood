export const HARD_DECORATION_DEADLINE_RULE_VERSION = 'hard-decoration-deadline-v2026-06-12';

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DAY_MS = 24 * 60 * 60 * 1000;

const DEADLINE_LABELS = {
  floorPlanStart: '平面/躺平设计启动',
  floorPlanWarn: '提醒：方案快截止了',
  floorPlanDue: '系统平面/躺平设计截止日期',
  constructionStart: '施工图启动',
  constructionDraftDue: '施工图预计截止日期（包含外包）',
  mallReviewStart: '商场审核预计开始时间',
  finalReviewWarn: '提醒：终审时间',
  mallFinalDue: '商场终审预计结束时间（包含二次修改）',
};

export const HARD_DECORATION_FIELD_ALIASES = {
  measureDate: ['复尺时间', '复尺日期'],
  area: ['面积', '门店面积'],
  floorPlanStart: ['平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）', '平面开始时间'],
  floorPlanFinish: ['硬装方案完成时间', '躺平内部审核结束时间', '内部审核结束时间'],
  constructionStart: ['施工图启动时间', '施工图发外包时间', '施工图开始时间'],
  constructionDraft: ['施工图初稿完成时间（外包首次提供图纸的时间）', '施工图初稿完成时间'],
  constructionReview: [
    '施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）',
    '施工图完成审核时间',
    '施工图终稿完成时间',
    '商场审核完成时间',
  ],
  hardDesigners: ['CD设计师', '硬装设计师', '设计师'],
  hardLeads: ['CD组长', '硬装组长'],
  hardOwners: ['CD负责人', '硬装负责人', '负责人'],
};

export const HARD_DECORATION_DEADLINE_MATRIX = [
  row('lt300', 'mini店：≤300㎡', 0, 300, [1, 4, 6, 7, 10, 10, 13, 15]),
  row('300-450', '中小店：300～450㎡', 300, 450, [1, 4, 6, 7, 11, 11, 14, 17]),
  row('450-650', '中店：450～650㎡', 450, 650, [1, 7, 9, 10, 15, 15, 18, 22]),
  row('650-800', '中大店：650～800㎡', 650, 800, [1, 9, 11, 12, 18, 18, 21, 25]),
  row('800-1000', '大店：800～1000㎡', 800, 1000, [1, 13, 15, 16, 23, 23, 26, 30]),
  row('1000-1500', '旗舰店：1000～1500㎡', 1000, 1500, [1, 13, 15, 16, 22, 22, 25, 30]),
  row('1500-2000', '超体店：1500～2000㎡', 1500, 2000, [1, 13, 15, 16, 23, 23, 26, 31]),
  row('gte2000', '超体店：2000㎡以上（暂按1500～2000㎡）', 2000, null, [1, 13, 15, 16, 23, 23, 26, 31]),
];

function row(key, label, minArea, maxArea, values) {
  return {
    key,
    label,
    minArea,
    maxArea,
    offsets: offsetsFromValues(values),
  };
}

function offsetsFromValues(values) {
  const keys = Object.keys(DEADLINE_LABELS);
  return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

function areaBucketContains(value, bucket) {
  const reachesMin = value >= bucket.minArea;
  const belowMax =
    bucket.maxArea === null ||
    value < bucket.maxArea ||
    (bucket.key === 'lt300' && value === bucket.maxArea);
  return reachesMin && belowMax;
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean).join('、');
  }
  if (typeof value === 'object') {
    return normalizeText(value.display ?? value.text ?? value.name ?? value.value ?? value.label ?? value.rawValue ?? '');
  }
  return String(value).trim();
}

function compactKey(value) {
  return normalizeText(value).replace(/\s+/g, '').toLowerCase();
}

export function readHardDecorationField(project = {}, fieldNames = []) {
  const rawFields = project?.rawFields || {};
  const entries = Object.entries(rawFields);

  for (const fieldName of fieldNames) {
    const exact = normalizeText(rawFields[fieldName]);
    if (exact) {
      return exact;
    }
  }

  for (const fieldName of fieldNames) {
    const needle = compactKey(fieldName);
    if (!needle) {
      continue;
    }
    const match = entries.find(([key, value]) => compactKey(key).includes(needle) && normalizeText(value));
    if (match) {
      return normalizeText(match[1]);
    }
  }

  return '';
}

function parseArea(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const text = normalizeText(value).replace(/,/g, '');
  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseDateParts(value) {
  const text = normalizeText(value);
  const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return [Number(year), Number(month), Number(day)];
}

export function normalizeDate(value) {
  const parts = parseDateParts(value);
  if (!parts) {
    return '';
  }
  const [year, month, day] = parts;
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    return '';
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return '';
  }
  return formatDate(date);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function chinaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateFromIso(dateText) {
  const parts = parseDateParts(dateText);
  if (!parts) {
    throw new Error(`Invalid date: ${dateText}`);
  }
  const [year, month, day] = parts;
  return new Date(Date.UTC(year, month - 1, day));
}

function addCalendarDays(dateText, days) {
  const date = dateFromIso(dateText);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function toDateSet(values = []) {
  return new Set(values.map(normalizeDate).filter(Boolean));
}

class CalendarCoverageError extends Error {
  constructor(dateText, years = []) {
    const year = String(dateText || '').slice(0, 4);
    super(`Local China workday calendar does not cover ${year}; deadline ${dateText} needs manual review.`);
    this.name = 'CalendarCoverageError';
    this.dateText = dateText;
    this.years = years;
  }
}

function calendarCoverageYears(calendar = {}) {
  const years = new Set();
  const appendYear = (value) => {
    for (const match of String(value ?? '').matchAll(/\d{4}/g)) {
      years.add(Number(match[0]));
    }
  };
  for (const year of calendar.years || []) {
    appendYear(year);
  }
  appendYear(calendar.year);
  return years;
}

function assertCalendarCoversDate(dateText, calendar = {}) {
  const years = calendarCoverageYears(calendar);
  if (!years.size) {
    return;
  }
  const year = Number(String(dateText || '').slice(0, 4));
  if (!years.has(year)) {
    throw new CalendarCoverageError(dateText, [...years].sort());
  }
}

export function mergeChinaWorkdayCalendars(calendars = []) {
  const validCalendars = calendars.filter(Boolean);
  const holidays = new Set();
  const workdays = new Set();
  const years = [];
  const sources = [];

  for (const calendar of validCalendars) {
    if (calendar.year) {
      years.push(calendar.year);
    }
    if (calendar.source) {
      sources.push(calendar.source);
    }
    for (const holiday of calendar.holidays || []) {
      const date = normalizeDate(holiday);
      if (date) {
        holidays.add(date);
      }
    }
    for (const workday of calendar.workdays || []) {
      const date = normalizeDate(workday);
      if (date) {
        workdays.add(date);
      }
    }
  }

  return {
    country: validCalendars[0]?.country || 'CN',
    years: [...new Set(years)].sort(),
    year: [...new Set(years)].sort().join('-'),
    timezone: validCalendars[0]?.timezone || 'Asia/Shanghai',
    source: sources[0] || null,
    sources,
    holidays: [...holidays].sort(),
    workdays: [...workdays].sort(),
  };
}

function readBundledChinaWorkdayCalendar(year) {
  try {
    return require(`../../data/rules/china-workday-calendar-${year}.json`);
  } catch {
    return null;
  }
}

export const DEFAULT_HARD_DECORATION_CALENDAR = mergeChinaWorkdayCalendars([
  readBundledChinaWorkdayCalendar(2025),
  readBundledChinaWorkdayCalendar(2026),
]);

export function isChinaWorkday(dateText, calendar = {}) {
  const date = normalizeDate(dateText);
  if (!date) {
    return false;
  }
  const holidaySet = toDateSet(calendar.holidays);
  const workdaySet = toDateSet(calendar.workdays);
  if (workdaySet.has(date)) {
    return true;
  }
  if (holidaySet.has(date)) {
    return false;
  }
  const day = dateFromIso(date).getUTCDay();
  return day !== 0 && day !== 6;
}

export function addChinaWorkdays(baseDate, offset, calendar = {}) {
  const start = normalizeDate(baseDate);
  if (!start) {
    return '';
  }
  assertCalendarCoversDate(start, calendar);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`Workday offset must be a non-negative integer: ${offset}`);
  }
  if (offset === 0) {
    return start;
  }

  let date = start;
  let count = 0;
  while (count < offset) {
    date = addCalendarDays(date, 1);
    assertCalendarCoversDate(date, calendar);
    if (isChinaWorkday(date, calendar)) {
      count += 1;
    }
  }
  return date;
}

function compareDate(a, b) {
  const left = normalizeDate(a);
  const right = normalizeDate(b);
  if (!left || !right) {
    return null;
  }
  return left.localeCompare(right);
}

function normalDeadlineStatus() {
  return { key: 'area_store_tier', label: '面积店态矩阵', source: '按面积店态矩阵计算' };
}

function resolveAreaBucket(area) {
  if (area === null || area === undefined || Number.isNaN(Number(area))) {
    return null;
  }
  const value = Number(area);
  return HARD_DECORATION_DEADLINE_MATRIX.find((bucket) => areaBucketContains(value, bucket)) || null;
}

export function resolveHardDecorationRule({ area } = {}) {
  const areaValue = parseArea(area);
  const areaBucket = resolveAreaBucket(areaValue);
  const urgency = normalDeadlineStatus();

  if (!areaBucket) {
    return {
      ruleVersion: HARD_DECORATION_DEADLINE_RULE_VERSION,
      area: areaValue,
      areaBucket: null,
      urgency,
      offsets: null,
      reason: 'missing_or_invalid_area',
    };
  }

  const offsets = areaBucket.offsets;
  return {
    ruleVersion: HARD_DECORATION_DEADLINE_RULE_VERSION,
    area: areaValue,
    areaBucket,
    urgency,
    offsets,
    floorPlanEfficiencyBudgetWorkdays: offsets.floorPlanDue - offsets.floorPlanStart,
  };
}

function deadlineMap(measureDate, offsets, calendar) {
  return Object.fromEntries(
    Object.entries(offsets).map(([key, offset]) => [
      key,
      addChinaWorkdays(measureDate, offset, calendar),
    ])
  );
}

function isCalendarCoverageError(error) {
  return error?.name === 'CalendarCoverageError';
}

function buildStartStatus(dueDate, actualDate, today) {
  if (actualDate) {
    return {
      dueDate,
      actualDate,
      status: compareDate(actualDate, dueDate) <= 0 ? 'on_time_start' : 'delayed_start',
    };
  }
  return {
    dueDate,
    actualDate: '',
    status: today && compareDate(today, dueDate) > 0 ? 'delayed_start_open' : 'pending_start',
  };
}

function buildCompletionStatus(dueDate, actualDate, today) {
  if (actualDate) {
    return {
      dueDate,
      actualDate,
      status: compareDate(actualDate, dueDate) <= 0 ? 'on_time_complete' : 'delayed_complete',
    };
  }
  return {
    dueDate,
    actualDate: '',
    status: today && compareDate(today, dueDate) > 0 ? 'delayed_open' : 'pending_complete',
  };
}

const HARD_SCHEME_STATUS_FIELDS = ['硬装方案情况（每周五刷新）', '硬装方案情况', '方案情况'];

function normalizeHardSchemeFormStatus(project = {}) {
  const rawText = readHardDecorationField(project, HARD_SCHEME_STATUS_FIELDS);
  if (!rawText) {
    return { status: '', rawText: '', filled: false, source: '' };
  }
  if (/延期完成/.test(rawText)) {
    return { status: 'delayed_complete', rawText, filled: true, source: 'form' };
  }
  if (/延期|逾期|超期/.test(rawText)) {
    return { status: 'delayed_open', rawText, filled: true, source: 'form' };
  }
  if (/准时完成|按时完成|正常完成/.test(rawText)) {
    return { status: 'on_time_complete', rawText, filled: true, source: 'form' };
  }
  if (/进行中|未完成|未开始|待/.test(rawText)) {
    return { status: 'pending_complete', rawText, filled: true, source: 'form' };
  }
  return { status: 'unknown', rawText, filled: true, source: 'form' };
}

function systemFloorPlanStatus(completion = {}) {
  return {
    status: completion.status || '',
    dueDate: completion.dueDate || '',
    actualDate: completion.actualDate || '',
    source: completion.status ? 'system_deadline' : '',
  };
}

function statusDelayFlag(status = '') {
  if (['delayed_complete', 'delayed_open'].includes(status)) {
    return true;
  }
  if (status === 'on_time_complete') {
    return false;
  }
  return null;
}

function buildConflictReview(formStatus = {}, systemStatus = {}) {
  const formDelayed = formStatus.filled ? statusDelayFlag(formStatus.status) : null;
  const systemDelayed = statusDelayFlag(systemStatus.status);
  const needsReview = formDelayed !== null && systemDelayed !== null && formDelayed !== systemDelayed;
  return {
    needsReview,
    reason: needsReview ? 'form_system_status_mismatch' : '',
    formStatus: formStatus.status || '',
    systemStatus: systemStatus.status || '',
  };
}

function fallbackStatusDate(project = {}) {
  return normalizeDate(project.updatedAt) || normalizeDate(project.startDate) || '';
}

function buildFinalDelayStatus({ project, formStatus, systemStatus, actualFinish }) {
  if (formStatus.filled) {
    const status = formStatus.status || 'unknown';
    return {
      status,
      source: 'form',
      date: actualFinish || fallbackStatusDate(project) || systemStatus.actualDate || systemStatus.dueDate || '',
      isDelayed: statusDelayFlag(status) === true,
    };
  }
  const status = systemStatus.status || '';
  return {
    status,
    source: status ? 'system_fallback' : '',
    date: systemStatus.actualDate || systemStatus.dueDate || '',
    isDelayed: statusDelayFlag(status) === true,
  };
}

function buildEfficiencyStatusModel(efficiency = {}) {
  return {
    status: efficiency.status || '',
    dueDate: efficiency.dueDate || '',
    actualDate: efficiency.actualDate || '',
    budgetWorkdays: efficiency.budgetWorkdays ?? null,
    source: efficiency.status ? 'actual_start_shifted_budget' : '',
  };
}

function buildEfficiencyStatus({ actualStart, actualFinish, budgetWorkdays, completionStatus, calendar, today }) {
  if (!actualStart) {
    return {
      budgetWorkdays,
      dueDate: '',
      actualDate: actualFinish || '',
      status: 'not_started',
      summary: '尚未启动，暂不能计算顺延效率。',
    };
  }

  const dueDate = addChinaWorkdays(actualStart, budgetWorkdays, calendar);
  if (actualFinish) {
    const ok = compareDate(actualFinish, dueDate) <= 0;
    const delayedButOk = ok && completionStatus === 'delayed_complete';
    return {
      budgetWorkdays,
      dueDate,
      actualDate: actualFinish,
      status: ok ? 'ok' : 'overtime',
      summary: delayedButOk
        ? '原始截止延期完成，但按实际启动顺延的效率判断为延期完成但效率OK。'
        : ok
          ? '按实际启动顺延后，平面方案效率OK。'
          : '按实际启动顺延后，平面方案效率仍超时。',
    };
  }

  const overtimeOpen = today && compareDate(today, dueDate) > 0;
  return {
    budgetWorkdays,
    dueDate,
    actualDate: '',
    status: overtimeOpen ? 'overtime_open' : 'pending',
    summary: overtimeOpen ? '按实际启动顺延后仍未完成，效率已超时。' : '已启动但尚未完成，效率继续观察。',
  };
}

function projectIdentity(project = {}) {
  return {
    projectId: normalizeText(project.id || project.projectId),
    projectName: normalizeText(project.name || readHardDecorationField(project, ['项目名称（不要自己添加/删除任何项目）', '项目名称', '门店名称'])),
  };
}

function splitPeopleNames(value) {
  return [
    ...new Set(
      normalizeText(value)
        .split(/[、,，/]/)
        .map((name) => name.trim())
        .filter(Boolean)
    ),
  ];
}

export function calculateHardDecorationDeadlineRecord(project = {}, { calendar = {}, today = '' } = {}) {
  const identity = projectIdentity(project);
  const measureDate = normalizeDate(readHardDecorationField(project, HARD_DECORATION_FIELD_ALIASES.measureDate));
  const areaText = readHardDecorationField(project, HARD_DECORATION_FIELD_ALIASES.area) || project?.difficulty?.area || '';
  const rule = resolveHardDecorationRule({ area: areaText });
  const actuals = {
    floorPlanStart: normalizeDate(readHardDecorationField(project, HARD_DECORATION_FIELD_ALIASES.floorPlanStart)),
    floorPlanFinish: normalizeDate(readHardDecorationField(project, HARD_DECORATION_FIELD_ALIASES.floorPlanFinish)),
    constructionStart: normalizeDate(readHardDecorationField(project, HARD_DECORATION_FIELD_ALIASES.constructionStart)),
    constructionDraft: normalizeDate(readHardDecorationField(project, HARD_DECORATION_FIELD_ALIASES.constructionDraft)),
    constructionReview: normalizeDate(readHardDecorationField(project, HARD_DECORATION_FIELD_ALIASES.constructionReview)),
  };
  const people = {
    hardDesigners: splitPeopleNames(readHardDecorationField(project, HARD_DECORATION_FIELD_ALIASES.hardDesigners)),
    hardLeads: splitPeopleNames(readHardDecorationField(project, HARD_DECORATION_FIELD_ALIASES.hardLeads)),
    hardOwners: splitPeopleNames(readHardDecorationField(project, HARD_DECORATION_FIELD_ALIASES.hardOwners)),
  };

  const missing = [];
  if (!measureDate) {
    missing.push('measureDate');
  }
  if (!rule.areaBucket) {
    missing.push('areaBucket');
  }

  const baseRecord = {
    ...identity,
    ruleVersion: HARD_DECORATION_DEADLINE_RULE_VERSION,
    calendar: {
      country: calendar.country || 'CN',
      year: calendar.year || '',
      sourceUrl: calendar.source?.url || '',
    },
    measureDate,
    area: rule.area,
    areaBucket: rule.areaBucket ? { key: rule.areaBucket.key, label: rule.areaBucket.label } : null,
    urgency: rule.urgency,
    sourceFields: {
      area: areaText,
      urgency: '',
    },
    people,
    actuals,
  };

  if (missing.length) {
    return {
      ...baseRecord,
      status: 'needs_manual_review',
      missing,
      reason: rule.reason || 'missing_required_basis',
      deadlines: {},
      floorPlan: null,
      construction: null,
    };
  }

  let deadlines;
  let floorStart;
  let floorCompletion;
  let efficiency;
  let formStatus;
  let systemStatus;
  let finalDelayStatus;
  let conflictReview;
  let efficiencyStatus;
  try {
    deadlines = deadlineMap(measureDate, rule.offsets, calendar);
    floorStart = buildStartStatus(deadlines.floorPlanStart, actuals.floorPlanStart, today);
    floorCompletion = buildCompletionStatus(deadlines.floorPlanDue, actuals.floorPlanFinish, today);
    efficiency = buildEfficiencyStatus({
      actualStart: actuals.floorPlanStart,
      actualFinish: actuals.floorPlanFinish,
      budgetWorkdays: rule.floorPlanEfficiencyBudgetWorkdays,
      completionStatus: floorCompletion.status,
      calendar,
      today,
    });
    formStatus = normalizeHardSchemeFormStatus(project);
    systemStatus = systemFloorPlanStatus(floorCompletion);
    finalDelayStatus = buildFinalDelayStatus({
      project,
      formStatus,
      systemStatus,
      actualFinish: actuals.floorPlanFinish,
    });
    conflictReview = buildConflictReview(formStatus, systemStatus);
    efficiencyStatus = buildEfficiencyStatusModel(efficiency);
  } catch (error) {
    if (!isCalendarCoverageError(error)) {
      throw error;
    }
    return {
      ...baseRecord,
      status: 'needs_manual_review',
      missing: ['calendar'],
      reason: error.message,
      deadlines: {},
      floorPlan: null,
      construction: null,
    };
  }

  return {
    ...baseRecord,
    status: 'calculated',
    offsets: rule.offsets,
    deadlineLabels: DEADLINE_LABELS,
    deadlines,
    floorPlan: {
      start: floorStart,
      warning: { dueDate: deadlines.floorPlanWarn },
      completion: floorCompletion,
      efficiency,
      formStatus,
      systemStatus,
      finalDelayStatus,
      efficiencyStatus,
      conflictReview,
    },
    construction: {
      start: buildStartStatus(deadlines.constructionStart, actuals.constructionStart, today),
      draft: buildCompletionStatus(deadlines.constructionDraftDue, actuals.constructionDraft, today),
      mallReview: { dueDate: deadlines.mallReviewStart },
      finalWarning: { dueDate: deadlines.finalReviewWarn },
      finalReview: buildCompletionStatus(deadlines.mallFinalDue, actuals.constructionReview, today),
    },
  };
}

export function calculateHardDecorationDeadlineRecords(projects = [], options = {}) {
  return projects.map((project) => calculateHardDecorationDeadlineRecord(project, options));
}

function hardDecorationFloorReminder(record = {}, today = '') {
  if (record.status !== 'calculated') {
    return null;
  }
  const floorPlan = record.floorPlan || {};
  const start = floorPlan.start || {};
  const completion = floorPlan.completion || {};
  const warning = floorPlan.warning || {};
  const normalizedToday = normalizeDate(today);
  if (start.status === 'delayed_start_open') {
    return {
      type: 'delayed_start',
      title: '系统平面启动已延期',
      action: '确认平面是否已启动，并补齐启动时间或反馈卡点。',
      dueDate: start.dueDate || '',
      severity: 'P1',
      source: 'system_deadline',
    };
  }
  if (completion.status === 'delayed_open') {
    return {
      type: 'delayed',
      title: '系统平面 Deadline 已延期',
      action: '确认平面延期原因、预计完成时间和是否需要调度支援。',
      dueDate: completion.dueDate || '',
      severity: 'P1',
      source: 'system_deadline',
    };
  }
  if (
    completion.status === 'pending_complete' &&
    normalizedToday &&
    warning.dueDate &&
    compareDate(normalizedToday, warning.dueDate) >= 0
  ) {
    return {
      type: 'due_soon',
      title: '系统平面 Deadline 临期',
      action: '确认平面能否按系统 Deadline 收口，不能则补反馈时间。',
      dueDate: completion.dueDate || '',
      warningDate: warning.dueDate || '',
      severity: 'P2',
      source: 'system_deadline',
    };
  }
  return null;
}

export function buildHardDecorationDeadlineSummary(
  project,
  { calendar = DEFAULT_HARD_DECORATION_CALENDAR, today = chinaToday() } = {}
) {
  const record = calculateHardDecorationDeadlineRecord(project, { calendar, today });
  const floorPlan = record.floorPlan || {};
  return {
    ruleVersion: record.ruleVersion,
    status: record.status,
    reason: record.reason || '',
    missing: record.missing || [],
    measureDate: record.measureDate || '',
    area: record.area ?? null,
    areaBucket: record.areaBucket || null,
    urgency: record.urgency || null,
    floorPlan: {
      startDueDate: floorPlan.start?.dueDate || '',
      warnDueDate: floorPlan.warning?.dueDate || '',
      dueDate: floorPlan.completion?.dueDate || '',
      actualStart: record.actuals?.floorPlanStart || '',
      actualFinish: record.actuals?.floorPlanFinish || '',
      startStatus: floorPlan.start?.status || '',
      completionStatus: floorPlan.completion?.status || '',
      formStatus: floorPlan.formStatus || { status: '', rawText: '', filled: false, source: '' },
      systemStatus: floorPlan.systemStatus || { status: '', dueDate: '', actualDate: '', source: '' },
      finalDelayStatus: floorPlan.finalDelayStatus || { status: '', source: '', date: '', isDelayed: false },
      efficiencyDueDate: floorPlan.efficiency?.dueDate || '',
      efficiencyStatus: floorPlan.efficiency?.status || '',
      efficiencyStatusModel: floorPlan.efficiencyStatus || {
        status: '',
        dueDate: '',
        actualDate: '',
        budgetWorkdays: null,
        source: '',
      },
      efficiencySummary: floorPlan.efficiency?.summary || '',
      conflictReview: floorPlan.conflictReview || {
        needsReview: false,
        reason: '',
        formStatus: '',
        systemStatus: '',
      },
    },
    construction: {
      startDueDate: record.construction?.start?.dueDate || '',
      draftDueDate: record.construction?.draft?.dueDate || '',
      finalWarnDate: record.construction?.finalWarning?.dueDate || '',
      finalDueDate: record.construction?.finalReview?.dueDate || '',
      draftStatus: record.construction?.draft?.status || '',
      finalStatus: record.construction?.finalReview?.status || '',
    },
    reminder: hardDecorationFloorReminder(record, today),
  };
}

function reminderSeverity(priority = '') {
  if (priority === 'P1') {
    return 'critical';
  }
  if (priority === 'P2') {
    return 'warning';
  }
  return 'info';
}

function systemReminderKind(type = '') {
  if (type === 'delayed_start') {
    return { type: 'overdue', nodeKey: 'floorPlanStart', label: '平面启动超期' };
  }
  if (type === 'delayed') {
    return { type: 'overdue', nodeKey: 'floorPlanDue', label: '平面超期' };
  }
  if (type === 'due_soon') {
    return { type: 'due_soon', nodeKey: 'floorPlanDue', label: '平面临期' };
  }
  return { type: type || 'normal_next_step', nodeKey: 'floorPlanDue', label: '平面提醒' };
}

function manualReviewReminder(project = {}, summary = {}) {
  if (summary.status !== 'needs_manual_review') {
    return null;
  }
  const projectId = normalizeText(project.id || project.projectId || '');
  const missing = summary.missing || [];
  const missingLabels = missing
    .map((item) => (item === 'measureDate' ? '复尺时间' : item === 'areaBucket' ? '面积' : item))
    .join('、');
  const label = missing.includes('areaBucket') ? '缺面积' : missing.includes('measureDate') ? '缺复尺' : '待复核';
  return {
    reminderId: `${projectId || 'unknown'}:hard:ruleBasis:manual_review`,
    projectId,
    discipline: 'hard',
    nodeKey: 'ruleBasis',
    type: 'manual_review',
    severity: 'warning',
    priority: 'P2',
    label,
    title: '硬装 Deadline 待复核',
    message: missingLabels ? `缺少${missingLabels}，暂不能计算系统 Deadline。` : '硬装 Deadline 暂不能计算，需人工复核。',
    dueDate: '',
    remindDate: '',
    status: 'open',
    source: 'missing_field',
  };
}

function systemDeadlineReminder(project = {}, summary = {}) {
  const reminder = summary.reminder;
  if (!reminder) {
    return null;
  }
  const projectId = normalizeText(project.id || project.projectId || '');
  const kind = systemReminderKind(reminder.type);
  return {
    reminderId: `${projectId || 'unknown'}:hard:${kind.nodeKey}:${kind.type}`,
    projectId,
    discipline: 'hard',
    nodeKey: kind.nodeKey,
    type: kind.type,
    severity: reminderSeverity(reminder.severity),
    priority: reminder.severity || '',
    label: kind.label,
    title: reminder.title || kind.label,
    message: reminder.action || '',
    dueDate: reminder.dueDate || '',
    remindDate: reminder.warningDate || '',
    status: 'open',
    source: reminder.source || 'system_deadline',
  };
}

export function buildHardDecorationProjectReminders(project = {}, options = {}) {
  const summary = buildHardDecorationDeadlineSummary(project, options);
  const reminders = [systemDeadlineReminder(project, summary), manualReviewReminder(project, summary)].filter(Boolean);
  return {
    hardDeadline: summary,
    reminders,
    primaryReminder: reminders[0] || null,
  };
}

export function enrichProjectWithHardDecorationDeadline(project = {}, options = {}) {
  const result = buildHardDecorationProjectReminders(project, options);
  const existingReminders = Array.isArray(project.reminders) ? project.reminders : [];
  const reminders = [
    ...result.reminders,
    ...existingReminders.filter(
      (item) => !result.reminders.some((deadlineReminder) => deadlineReminder.reminderId === item?.reminderId)
    ),
  ];
  return {
    ...project,
    hardDeadline: result.hardDeadline,
    reminders,
    primaryReminder: result.primaryReminder || project.primaryReminder || reminders[0] || null,
  };
}

export function buildHardDecorationDesignerDeadlineRecords(records = []) {
  const designerRecords = [];

  for (const record of records) {
    const designers = record.people?.hardDesigners || [];
    for (const designerName of designers) {
      designerRecords.push({
        designerName,
        role: 'CD设计师',
        projectId: record.projectId,
        projectName: record.projectName,
        ruleVersion: record.ruleVersion,
        measureDate: record.measureDate,
        area: record.area,
        areaBucket: record.areaBucket,
        urgency: record.urgency,
        floorPlanStartDue: record.deadlines?.floorPlanStart || '',
        floorPlanDue: record.deadlines?.floorPlanDue || '',
        floorPlanActualStart: record.actuals?.floorPlanStart || '',
        floorPlanActualFinish: record.actuals?.floorPlanFinish || '',
        floorPlanStartStatus: record.floorPlan?.start?.status || '',
        floorPlanCompletionStatus: record.floorPlan?.completion?.status || '',
        floorPlanEfficiencyBudgetWorkdays: record.floorPlan?.efficiency?.budgetWorkdays ?? null,
        floorPlanEfficiencyDue: record.floorPlan?.efficiency?.dueDate || '',
        floorPlanEfficiencyStatus: record.floorPlan?.efficiency?.status || '',
        floorPlanEfficiencySummary: record.floorPlan?.efficiency?.summary || '',
        constructionDraftDue: record.deadlines?.constructionDraftDue || '',
        constructionDraftActual: record.actuals?.constructionDraft || '',
        constructionDraftStatus: record.construction?.draft?.status || '',
        constructionFinalDue: record.deadlines?.mallFinalDue || '',
        constructionFinalActual: record.actuals?.constructionReview || '',
        constructionFinalStatus: record.construction?.finalReview?.status || '',
      });
    }
  }

  return designerRecords;
}

export function summarizeHardDecorationDesignerDeadlineRecords(designerRecords = []) {
  const byDesigner = new Map();

  for (const record of designerRecords) {
    if (!record.designerName) {
      continue;
    }
    if (!byDesigner.has(record.designerName)) {
      byDesigner.set(record.designerName, {
        designerName: record.designerName,
        role: record.role,
        total: 0,
        floorPlanDelayedStart: 0,
        floorPlanDelayedComplete: 0,
        floorPlanEfficiencyOk: 0,
        floorPlanEfficiencyOvertime: 0,
        records: [],
      });
    }
    const summary = byDesigner.get(record.designerName);
    summary.total += 1;
    if (record.floorPlanStartStatus?.startsWith('delayed_start')) {
      summary.floorPlanDelayedStart += 1;
    }
    if (record.floorPlanCompletionStatus === 'delayed_complete') {
      summary.floorPlanDelayedComplete += 1;
    }
    if (record.floorPlanEfficiencyStatus === 'ok') {
      summary.floorPlanEfficiencyOk += 1;
    }
    if (['overtime', 'overtime_open'].includes(record.floorPlanEfficiencyStatus)) {
      summary.floorPlanEfficiencyOvertime += 1;
    }
    summary.records.push(record);
  }

  return [...byDesigner.values()].sort((a, b) => {
    const overtimeDiff = b.floorPlanEfficiencyOvertime - a.floorPlanEfficiencyOvertime;
    if (overtimeDiff) {
      return overtimeDiff;
    }
    const delayedDiff = b.floorPlanDelayedComplete - a.floorPlanDelayedComplete;
    if (delayedDiff) {
      return delayedDiff;
    }
    return a.designerName.localeCompare(b.designerName, 'zh-Hans-CN');
  });
}

export function summarizeHardDecorationDeadlineRecords(records = []) {
  const summary = {
    total: records.length,
    calculated: 0,
    needsManualReview: 0,
    floorPlanDelayedComplete: 0,
    floorPlanDelayedStart: 0,
    floorPlanEfficiencyOk: 0,
    floorPlanEfficiencyOvertime: 0,
  };

  for (const record of records) {
    if (record.status === 'calculated') {
      summary.calculated += 1;
    } else {
      summary.needsManualReview += 1;
    }
    if (record.floorPlan?.start?.status?.startsWith('delayed_start')) {
      summary.floorPlanDelayedStart += 1;
    }
    if (record.floorPlan?.completion?.status === 'delayed_complete') {
      summary.floorPlanDelayedComplete += 1;
    }
    if (record.floorPlan?.efficiency?.status === 'ok') {
      summary.floorPlanEfficiencyOk += 1;
    }
    if (['overtime', 'overtime_open'].includes(record.floorPlan?.efficiency?.status)) {
      summary.floorPlanEfficiencyOvertime += 1;
    }
  }

  return summary;
}
