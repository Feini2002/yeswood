import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDisplayCompletionState } from '../src/backend/metrics/workCompletionSemantics.mjs';

function raw(display) {
  return { display };
}

function project(rawFields = {}, overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    name: overrides.name || '测试项目',
    status: overrides.status || '推进中',
    storeStatus: overrides.storeStatus || '常规店',
    rawFields,
    ...overrides,
  };
}

test('display start time marks display metric as in progress before display file is sent', () => {
  const state = resolveDisplayCompletionState(
    project({
      摆场开始时间: raw('2026-06-07'),
    })
  );

  assert.equal(state.completed, false);
  assert.equal(state.inProgress, true);
  assert.equal(state.state, 'inProgress');
});

test('display file sent date marks display metric as completed even without display start time', () => {
  const state = resolveDisplayCompletionState(
    project({
      '摆场文件发出时间(项目群）': raw('2026-06-10'),
    })
  );

  assert.equal(state.completed, true);
  assert.equal(state.inProgress, false);
  assert.equal(state.completedAt, '2026-06-10');
});
