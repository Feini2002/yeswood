import assert from 'node:assert/strict';
import test from 'node:test';

import { compactProjectForDetailReadModel } from '../src/backend/projectDetailPayload.mjs';

function raw(display) {
  return { display };
}

test('detail read model includes unified stage reminder beside raw display fields', () => {
  const detail = compactProjectForDetailReadModel({
    id: 'display-started',
    name: '摆场开始项目',
    rawFields: {
      摆场开始时间: raw('2026-06-07'),
    },
  });

  assert.equal(detail.rawFields.摆场开始时间.display, '2026-06-07');
  assert.equal(detail.stageReminder.currentStage.label, '摆场中');
  assert.equal(detail.stageReminder.primaryReminder.message, '等待摆场结束');
  assert.equal(detail.stageReminder.dataGapCount, 3);
  assert.equal(detail.workflowFacts.displayStarted, true);
  assert.equal(detail.workflowFacts.displayStartedAt, '2026-06-07');
  assert.equal(detail.workflowFacts.displayEnded, false);
});
