import assert from 'node:assert/strict';
import test from 'node:test';

import { filterProjects } from '../src/backend/projectData.mjs';
import { summarizeProjects } from '../src/backend/projectPresentation.mjs';

const sampleProjects = [
  {
    id: 'p1',
    name: 'Alpha',
    province: 'Zhejiang',
    businessType: 'Food',
    storeStatus: 'Normal',
    status: 'Healthy',
    owner: 'Owner A',
    rawFields: {
      StoreStatus: { display: 'Normal', kind: 'text' },
      EmptyField: { display: ' ', kind: 'text' },
    },
  },
  {
    id: 'p2',
    name: 'Beta',
    province: 'Shanghai',
    businessType: 'Retail',
    storeStatus: 'Flagship',
    status: 'Urgent',
    owner: 'Owner B',
    rawFields: { StoreStatus: { display: 'Flagship', kind: 'text' } },
  },
];

test('summary projects omit raw fields from list payloads', () => {
  const [first] = summarizeProjects(sampleProjects);
  assert.equal(Object.hasOwn(first, 'rawFields'), false);
  assert.equal(first.name, 'Alpha');
});

test('filterProjects ids payload shape matches drill contract', () => {
  const filtered = filterProjects(sampleProjects, { province: 'Zhejiang' });
  const payload = {
    ids: filtered.map((project) => project.id),
    total: filtered.length,
    readOnly: true,
  };
  assert.deepEqual(payload.ids, ['p1']);
  assert.equal(payload.total, 1);
});
