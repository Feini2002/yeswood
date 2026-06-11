import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildTeamResponsibilityReview } from '../src/backend/teamResponsibilityReview.mjs';
import { createServer } from '../src/backend/server.mjs';

async function withTestServer(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-team-responsibility-'));
  const config = {
    port: 0,
    mode: 'mock',
    cacheFile: path.join(tempDir, 'dashboard-cache.json'),
    precomputeDir: path.join(tempDir, 'precomputed'),
    syncApiKey: 'server-only-secret',
    syncMinIntervalMs: 0,
    dashboardSyncEnabled: false,
    databaseFile: '',
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
  };

  const server = createServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${pathname}`, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, body: JSON.parse(body) });
          } catch {
            resolve({ status: response.statusCode, body });
          }
        });
      })
      .on('error', reject);
  });
}

function raw(display) {
  return { display };
}

function project(overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    name: overrides.name || '测试项目',
    owner: overrides.owner || '苏佳蕾',
    status: overrides.status || '推进中',
    storeStatus: overrides.storeStatus || '常规店',
    riskLevel: overrides.riskLevel || '低',
    startDate: overrides.startDate || '2026-05-01',
    dueDate: overrides.dueDate || '2026-07-01',
    updatedAt: overrides.updatedAt || '2026-06-15T00:00:00.000Z',
    rawFields: overrides.rawFields || {},
    ...overrides,
  };
}

function person(review, name) {
  return review.people.find((item) => item.name === name);
}

test('buildTeamResponsibilityReview counts only active execution designer load for hard owners', () => {
  const team = {
    owner: '苏佳蕾',
    groups: [
      { name: '直营1组', members: ['陈菲菲', '乔玲玲'] },
    ],
  };
  const architecture = {
    people: {
      苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
      陈菲菲: { name: '陈菲菲', position: 'lead', discipline: 'hard' },
      乔玲玲: { name: '乔玲玲', position: 'designer', discipline: 'hard' },
      外部设计师: { name: '外部设计师', position: 'designer', discipline: 'hard' },
    },
    teams: [team],
  };
  const projects = [
    project({
      id: 'team-open',
      owner: '苏佳蕾',
      rawFields: {
        组别: raw('直营新店'),
        负责人: raw('苏佳蕾'),
        CD负责人: raw('苏佳蕾'),
        CD组长: raw('陈菲菲'),
        CD设计师: raw('乔玲玲'),
        VM设计师: raw('软装执行'),
        硬装项目进度: raw('平面方案'),
        平面开始时间: raw('2026-06-01'),
        硬装方案情况: raw('进行中'),
      },
    }),
    project({
      id: 'team-done',
      owner: '苏佳蕾',
      rawFields: {
        组别: raw('直营新店'),
        负责人: raw('苏佳蕾'),
        CD设计师: raw('乔玲玲'),
        硬装项目进度: raw('施工图'),
        平面开始时间: raw('2026-06-01'),
        躺平内部审核结束时间: raw('2026-06-05'),
      },
    }),
    project({
      id: 'team-paused',
      owner: '苏佳蕾',
      rawFields: {
        组别: raw('直营新店'),
        负责人: raw('苏佳蕾'),
        CD设计师: raw('乔玲玲'),
        硬装项目进度: raw('暂停'),
        平面开始时间: raw('2026-06-01'),
      },
    }),
    project({
      id: 'team-external',
      owner: '苏佳蕾',
      rawFields: {
        组别: raw('直营新店'),
        负责人: raw('苏佳蕾'),
        CD设计师: raw('外部设计师'),
        硬装项目进度: raw('平面躺平'),
        平面开始时间: raw('2026-06-02'),
      },
    }),
    project({
      id: 'borrowed-out',
      owner: '其他负责人',
      rawFields: {
        组别: raw('直营新店'),
        负责人: raw('其他负责人'),
        CD设计师: raw('乔玲玲'),
        硬装项目进度: raw('平面方案'),
        平面开始时间: raw('2026-06-03'),
      },
    }),
  ];

  const review = buildTeamResponsibilityReview(projects, team, {
    month: '2026-06',
    dashboardContext: 'direct',
    personnelArchitecture: architecture,
  });

  assert.equal(review.executionScope.name, '硬装执行负载');
  assert.deepEqual(review.executionScope.slotKeys, ['cd_designer']);
  assert.equal(review.summary.projectCount, 3);
  assert.equal(review.summary.responsibilityItemCount, 3);
  assert.equal(review.summary.peopleCount, 2);
  assert.equal(review.summary.externalSupportCount, 1);
  assert.equal(review.summary.borrowedOutCount, 1);
  assert.equal(person(review, '苏佳蕾'), undefined);
  assert.equal(person(review, '陈菲菲'), undefined);
  assert.equal(person(review, '软装执行'), undefined);
  assert.equal(person(review, '乔玲玲').supportType, 'mixed');
  assert.equal(person(review, '乔玲玲').projectCount, 2);
  assert.deepEqual(
    person(review, '乔玲玲').roles.map((item) => [item.key, item.slotKey, item.deliveryKey, item.itemCount]),
    [['cdDesigner', 'cd_designer', 'hardScheme', 2]]
  );
  assert.equal(person(review, '外部设计师').supportType, 'externalSupport');
  assert.deepEqual(
    review.borrowing.map((item) => [item.projectId, item.personName, item.direction, item.roleLabel]),
    [
      ['team-external', '外部设计师', 'externalIn', '硬装设计师'],
      ['borrowed-out', '乔玲玲', 'borrowedOut', '硬装设计师'],
    ]
  );
});

test('buildTeamResponsibilityReview uses Su Jialei static direct groups when architecture team has no members', () => {
  const team = { owner: '苏佳蕾', cdLeads: [], vmLeads: [] };
  const review = buildTeamResponsibilityReview(
    [
      project({
        id: 'static-team-member',
        owner: '苏佳蕾',
        rawFields: {
          负责人: raw('苏佳蕾'),
          CD设计师: raw('乔玲玲'),
          硬装项目进度: raw('平面方案'),
          平面开始时间: raw('2026-06-01'),
        },
      }),
    ],
    team,
    {
      month: '2026-06',
      personnelArchitecture: {
        people: {
          苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
          乔玲玲: { name: '乔玲玲', position: 'designer', discipline: 'hard' },
        },
        teams: [team],
      },
    }
  );

  assert.equal(person(review, '乔玲玲').supportType, 'team');
  assert.equal(review.summary.externalSupportCount, 0);
  assert.equal(review.team.groups.length, 4);
  assert.equal(review.team.coreNames.includes('乔玲玲'), true);
});

test('buildTeamResponsibilityReview builds company-wide member load modules for owner team members', () => {
  const team = { owner: '苏佳蕾', cdLeads: [], vmLeads: [] };
  const projects = [
    project({
      id: 'chen-floor-active-other-owner',
      name: '异负责人平面进行店',
      owner: '其他负责人',
      rawFields: {
        组别: raw('加盟新店'),
        负责人: raw('其他负责人'),
        CD设计师: raw('陈晶晶'),
        硬装项目进度: raw('平面方案'),
        平面开始时间: raw('2026-06-01'),
        硬装方案情况: raw('进行中'),
      },
    }),
    project({
      id: 'chen-floor-done-history',
      name: '历史平面完成店',
      owner: '其他负责人',
      rawFields: {
        组别: raw('直营新店'),
        负责人: raw('其他负责人'),
        CD设计师: raw('陈晶晶'),
        硬装项目进度: raw('施工图'),
        平面开始时间: raw('2026-04-01'),
        躺平内部审核结束时间: raw('2026-04-08'),
      },
    }),
    project({
      id: 'chen-display-active',
      name: '摆场推进店',
      owner: '其他负责人',
      rawFields: {
        组别: raw('直营新店'),
        负责人: raw('其他负责人'),
        VM设计师: raw('软装同事'),
        摆场设计师: raw('陈晶晶、严许'),
        软装项目进度: raw('摆场'),
      },
    }),
    project({
      id: 'chen-display-done',
      name: '摆场闭环店',
      owner: '其他负责人',
      rawFields: {
        组别: raw('直营新店'),
        负责人: raw('其他负责人'),
        摆场设计师: raw('陈晶晶'),
        硬装项目进度: raw('闭环'),
        软装项目进度: raw('闭环'),
      },
    }),
    project({
      id: 'chen-associated-only',
      name: '仅关联软装店',
      owner: '其他负责人',
      rawFields: {
        组别: raw('直营新店'),
        负责人: raw('其他负责人'),
        VM设计师: raw('陈晶晶'),
        软装项目进度: raw('未开始'),
      },
    }),
  ];

  const review = buildTeamResponsibilityReview(projects, team, {
    month: '2026-06',
    dashboardContext: 'direct',
    personnelArchitecture: {
      people: {
        苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
        陈晶晶: { name: '陈晶晶', position: 'designer', discipline: 'hard' },
      },
      teams: [team],
    },
  });

  const chen = review.memberLoads.find((item) => item.name === '陈晶晶');
  assert.ok(chen);
  assert.equal(chen.groupName, '直营1组');
  assert.equal(chen.summary.associatedProjectCount, 5);
  assert.equal(chen.summary.floorPlanActiveCount, 1);
  assert.equal(chen.summary.floorPlanCompletedCount, 1);
  assert.equal(chen.summary.displayActiveCount, 1);
  assert.equal(chen.summary.displayCompletedCount, 1);
  assert.deepEqual(
    chen.floorPlan.active.map((item) => item.projectId),
    ['chen-floor-active-other-owner']
  );
  assert.deepEqual(
    chen.floorPlan.completed.map((item) => item.projectId),
    ['chen-floor-done-history']
  );
  assert.deepEqual(
    chen.display.active.map((item) => item.projectId),
    ['chen-display-active']
  );
  assert.deepEqual(
    chen.display.completed.map((item) => item.projectId),
    ['chen-display-done']
  );
  assert.deepEqual(
    chen.associatedProjects.map((item) => [item.projectId, item.projectName, item.owner, item.state]),
    [
      ['chen-floor-active-other-owner', '异负责人平面进行店', '其他负责人', 'active'],
      ['chen-floor-done-history', '历史平面完成店', '其他负责人', 'completed'],
      ['chen-display-active', '摆场推进店', '其他负责人', 'active'],
      ['chen-display-done', '摆场闭环店', '其他负责人', 'completed'],
      ['chen-associated-only', '仅关联软装店', '其他负责人', 'associated'],
    ]
  );
  assert.equal(review.summary.memberAssociatedProjectCount >= 5, true);
});

test('buildTeamResponsibilityReview validates display assignees through existing designer evidence without inferring a display role', () => {
  const team = { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['陈晶晶'] }] };
  const architecture = {
    people: {
      苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
      陈晶晶: { name: '陈晶晶', position: 'designer', discipline: 'hard' },
    },
    teams: [team],
  };
  const review = buildTeamResponsibilityReview(
    [
      project({
        id: 'display-with-unknown',
        name: '摆场责任待核店',
        owner: '其他负责人',
        rawFields: {
          负责人: raw('其他负责人'),
          VM设计师: raw('软装同事'),
          摆场设计师: raw('陈晶晶、严许、临时摆场人'),
          软装项目进度: raw('摆场'),
        },
      }),
      project({
        id: 'yan-point-evidence',
        name: '严许点位证据店',
        owner: '其他负责人',
        rawFields: {
          负责人: raw('其他负责人'),
          点位设计师: raw('严许'),
          软装项目进度: raw('点位'),
        },
      }),
    ],
    team,
    {
      month: '2026-06',
      dashboardContext: 'all',
      personnelArchitecture: architecture,
    }
  );

  const chen = review.memberLoads.find((item) => item.name === '陈晶晶');
  assert.equal(chen.summary.displayActiveCount, 1);
  assert.equal(review.memberLoads.some((item) => item.name === '严许'), false);
  assert.equal(review.memberLoads.some((item) => item.name === '临时摆场人'), false);
  assert.equal(review.summary.dataQualityAnomalyCount, 1);
  assert.deepEqual(
    review.dataQuality.anomalies.map((item) => [item.type, item.personName, item.projectId, item.sourceField]),
    [['摆场责任人待核对', '临时摆场人', 'display-with-unknown', '摆场设计师']]
  );
  assert.match(review.dataQuality.anomalies[0].message, /未匹配到已维护设计师或项目 CD\/VM\/点位设计师/);
});

test('buildTeamResponsibilityReview attaches hard decoration deadline reminders to member floor load', () => {
  const team = { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['陈晶晶'] }] };
  const architecture = {
    people: {
      苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
      陈晶晶: { name: '陈晶晶', position: 'designer', discipline: 'hard' },
    },
    teams: [team],
  };
  const review = buildTeamResponsibilityReview(
    [
      project({
        id: 'system-deadline-floor',
        name: '系统规则延期平面店',
        owner: '苏佳蕾',
        rawFields: {
          组别: raw('直营新店'),
          负责人: raw('苏佳蕾'),
          CD设计师: raw('陈晶晶'),
          硬装项目进度: raw('平面方案'),
          复尺时间: raw('2026-06-01'),
          面积: raw('280'),
          平面开始时间: raw('2026-06-02'),
          硬装方案情况: raw('进行中'),
        },
      }),
    ],
    team,
    {
      month: '2026-06',
      dashboardContext: 'direct',
      personnelArchitecture: architecture,
      today: '2026-06-10',
      hardDecorationCalendar: { timezone: 'Asia/Shanghai', holidays: [], workdays: [] },
    }
  );

  const floorItem = review.memberLoads.find((item) => item.name === '陈晶晶')?.floorPlan.active[0];
  assert.ok(floorItem);
  assert.equal(floorItem.status, '进行中');
  assert.equal(floorItem.hardDeadline.ruleVersion, 'hard-decoration-deadline-v2026-06-04');
  assert.equal(floorItem.hardDeadline.areaBucket.label, 'mini店：≤300㎡');
  assert.equal(floorItem.hardDeadline.floorPlan.dueDate, '2026-06-09');
  assert.equal(floorItem.hardDeadline.floorPlan.completionStatus, 'delayed_open');
  assert.deepEqual(
    {
      type: floorItem.hardDeadline.reminder.type,
      title: floorItem.hardDeadline.reminder.title,
      dueDate: floorItem.hardDeadline.reminder.dueDate,
      severity: floorItem.hardDeadline.reminder.severity,
    },
    {
      type: 'delayed',
      title: '系统平面 Deadline 已延期',
      dueDate: '2026-06-09',
      severity: 'P1',
    }
  );
});

test('buildTeamResponsibilityReview excludes inactive placeholder members from member load summary', () => {
  const team = { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['陈晶晶', '李晓倩'] }] };
  const review = buildTeamResponsibilityReview(
    [
      project({
        id: 'active-member-project',
        name: '在职成员项目',
        owner: '苏佳蕾',
        rawFields: {
          组别: raw('直营新店'),
          负责人: raw('苏佳蕾'),
          CD设计师: raw('陈晶晶'),
          硬装项目进度: raw('平面方案'),
          平面开始时间: raw('2026-06-01'),
        },
      }),
      project({
        id: 'inactive-member-project',
        name: '暂不在职成员项目',
        owner: '苏佳蕾',
        rawFields: {
          组别: raw('直营新店'),
          负责人: raw('苏佳蕾'),
          CD设计师: raw('李晓倩'),
          硬装项目进度: raw('平面方案'),
          平面开始时间: raw('2026-06-01'),
        },
      }),
    ],
    team,
    { month: '2026-06', dashboardContext: 'direct' }
  );

  assert.ok(review.team.groups[0].members.includes('李晓倩'));
  assert.equal(review.memberLoads.some((item) => item.name === '李晓倩'), false);
  assert.equal(review.summary.memberCount, 1);
  assert.equal(review.summary.memberAssociatedProjectCount, 1);
});

test('buildTeamResponsibilityReview drops hard load once workflow moves past floor plan stage', () => {
  const team = { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['乔玲玲'] }] };
  const review = buildTeamResponsibilityReview(
    [
      project({
        id: 'construction-stage-without-finish-time',
        owner: '苏佳蕾',
        rawFields: {
          组别: raw('直营新店'),
          负责人: raw('苏佳蕾'),
          CD设计师: raw('乔玲玲'),
          硬装项目进度: raw('施工图'),
          平面开始时间: raw('2026-06-01'),
        },
      }),
      project({
        id: 'floor-plan-stage',
        owner: '苏佳蕾',
        rawFields: {
          组别: raw('直营新店'),
          负责人: raw('苏佳蕾'),
          CD设计师: raw('乔玲玲'),
          硬装项目进度: raw('平面躺平'),
          平面开始时间: raw('2026-06-02'),
        },
      }),
    ],
    team,
    {
      month: '2026-06',
      dashboardContext: 'direct',
      personnelArchitecture: {
        people: {
          苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
          乔玲玲: { name: '乔玲玲', position: 'designer', discipline: 'hard' },
        },
        teams: [team],
      },
    }
  );

  assert.equal(review.summary.responsibilityItemCount, 1);
  assert.deepEqual(person(review, '乔玲玲').items.map((item) => item.projectId), ['floor-plan-stage']);
});

test('buildTeamResponsibilityReview maps soft and creative owners to execution designer scopes', () => {
  const softTeam = { owner: '软装负责人', members: ['点位同事', '方案同事'] };
  const creativeTeam = { owner: '创意负责人', members: ['硬装同事', '点位同事', '方案同事'] };
  const architecture = {
    people: {
      软装负责人: { name: '软装负责人', position: 'owner', discipline: 'soft' },
      创意负责人: { name: '创意负责人', position: 'owner', discipline: 'both' },
      点位同事: { name: '点位同事', position: 'designer', discipline: 'soft' },
      方案同事: { name: '方案同事', position: 'designer', discipline: 'soft' },
      硬装同事: { name: '硬装同事', position: 'designer', discipline: 'hard' },
    },
    teams: [softTeam, creativeTeam],
  };
  const projects = [
    project({
      id: 'soft-open',
      owner: '软装负责人',
      rawFields: {
        负责人: raw('软装负责人'),
        CD设计师: raw('硬装同事'),
        点位设计师: raw('点位同事'),
        VM设计师: raw('方案同事'),
        硬装项目进度: raw('施工图'),
        软装项目进度: raw('软装方案'),
        点位完成情况: raw('延期中'),
        软装方案开始时间: raw('2026-06-01'),
        软装完成情况: raw('进行中'),
      },
    }),
    project({
      id: 'creative-open',
      owner: '创意负责人',
      rawFields: {
        负责人: raw('创意负责人'),
        CD设计师: raw('硬装同事'),
        点位设计师: raw('点位同事'),
        VM设计师: raw('方案同事'),
        硬装项目进度: raw('平面方案'),
        平面开始时间: raw('2026-06-01'),
        软装项目进度: raw('软装方案'),
        点位完成情况: raw('延期中'),
        软装方案开始时间: raw('2026-06-01'),
        软装完成情况: raw('进行中'),
      },
    }),
  ];

  const softReview = buildTeamResponsibilityReview(projects, softTeam, {
    month: '2026-06',
    personnelArchitecture: architecture,
  });
  assert.equal(softReview.executionScope.name, '软装执行负载');
  assert.deepEqual(softReview.executionScope.slotKeys, ['point_designer', 'vm_designer']);
  assert.equal(softReview.summary.responsibilityItemCount, 4);
  assert.equal(softReview.summary.borrowedOutCount, 2);
  assert.equal(person(softReview, '硬装同事'), undefined);
  assert.equal(person(softReview, '点位同事').roles[0].deliveryKey, 'point');
  assert.equal(person(softReview, '方案同事').roles[0].deliveryKey, 'softScheme');

  const creativeReview = buildTeamResponsibilityReview(projects.filter((item) => item.id === 'creative-open'), creativeTeam, {
    month: '2026-06',
    personnelArchitecture: architecture,
  });
  assert.equal(creativeReview.executionScope.name, '全案执行负载');
  assert.deepEqual(creativeReview.executionScope.slotKeys, ['cd_designer', 'point_designer', 'vm_designer']);
  assert.equal(creativeReview.summary.responsibilityItemCount, 3);
  assert.equal(person(creativeReview, '硬装同事').roles[0].deliveryKey, 'hardScheme');
  assert.equal(person(creativeReview, '点位同事').roles[0].deliveryKey, 'point');
  assert.equal(person(creativeReview, '方案同事').roles[0].deliveryKey, 'softScheme');
});

test('buildTeamResponsibilityReview expands only execution designer items for the owner discipline', () => {
  const team = {
    owner: '苏佳蕾',
    cdLeads: ['硬组长'],
    vmLeads: ['软组长'],
  };
  const projects = [
    project({
      id: 'team-1',
      rawFields: {
        负责人: raw('苏佳蕾'),
        CD负责人: raw('硬负责人'),
        CD组长: raw('硬组长'),
        CD设计师: raw('硬设计师'),
        VM负责人: raw('软负责人'),
        VM组长: raw('软组长'),
        点位设计师: raw('点位设计师'),
        VM设计师: raw('软设计师'),
        摆场设计师: raw('摆场设计师'),
        硬装项目进度: raw('平面方案'),
        平面开始时间: raw('2026-06-01'),
        硬装方案情况: raw('延期中'),
        点位完成情况: raw('准时完成'),
        点位完成时间: raw('2026-06-05'),
        软装完成情况: raw('延期中'),
      },
    }),
  ];

  const review = buildTeamResponsibilityReview(projects, team, {
    month: '2026-06',
    personnelArchitecture: {
      people: {
        苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
        硬组长: { name: '硬组长', position: 'lead', discipline: 'hard' },
        软组长: { name: '软组长', position: 'lead', discipline: 'soft' },
      },
      teams: [team],
    },
  });

  assert.equal(review.owner, '苏佳蕾');
  assert.equal(review.summary.projectCount, 1);
  assert.equal(review.summary.responsibilityItemCount, 1);
  assert.equal(review.summary.completedThisMonth, 0);
  assert.equal(review.summary.delayedCompletedThisMonth, 0);
  assert.equal(review.summary.openDelayed, 1);
  assert.deepEqual(
    review.disciplines.map((item) => [item.key, item.itemCount, item.completedThisMonth, item.openDelayed]),
    [
      ['hard', 1, 0, 1],
      ['soft', 0, 0, 0],
    ]
  );

  assert.equal(person(review, '苏佳蕾'), undefined);
  assert.equal(person(review, '硬组长'), undefined);
  assert.equal(person(review, '软组长'), undefined);
  assert.equal(person(review, '硬设计师').projectCount, 1);
  assert.equal(person(review, '硬设计师').responsibilityItemCount, 1);
  assert.deepEqual(
    person(review, '硬设计师').roles.map((item) => [item.key, item.deliveryKey, item.itemCount, item.openDelayed]),
    [['cdDesigner', 'hardScheme', 1, 1]]
  );
  assert.equal(person(review, '点位设计师'), undefined);
  assert.equal(person(review, '软设计师'), undefined);
  assert.equal(person(review, '摆场设计师'), undefined);
});

test('buildTeamResponsibilityReview separates in-team work from borrowed designer support', () => {
  const team = {
    owner: '苏佳蕾',
    cdLeads: ['硬组长'],
    vmLeads: ['软组长'],
  };
  const projects = [
    project({
      id: 'owned-by-team',
      owner: '苏佳蕾',
      rawFields: {
        负责人: raw('苏佳蕾'),
        CD设计师: raw('外部硬设计师'),
        硬装项目进度: raw('平面方案'),
        平面开始时间: raw('2026-06-01'),
        硬装方案情况: raw('进行中'),
      },
    }),
    project({
      id: 'borrowed-out',
      owner: '其他负责人',
      rawFields: {
        负责人: raw('其他负责人'),
        CD设计师: raw('硬组长'),
        硬装项目进度: raw('平面方案'),
        平面开始时间: raw('2026-06-02'),
        硬装方案情况: raw('延期中'),
      },
    }),
  ];

  const review = buildTeamResponsibilityReview(projects, team, {
    month: '2026-06',
    personnelArchitecture: {
      people: {
        苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
        硬组长: { name: '硬组长', position: 'lead', discipline: 'hard' },
        外部硬设计师: { name: '外部硬设计师', position: 'designer', discipline: 'hard' },
      },
      teams: [team],
    },
  });

  assert.equal(person(review, '外部硬设计师').supportType, 'externalSupport');
  assert.equal(person(review, '外部硬设计师').projectCount, 1);
  assert.equal(person(review, '硬组长').supportType, 'borrowedOut');
  assert.equal(person(review, '硬组长').borrowedOutCount, 1);
  assert.deepEqual(
    review.borrowing.map((item) => [item.projectId, item.personName, item.direction]),
    [
      ['owned-by-team', '外部硬设计师', 'externalIn'],
      ['borrowed-out', '硬组长', 'borrowedOut'],
    ]
  );
});

test('buildTeamResponsibilityReview resolves aliases before classifying team support direction', () => {
  const team = {
    owner: 'Jarvan范嘉瑞',
    cdLeads: ['硬组长'],
    vmLeads: [],
  };
  const projects = [
    project({
      id: 'alias-team-owned',
      owner: '范嘉瑞',
      rawFields: {
        负责人: raw('范嘉瑞'),
        CD负责人: raw('范嘉瑞'),
        CD设计师: raw('硬组长别名'),
        硬装项目进度: raw('平面方案'),
        平面开始时间: raw('2026-06-01'),
        硬装方案情况: raw('进行中'),
      },
    }),
    project({
      id: 'alias-borrowed-out',
      owner: '其他负责人',
      rawFields: {
        负责人: raw('其他负责人'),
        CD设计师: raw('硬组长别名'),
        硬装项目进度: raw('平面方案'),
        平面开始时间: raw('2026-06-02'),
        硬装方案情况: raw('延期中'),
      },
    }),
  ];

  const review = buildTeamResponsibilityReview(projects, team, {
    month: '2026-06',
    personnelArchitecture: {
      people: {
        Jarvan范嘉瑞: {
          name: 'Jarvan范嘉瑞',
          displayName: '范嘉瑞',
          aliases: ['范嘉瑞'],
          position: 'owner',
          discipline: 'hard',
        },
        硬组长: {
          name: '硬组长',
          aliases: ['硬组长别名'],
          position: 'lead',
          discipline: 'hard',
        },
      },
      teams: [team],
    },
  });

  assert.equal(person(review, '范嘉瑞'), undefined);
  assert.equal(person(review, '硬组长别名'), undefined);
  assert.equal(person(review, '硬组长').supportType, 'mixed');
  assert.equal(person(review, '硬组长').borrowedOutCount, 1);
  assert.equal(review.summary.externalSupportCount, 0);
  assert.equal(review.summary.borrowedOutCount, 1);
  assert.deepEqual(
    review.borrowing.map((item) => [item.projectId, item.personName, item.direction]),
    [['alias-borrowed-out', '硬组长', 'borrowedOut']]
  );
  assert.deepEqual(review.people.map((item) => item.name), ['硬组长']);
});

test('buildTeamResponsibilityReview excludes completed execution stock from current load', () => {
  const team = { owner: '苏佳蕾' };
  const projects = [
    project({
      id: 'may-done',
      rawFields: {
        负责人: raw('苏佳蕾'),
        CD设计师: raw('苏佳蕾'),
        硬装方案情况: raw('准时完成'),
        硬装方案完成时间: raw('2026-05-31'),
      },
    }),
    project({
      id: 'june-delay-done',
      rawFields: {
        负责人: raw('苏佳蕾'),
        CD设计师: raw('苏佳蕾'),
        硬装方案情况: raw('延期完成'),
        硬装方案完成时间: raw('2026-06-03'),
      },
    }),
    project({
      id: 'july-done',
      rawFields: {
        负责人: raw('苏佳蕾'),
        CD设计师: raw('苏佳蕾'),
        硬装方案情况: raw('准时完成'),
        硬装方案完成时间: raw('2026-07-01'),
      },
    }),
  ];

  const review = buildTeamResponsibilityReview(projects, team, {
    month: '2026-06',
    personnelArchitecture: {
      people: {
        苏佳蕾: { name: '苏佳蕾', position: 'owner', discipline: 'hard' },
      },
      teams: [team],
    },
  });

  assert.equal(review.summary.projectCount, 0);
  assert.equal(review.summary.responsibilityItemCount, 0);
  assert.equal(review.summary.completedThisMonth, 0);
  assert.equal(review.summary.delayedCompletedThisMonth, 0);
  assert.equal(review.summary.openDelayed, 0);
  assert.equal(person(review, '苏佳蕾'), undefined);
});

test('/api/team-responsibility-review requires owner and returns review payload', async () => {
  await withTestServer(async (port) => {
    const missingOwner = await getJson(port, '/api/team-responsibility-review');
    assert.equal(missingOwner.status, 400);
    assert.match(missingOwner.body.error, /owner query parameter is required/);

    const invalidContext = await getJson(port, `/api/team-responsibility-review?owner=${encodeURIComponent('苏佳蕾')}&context=unknown`);
    assert.equal(invalidContext.status, 400);
    assert.match(invalidContext.body.error, /context must be one of/);

    const payload = await getJson(
      port,
      `/api/team-responsibility-review?owner=${encodeURIComponent('苏佳蕾')}&month=2026-06`
    );

    assert.equal(payload.status, 200);
    assert.equal(payload.body.owner, '苏佳蕾');
    assert.equal(payload.body.month, '2026-06');
    assert.equal(payload.body.readOnly, true);
    assert.ok(payload.body.summary);
    assert.deepEqual(
      payload.body.disciplines.map((item) => item.key),
      ['hard', 'soft']
    );
    assert.ok(Array.isArray(payload.body.people));
  });
});
