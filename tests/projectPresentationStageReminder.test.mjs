import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeProject } from '../src/backend/projectPresentation.mjs';
import { resolveProjectStageReminder } from '../public/domain/project-stage-reminder-rules.mjs';

function raw(display) {
  return { display };
}

test('summary project carries reusable stage reminder for display start', () => {
  const summary = summarizeProject({
    id: 'display-started',
    name: '摆场开始项目',
    rawFields: {
      软装项目进度: raw('待采购'),
      采购完成情况: raw('已完成'),
      摆场开始时间: raw('2026-06-07'),
    },
  });

  assert.equal(summary.stageReminder.currentStage.label, '摆场中');
  assert.equal(summary.stageReminder.primaryReminder.message, '等待摆场结束');

  const reused = resolveProjectStageReminder({
    id: summary.id,
    name: summary.name,
    stageReminder: summary.stageReminder,
  });
  assert.equal(reused.primaryReminder.message, '等待摆场结束');
});
