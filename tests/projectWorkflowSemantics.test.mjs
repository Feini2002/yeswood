import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCompanyLifecycleClosed,
  isCanceledProject,
  isPausedOrCanceledProject,
  isPausedProject,
  projectStageDisplayItems,
  projectWorkbenchStageRank,
  readProjectStage,
  readEffectiveWorkflowStage,
} from '../public/domain/project-workflow.mjs';
import { PROJECT_STAGE_KEYS } from '../public/domain/project-stage-reminder-rules.mjs';
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

test('frontend company lifecycle uses the same single-track closed rule as backend', () => {
  assert.equal(
    isCompanyLifecycleClosed(
      project({
        硬装项目进度: raw('闭环'),
        软装项目进度: raw('待采购'),
      })
    ),
    true
  );
  assert.equal(
    isCompanyLifecycleClosed(
      project({
        硬装项目进度: raw('施工图'),
        软装项目进度: raw('闭环'),
      })
    ),
    true
  );
  assert.equal(
    isCompanyLifecycleClosed(
      project({
        硬装项目进度: raw('完成'),
        软装项目进度: raw('已完成'),
      })
    ),
    false
  );
});

test('frontend pause filter only excludes projects that are currently paused', () => {
  assert.equal(isPausedProject(project({ 硬装项目进度: raw('暂停') })), true);
  assert.equal(isPausedProject(project({ 硬装项目进度: raw('暂停后恢复') })), false);
  assert.equal(isPausedProject(project({ 软装项目进度: raw('曾暂停，现待采购') })), false);
  assert.equal(isPausedProject(project({ 软装项目进度: raw('恢复后再次暂停') })), true);
});

test('frontend distinguishes canceled projects while grouping them with paused projects for lifecycle lanes', () => {
  const hardCanceled = project({
    硬装项目进度: raw('取消'),
    软装项目进度: raw('软装方案'),
  });
  const softCanceled = project({
    硬装项目进度: raw('施工图'),
    软装项目进度: raw('取消后恢复推进'),
  });

  assert.equal(isCanceledProject(hardCanceled), true);
  assert.equal(isCanceledProject(softCanceled), true);
  assert.equal(isPausedProject(hardCanceled), false);
  assert.equal(isPausedOrCanceledProject(hardCanceled), true);
  assert.deepEqual(classifyProjectLifecycleStage(hardCanceled), { key: 'paused', label: '暂停/取消' });
});

test('project stage display follows unified procurement facts over stale soft progress text', () => {
  const purchasing = project({
    软装项目进度: raw('待采购'),
    采购时间: raw('2026-05-22'),
  });
  const purchaseDone = project({
    软装项目进度: raw('待采购'),
    采购完成情况: raw('已完成'),
  });

  assert.equal(readEffectiveWorkflowStage(purchasing, 'soft'), '采购中');
  assert.equal(readEffectiveWorkflowStage(purchaseDone, 'soft'), '采购完成');
  assert.match(readProjectStage(purchasing), /软装：采购中/);
  assert.match(readProjectStage(purchaseDone), /软装：采购完成/);
  assert.deepEqual(projectStageDisplayItems(purchaseDone).map((item) => item.value), ['采购完成']);
});

test('project stage display uses unified downstream facts when soft progress is blank', () => {
  const productListReady = project({
    '流程记录：产品清单接收时间': raw('2026-05-22'),
  });
  const displayStarted = project({
    摆场开始时间: raw('2026-06-07'),
  });

  assert.equal(readEffectiveWorkflowStage(productListReady, 'soft'), '产品清单已接收');
  assert.equal(readEffectiveWorkflowStage(displayStarted, 'soft'), '摆场中');
  assert.match(readProjectStage(productListReady), /软装：产品清单已接收/);
  assert.match(readProjectStage(displayStarted), /软装：摆场中/);
});

test('project workbench sorting follows unified display facts over stale purchase text', () => {
  const blankKeyDate = { label: '', stage: '' };
  const stalePurchaseDisplayStarted = project({
    软装项目进度: raw('待采购'),
    摆场开始时间: raw('2026-06-07'),
  });
  const displayTextProject = project({
    软装项目进度: raw('摆场'),
  });
  const purchaseTextProject = project({
    软装项目进度: raw('待采购'),
  });

  assert.equal(
    projectWorkbenchStageRank(stalePurchaseDisplayStarted, blankKeyDate),
    projectWorkbenchStageRank(displayTextProject, blankKeyDate)
  );
  assert.equal(
    projectWorkbenchStageRank(stalePurchaseDisplayStarted, blankKeyDate) >
      projectWorkbenchStageRank(purchaseTextProject, blankKeyDate),
    true
  );
});

test('project key date keeps unified stage action before system hard deadline reminders', () => {
  const stageAction = {
    label: 'display-end',
    formatted: '--',
    message: 'wait-display-end',
    discipline: 'followup',
    kind: 'stage_action',
  };
  const item = {
    id: 'summary-with-system-deadline',
    stageReminder: {
      currentStage: { key: PROJECT_STAGE_KEYS.displayInProgress, label: 'display', rank: 880 },
      primaryReminder: stageAction,
      dataGaps: [],
      reminders: [stageAction],
    },
    primaryReminder: {
      discipline: 'hard',
      source: 'system_deadline',
      type: 'overdue',
      nodeKey: 'floorPlanFinish',
      label: 'hard-deadline',
      dueDate: '2026-06-20',
      title: 'Floor plan due',
      message: 'late',
    },
  };

  const reminders = resolveProjectKeyDateReminders(item);

  assert.equal(reminders[0].label, 'display-end');
  assert.equal(reminders[1].label, 'hard-deadline');
});

test('summary-only projects use stageReminder and workflowFacts to identify paused or canceled state', () => {
  const pausedSummary = {
    id: 'paused-summary',
    workflowFacts: { paused: true },
  };
  const canceledSummary = {
    id: 'canceled-summary',
    stageReminder: {
      currentStage: { key: PROJECT_STAGE_KEYS.canceled, label: 'canceled', rank: 1000 },
      primaryReminder: { label: 'canceled', formatted: '--', message: 'canceled', discipline: 'status', kind: 'status' },
      dataGaps: [],
      reminders: [],
    },
  };

  assert.equal(isPausedProject(pausedSummary), true);
  assert.equal(isPausedOrCanceledProject(pausedSummary), true);
  assert.equal(isCanceledProject(canceledSummary), true);
  assert.equal(isPausedOrCanceledProject(canceledSummary), true);
  assert.equal(projectStageDisplayItems(canceledSummary)[0].className, 'is-canceled');
});
