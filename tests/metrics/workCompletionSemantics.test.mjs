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

test('isCompanyLifecycleClosed accepts either hard or soft workflow closure for normal projects', () => {
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
  assert.equal(isCompanyLifecycleClosed(softStillPurchasing), true);
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
  assert.equal(isCompanyLifecycleClosed(normalHardOnly), true);
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

test('display completion uses display file sent date while active stage uses either workflow track', () => {
  const activeHardDisplay = project({
    rawFields: {
      硬装项目进度: raw('摆场'),
      软装项目进度: raw('未安排摆场'),
    },
  });
  const activeSoftDisplay = project({
    rawFields: {
      软装项目进度: raw('摆场'),
    },
  });
  const pointDoneOnly = project({
    rawFields: {
      点位完成情况: raw('准时完成'),
      点位完成时间: raw('2026-05-09'),
    },
  });
  const completedWithDisplayFile = project({
    rawFields: {
      软装项目进度: raw('摆场'),
      '摆场文件发出时间(项目群）': raw('2026-05-18'),
    },
  });

  assert.deepEqual(
    {
      completed: resolveDisplayCompletionState(activeHardDisplay).completed,
      inProgress: resolveDisplayCompletionState(activeHardDisplay).inProgress,
      missingDate: resolveDisplayCompletionState(activeHardDisplay).missingDate,
    },
    { completed: false, inProgress: true, missingDate: false }
  );
  assert.deepEqual(
    {
      completed: resolveDisplayCompletionState(activeSoftDisplay).completed,
      inProgress: resolveDisplayCompletionState(activeSoftDisplay).inProgress,
      missingDate: resolveDisplayCompletionState(activeSoftDisplay).missingDate,
    },
    { completed: false, inProgress: true, missingDate: false }
  );
  assert.deepEqual(
    {
      completed: resolveDisplayCompletionState(pointDoneOnly).completed,
      inProgress: resolveDisplayCompletionState(pointDoneOnly).inProgress,
      state: resolveDisplayCompletionState(pointDoneOnly).state,
    },
    { completed: false, inProgress: false, state: 'none' }
  );
  assert.deepEqual(
    {
      completed: resolveDisplayCompletionState(completedWithDisplayFile).completed,
      completedAt: resolveDisplayCompletionState(completedWithDisplayFile).completedAt,
      missingDate: resolveDisplayCompletionState(completedWithDisplayFile).missingDate,
    },
    { completed: true, completedAt: '2026-05-18', missingDate: false }
  );
});

test('floor plan follows flat start and tap audit end dates only', () => {
  const startedOnly = project({
    rawFields: {
      '平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）': raw('2026-05-08'),
    },
  });
  const completedWithAuditEnd = project({
    rawFields: {
      '平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）': raw('2026-05-08'),
      躺平内部审核结束时间: raw('2026-04-22'),
    },
  });
  const statusOnly = project({
    rawFields: {
      硬装方案情况: raw('延期完成'),
    },
  });

  assert.deepEqual(
    {
      completed: resolveFloorPlanCompletionState(startedOnly).completed,
      inProgress: resolveFloorPlanCompletionState(startedOnly).inProgress,
      missingDate: resolveFloorPlanCompletionState(startedOnly).missingDate,
    },
    { completed: false, inProgress: true, missingDate: false }
  );
  assert.deepEqual(
    {
      completed: resolveFloorPlanCompletionState(completedWithAuditEnd).completed,
      missingDate: resolveFloorPlanCompletionState(completedWithAuditEnd).missingDate,
      completedAt: resolveFloorPlanCompletionState(completedWithAuditEnd).completedAt,
    },
    { completed: true, missingDate: false, completedAt: '2026-04-22' }
  );
  assert.equal(resolveFloorPlanCompletionState(statusOnly).state, 'none');
});

test('company lifecycle completion date is meeting date plus closure cycle', () => {
  const closedWithCycle = project({
    rawFields: {
      硬装项目进度: raw('闭环'),
      软装项目进度: raw('待采购'),
      上会日期: raw('2026-05-20'),
      闭环周期: raw('12'),
    },
  });
  const closedWithoutCycle = project({
    rawFields: {
      硬装项目进度: raw('摆场'),
      软装项目进度: raw('闭环'),
      上会日期: raw('2026-05-20'),
    },
  });

  const state = resolveCompanyLifecycleState(closedWithCycle);
  const missingDateState = resolveCompanyLifecycleState(closedWithoutCycle);

  assert.equal(state.completed, true);
  assert.equal(state.inProgress, false);
  assert.equal(state.completedAt, '2026-06-01');
  assert.equal(state.missingDate, false);
  assert.equal(missingDateState.completed, true);
  assert.equal(missingDateState.completedAt, '');
  assert.equal(missingDateState.missingDate, true);
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
