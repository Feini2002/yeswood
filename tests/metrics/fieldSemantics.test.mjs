import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasOpenDesignResponsibility,
  hasOpenHardDesignResponsibility,
  hasOpenPointDesignResponsibility,
  hasOpenSoftSchemeDesignResponsibility,
  hasOpenSoftDesignResponsibility,
  isHardDesignResponsibilityCompleted,
  isHardInProgress,
  isHardNotStarted,
  isDesignResponsibilityClosed,
  isOpenDelayed,
  isPriorityStatus,
  isProjectInProgress,
  isProjectNotStarted,
  isOpenPointDesignResponsibilityDelayed,
  isOpenSoftSchemeDesignResponsibilityDelayed,
  isPointDesignResponsibilityCompleted,
  isSchemeDelayed,
  isSoftProjectDesignStageCompleted,
  isSoftDesignResponsibilityCompleted,
  isSoftDesignClosed,
  isSoftSchemeDesignResponsibilityCompleted,
  isSoftNotStarted,
  isWorkflowClosed,
  readFranchiseScope,
  normalizePriorityStatus,
  readPriorityStatus,
  readRawDisplay,
  readStoreNatureKey,
  matchesStoreSegment,
  readStoreTier,
  readWorkflowStage,
} from '../../src/backend/metrics/fieldSemantics.mjs';

function sampleProject(overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    status: overrides.status || '一般',
    storeStatus: overrides.storeStatus || '常规店',
    dueDate: overrides.dueDate || '2026-12-01',
    isDelayed: overrides.isDelayed ?? false,
    rawFields: overrides.rawFields || {},
    ...overrides,
  };
}

test('readWorkflowStage reads hard and soft progress fields', () => {
  const project = sampleProject({
    rawFields: {
      硬装项目进度: { display: '施工图' },
      软装项目进度: { display: '摆场' },
    },
  });
  assert.equal(readWorkflowStage(project, { discipline: 'hard' }), '施工图');
  assert.equal(readWorkflowStage(project, { discipline: 'soft' }), '摆场');
});

test('readWorkflowStage does not treat numeric progress as a workflow stage', () => {
  assert.equal(readWorkflowStage(sampleProject({ progress: 0 }), { discipline: 'hard' }), '');
  assert.equal(readWorkflowStage(sampleProject({ progress: '75%' }), { discipline: 'hard' }), '');
  assert.equal(readWorkflowStage(sampleProject({ progress: '施工图' }), { discipline: 'hard' }), '施工图');
});

test('isWorkflowClosed uses soft workflow closed stages', () => {
  assert.equal(isWorkflowClosed(sampleProject({ rawFields: { 软装项目进度: { display: '闭环' } } })), true);
  assert.equal(isWorkflowClosed(sampleProject({ rawFields: { 软装项目进度: { display: '摆场' } } })), false);
});

test('soft completion status does not close follow-up workflow by itself', () => {
  const project = sampleProject({
    isDelayed: true,
    dueDate: '2020-01-01',
    rawFields: {
      硬装项目进度: { display: '闭环' },
      软装项目进度: { display: '待采购' },
      软装完成情况: { display: '准时完成' },
    },
  });

  assert.equal(isWorkflowClosed(project, { discipline: 'soft' }), false);
  assert.equal(isSoftDesignResponsibilityCompleted(project), false);
  assert.equal(isSoftDesignClosed(project), false);
  assert.equal(isDesignResponsibilityClosed(project), false);
  assert.equal(isOpenDelayed(project), false);
});

test('design responsibility completion is separate from company workflow closure', () => {
  const hardDesignDoneCompanyActive = sampleProject({
    rawFields: {
      硬装项目进度: { display: '施工图' },
      躺平内部审核结束时间: { display: '2026-05-12' },
      产品清单发出时间: { display: '2026-05-15' },
    },
  });
  const softDesignDoneCompanyActive = sampleProject({
    rawFields: {
      软装项目进度: { display: '待采购' },
      点位完成情况: { display: '已完成' },
      点位完成时间: { display: '2026-05-16' },
      软装方案开始时间: { display: '2026-05-18' },
      软装完成情况: { display: '延期完成' },
      采购完成情况: { display: '待采购' },
    },
  });
  const softDelayedInProgress = sampleProject({
    rawFields: {
      软装项目进度: { display: '软装方案中' },
      软装方案开始时间: { display: '2026-05-18' },
      软装完成情况: { display: '延期中' },
    },
  });
  const productListOnly = sampleProject({
    rawFields: {
      硬装项目进度: { display: '施工图' },
      躺平内部审核结束时间: { display: '2026-05-12' },
      产品清单发出时间: { display: '2026-05-15' },
      软装项目进度: { display: '点位清单' },
    },
  });
  const softStageTextOnly = sampleProject({
    rawFields: {
      软装项目进度: { display: '软装方案中' },
    },
  });

  assert.equal(isWorkflowClosed(hardDesignDoneCompanyActive, { discipline: 'hard' }), false);
  assert.equal(isHardDesignResponsibilityCompleted(hardDesignDoneCompanyActive), true);
  assert.equal(hasOpenHardDesignResponsibility(hardDesignDoneCompanyActive), false);
  assert.equal(hasOpenPointDesignResponsibility(hardDesignDoneCompanyActive), true);
  assert.equal(hasOpenDesignResponsibility(hardDesignDoneCompanyActive), true);

  assert.equal(isWorkflowClosed(softDesignDoneCompanyActive, { discipline: 'soft' }), false);
  assert.equal(isSoftDesignResponsibilityCompleted(softDesignDoneCompanyActive), true);
  assert.equal(hasOpenSoftDesignResponsibility(softDesignDoneCompanyActive), false);
  assert.equal(hasOpenDesignResponsibility(softDesignDoneCompanyActive), false);
  assert.equal(isOpenDelayed(softDesignDoneCompanyActive), false);

  assert.equal(isSoftDesignResponsibilityCompleted(softDelayedInProgress), false);
  assert.equal(hasOpenSoftDesignResponsibility(softDelayedInProgress), true);
  assert.equal(isOpenDelayed(softDelayedInProgress), true);

  assert.equal(hasOpenPointDesignResponsibility(productListOnly), true);
  assert.equal(hasOpenSoftDesignResponsibility(productListOnly), true);
  assert.equal(hasOpenDesignResponsibility(productListOnly), true);
  assert.equal(hasOpenSoftDesignResponsibility(softStageTextOnly), true);
});

test('hard design responsibility only spans floor plan start through internal review', () => {
  const constructionStageOnly = sampleProject({
    rawFields: {
      硬装项目进度: { display: '施工图' },
      软装项目进度: { display: '未开始' },
    },
  });
  const constructionOnly = sampleProject({
    rawFields: {
      硬装项目进度: { display: '施工图' },
      施工图初稿完成时间: { display: '2026-05-15' },
    },
  });
  const floorPlanStarted = sampleProject({
    rawFields: {
      硬装项目进度: { display: '平面方案' },
      平面开始时间: { display: '2026-05-01' },
    },
  });
  const floorPlanDone = sampleProject({
    rawFields: {
      硬装项目进度: { display: '施工图' },
      平面开始时间: { display: '2026-05-01' },
      躺平内部审核结束时间: { display: '2026-05-10' },
    },
  });

  assert.equal(hasOpenPointDesignResponsibility(constructionStageOnly), true);
  assert.equal(hasOpenDesignResponsibility(constructionStageOnly), true);
  assert.equal(isSoftNotStarted(constructionStageOnly), false);
  assert.equal(hasOpenHardDesignResponsibility(constructionOnly), false);
  assert.equal(hasOpenPointDesignResponsibility(constructionOnly), true);
  assert.equal(hasOpenDesignResponsibility(constructionOnly), true);
  assert.equal(isSoftNotStarted(constructionOnly), false);
  assert.equal(isProjectInProgress(constructionOnly), true);
  assert.equal(hasOpenHardDesignResponsibility(floorPlanStarted), true);
  assert.equal(isHardDesignResponsibilityCompleted(floorPlanDone), true);
  assert.equal(hasOpenHardDesignResponsibility(floorPlanDone), false);
});

test('soft personal responsibility separates point design from scheme design', () => {
  const pointOnlyDone = sampleProject({
    rawFields: {
      硬装项目进度: { display: '闭环' },
      软装项目进度: { display: '方案设计' },
      点位完成情况: { display: '已完成' },
      点位完成时间: { display: '2026-05-16' },
    },
  });
  const softSchemeOnlyDone = sampleProject({
    rawFields: {
      硬装项目进度: { display: '闭环' },
      软装项目进度: { display: '待采购' },
      软装方案开始时间: { display: '2026-05-18' },
      软装完成情况: { display: '准时完成' },
    },
  });
  const pointDelayed = sampleProject({
    rawFields: {
      硬装项目进度: { display: '闭环' },
      软装项目进度: { display: '点位设计' },
      点位完成情况: { display: '延期中' },
    },
  });
  const pointAndSchemeDone = sampleProject({
    rawFields: {
      硬装项目进度: { display: '闭环' },
      软装项目进度: { display: '待采购' },
      点位完成情况: { display: '已完成' },
      点位完成时间: { display: '2026-05-16' },
      软装方案开始时间: { display: '2026-05-18' },
      软装完成情况: { display: '准时完成' },
    },
  });

  assert.equal(isPointDesignResponsibilityCompleted(pointOnlyDone), true);
  assert.equal(hasOpenPointDesignResponsibility(pointOnlyDone), false);
  assert.equal(isSoftSchemeDesignResponsibilityCompleted(pointOnlyDone), false);
  assert.equal(isSoftProjectDesignStageCompleted(pointOnlyDone), false);
  assert.equal(hasOpenSoftDesignResponsibility(pointOnlyDone), true);

  assert.equal(isPointDesignResponsibilityCompleted(softSchemeOnlyDone), false);
  assert.equal(isSoftSchemeDesignResponsibilityCompleted(softSchemeOnlyDone), true);
  assert.equal(hasOpenSoftSchemeDesignResponsibility(softSchemeOnlyDone), false);
  assert.equal(isSoftProjectDesignStageCompleted(softSchemeOnlyDone), false);
  assert.equal(hasOpenSoftDesignResponsibility(softSchemeOnlyDone), true);

  assert.equal(hasOpenPointDesignResponsibility(pointDelayed), true);
  assert.equal(isOpenPointDesignResponsibilityDelayed(pointDelayed), true);
  assert.equal(isOpenSoftSchemeDesignResponsibilityDelayed(pointDelayed), false);

  assert.equal(isSoftDesignResponsibilityCompleted(softSchemeOnlyDone), false);
  assert.equal(isSoftDesignResponsibilityCompleted(pointAndSchemeDone), true);
  assert.equal(isSoftProjectDesignStageCompleted(pointAndSchemeDone), true);
  assert.equal(hasOpenSoftDesignResponsibility(pointAndSchemeDone), false);
});

test('floor plan handoff starts point design responsibility even when soft stage is not updated', () => {
  const handoffProject = sampleProject({
    rawFields: {
      硬装项目进度: { display: '平面躺平' },
      软装项目进度: { display: '未开始' },
      躺平内部审核结束时间: { display: '2026-05-12' },
    },
  });

  assert.equal(isPointDesignResponsibilityCompleted(handoffProject), false);
  assert.equal(hasOpenPointDesignResponsibility(handoffProject), true);
  assert.equal(hasOpenSoftDesignResponsibility(handoffProject), true);
  assert.equal(isSoftNotStarted(handoffProject), false);
  assert.equal(isProjectInProgress(handoffProject), true);
});

test('workflow closure does not complete design responsibility without responsibility fields', () => {
  const hardWorkflowClosedButSchemeDelayed = sampleProject({
    rawFields: {
      硬装项目进度: { display: '闭环' },
      平面开始时间: { display: '2026-05-01' },
      硬装方案情况: { display: '延期中' },
    },
  });
  const softWorkflowClosedButCompletionDelayed = sampleProject({
    rawFields: {
      硬装项目进度: { display: '闭环' },
      躺平内部审核结束时间: { display: '2026-05-12' },
      软装项目进度: { display: '闭环' },
      软装方案开始时间: { display: '2026-05-18' },
      软装完成情况: { display: '延期中' },
    },
  });
  const softWorkflowClosedButCompletionUnfinished = sampleProject({
    rawFields: {
      硬装项目进度: { display: '闭环' },
      躺平内部审核结束时间: { display: '2026-05-12' },
      软装项目进度: { display: '完成' },
      软装方案开始时间: { display: '2026-05-18' },
      软装完成情况: { display: '未完成' },
    },
  });

  assert.equal(isHardDesignResponsibilityCompleted(hardWorkflowClosedButSchemeDelayed), false);
  assert.equal(hasOpenHardDesignResponsibility(hardWorkflowClosedButSchemeDelayed), true);
  assert.equal(isOpenDelayed(hardWorkflowClosedButSchemeDelayed), true);
  assert.equal(isDesignResponsibilityClosed(hardWorkflowClosedButSchemeDelayed), false);

  assert.equal(isSoftDesignResponsibilityCompleted(softWorkflowClosedButCompletionDelayed), false);
  assert.equal(hasOpenSoftDesignResponsibility(softWorkflowClosedButCompletionDelayed), true);
  assert.equal(isOpenDelayed(softWorkflowClosedButCompletionDelayed), true);
  assert.equal(isDesignResponsibilityClosed(softWorkflowClosedButCompletionDelayed), false);

  assert.equal(isSoftDesignResponsibilityCompleted(softWorkflowClosedButCompletionUnfinished), false);
  assert.equal(hasOpenSoftDesignResponsibility(softWorkflowClosedButCompletionUnfinished), true);
  assert.equal(isOpenDelayed(softWorkflowClosedButCompletionUnfinished), false);
  assert.equal(isDesignResponsibilityClosed(softWorkflowClosedButCompletionUnfinished), false);
});

test('isPriorityStatus treats 项目状态 as priority not workflow', () => {
  const urgent = sampleProject({ status: '紧急', rawFields: { 项目状态: { display: '紧急' } } });
  const general = sampleProject({ status: '一般', rawFields: { 项目状态: { display: '一般' } } });
  assert.equal(isPriorityStatus(urgent), true);
  assert.equal(isPriorityStatus(general), true);
  assert.equal(readPriorityStatus(urgent), '紧急');
  assert.equal(readPriorityStatus(general), '一般');
});

test('normalizePriorityStatus maps legacy and empty values to 未设置', () => {
  assert.equal(normalizePriorityStatus(''), '未设置');
  assert.equal(normalizePriorityStatus('未分类'), '未设置');
  assert.equal(normalizePriorityStatus('推进中'), '未设置');
  assert.equal(normalizePriorityStatus('紧急'), '紧急');
  assert.equal(normalizePriorityStatus('一般'), '一般');
});

test('isHardNotStarted and isHardInProgress follow hard workflow rules', () => {
  const notStarted = sampleProject({ rawFields: { 硬装项目进度: { display: '未开始' } } });
  const paused = sampleProject({ rawFields: { 硬装项目进度: { display: '暂停' } } });
  const recoveredPaused = sampleProject({ rawFields: { 硬装项目进度: { display: '暂停后恢复，现施工图推进' } } });
  const rePaused = sampleProject({ rawFields: { 硬装项目进度: { display: '暂停后恢复又暂停' } } });
  const inProgress = sampleProject({ rawFields: { 硬装项目进度: { display: '施工图' } } });
  const meetingDone = sampleProject({ rawFields: { 硬装项目进度: { display: '完成上会' } } });

  assert.equal(isHardNotStarted(notStarted), true);
  assert.equal(isHardInProgress(notStarted), false);
  assert.equal(isHardInProgress(paused), false);
  assert.equal(isHardInProgress(recoveredPaused), true);
  assert.equal(isHardInProgress(rePaused), false);
  assert.equal(isHardInProgress(inProgress), true);
  assert.equal(isHardInProgress(meetingDone), true);
  assert.equal(isWorkflowClosed(meetingDone, { discipline: 'hard' }), false);
});

test('isSchemeDelayed only checks scheme field without isDelayed fallback', () => {
  const schemeDelayed = sampleProject({
    isDelayed: true,
    rawFields: { '硬装方案情况（每周五刷新）': { display: '延期完成' } },
  });
  const dueOnly = sampleProject({
    isDelayed: true,
    dueDate: '2020-01-01',
    rawFields: { '硬装方案情况（每周五刷新）': { display: '进行中' } },
  });

  assert.equal(isSchemeDelayed(schemeDelayed), true);
  assert.equal(isSchemeDelayed(dueOnly), false);
});

test('isOpenDelayed excludes management-date-only overdue and accepts explicit open delay', () => {
  const closedDelayed = sampleProject({
    isDelayed: true,
    dueDate: '2020-01-01',
    rawFields: {
      硬装项目进度: { display: '闭环' },
      躺平内部审核结束时间: { display: '2026-05-12' },
      软装项目进度: { display: '闭环' },
      软装完成情况: { display: '准时完成' },
      '硬装方案情况（每周五刷新）': { display: '延期' },
    },
  });
  const openDueDelayed = sampleProject({
    isDelayed: true,
    dueDate: '2020-01-01',
    rawFields: { 软装项目进度: { display: '摆场' } },
  });
  const openSchemeDelayed = sampleProject({
    rawFields: {
      软装项目进度: { display: '摆场' },
      平面开始时间: { display: '2026-05-01' },
      '硬装方案情况（每周五刷新）': { display: '延期' },
    },
  });
  const openSoftDelayed = sampleProject({
    rawFields: {
      软装项目进度: { display: '软装方案中' },
      软装完成情况: { display: '延期中' },
    },
  });

  assert.equal(isOpenDelayed(closedDelayed), false);
  assert.equal(isOpenDelayed(closedDelayed, { countClosedSchemeDelay: true }), false);
  assert.equal(isOpenDelayed(openDueDelayed), false);
  assert.equal(isOpenDelayed(openSchemeDelayed), true);
  assert.equal(isOpenDelayed(openSoftDelayed), true);
});

test('design responsibility closure overrides stale delay fields only when active tracks are closed', () => {
  const fullyClosed = sampleProject({
    isDelayed: true,
    dueDate: '2020-01-01',
    rawFields: {
      硬装项目进度: { display: '闭环' },
      躺平内部审核结束时间: { display: '2026-05-12' },
      软装项目进度: { display: '闭环' },
      点位完成情况: { display: '已完成' },
      点位完成时间: { display: '2026-05-16' },
      软装完成情况: { display: '延期完成' },
      '硬装方案情况（每周五刷新）': { display: '延期' },
    },
  });
  const softClosedHardActive = sampleProject({
    isDelayed: true,
    dueDate: '2020-01-01',
    rawFields: {
      硬装项目进度: { display: '施工图' },
      平面开始时间: { display: '2026-05-01' },
      软装项目进度: { display: '闭环' },
      '硬装方案情况（每周五刷新）': { display: '延期' },
    },
  });
  const hardOnlyClosed = sampleProject({
    isDelayed: true,
    dueDate: '2020-01-01',
    rawFields: {
      硬装项目进度: { display: '闭环' },
      平面开始时间: { display: '2026-05-01' },
      '硬装方案情况（每周五刷新）': { display: '延期' },
    },
  });
  const softDonePurchaseWaiting = sampleProject({
    isDelayed: true,
    dueDate: '2020-01-01',
    rawFields: {
      硬装项目进度: { display: '闭环' },
      软装项目进度: { display: '待采购' },
      软装完成情况: { display: '延期完成' },
    },
  });

  assert.equal(isDesignResponsibilityClosed(fullyClosed), true);
  assert.equal(isOpenDelayed(fullyClosed, { countClosedSchemeDelay: true }), false);
  assert.equal(isDesignResponsibilityClosed(softClosedHardActive), false);
  assert.equal(isOpenDelayed(softClosedHardActive, { countClosedSchemeDelay: true }), true);
  assert.equal(isDesignResponsibilityClosed(hardOnlyClosed), false);
  assert.equal(isOpenDelayed(hardOnlyClosed, { countClosedSchemeDelay: true }), true);
  assert.equal(isDesignResponsibilityClosed(softDonePurchaseWaiting), false);
  assert.equal(isOpenDelayed(softDonePurchaseWaiting, { countClosedSchemeDelay: true }), false);
});

test('sleep stores close at hard construction review and ignore soft workflow delay fields', () => {
  const sleepClosed = sampleProject({
    storeStatus: '睡眠店',
    rawFields: {
      店态: { display: '睡眠店' },
      硬装项目进度: { display: '（施工中）施工图完成审核' },
      软装项目进度: { display: '点位待跟进' },
      软装完成情况: { display: '延期中' },
    },
  });
  const sleepHardActive = sampleProject({
    storeStatus: '睡眠店',
    rawFields: {
      店态: { display: '睡眠店' },
      硬装项目进度: { display: '施工图' },
      软装项目进度: { display: '点位待跟进' },
      软装完成情况: { display: '延期中' },
    },
  });

  assert.equal(readWorkflowStage(sleepClosed, { discipline: 'soft' }), '');
  assert.equal(isDesignResponsibilityClosed(sleepClosed), true);
  assert.equal(isOpenDelayed(sleepClosed), false);
  assert.equal(isDesignResponsibilityClosed(sleepHardActive), false);
  assert.equal(isOpenDelayed(sleepHardActive), false);
});

test('readStoreNatureKey classifies 新店 and 老店 variants', () => {
  assert.equal(
    readStoreNatureKey(
      sampleProject({ rawFields: { 店铺性质: { display: '新店' } } })
    ),
    'newStore'
  );
  assert.equal(
    readStoreNatureKey(
      sampleProject({ rawFields: { 店铺性质: { display: '老店扩店' } } })
    ),
    'renovated'
  );
  assert.equal(
    matchesStoreSegment(
      sampleProject({
        rawFields: { 店铺性质: { display: '新店' }, 店态: { display: '常规店' } },
      }),
      'newStore-regular'
    ),
    true
  );
});

test('isProjectNotStarted requires both hard and soft not started', () => {
  const hardOnly = sampleProject({
    rawFields: {
      硬装项目进度: { display: '未开始' },
      软装项目进度: { display: '摆场' },
    },
  });
  const bothNotStarted = sampleProject({
    rawFields: {
      硬装项目进度: { display: '未开始' },
      软装项目进度: { display: '未开始' },
    },
  });
  const softPaused = sampleProject({
    rawFields: {
      硬装项目进度: { display: '未开始' },
      软装项目进度: { display: '暂停' },
    },
  });
  const softRecoveredPaused = sampleProject({
    rawFields: {
      硬装项目进度: { display: '未开始' },
      软装项目进度: { display: '暂停后恢复，现待采购' },
    },
  });
  const softRePaused = sampleProject({
    rawFields: {
      硬装项目进度: { display: '未开始' },
      软装项目进度: { display: '恢复后再次暂停' },
    },
  });

  assert.equal(isProjectNotStarted(hardOnly), false);
  assert.equal(isProjectNotStarted(bothNotStarted), true);
  assert.equal(isProjectNotStarted(softPaused), false);
  assert.equal(isProjectNotStarted(softPaused, { includeSoftPause: true }), true);
  assert.equal(isSoftNotStarted(softPaused, { includePause: true }), true);
  assert.equal(isProjectNotStarted(softRecoveredPaused, { includeSoftPause: true }), false);
  assert.equal(isSoftNotStarted(softRecoveredPaused, { includePause: true }), false);
  assert.equal(isProjectNotStarted(softRePaused, { includeSoftPause: true }), true);
});

test('isProjectInProgress is true when hard or soft is advancing', () => {
  const hardOnly = sampleProject({
    rawFields: {
      硬装项目进度: { display: '施工图' },
      软装项目进度: { display: '未开始' },
    },
  });
  const softOnly = sampleProject({
    rawFields: {
      硬装项目进度: { display: '未开始' },
      软装项目进度: { display: '待采购' },
    },
  });
  const neither = sampleProject({
    rawFields: {
      硬装项目进度: { display: '未开始' },
      软装项目进度: { display: '未开始' },
    },
  });
  const currentPaused = sampleProject({
    rawFields: {
      硬装项目进度: { display: '暂停' },
      软装项目进度: { display: '未开始' },
    },
  });
  const recoveredPaused = sampleProject({
    rawFields: {
      硬装项目进度: { display: '暂停后恢复，现施工图推进' },
      软装项目进度: { display: '未开始' },
    },
  });
  const rePaused = sampleProject({
    rawFields: {
      硬装项目进度: { display: '暂停后恢复又暂停' },
      软装项目进度: { display: '未开始' },
    },
  });

  assert.equal(isProjectInProgress(hardOnly), true);
  assert.equal(isProjectInProgress(softOnly), true);
  assert.equal(isProjectInProgress(neither), false);
  assert.equal(isProjectInProgress(currentPaused), false);
  assert.equal(isProjectInProgress(recoveredPaused), true);
  assert.equal(isProjectInProgress(rePaused), false);
});

test('readStoreTier and readFranchiseScope parse tier and scope fields', () => {
  const project = sampleProject({
    storeStatus: '常规店',
    rawFields: {
      店态: { display: '下沉店' },
      组别: { display: '加盟一组' },
    },
  });
  assert.equal(readStoreTier(project), 'sinking');
  assert.equal(readFranchiseScope(project), 'franchise');
  assert.equal(readRawDisplay(project, ['组别']), '加盟一组');
});

test('readRawDisplay does not match a different field through substring fallback', () => {
  const project = sampleProject({
    rawFields: {
      点位完成情况: { display: '未完成' },
    },
  });

  assert.equal(readRawDisplay(project, ['点位完成时间']), '');
});

test('readRawDisplay still matches exact and normalized-exact raw field names', () => {
  const project = sampleProject({
    rawFields: {
      ' 点位完成时间 ': { display: '2026-05-01' },
    },
  });

  assert.equal(readRawDisplay(project, ['点位完成时间']), '2026-05-01');
});

test('readRawDisplay supports direct string raw field values', () => {
  const pointDoneTimeField = '\u70b9\u4f4d\u5b8c\u6210\u65f6\u95f4';
  const project = sampleProject({
    rawFields: {
      [` ${pointDoneTimeField} `]: '2026-06-01',
    },
  });

  assert.equal(readRawDisplay(project, [pointDoneTimeField]), '2026-06-01');
});
