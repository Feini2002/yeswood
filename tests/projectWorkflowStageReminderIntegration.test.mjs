import assert from 'node:assert/strict';
import test from 'node:test';

import { readEffectiveWorkflowStage } from '../public/domain/project-workflow.mjs';
import { resolveProjectKeyDateReminders } from '../public/domain/project-reminders.mjs';
import { classifyProjectLifecycleStage } from '../public/dashboard/project-lifecycle.mjs';

function raw(display) {
  return { display };
}

function project(rawFields = {}, overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    name: overrides.name || '测试项目',
    storeStatus: overrides.storeStatus || '常规店',
    rawFields,
    ...overrides,
  };
}

test('frontend reminders and stages use display start as display in progress even when soft completion status is missing', () => {
  const displayStarted = project({
    硬装项目进度: raw('施工图完成审核'),
    软装项目进度: raw('摆场'),
    点位完成情况: raw('已完成'),
    点位完成时间: raw('2026-04-16'),
    软装方案开始时间: raw('2026-05-08'),
    软装发项目群时间: raw('2026-05-15'),
    采购时间: raw('2026-05-22'),
    采购完成情况: raw('已完成'),
    摆场开始时间: raw('2026-06-07'),
  });

  assert.equal(resolveProjectKeyDateReminders(displayStarted)[0].message, '等待摆场结束');
  assert.equal(readEffectiveWorkflowStage(displayStarted, 'soft'), '摆场中');
  assert.deepEqual(classifyProjectLifecycleStage(displayStarted), { key: 'site', label: '摆场交付' });
});

test('frontend reminders treat display file sent as display finished and prompt project closure', () => {
  const displayFinished = project({
    软装项目进度: raw('摆场'),
    '摆场文件发出时间(项目群）': raw('2026-06-10'),
  });

  assert.equal(resolveProjectKeyDateReminders(displayFinished)[0].message, '项目待闭环');
  assert.equal(readEffectiveWorkflowStage(displayFinished, 'soft'), '摆场结束');
  assert.deepEqual(classifyProjectLifecycleStage(displayFinished), { key: 'site', label: '摆场交付' });
});

test('lifecycle stage follows display start downstream fact even when workflow text still says purchase', () => {
  const displayStartedFromDate = project({
    软装项目进度: raw('待采购'),
    采购完成情况: raw('已完成'),
    摆场开始时间: raw('2026-06-07'),
  });

  assert.deepEqual(classifyProjectLifecycleStage(displayStartedFromDate), { key: 'site', label: '摆场交付' });
});

test('frontend reminders distinguish purchase start from purchase completion when progress text is stale', () => {
  const purchasing = project({
    软装项目进度: raw('待采购'),
    采购时间: raw('2026-05-22'),
  });
  const purchaseDone = project({
    软装项目进度: raw('待采购'),
    采购完成情况: raw('已完成'),
  });

  assert.equal(resolveProjectKeyDateReminders(purchasing)[0].message, '待采购完成');
  assert.equal(resolveProjectKeyDateReminders(purchaseDone)[0].message, '待摆场');
  assert.deepEqual(classifyProjectLifecycleStage(purchasing), { key: 'purchase', label: '采购推进' });
  assert.deepEqual(classifyProjectLifecycleStage(purchaseDone), { key: 'purchase', label: '采购推进' });
});
