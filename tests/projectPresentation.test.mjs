import assert from 'node:assert/strict';
import test from 'node:test';

import { findProjectInSnapshot, summarizeProject, summarizeProjects } from '../src/backend/projectPresentation.mjs';

test('summarizeProject keeps non-empty raw fields only', () => {
  const project = summarizeProject({
    id: 'p1',
    name: 'Demo',
    rawFields: {
      店态: { display: '常规店', kind: 'text' },
      空字段: { display: '   ', kind: 'text' },
      备注: { display: '有内容', kind: 'text' },
    },
    recordMeta: { id: 'r1', createdTime: '2026-01-01', lastModifiedTime: '2026-02-01' },
  });

  assert.equal(Object.keys(project.rawFields).length, 2);
  assert.equal(project.rawFields['店态'].display, '常规店');
  assert.equal(project.recordMeta.id, 'r1');
  assert.equal(project.recordMeta.createdTime, undefined);
});

test('findProjectInSnapshot resolves by id or record meta id', () => {
  const projects = [{ id: 'local-1', recordMeta: { id: 'ding-1' }, name: 'A' }];
  assert.equal(findProjectInSnapshot(projects, 'local-1')?.name, 'A');
  assert.equal(findProjectInSnapshot(projects, 'ding-1')?.name, 'A');
  assert.equal(summarizeProjects(projects).length, 1);
});
