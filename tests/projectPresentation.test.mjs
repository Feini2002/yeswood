import assert from 'node:assert/strict';
import test from 'node:test';

import { findProjectInSnapshot, summarizeProject, summarizeProjects } from '../src/backend/projectPresentation.mjs';

test('summarizeProject keeps only list-critical raw fields in summary payloads', () => {
  const project = summarizeProject({
    id: 'p1',
    name: 'Demo',
    hardProgressStage: 'Floor plan',
    softProgressStage: 'Display plan',
    rawFields: {
      StoreStatus: { display: 'Normal', kind: 'text' },
      EmptyField: { display: '   ', kind: 'text' },
      CD组长: { display: '周丹阳', kind: 'array' },
      VM组长: { display: '张情', kind: 'array' },
      CD设计师: { display: '兰雨昕', kind: 'array' },
      VM设计师: { display: '陈燕玲', kind: 'array' },
      上会日期: { display: '2026-04-21', kind: 'date' },
      面积: { display: '306', kind: 'string' },
      Note: { display: 'Ready', kind: 'text' },
    },
    recordMeta: { id: 'r1', createdTime: '2026-01-01', lastModifiedTime: '2026-02-01' },
  });

  assert.deepEqual(Object.keys(project.rawFields).sort(), ['CD组长', 'CD设计师', 'VM组长', 'VM设计师', '上会日期', '面积'].sort());
  assert.equal(project.rawFields.CD组长.display, '周丹阳');
  assert.equal(project.rawFields.VM设计师.display, '陈燕玲');
  assert.equal(project.rawFields.Note, undefined);
  assert.equal(project.rawFields.StoreStatus, undefined);
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
