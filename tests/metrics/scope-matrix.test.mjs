import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inferOwnerDashboardContext,
  resolveCanonicalOwner,
  resolveOwnerMonthlyProjects,
} from '../../src/backend/metrics/projectScopes.mjs';
import { expandOwnerNames } from '../../src/backend/responsibilityRepository.mjs';
import { filterProjectsByProfile } from '../../src/backend/metrics/scopes.mjs';

const projects = [
  {
    id: '1',
    owner: 'Jarvan范嘉瑞',
    rawFields: { 负责人: { display: 'Jarvan范嘉瑞' }, 组别: { display: '加盟' }, 店态: { display: '常规店' } },
  },
  {
    id: '2',
    owner: 'Jarvan范嘉瑞',
    rawFields: { 负责人: { display: 'Jarvan范嘉瑞' }, 组别: { display: '直营' }, 店态: { display: '常规店' } },
  },
  {
    id: '3',
    owner: '苏佳蕾',
    rawFields: { 负责人: { display: '苏佳蕾' }, 组别: { display: '加盟' }, 店态: { display: '常规店' } },
  },
];

test('ownerMonthly franchise scope only includes franchise owner projects', () => {
  const scoped = resolveOwnerMonthlyProjects(projects, 'Jarvan范嘉瑞', { dashboardContext: 'franchise' });
  assert.deepEqual(scoped.map((project) => project.id), ['1']);
});

test('inferOwnerDashboardContext picks direct when owner projects are mostly direct', () => {
  const directOwnerProjects = [
    {
      id: 'd1',
      rawFields: { 负责人: { display: '张嫚烔' }, 组别: { display: '直营新店' } },
    },
    {
      id: 'd2',
      rawFields: { 负责人: { display: '张嫚烔' }, 组别: { display: '直营老店' } },
    },
    {
      id: 'f1',
      rawFields: { 负责人: { display: '张嫚烔' }, 组别: { display: '加盟' } },
    },
  ];
  assert.equal(inferOwnerDashboardContext(directOwnerProjects, '张嫚烔'), 'direct');
  assert.equal(inferOwnerDashboardContext(directOwnerProjects, '张嫚炯', {
    personnelArchitecture: { people: { 张嫚烔: { name: '张嫚烔', aliases: ['张嫚炯'] } } },
  }), 'direct');
});

test('expandOwnerNames maps common owner spelling alias 炯 to 烔', () => {
  const architecture = { people: { 张嫚烔: { name: '张嫚烔', aliases: ['张嫚炯'] } } };
  const names = expandOwnerNames('张嫚炯', architecture);
  assert.ok(names.has('张嫚烔'));
  assert.equal(resolveCanonicalOwner('张嫚炯', architecture), '张嫚烔');
});

test('filterProjectsForTeam deprecated path uses owner column only', () => {
  const team = { owner: 'Jarvan范嘉瑞', cdLeads: ['某人'], vmLeads: ['另一人'] };
  const scoped = filterProjectsByProfile(projects, 'ownerMonthly', {
    team,
    owner: team.owner,
    dashboardContext: 'all',
  });
  assert.equal(scoped.length, 2);
});
