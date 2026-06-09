import assert from 'node:assert/strict';
import test from 'node:test';

import { matchSlotForFieldName } from '../../src/backend/responsibilitySlots.mjs';
import { filterProjectsByProfile } from '../../src/backend/metrics/scopes.mjs';
import { composeDashboardMetrics } from '../../src/backend/metrics/composeDashboard.mjs';
import { matchesStoreSegment, readFranchiseScope, readStoreNatureKey } from '../../src/backend/metrics/fieldSemantics.mjs';

function sampleProject(overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    owner: overrides.owner || '测试负责人',
    status: overrides.status || '一般',
    storeStatus: overrides.storeStatus || '常规店',
    rawFields: overrides.rawFields || {},
    ...overrides,
  };
}

test('filterProjectsByProfile scopes direct and franchise by 组别', () => {
  const projects = [
    sampleProject({ id: '1', rawFields: { 组别: { display: '直营华东' } } }),
    sampleProject({ id: '2', rawFields: { 组别: { display: '加盟一组' } } }),
    sampleProject({ id: '3', rawFields: { 组别: { display: '其他' } } }),
  ];

  assert.deepEqual(filterProjectsByProfile(projects, 'direct').map((item) => item.id), ['1']);
  assert.deepEqual(filterProjectsByProfile(projects, 'franchise').map((item) => item.id), ['2']);
  assert.equal(filterProjectsByProfile(projects, 'department').length, 3);
});

test('readStoreNatureKey and matchesStoreSegment split new/renovated by 店铺性质 and 店态', () => {
  const newRegular = sampleProject({
    id: 'nr',
    rawFields: {
      店铺性质: { display: '新店' },
      店态: { display: '常规店' },
    },
  });
  const renovatedSinking = sampleProject({
    id: 'rs',
    rawFields: {
      店铺性质: { display: '老店扩店' },
      店态: { display: '下沉店' },
    },
  });

  assert.equal(readStoreNatureKey(newRegular), 'newStore');
  assert.equal(readStoreNatureKey(renovatedSinking), 'renovated');
  assert.equal(matchesStoreSegment(newRegular, 'newStore-regular'), true);
  assert.equal(matchesStoreSegment(renovatedSinking, 'renovated-sinking'), true);
  assert.equal(matchesStoreSegment(newRegular, 'renovated-sinking'), false);
});

test('composeDashboardMetrics returns storeSegments for franchise profile', () => {
  const projects = [
    sampleProject({
      id: '1',
      rawFields: {
        组别: { display: '加盟新店' },
        店铺性质: { display: '新店' },
        店态: { display: '常规店' },
        硬装项目进度: { display: '未开始' },
      },
    }),
    sampleProject({
      id: '2',
      rawFields: {
        组别: { display: '加盟老店' },
        店铺性质: { display: '老店换址' },
        店态: { display: '下沉店' },
        硬装项目进度: { display: '施工图' },
        软装项目进度: { display: '摆场' },
        硬装方案情况: { display: '延期' },
      },
    }),
  ];

  const metrics = composeDashboardMetrics(projects, 'franchise');
  assert.equal(metrics.scopeCount, 2);
  assert.ok(metrics.storeSegments);
  assert.equal(metrics.storeSegments['newStore-regular'].projectCount, 1);
  assert.equal(metrics.storeSegments['renovated-sinking'].projectCount, 1);
});

test('composeDashboardMetrics returns tier blocks for department profile', () => {
  const projects = [
    sampleProject({
      id: '1',
      rawFields: { 店态: { display: '常规店' }, 硬装项目进度: { display: '未开始' }, 组别: { display: '加盟' } },
    }),
    sampleProject({
      id: '2',
      rawFields: {
        店态: { display: '下沉店' },
        硬装项目进度: { display: '施工图' },
        软装项目进度: { display: '待采购' },
        组别: { display: '加盟' },
      },
    }),
    sampleProject({
      id: '3',
      storeStatus: '高标店',
      rawFields: {
        店态: { display: '高标店' },
        硬装项目进度: { display: '施工图' },
        软装项目进度: { display: '施工图' },
        组别: { display: '直营' },
      },
    }),
    sampleProject({
      id: '4',
      storeStatus: '睡眠店',
      rawFields: {
        店态: { display: '睡眠店' },
        硬装项目进度: { display: '施工图' },
        软装项目进度: { display: '待采购' },
        组别: { display: '直营' },
      },
    }),
  ];

  const metrics = composeDashboardMetrics(projects, 'department');
  assert.equal(metrics.profile, 'department');
  assert.deepEqual(metrics.tierOrder, ['regular', 'sinking', 'premium', 'custom:睡眠店']);
  assert.equal(metrics.tiers.regular.notStarted, 1);
  assert.equal(metrics.tiers.sinking.inProgress, 1);
  assert.equal(metrics.tiers.premium.projectCount, 1);
  assert.equal(metrics.tierLabels['custom:睡眠店'], '睡眠店');
  assert.equal(metrics.tiers['custom:睡眠店'].projectCount, 1);
  assert.equal(metrics.totals.projectCount, 4);
  assert.ok(metrics.metricDefinitions.notStarted);
});

test('matchSlotForFieldName recognizes CD/VM 负责人 columns', () => {
  assert.equal(matchSlotForFieldName('CD负责人')?.slotKey, 'cd_owner');
  assert.equal(matchSlotForFieldName('VM负责人')?.slotKey, 'vm_owner');
  assert.equal(matchSlotForFieldName('硬装负责人')?.slotKey, 'cd_owner');
});

test('readFranchiseScope identifies direct stores', () => {
  const project = sampleProject({ rawFields: { 组别: { display: '直营设计组' } } });
  assert.equal(readFranchiseScope(project), 'direct');
});
