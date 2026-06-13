import assert from 'node:assert/strict';
import test from 'node:test';

import { findProjectInSnapshot, summarizeProject, summarizeProjects } from '../src/backend/projectPresentation.mjs';

test('summarizeProject omits raw fields from list payloads', () => {
  const project = summarizeProject({
    id: 'p1',
    name: 'Demo',
    hardProgressStage: 'Floor plan',
    softProgressStage: 'Display plan',
    rawFields: {
      StoreStatus: { display: 'Normal', kind: 'text' },
      EmptyField: { display: '   ', kind: 'text' },
      Note: { display: 'Ready', kind: 'text' },
    },
    recordMeta: { id: 'r1', createdTime: '2026-01-01', lastModifiedTime: '2026-02-01' },
  });

  assert.equal(Object.hasOwn(project, 'rawFields'), false);
  assert.equal(project.recordMeta.id, 'r1');
  assert.equal(project.recordMeta.createdTime, undefined);
  assert.ok(project.stageReminder);
  assert.ok(project.workflowFacts);
});

test('findProjectInSnapshot resolves by id or record meta id', () => {
  const projects = [{ id: 'local-1', recordMeta: { id: 'ding-1' }, name: 'A' }];
  assert.equal(findProjectInSnapshot(projects, 'local-1')?.name, 'A');
  assert.equal(findProjectInSnapshot(projects, 'ding-1')?.name, 'A');
  assert.equal(summarizeProjects(projects).length, 1);
});
