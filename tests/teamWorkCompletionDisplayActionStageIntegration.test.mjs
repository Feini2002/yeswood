import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTeamWorkCompletionReview } from '../src/backend/teamWorkCompletionReview.mjs';

function raw(display) {
  return { display };
}

function project(id, rawFields = {}) {
  return {
    id,
    name: id,
    status: '紧急',
    storeStatus: '常规店',
    dueDate: '2026-07-01',
    updatedAt: '2026-06-12T00:00:00.000Z',
    rawFields: {
      组别: raw('直营1组'),
      CD设计师: raw('陈菲菲'),
      硬装项目进度: raw('施工图完成审核'),
      点位完成情况: raw('已完成'),
      点位完成时间: raw('2026-05-18'),
      软装方案开始时间: raw('2026-05-20'),
      软装发项目群时间: raw('2026-05-25'),
      采购时间: raw('2026-05-30'),
      采购完成情况: raw('已完成'),
      ...rawFields,
    },
  };
}

const team = {
  owner: '苏佳蕾',
  groups: [{ name: '直营1组', members: ['陈菲菲'] }],
};

const personnelArchitecture = {
  people: {
    苏佳蕾: { name: '苏佳蕾', displayName: '苏佳蕾' },
    陈菲菲: { name: '陈菲菲', displayName: '陈菲菲' },
  },
  aliases: {},
  teams: [team],
};

function reviewFor(projects) {
  return buildTeamWorkCompletionReview(projects, team, {
    personnelArchitecture,
    year: 2026,
    dashboardContext: 'all',
  });
}

test('team work completion queue distinguishes display waiting and display closure actions', () => {
  const review = reviewFor([
    project('display-not-started', {
      软装项目进度: raw('待采购'),
    }),
    project('display-started', {
      软装项目进度: raw('摆场'),
      摆场开始时间: raw('2026-06-07'),
    }),
    project('display-ended', {
      软装项目进度: raw('摆场'),
      '摆场文件发出时间(项目群）': raw('2026-06-10'),
    }),
  ]);

  const byId = Object.fromEntries(review.processingQueues.urgent.topProjects.map((item) => [item.id, item.actionStage]));

  assert.equal(byId['display-not-started'], '待摆场');
  assert.equal(byId['display-started'], '等待摆场结束');
  assert.equal(byId['display-ended'], '项目待闭环');
});
