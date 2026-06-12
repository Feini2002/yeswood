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

function sparseProject(id, rawFields = {}) {
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
    sparseProject('display-start-only-upstream-missing', {
      摆场开始时间: raw('2026-06-07'),
    }),
  ]);

  const byId = Object.fromEntries(review.processingQueues.urgent.topProjects.map((item) => [item.id, item.actionStage]));

  assert.equal(byId['display-not-started'], '待摆场');
  assert.equal(byId['display-started'], '等待摆场结束');
  assert.equal(byId['display-ended'], '项目待闭环');
  assert.equal(byId['display-start-only-upstream-missing'], '等待摆场结束');
});

test('team work completion queue uses unified primary reminders before display stage', () => {
  const review = reviewFor([
    sparseProject('point-done-waits-soft', {
      硬装项目进度: raw('施工图完成审核'),
      点位完成情况: raw('已完成'),
      点位完成时间: raw('2026-05-18'),
    }),
    sparseProject('product-list-ready', {
      软装项目进度: raw('产品清单'),
      产品清单接收时间: raw('2026-05-22'),
    }),
    sparseProject('purchase-started', {
      软装项目进度: raw('待采购'),
      采购情况: raw('待采购'),
    }),
    sparseProject('purchase-time-only', {
      软装项目进度: raw('待采购'),
      采购时间: raw('2026-05-30'),
    }),
    sparseProject('purchase-completed-stale-progress', {
      软装项目进度: raw('待采购'),
      采购完成情况: raw('已完成'),
    }),
  ]);

  const byId = Object.fromEntries(review.processingQueues.urgent.topProjects.map((item) => [item.id, item.actionStage]));

  assert.equal(byId['point-done-waits-soft'], '待软装方案');
  assert.equal(byId['product-list-ready'], '待采购');
  assert.equal(byId['purchase-started'], '待采购完成');
  assert.equal(byId['purchase-time-only'], '待采购完成');
  assert.equal(byId['purchase-completed-stale-progress'], '待摆场');
});

test('team work completion queue includes procurement-only projects without workflow text', () => {
  const review = reviewFor([
    sparseProject('purchase-time-no-progress', {
      采购时间: raw('2026-05-30'),
    }),
    sparseProject('purchase-completed-no-progress', {
      采购完成情况: raw('已完成'),
    }),
  ]);

  const byId = Object.fromEntries(review.processingQueues.urgent.topProjects.map((item) => [item.id, item.actionStage]));

  assert.equal(byId['purchase-time-no-progress'], '待采购完成');
  assert.equal(byId['purchase-completed-no-progress'], '待摆场');
});
