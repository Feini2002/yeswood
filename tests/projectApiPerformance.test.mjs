import assert from 'node:assert/strict';
import test from 'node:test';

import { filterProjects } from '../src/backend/projectData.mjs';
import { summarizeProjects } from '../src/backend/projectPresentation.mjs';

const sampleProjects = [
  {
    id: 'p1',
    name: 'Alpha',
    province: '浙江',
    businessType: '餐饮',
    storeStatus: '常规店',
    status: '正常',
    owner: 'Owner A',
    rawFields: { 店态: { display: '常规店', kind: 'text' }, 空字段: { display: ' ', kind: 'text' } },
  },
  {
    id: 'p2',
    name: 'Beta',
    province: '上海',
    businessType: '零售',
    storeStatus: '旗舰店',
    status: '紧急',
    owner: 'Owner B',
    rawFields: { 店态: { display: '旗舰店', kind: 'text' } },
  },
];

test('summary projects drop empty raw fields', () => {
  const [first] = summarizeProjects(sampleProjects);
  assert.equal(Object.keys(first.rawFields).length, 1);
  assert.equal(first.rawFields['店态'].display, '常规店');
});

test('filterProjects ids payload shape matches drill contract', () => {
  const filtered = filterProjects(sampleProjects, { province: '浙江' });
  const payload = {
    ids: filtered.map((project) => project.id),
    total: filtered.length,
    readOnly: true,
  };
  assert.deepEqual(payload.ids, ['p1']);
  assert.equal(payload.total, 1);
});
