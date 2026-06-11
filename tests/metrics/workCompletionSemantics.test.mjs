import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCompanyLifecycleClosed,
  resolveCompanyLifecycleState,
  resolveDisplayCompletionState,
  resolveFloorPlanCompletionState,
} from '../../src/backend/metrics/workCompletionSemantics.mjs';

function raw(display) {
  return { display };
}

function project(overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    name: overrides.name || '测试项目',
    status: overrides.status || '推进中',
    storeStatus: overrides.storeStatus || '常规店',
    dueDate: overrides.dueDate || '2026-12-01',
    updatedAt: overrides.updatedAt || '2026-06-30T00:00:00.000Z',
    rawFields: overrides.rawFields || {},
    ...overrides,
  };
}

test('isCompanyLifecycleClosed requires hard and soft workflow closure for normal projects', () => {
  const fullyClosed = project({
    rawFields: {
      硬装项目进度: raw('闭环'),
      软装项目进度: raw('闭环'),
    },
  });
  const softStillPurchasing = project({
    rawFields: {
      硬装项目进度: raw('闭环'),
      软装项目进度: raw('待采购'),
      点位完成情况: raw('已完成'),
      点位完成时间: raw('2026-05-16'),
      软装完成情况: raw('准时完成'),
    },
  });
  const broadDoneTextIsNotLifecycleClosure = project({
    rawFields: {
      硬装项目进度: raw('完成'),
      软装项目进度: raw('已完成'),
    },
  });

  assert.equal(isCompanyLifecycleClosed(fullyClosed), true);
  assert.equal(isCompanyLifecycleClosed(softStillPurchasing), false);
  assert.equal(isCompanyLifecycleClosed(broadDoneTextIsNotLifecycleClosure), false);
});

test('isCompanyLifecycleClosed closes sleep stores from hard closure only', () => {
  const sleepClosed = project({
    name: '源氏木语睡眠店',
    storeStatus: '睡眠店',
    rawFields: {
      硬装项目进度: raw('施工闭环'),
      软装项目进度: raw('点位待跟进'),
    },
  });
  const normalHardOnly = project({
    rawFields: {
      硬装项目进度: raw('闭环'),
      软装项目进度: raw('点位待跟进'),
    },
  });

  assert.equal(isCompanyLifecycleClosed(sleepClosed), true);
  assert.equal(isCompanyLifecycleClosed(normalHardOnly), false);
});

test('design responsibility completion alone does not close company lifecycle', () => {
  const responsibilityClosedOnly = project({
    rawFields: {
      硬装项目进度: raw('施工图'),
      软装项目进度: raw('点位已完成'),
      硬装方案情况: raw('准时完成'),
      点位完成情况: raw('准时完成'),
      软装完成情况: raw('准时完成'),
    },
  });

  const state = resolveCompanyLifecycleState(responsibilityClosedOnly);

  assert.equal(isCompanyLifecycleClosed(responsibilityClosedOnly), false);
  assert.equal(state.completed, false);
  assert.equal(state.inProgress, true);
});

test('display completion is not inferred from lifecycle closure', () => {
  const lifecycleClosedWithoutDisplayEvidence = project({
    rawFields: {
      硬装项目进度: raw('闭环'),
      软装项目进度: raw('闭环'),
    },
  });

  const state = resolveDisplayCompletionState(lifecycleClosedWithoutDisplayEvidence);

  assert.equal(state.completed, false);
  assert.equal(state.inProgress, false);
  assert.equal(state.state, 'none');
});

test('display active completed and missing-date states are separate', () => {
  const activeDisplay = project({
    rawFields: {
      软装项目进度: raw('摆场'),
    },
  });
  const completedWithoutDate = project({
    rawFields: {
      点位完成情况: raw('准时完成'),
    },
  });
  const completedWithDate = project({
    rawFields: {
      点位完成情况: raw('准时完成'),
      点位完成时间: raw('2026-05-09'),
    },
  });

  assert.deepEqual(
    {
      completed: resolveDisplayCompletionState(activeDisplay).completed,
      inProgress: resolveDisplayCompletionState(activeDisplay).inProgress,
      missingDate: resolveDisplayCompletionState(activeDisplay).missingDate,
    },
    { completed: false, inProgress: true, missingDate: false }
  );
  assert.deepEqual(
    {
      completed: resolveDisplayCompletionState(completedWithoutDate).completed,
      inProgress: resolveDisplayCompletionState(completedWithoutDate).inProgress,
      missingDate: resolveDisplayCompletionState(completedWithoutDate).missingDate,
    },
    { completed: true, inProgress: false, missingDate: true }
  );
  assert.deepEqual(
    {
      completed: resolveDisplayCompletionState(completedWithDate).completed,
      completedAt: resolveDisplayCompletionState(completedWithDate).completedAt,
      missingDate: resolveDisplayCompletionState(completedWithDate).missingDate,
    },
    { completed: true, completedAt: '2026-05-09', missingDate: false }
  );
});

test('floor plan completed without date increments missingDate', () => {
  const completedWithoutDate = project({
    rawFields: {
      硬装方案情况: raw('延期完成'),
    },
  });
  const completedWithDate = project({
    rawFields: {
      硬装方案情况: raw('准时完成'),
      躺平内部审核结束时间: raw('2026-04-22'),
    },
  });

  assert.deepEqual(
    {
      completed: resolveFloorPlanCompletionState(completedWithoutDate).completed,
      missingDate: resolveFloorPlanCompletionState(completedWithoutDate).missingDate,
      completedAt: resolveFloorPlanCompletionState(completedWithoutDate).completedAt,
    },
    { completed: true, missingDate: true, completedAt: '' }
  );
  assert.deepEqual(
    {
      completed: resolveFloorPlanCompletionState(completedWithDate).completed,
      missingDate: resolveFloorPlanCompletionState(completedWithDate).missingDate,
      completedAt: resolveFloorPlanCompletionState(completedWithDate).completedAt,
    },
    { completed: true, missingDate: false, completedAt: '2026-04-22' }
  );
});

test('company lifecycle completion does not require or track closure dates', () => {
  const closedWithoutClosureDate = project({
    rawFields: {
      硬装项目进度: raw('闭环'),
      软装项目进度: raw('闭环'),
      项目闭环时间: raw('2026-06-15'),
    },
  });

  const state = resolveCompanyLifecycleState(closedWithoutClosureDate);

  assert.equal(state.completed, true);
  assert.equal(state.inProgress, false);
  assert.equal(state.missingDate, false);
  assert.equal(state.completedAt, '');
});

test('not-started stopped and discarded projects are not counted as in progress', () => {
  const notStarted = project({
    rawFields: {
      硬装方案情况: raw('未开始'),
      硬装项目进度: raw('未开始'),
      软装项目进度: raw('未安排摆场'),
    },
  });
  const stopped = project({
    rawFields: {
      硬装方案情况: raw('推进中'),
      硬装项目进度: raw('施工图'),
      软装项目进度: raw('摆场'),
      状态: raw('停止'),
    },
  });
  const discarded = project({
    rawFields: {
      硬装项目进度: raw('施工图'),
      项目状态: raw('废弃'),
    },
  });

  assert.equal(resolveFloorPlanCompletionState(notStarted).inProgress, false);
  assert.equal(resolveDisplayCompletionState(notStarted).inProgress, false);
  assert.equal(resolveCompanyLifecycleState(notStarted).inProgress, false);
  assert.equal(resolveFloorPlanCompletionState(stopped).inProgress, false);
  assert.equal(resolveDisplayCompletionState(stopped).inProgress, false);
  assert.equal(resolveCompanyLifecycleState(discarded).inProgress, false);
});
