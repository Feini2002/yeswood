import test from 'node:test';
import assert from 'node:assert/strict';

import { readProjectOwnerNames } from '../src/backend/personnelNames.mjs';
import { aggregatePersonnelStatsFromProjects } from '../src/backend/responsibilityRepository.mjs';
import { resolveOwnerMonthlyProjects } from '../src/backend/metrics/projectScopes.mjs';

test('readProjectOwnerNames falls back to CD负责人 when 负责人 column is absent', () => {
  const project = {
    owner: '未分配',
    rawFields: {
      CD负责人: { display: '苏佳蕾' },
      VM负责人: { display: '张情' },
    },
  };
  assert.deepEqual(readProjectOwnerNames(project), ['苏佳蕾', '张情']);
});

test('readProjectOwnerNames includes SQL split owner fields without raw DingTalk fields', () => {
  const project = {
    owner: '未分配',
    cdOwner: '苏佳蕾',
    vmOwner: '张情',
    rawFields: {},
  };
  assert.deepEqual(readProjectOwnerNames(project), ['苏佳蕾', '张情']);
});

test('readProjectOwnerNames recognizes hard and soft owner Chinese aliases', () => {
  const project = {
    owner: '未分配',
    rawFields: {
      硬装负责人: { display: '苏佳蕾' },
      软装负责人: { display: '张情' },
    },
  };
  assert.deepEqual(readProjectOwnerNames(project), ['苏佳蕾', '张情']);
});

test('aggregatePersonnelStatsFromProjects splits CD and VM owner roles', () => {
  const stats = aggregatePersonnelStatsFromProjects([
    {
      id: '1',
      owner: '未分配',
      rawFields: { CD负责人: { display: '苏佳蕾' }, VM负责人: { display: '张情' } },
    },
  ]);
  const cdOwnerRole = stats.roles.find((role) => role.key === 'cdOwner');
  const vmOwnerRole = stats.roles.find((role) => role.key === 'vmOwner');

  assert.equal(stats.roles.some((role) => role.key === 'owner'), false);
  assert.equal(cdOwnerRole.label, '硬装负责人');
  assert.equal(cdOwnerRole.people.length, 1);
  assert.equal(cdOwnerRole.people[0].name, '苏佳蕾');
  assert.equal(vmOwnerRole.label, '软装负责人');
  assert.equal(vmOwnerRole.people.length, 1);
  assert.equal(vmOwnerRole.people[0].name, '张情');
});

test('resolveOwnerMonthlyProjects matches CD负责人 names', () => {
  const projects = [
    {
      id: '1',
      owner: '未分配',
      rawFields: { CD负责人: { display: '苏佳蕾' }, 店态: { display: '常规店' } },
    },
    { id: '2', owner: '未分配', rawFields: { CD负责人: { display: '其他人' } } },
  ];
  const scoped = resolveOwnerMonthlyProjects(projects, '苏佳蕾');
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].id, '1');
});

test('resolveOwnerMonthlyProjects matches SQL split owners but ignores lead-only matches', () => {
  const projects = [
    { id: 'hard-owner', owner: '未分配', cdOwner: '苏佳蕾', rawFields: { 店态: { display: '常规店' } } },
    { id: 'soft-owner', owner: '未分配', vmOwner: '苏佳蕾', rawFields: { 店态: { display: '常规店' } } },
    { id: 'lead-only', owner: '未分配', rawFields: { CD组长: { display: '苏佳蕾' }, 店态: { display: '常规店' } } },
  ];
  const scoped = resolveOwnerMonthlyProjects(projects, '苏佳蕾');
  assert.deepEqual(
    scoped.map((project) => project.id),
    ['hard-owner', 'soft-owner']
  );
});
