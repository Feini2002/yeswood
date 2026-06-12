import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TEAM_WORK_COMPLETION_DATA_QUALITY_NOTE_LIMIT,
  buildTeamWorkCompletionReview,
} from '../src/backend/teamWorkCompletionReview.mjs';

function raw(display) {
  return { display };
}

function project(overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    name: overrides.name || '测试项目',
    status: overrides.status || '推进中',
    storeStatus: overrides.storeStatus || '常规店',
    dueDate: overrides.dueDate || '',
    updatedAt: overrides.updatedAt || '2026-06-30T00:00:00.000Z',
    rawFields: overrides.rawFields || {},
    ...overrides,
  };
}

const team = {
  owner: '苏佳蕾',
  groups: [
    { name: '直营1组', members: ['陈菲菲', '乔玲玲'] },
    { name: '直营2组', members: ['陶媛媛'] },
  ],
};

const personnelArchitecture = {
  people: {
    苏佳蕾: { name: '苏佳蕾', displayName: '苏佳蕾', aliases: ['苏总'] },
    陈菲菲: { name: '陈菲菲', displayName: '陈菲菲', aliases: ['菲菲'] },
    乔玲玲: { name: '乔玲玲', displayName: '乔玲玲' },
    陶媛媛: { name: '陶媛媛', displayName: '陶媛媛' },
  },
  aliases: {
    陈菲菲: ['菲菲'],
  },
  teams: [team],
};

function group(review, name) {
  return review.groups.find((item) => item.name === name);
}

function member(review, name) {
  return review.members.find((item) => item.name === name);
}

function month(review, monthNumber) {
  return review.monthly.months.find((item) => item.month === monthNumber);
}

test('buildTeamWorkCompletionReview does not count construction review as display completion', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'construction-review-only',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          硬装项目进度: raw('（施工中）施工图完成审核'),
          软装项目进度: raw('未安排摆场'),
          点位完成情况: raw('（施工中）施工图完成审核'),
          '施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）': raw('2026-05-13'),
        },
      }),
    ],
    team,
    { personnelArchitecture, year: 2026, dashboardContext: 'all' }
  );

  assert.equal(review.summary.display.completedCount, 0);
  assert.equal(review.summary.display.inProgressCount, 0);
  assert.equal(review.projectsById['construction-review-only'].metrics.display.state, 'none');
});

test('buildTeamWorkCompletionReview keeps floorPlan display and lifecycle independent', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'independent',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          '平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）': raw('2026-04-10'),
          硬装方案情况: raw('准时完成'),
          躺平内部审核结束时间: raw('2026-04-22'),
          软装项目进度: raw('摆场'),
        },
      }),
    ],
    team,
    { personnelArchitecture, year: 2026, dashboardContext: 'all' }
  );

  assert.equal(review.summary.floorPlan.completedCount, 1);
  assert.equal(review.summary.display.inProgressCount, 1);
  assert.equal(review.summary.lifecycle.inProgressCount, 1);
  assert.equal(review.summary.display.completedCount, 0);
  assert.equal(review.summary.lifecycle.completedCount, 0);
  assert.equal(month(review, 4).floorPlanCompleted, 1);
  assert.equal(group(review, '直营1组').leadDisplay, '陈菲菲');
  assert.equal(group(review, '直营2组').leadDisplay, '陶媛媛');
});

test('buildTeamWorkCompletionReview buckets in-progress metrics by project update month', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'active-floor-display',
        updatedAt: '2026-05-20T10:00:00.000Z',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          '平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）': raw('2026-05-08'),
          硬装项目进度: raw('平面方案'),
          软装项目进度: raw('摆场'),
        },
      }),
    ],
    team,
    { personnelArchitecture, year: 2026, dashboardContext: 'all' }
  );

  assert.equal(month(review, 5).floorPlanInProgress, 1);
  assert.equal(month(review, 5).displayInProgress, 1);
  assert.equal(month(review, 5).lifecycleInProgress, 1);
  assert.deepEqual(month(review, 5).projectIds.floorPlanInProgress, ['active-floor-display']);
  assert.deepEqual(month(review, 5).projectIds.displayInProgress, ['active-floor-display']);
  assert.deepEqual(month(review, 5).projectIds.lifecycleInProgress, ['active-floor-display']);
});

test('buildTeamWorkCompletionReview reuses static groups when owner has no explicit roster', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'static-roster-project',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          硬装项目进度: raw('闭环'),
          软装项目进度: raw('闭环'),
          上会日期: raw('2026-05-20'),
          闭环周期: raw('26'),
        },
      }),
    ],
    { owner: '苏佳蕾', cdLeads: [], vmLeads: [] },
    { personnelArchitecture: {}, year: 2026, dashboardContext: 'all' }
  );

  assert.equal(review.team.groupCount, 4);
  assert.equal(review.team.memberCount, 24);
  assert.equal(review.groups.length, 4);
  assert.equal(review.projectCount, 1);
  assert.equal(group(review, '直营1组').leadDisplay, '陈菲菲');
  assert.equal(group(review, '直营2组').leadDisplay, '陶媛媛');
  assert.equal(group(review, '直营3组').leadDisplay, '杨晓芸');
  assert.equal(group(review, '直营4组').leadDisplay, '刘雯蓓');
  assert.equal(group(review, '直营1组').summary.lifecycle.completedCount, 1);
  assert.equal(member(review, '陈菲菲').summary.lifecycle.completedCount, 1);
  assert.equal(member(review, '李晓倩'), undefined);
  assert.equal(member(review, '席创意'), undefined);
  assert.equal(member(review, '侯喆'), undefined);
  assert.deepEqual(month(review, 6).projectIds.lifecycle, ['static-roster-project']);
});

test('buildTeamWorkCompletionReview de-duplicates same project within one group and team', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'same-group',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲、乔玲玲'),
          硬装项目进度: raw('闭环'),
          软装项目进度: raw('闭环'),
          上会日期: raw('2026-05-20'),
          闭环周期: raw('26'),
        },
      }),
    ],
    team,
    { personnelArchitecture, year: 2026, dashboardContext: 'all' }
  );

  assert.equal(review.summary.lifecycle.completedCount, 1);
  assert.equal(group(review, '直营1组').summary.lifecycle.completedCount, 1);
  assert.equal(member(review, '陈菲菲').summary.lifecycle.completedCount, 1);
  assert.equal(member(review, '乔玲玲').summary.lifecycle.completedCount, 1);
  assert.deepEqual(group(review, '直营1组').monthly.months[5].projectIds.lifecycle, ['same-group']);
  assert.deepEqual(month(review, 6).projectIds.lifecycle, ['same-group']);
});

test('buildTeamWorkCompletionReview counts cross-group projects once per group and once for team', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'cross-group',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          摆场设计师: raw('陶媛媛'),
          硬装项目进度: raw('闭环'),
          软装项目进度: raw('闭环'),
          上会日期: raw('2026-05-20'),
          闭环周期: raw('26'),
        },
      }),
    ],
    team,
    { personnelArchitecture, year: 2026, dashboardContext: 'all' }
  );

  assert.equal(review.summary.lifecycle.completedCount, 1);
  assert.equal(group(review, '直营1组').summary.lifecycle.completedCount, 1);
  assert.equal(group(review, '直营2组').summary.lifecycle.completedCount, 1);
});

test('buildTeamWorkCompletionReview keeps completed stopped projects and suppresses unfinished stopped inProgress', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'completed-paused',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          硬装项目进度: raw('闭环'),
          软装项目进度: raw('闭环'),
          上会日期: raw('2026-05-20'),
          闭环周期: raw('26'),
          状态: raw('暂停'),
        },
      }),
      project({
        id: 'unfinished-paused',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('乔玲玲'),
          硬装项目进度: raw('施工图'),
          软装项目进度: raw('摆场'),
          状态: raw('暂停'),
        },
      }),
    ],
    team,
    { personnelArchitecture, year: 2026, dashboardContext: 'all' }
  );

  assert.equal(review.summary.lifecycle.completedCount, 1);
  assert.equal(review.summary.lifecycle.inProgressCount, 0);
  assert.equal(review.projectsById['completed-paused'].metrics.lifecycle.state, 'completed');
  assert.equal(review.projectsById['unfinished-paused'].metrics.lifecycle.state, 'none');
});

test('buildTeamWorkCompletionReview does not flag closed lifecycle projects as missing dates', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'lifecycle-missing-date',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          硬装项目进度: raw('闭环'),
          软装项目进度: raw('待采购'),
          上会日期: raw('2026-05-20'),
        },
      }),
    ],
    team,
    { personnelArchitecture, year: 2026, dashboardContext: 'all' }
  );

  assert.equal(review.summary.lifecycle.completedCount, 1);
  assert.equal(review.summary.lifecycle.missingDateCount, 0);
  assert.equal(review.dataQuality.missingDateCompletionCount, 0);
  assert.deepEqual(review.dataQuality.notes, []);
  assert.equal(review.monthly.months.reduce((sum, item) => sum + item.lifecycleCompleted, 0), 0);
});

test('buildTeamWorkCompletionReview buckets completion months from business dates', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'floor-completed',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          '平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）': raw('2026-04-10'),
          躺平内部审核结束时间: raw('2026-04-22'),
        },
      }),
      project({
        id: 'display-completed',
        rawFields: {
          组别: raw('直营新店'),
          摆场设计师: raw('陈菲菲'),
          软装项目进度: raw('摆场'),
          '摆场文件发出时间(项目群）': raw('2026-05-18'),
        },
      }),
      project({
        id: 'lifecycle-completed',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          硬装项目进度: raw('闭环'),
          软装项目进度: raw('待采购'),
          上会时间: raw('2026-05-20'),
          闭环周期: raw('12'),
        },
      }),
      project({
        id: 'lifecycle-deadline-fallback',
        dueDate: '2026-04-10',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          硬装项目进度: raw('闭环'),
          软装项目进度: raw('闭环'),
        },
      }),
    ],
    team,
    { personnelArchitecture, year: 2026, dashboardContext: 'all' }
  );

  assert.equal(month(review, 4).floorPlanCompleted, 1);
  assert.deepEqual(month(review, 4).projectIds.floorPlan, ['floor-completed']);
  assert.equal(month(review, 4).lifecycleCompleted, 1);
  assert.deepEqual(month(review, 4).projectIds.lifecycle, ['lifecycle-deadline-fallback']);
  assert.equal(month(review, 5).displayCompleted, 1);
  assert.deepEqual(month(review, 5).projectIds.display, ['display-completed']);
  assert.equal(month(review, 6).lifecycleCompleted, 1);
  assert.deepEqual(month(review, 6).projectIds.lifecycle, ['lifecycle-completed']);
  assert.equal(review.monthly.months.reduce((sum, item) => sum + item.lifecycleCompleted, 0), 2);
});

test('buildTeamWorkCompletionReview counts projects that only match the team owner', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'owner-only',
        rawFields: {
          组别: raw('直营新店'),
          负责人: raw('苏佳蕾'),
          硬装项目进度: raw('闭环'),
          软装项目进度: raw('待采购'),
          上会日期: raw('2026-05-20'),
          闭环周期: raw('12'),
        },
      }),
    ],
    team,
    { personnelArchitecture, year: 2026, dashboardContext: 'all' }
  );

  assert.equal(review.projectCount, 1);
  assert.equal(review.summary.lifecycle.completedCount, 1);
  assert.equal(member(review, '苏佳蕾').summary.lifecycle.completedCount, 1);
  assert.equal(group(review, '直营1组').summary.lifecycle.completedCount, 0);
});

test('buildTeamWorkCompletionReview filters selected year and dashboard context', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'direct-2026',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          硬装项目进度: raw('闭环'),
          软装项目进度: raw('闭环'),
          上会日期: raw('2026-05-20'),
          闭环周期: raw('26'),
        },
      }),
      project({
        id: 'franchise-2026',
        rawFields: {
          组别: raw('加盟新店'),
          CD设计师: raw('陈菲菲'),
          硬装项目进度: raw('闭环'),
          软装项目进度: raw('闭环'),
          上会日期: raw('2026-05-20'),
          闭环周期: raw('27'),
        },
      }),
      project({
        id: 'direct-2025',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          硬装项目进度: raw('闭环'),
          软装项目进度: raw('闭环'),
          上会日期: raw('2025-05-20'),
          闭环周期: raw('26'),
        },
      }),
    ],
    team,
    { personnelArchitecture, year: 2026, dashboardContext: 'direct' }
  );

  assert.equal(review.summary.lifecycle.completedCount, 2);
  assert.deepEqual(review.summary.lifecycle.completedProjectIds, ['direct-2026', 'direct-2025']);
  assert.equal(review.monthly.months.reduce((sum, item) => sum + item.lifecycleCompleted, 0), 1);
  assert.deepEqual(month(review, 6).projectIds.lifecycle, ['direct-2026']);
});

test('buildTeamWorkCompletionReview canonicalizes aliases and reports data quality notes', () => {
  const review = buildTeamWorkCompletionReview(
    [
      project({
        id: 'alias-floor',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('菲菲'),
          '平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）': raw('2026-04-10'),
          躺平内部审核结束时间: raw('2026-04-22'),
        },
      }),
      project({
        id: 'unknown-display',
        rawFields: {
          组别: raw('直营新店'),
          CD设计师: raw('陈菲菲'),
          摆场设计师: raw('临时摆场人'),
          软装项目进度: raw('摆场'),
        },
      }),
      project({
        id: 'unrelated-unknown',
        name: '其它团队项目',
        rawFields: {
          组别: raw('直营新店'),
          摆场设计师: raw('其它团队成员'),
          硬装方案情况: raw('准时完成'),
        },
      }),
    ],
    team,
    { personnelArchitecture, year: 2026, dashboardContext: 'all' }
  );

  assert.equal(member(review, '陈菲菲').summary.floorPlan.completedCount, 1);
  assert.equal(review.projectCount, 2);
  assert.equal(review.projectsById['unrelated-unknown'], undefined);
  assert.equal(review.dataQuality.unmappedMemberCount, 1);
  assert.equal(review.dataQuality.notes[0].projectId, 'unknown-display');
  assert.equal(review.dataQuality.notes[0].type, 'unmappedMember');
});

test('buildTeamWorkCompletionReview caps exported data quality notes while preserving counts', () => {
  const projects = Array.from({ length: TEAM_WORK_COMPLETION_DATA_QUALITY_NOTE_LIMIT + 8 }, (_, index) =>
    project({
      id: `note-${index}`,
      rawFields: {
        组别: raw('直营新店'),
        CD设计师: raw('陈菲菲'),
        摆场设计师: raw(`外部成员${index}`),
        软装项目进度: raw('摆场'),
      },
    })
  );
  const review = buildTeamWorkCompletionReview(projects, team, {
    personnelArchitecture,
    year: 2026,
    dashboardContext: 'all',
  });

  assert.equal(review.dataQuality.notes.length, TEAM_WORK_COMPLETION_DATA_QUALITY_NOTE_LIMIT);
  assert.equal(review.dataQuality.notesTotal, TEAM_WORK_COMPLETION_DATA_QUALITY_NOTE_LIMIT + 8);
  assert.equal(review.dataQuality.notesTruncated, true);
  assert.equal(review.dataQuality.unmappedMemberCount, TEAM_WORK_COMPLETION_DATA_QUALITY_NOTE_LIMIT + 8);
});
