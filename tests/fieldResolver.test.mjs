import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_FIELD_RULES,
  normalizeFieldLabel,
  resolveFieldMap,
  scanSourceFieldKeys,
} from '../src/backend/fieldResolver.mjs';

const REALISTIC_KEYS = [
  '店态',
  '硬装方案情况（每周五刷新）',
  '点位完成情况',
  '项目名称（不要自己添加/删除任何项目）',
  '业态',
  '启动时间',
  '省份',
  '硬装项目进度',
  '软装项目进度',
  '负责人',
  '计划开业时间',
  '平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）',
  '组别',
  '店铺性质',
  '面积',
];

test('normalizeFieldLabel strips parenthetical remarks', () => {
  assert.equal(normalizeFieldLabel('项目名称（不要自己添加任何项目）'), '项目名称');
  assert.equal(normalizeFieldLabel('项目名称（不要自己添加/删除任何项目）'), '项目名称');
  assert.equal(normalizeFieldLabel('硬装方案情况（每周五刷新）'), '硬装方案情况');
  assert.equal(normalizeFieldLabel('  省份  '), '省份');
});

test('resolveFieldMap maps project name fields with varying parenthetical remarks', () => {
  for (const nameKey of [
    '项目名称（不要自己添加任何项目）',
    '项目名称（不要自己添加/删除任何项目）',
    '项目名称（管理员随便改备注）',
  ]) {
    const result = resolveFieldMap([nameKey, '省份', '业态', '店态', '负责人', '启动时间', '计划开业时间'], {});
    assert.equal(result.fieldMap.name, nameKey, `expected name binding for ${nameKey}`);
    assert.equal(result.unresolved.includes('name'), false);
  }
});

test('resolveFieldMap resolves realistic DingTalk field keys', () => {
  const result = resolveFieldMap(REALISTIC_KEYS, {});

  assert.equal(result.fieldMap.name, '项目名称（不要自己添加/删除任何项目）');
  assert.equal(result.fieldMap.province, '省份');
  assert.equal(result.fieldMap.businessType, '业态');
  assert.equal(result.fieldMap.storeStatus, '店态');
  assert.equal(result.fieldMap.owner, '负责人');
  assert.equal(result.fieldMap.progress, '硬装项目进度');
  assert.equal(result.fieldMap.startDate, '启动时间');
  assert.equal(result.fieldMap.dueDate, '计划开业时间');
  assert.notEqual(result.fieldMap.startDate, '平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）');
});

test('resolveFieldMap does not confuse hard and soft progress fields', () => {
  const result = resolveFieldMap(['硬装项目进度', '软装项目进度'], {});
  assert.equal(result.fieldMap.progress, '硬装项目进度');
});

test('resolveFieldMap prefers env exact mapping when the configured key exists', () => {
  const envFieldMap = {
    name: '项目名称（不要自己添加任何项目）',
    progress: '硬装项目进度',
  };
  const result = resolveFieldMap(
    ['项目名称（不要自己添加任何项目）', '项目名称（不要自己添加/删除任何项目）', '硬装项目进度'],
    { envFieldMap }
  );

  assert.equal(result.fieldMap.name, '项目名称（不要自己添加任何项目）');
  assert.ok(result.bindings.some((binding) => binding.canonicalKey === 'name' && binding.matchMethod === 'env'));
});

test('resolveFieldMap uses cached bindings when env key is stale but cache key still exists', () => {
  const result = resolveFieldMap(['项目名称（不要自己添加/删除任何项目）', '省份'], {
    envFieldMap: { name: '项目名称（旧备注已不存在）' },
    cachedBindings: [{ canonicalKey: 'name', sourceFieldKey: '项目名称（不要自己添加/删除任何项目）', matchMethod: 'cache' }],
  });

  assert.equal(result.fieldMap.name, '项目名称（不要自己添加/删除任何项目）');
});

test('resolveFieldMap reports ambiguous canonical fields instead of guessing', () => {
  const result = resolveFieldMap(['状态A', '状态B'], {
    envFieldMap: {},
  });

  assert.equal(result.fieldMap.status, undefined);
  assert.equal(result.ambiguous.some((item) => item.canonicalKey === 'status'), false);
});

test('scanSourceFieldKeys unions keys from all records', () => {
  const keys = scanSourceFieldKeys([
    { fields: { 省份: '浙江', 业态: 'mall' } },
    { fields: { 店态: '高标', 负责人: '张三' } },
  ]);

  assert.deepEqual(keys.sort(), ['业态', '店态', '省份', '负责人']);
});

test('CANONICAL_FIELD_RULES includes required standard keys', () => {
  assert.ok(CANONICAL_FIELD_RULES.name);
  assert.ok(CANONICAL_FIELD_RULES.progress);
  assert.ok(CANONICAL_FIELD_RULES.startDate);
});
