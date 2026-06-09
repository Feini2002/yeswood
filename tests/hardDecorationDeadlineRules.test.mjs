import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  addChinaWorkdays,
  buildHardDecorationDesignerDeadlineRecords,
  calculateHardDecorationDeadlineRecord,
  mergeChinaWorkdayCalendars,
  resolveHardDecorationRule,
} from '../src/backend/hardDecorationDeadlineRules.mjs';

const root = process.cwd();

function raw(display) {
  return { display, rawValue: display, kind: 'string' };
}

async function loadOfficialCalendar() {
  const text = await readFile(join(root, 'data', 'rules', 'china-workday-calendar-2026.json'), 'utf8');
  return JSON.parse(text);
}

async function loadCalendarYear(year) {
  const text = await readFile(join(root, 'data', 'rules', `china-workday-calendar-${year}.json`), 'utf8');
  return JSON.parse(text);
}

test('Y+N deadlines use China workdays instead of calendar days', async () => {
  const fixtureCalendar = {
    timezone: 'Asia/Shanghai',
    holidays: ['2026-04-06'],
    workdays: ['2026-04-11'],
  };

  assert.equal(addChinaWorkdays('2026-04-03', 1, fixtureCalendar), '2026-04-07');
  assert.equal(addChinaWorkdays('2026-04-03', 5, fixtureCalendar), '2026-04-11');
});

test('official 2026 China calendar records statutory holidays and adjusted workdays', async () => {
  const calendar = await loadOfficialCalendar();

  assert.equal(calendar.country, 'CN');
  assert.equal(calendar.year, 2026);
  assert.match(calendar.source.url, /www\.gov\.cn/);
  assert.ok(calendar.holidays.includes('2026-02-15'));
  assert.ok(calendar.holidays.includes('2026-10-07'));
  assert.ok(calendar.workdays.includes('2026-02-14'));
  assert.ok(calendar.workdays.includes('2026-10-10'));
});

test('China workday calendar can merge years for projects crossing year boundaries', async () => {
  const calendar = mergeChinaWorkdayCalendars([
    await loadCalendarYear(2025),
    await loadCalendarYear(2026),
  ]);

  assert.equal(addChinaWorkdays('2025-01-27', 1, calendar), '2025-02-05');
  assert.equal(addChinaWorkdays('2025-12-31', 1, calendar), '2026-01-04');
});

test('hard decoration deadlines require local calendar coverage for generated years', () => {
  const project = {
    id: 'late-2026-project',
    name: '跨年日历保护示例店',
    rawFields: {
      复尺时间: raw('2026-12-31'),
      面积: raw('280'),
    },
  };
  const calendar = {
    country: 'CN',
    year: 2026,
    timezone: 'Asia/Shanghai',
    holidays: [],
    workdays: [],
  };

  const record = calculateHardDecorationDeadlineRecord(project, { calendar, today: '2026-12-31' });

  assert.equal(record.status, 'needs_manual_review');
  assert.deepEqual(record.missing, ['calendar']);
  assert.match(record.reason, /2027/);
});

test('mini store project can be delayed by original deadline while efficiency remains OK', async () => {
  const calendar = await loadOfficialCalendar();
  const project = {
    id: 'demo-less-300-normal',
    name: '小面积不紧急示例店',
    status: '一般',
    rawFields: {
      复尺时间: raw('2026-05-04'),
      面积: raw('280'),
      项目状态: raw('一般'),
      平面开始时间: raw('2026-05-08'),
      躺平内部审核结束时间: raw('2026-05-14'),
    },
  };

  const record = calculateHardDecorationDeadlineRecord(project, { calendar, today: '2026-05-18' });

  assert.equal(record.areaBucket.label, 'mini店：≤300㎡');
  assert.equal(record.urgency.label, '不紧急');
  assert.equal(record.deadlines.floorPlanStart, '2026-05-06');
  assert.equal(record.deadlines.floorPlanDue, '2026-05-12');
  assert.equal(record.floorPlan.start.status, 'delayed_start');
  assert.equal(record.floorPlan.completion.status, 'delayed_complete');
  assert.equal(record.floorPlan.efficiency.budgetWorkdays, 5);
  assert.equal(record.floorPlan.efficiency.dueDate, '2026-05-14');
  assert.equal(record.floorPlan.efficiency.status, 'ok');
  assert.match(record.floorPlan.efficiency.summary, /延期完成但效率OK/);
});

test('floor plan efficiency is overtime when shifted budget is also exceeded', async () => {
  const calendar = await loadOfficialCalendar();
  const project = {
    id: 'demo-less-300-normal-overtime',
    name: '小面积效率超时示例店',
    status: '不紧急',
    rawFields: {
      复尺时间: raw('2026-04-01'),
      面积: raw('260'),
      项目状态: raw('不紧急'),
      CD设计师: raw('张三、李四'),
      CD负责人: raw('王五'),
      平面开始时间: raw('2026-04-03'),
      躺平内部审核结束时间: raw('2026-04-16'),
    },
  };

  const record = calculateHardDecorationDeadlineRecord(project, { calendar, today: '2026-04-16' });

  assert.equal(record.floorPlan.efficiency.budgetWorkdays, 5);
  assert.equal(record.floorPlan.efficiency.dueDate, '2026-04-13');
  assert.equal(record.floorPlan.efficiency.status, 'overtime');
  assert.deepEqual(record.people.hardDesigners, ['张三', '李四']);

  const designerRecords = buildHardDecorationDesignerDeadlineRecords([record]);

  assert.equal(designerRecords.length, 2);
  assert.deepEqual(
    designerRecords.map((item) => [item.designerName, item.projectName, item.floorPlanEfficiencyStatus]),
    [
      ['张三', '小面积效率超时示例店', 'overtime'],
      ['李四', '小面积效率超时示例店', 'overtime'],
    ]
  );
});

test('hard decoration matrix ignores urgent form status and uses the normal area deadline', () => {
  const normalRule = resolveHardDecorationRule({ area: 280, urgencyText: '一般' });
  const urgentRule = resolveHardDecorationRule({ area: 280, urgencyText: '紧急' });

  assert.equal(normalRule.urgency.label, '不紧急');
  assert.equal(normalRule.offsets.floorPlanDue, 6);
  assert.equal(urgentRule.urgency.label, '不紧急');
  assert.equal(urgentRule.offsets.floorPlanDue, 6);
  assert.equal(urgentRule.areaBucket.label, 'mini店：≤300㎡');
});

test('hard decoration downstream offsets derive from floor plan due dates', () => {
  const cases = [
    [280, 'mini店：≤300㎡', 4, 6, 7, 10],
    [320, '中小店：300～450㎡', 4, 6, 7, 11],
    [500, '中店：450～650㎡', 7, 9, 10, 15],
    [700, '中大店：650～800㎡', 9, 11, 12, 18],
    [900, '大店：800～1000㎡', 13, 15, 16, 23],
    [1200, '旗舰店：1000～1500㎡', 13, 15, 16, 22],
    [1700, '超体店：1500～2000㎡', 13, 15, 16, 23],
  ];

  for (const [area, label, floorPlanWarn, floorPlanDue, constructionStart, constructionDraftDue] of cases) {
    const rule = resolveHardDecorationRule({ area });

    assert.equal(rule.areaBucket.label, label);
    assert.equal(rule.offsets.floorPlanWarn, floorPlanWarn);
    assert.equal(rule.offsets.floorPlanDue, floorPlanDue);
    assert.equal(rule.offsets.constructionStart, constructionStart);
    assert.equal(rule.offsets.constructionDraftDue, constructionDraftDue);
  }
});

test('hard decoration mall review offsets derive from construction draft dates', () => {
  const cases = [
    [280, 'mini店：≤300㎡', 10, 10, 13, 15],
    [320, '中小店：300～450㎡', 11, 11, 14, 17],
    [500, '中店：450～650㎡', 15, 15, 18, 22],
    [700, '中大店：650～800㎡', 18, 18, 21, 25],
    [900, '大店：800～1000㎡', 23, 23, 26, 30],
    [1200, '旗舰店：1000～1500㎡', 22, 22, 25, 30],
    [1700, '超体店：1500～2000㎡', 23, 23, 26, 31],
  ];

  for (const [area, label, constructionDraftDue, mallReviewStart, finalReviewWarn, mallFinalDue] of cases) {
    const rule = resolveHardDecorationRule({ area });

    assert.equal(rule.areaBucket.label, label);
    assert.equal(rule.offsets.constructionDraftDue, constructionDraftDue);
    assert.equal(rule.offsets.mallReviewStart, mallReviewStart);
    assert.equal(rule.offsets.finalReviewWarn, finalReviewWarn);
    assert.equal(rule.offsets.mallFinalDue, mallFinalDue);
  }
});
