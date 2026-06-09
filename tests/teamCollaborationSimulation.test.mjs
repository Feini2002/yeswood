import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTeamCollaborationSimulation } from '../src/backend/agents/teamCollaborationSimulationAgent.mjs';

test('buildTeamCollaborationSimulation ranks collaborators and returns scheduling advice', () => {
  const result = buildTeamCollaborationSimulation({
    owner: '苏佳蕾',
    dashboardContext: 'all',
    leadLoad: [
      { name: '张倩', displayName: '张倩', roleLabel: '软装组长', value: 9, delayed: 2, highRisk: 1 },
      { name: '李爽', displayName: '李爽', roleLabel: '软装组长', value: 2, delayed: 0, highRisk: 0 },
    ],
    weightedLeadLoad: [
      { name: '张倩', displayName: '张倩', roleLabel: '软装组长', value: 9, weightedWorkload: 84, workdays: 184.8, avgScore: 62, delayed: 2, highRisk: 1 },
      { name: '李爽', displayName: '李爽', roleLabel: '软装组长', value: 2, weightedWorkload: 12, workdays: 26.4, avgScore: 24, delayed: 0, highRisk: 0 },
    ],
  });

  assert.equal(result.channel, 'teamCollaboration');
  assert.equal(result.agentName, '小组协作负载 Agent');
  assert.equal(result.modelName, 'deterministic-js');
  assert.ok(result.promptHash);
  assert.equal(result.analysisScope.scopeKey, 'all:苏佳蕾:teamCollaboration');
  assert.equal(result.status, 'ready');
  assert.equal(result.ranking[0].name, '张倩');
  assert.equal(result.ranking[0].status, 'overloaded');
  assert.equal(result.groups.available[0].name, '李爽');
  assert.ok(result.recommendations.some((item) => /新增|延期|高风险/.test(item.action)));
});

test('buildTeamCollaborationSimulation degrades gracefully without weighted workload', () => {
  const result = buildTeamCollaborationSimulation({
    leadLoad: [{ name: '陈菲菲', roleLabel: '硬装组长', value: 3 }],
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.summary.confidence, 'medium');
  assert.match(result.limitations.join(''), /项目数量口径/);
});
