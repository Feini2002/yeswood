import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  HARD_DECORATION_DEADLINE_RULE_VERSION,
  buildHardDecorationDesignerDeadlineRecords,
  calculateHardDecorationDeadlineRecords,
  mergeChinaWorkdayCalendars,
  summarizeHardDecorationDesignerDeadlineRecords,
  summarizeHardDecorationDeadlineRecords,
} from '../src/backend/hardDecorationDeadlineRules.mjs';

const root = process.cwd();
const cachePath = join(root, 'data', 'dashboard-cache.json');
const calendarPaths = [
  join(root, 'data', 'rules', 'china-workday-calendar-2025.json'),
  join(root, 'data', 'rules', 'china-workday-calendar-2026.json'),
];
const outputPath = join(root, 'data', 'rules', 'hard-decoration-deadline-records.json');

function parseTodayArg(argv) {
  const pair = argv.find((arg) => arg.startsWith('--today='));
  return pair ? pair.slice('--today='.length) : '';
}

function chinaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const [cache, ...calendars] = await Promise.all([readJson(cachePath), ...calendarPaths.map(readJson)]);
const calendar = mergeChinaWorkdayCalendars(calendars);
const projects = Array.isArray(cache.projects) ? cache.projects : [];
const today = parseTodayArg(process.argv.slice(2)) || chinaToday();
const records = calculateHardDecorationDeadlineRecords(projects, { calendar, today });
const summary = summarizeHardDecorationDeadlineRecords(records);
const designerRecords = buildHardDecorationDesignerDeadlineRecords(records);
const designerSummary = summarizeHardDecorationDesignerDeadlineRecords(designerRecords);

const payload = {
  schema: 'hard-decoration-deadline-records',
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  today,
  ruleVersion: HARD_DECORATION_DEADLINE_RULE_VERSION,
  source: {
    cachePath: 'data/dashboard-cache.json',
    cacheSyncedAt: cache.syncedAt || '',
    totalProjects: projects.length,
  },
  calendar: {
    paths: ['data/rules/china-workday-calendar-2025.json', 'data/rules/china-workday-calendar-2026.json'],
    country: calendar.country,
    year: calendar.year,
    years: calendar.years,
    timezone: calendar.timezone,
    sources: calendar.sources,
  },
  summary,
  designerSummary,
  designerRecords,
  records,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(
  [
    `ruleVersion=${payload.ruleVersion}`,
    `today=${payload.today}`,
    `projects=${summary.total}`,
    `calculated=${summary.calculated}`,
    `needsManualReview=${summary.needsManualReview}`,
    `floorPlanDelayedStart=${summary.floorPlanDelayedStart}`,
    `floorPlanDelayedComplete=${summary.floorPlanDelayedComplete}`,
    `floorPlanEfficiencyOk=${summary.floorPlanEfficiencyOk}`,
    `floorPlanEfficiencyOvertime=${summary.floorPlanEfficiencyOvertime}`,
    `designerRecords=${designerRecords.length}`,
    `designerSummary=${designerSummary.length}`,
    `output=data/rules/hard-decoration-deadline-records.json`,
  ].join('\n')
);
