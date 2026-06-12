import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCompanyLifecycleClosed,
  isCanceledProject,
  isPausedOrCanceledProject,
  isPausedProject,
} from '../public/domain/project-workflow.mjs';
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
