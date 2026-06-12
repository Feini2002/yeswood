import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_STAGE_KEYS,
  resolveProjectStageReminder,
  resolveProjectWorkflowFacts,
} from '../public/domain/project-stage-reminder-rules.mjs';

function raw(display) {
  return { display };
}

function project(rawFields = {}, overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    name: overrides.name || '测试项目',
    status: overrides.status || '推进中',
    storeStatus: overrides.storeStatus || '常规店',
    rawFields,
    ...overrides,
  };
}

test('display start time advances project to display in progress without waiting for soft completion status', () => {
  const item = project({
    硬装项目进度: raw('施工图完成审核'),
    软装项目进度: raw('摆场'),
    点位完成情况: raw('已完成'),
    点位完成时间: raw('2026-04-16'),
    软装方案开始时间: raw('2026-05-08'),
    软装发项目群时间: raw('2026-05-15'),
    流程记录: raw('产品清单接收时间 2026-05-22'),
    采购时间: raw('2026-05-22'),
    采购完成情况: raw('已完成'),
    摆场开始时间: raw('2026-06-07'),
  });

  const facts = resolveProjectWorkflowFacts(item);
  const result = resolveProjectStageReminder(item);

  assert.equal(facts.nodes.displayStarted, true);
  assert.equal(facts.nodes.displayEnded, false);
  assert.equal(result.currentStage.key, PROJECT_STAGE_KEYS.displayInProgress);
  assert.equal(result.primaryReminder.message, '等待摆场结束');
  assert.equal(result.primaryReminder.kind, 'stage_action');
  assert.equal(
    result.dataGaps.some((gap) => gap.key === 'softDoneStatusMissing'),
    true
  );
});

test('display file sent is the display completion fact and moves reminder to project closure', () => {
  const item = project({
    软装项目进度: raw('摆场'),
    软装完成情况: raw('准时完成'),
    摆场开始时间: raw('2026-06-07'),
    '摆场文件发出时间(项目群）': raw('2026-06-10'),
  });

  const result = resolveProjectStageReminder(item);

  assert.equal(result.facts.nodes.displayStarted, true);
  assert.equal(result.facts.nodes.displayEnded, true);
  assert.equal(result.currentStage.key, PROJECT_STAGE_KEYS.displayFinished);
  assert.equal(result.primaryReminder.message, '项目待闭环');
});

test('downstream display completion can expose missing upstream display start as a data gap without blocking stage', () => {
  const item = project({
    软装项目进度: raw('摆场'),
    '摆场文件发出时间(项目群）': raw('2026-06-10'),
  });

  const result = resolveProjectStageReminder(item);

  assert.equal(result.currentStage.key, PROJECT_STAGE_KEYS.displayFinished);
  assert.equal(result.primaryReminder.message, '项目待闭环');
  assert.equal(
    result.dataGaps.some((gap) => gap.key === 'displayStartMissing'),
    true
  );
});

test('purchase completion waits for display start instead of soft completion re-entry', () => {
  const item = project({
    软装项目进度: raw('待采购'),
    软装发项目群时间: raw('2026-05-15'),
    采购时间: raw('2026-05-22'),
    采购完成情况: raw('已完成'),
  });

  const result = resolveProjectStageReminder(item);

  assert.equal(result.currentStage.key, PROJECT_STAGE_KEYS.purchaseDone);
  assert.equal(result.primaryReminder.message, '待摆场');
  assert.equal(
    result.dataGaps.some((gap) => gap.key === 'softDoneStatusMissing'),
    true
  );
});

test('explicit unfinished soft completion status blocks soft completion unless downstream facts exist', () => {
  const item = project({
    软装项目进度: raw('软装方案中'),
    软装方案开始时间: raw('2026-05-08'),
    软装发项目群时间: raw('2026-05-15'),
    软装完成情况: raw('未完成'),
  });

  const result = resolveProjectStageReminder(item);

  assert.equal(result.currentStage.key, PROJECT_STAGE_KEYS.softInProgress);
  assert.equal(result.primaryReminder.message, '待软装完成情况');
});

test('downstream display facts keep upstream purchase and product list data gaps visible', () => {
  const item = project({
    软装项目进度: raw('摆场'),
    摆场开始时间: raw('2026-06-07'),
  });

  const result = resolveProjectStageReminder(item);
  const gapKeys = result.dataGaps.map((gap) => gap.key);

  assert.equal(result.primaryReminder.message, '等待摆场结束');
  assert.equal(gapKeys.includes('productListMissing'), true);
  assert.equal(gapKeys.includes('purchaseStatusMissing'), true);
});

test('paused, canceled and lifecycle closed statuses override downstream action reminders', () => {
  assert.equal(
    resolveProjectStageReminder(
      project({
        硬装项目进度: raw('暂停'),
        摆场开始时间: raw('2026-06-07'),
      })
    ).primaryReminder.message,
    '项目暂停中'
  );

  assert.equal(
    resolveProjectStageReminder(
      project({
        硬装项目进度: raw('取消'),
        摆场开始时间: raw('2026-06-07'),
      })
    ).primaryReminder.message,
    '项目已取消'
  );

  const closed = resolveProjectStageReminder(
    project({
      硬装项目进度: raw('闭环'),
      摆场开始时间: raw('2026-06-07'),
    })
  );
  assert.equal(closed.currentStage.key, PROJECT_STAGE_KEYS.closed);
  assert.equal(closed.primaryReminder.message, '项目已闭环');
});
