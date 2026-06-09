import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDepartmentOperationsAnalysis } from '../src/backend/agents/departmentOperationsAgent.mjs';

function ownerMetrics({
  owner,
  pressureScore,
  peakPressureScore = pressureScore,
  activeProjects,
  delayedProjects = 0,
  highRiskProjects = 0,
  workload,
  highDifficultyCount = 0,
  overloadedCount = 0,
  availableCount = 0,
  entryCoverage = 100,
} = {}) {
  return {
    owner,
    displayName: owner,
    dashboardContext: 'all',
    summary: {
      activeProjects,
      delayedProjects,
      highRiskProjects,
    },
    monthlyEntry: {
      pressureByMonth: [
        {
          label: '2026-06',
          pressureScore,
          pressureLevel: pressureScore >= 80 ? '高压' : pressureScore >= 60 ? '预警' : '低压',
          totalEntryCount: Math.max(1, Math.round(pressureScore / 20)),
          newStoreCount: Math.max(0, Math.round(pressureScore / 30)),
          oldStoreCount: Math.max(0, Math.round(pressureScore / 45)),
        },
        {
          label: '2026-04',
          pressureScore: peakPressureScore,
          pressureLevel: peakPressureScore >= 80 ? '高压' : '预警',
          totalEntryCount: Math.max(1, Math.round(peakPressureScore / 18)),
        },
      ],
    },
    difficultySummary: {
      responsibleWeightedWorkload: workload,
      highDifficultyCount,
    },
    fieldCoverage: {
      entryDate: entryCoverage,
    },
    collaborationSimulation: {
      facts: {
        overloadedCount,
        availableCount,
      },
    },
  };
}

test('department operations analysis compares one team with the department and recommends intake stance', () => {
  const result = buildDepartmentOperationsAnalysis({
    dashboardContext: 'all',
    currentOwner: '王吉祥',
    metricsByOwner: {
      王吉祥: ownerMetrics({
        owner: '王吉祥',
        pressureScore: 82,
        peakPressureScore: 95,
        activeProjects: 20,
        delayedProjects: 4,
        highRiskProjects: 1,
        workload: 120,
        highDifficultyCount: 5,
        overloadedCount: 2,
      }),
      苏佳蕾: ownerMetrics({
        owner: '苏佳蕾',
        pressureScore: 32,
        activeProjects: 8,
        workload: 38,
        availableCount: 2,
      }),
      杨锦帆: ownerMetrics({
        owner: '杨锦帆',
        pressureScore: 20,
        activeProjects: 6,
        workload: 22,
        availableCount: 3,
      }),
    },
  });

  assert.equal(result.channel, 'departmentOperations');
  assert.equal(result.agentName, '部门团队运转分析 Agent');
  assert.equal(result.status, 'ready');
  assert.equal(result.modelName, 'deterministic-js');
  assert.ok(result.promptHash);
  assert.ok(result.inputSnapshotHash);
  assert.equal(result.facts.teamCount, 3);
  assert.equal(result.facts.dataRiskTeamCount, 0);
  assert.equal(result.ownerRecommendations['王吉祥'].stance, 'less');
  assert.match(result.ownerRecommendations['王吉祥'].headline, /少承接|谨慎承接|控新增/);
  assert.ok(result.ownerRecommendations['王吉祥'].evidence.some((item) => /部门均值/.test(item)));
  assert.equal(result.ownerRecommendations['苏佳蕾'].stance, 'more');
  assert.ok(result.departmentRecommendations.some((item) => /王吉祥/.test(item.action)));
});

test('department operations analysis keeps channel alive when other team data is incomplete', () => {
  const result = buildDepartmentOperationsAnalysis({
    dashboardContext: 'all',
    currentOwner: '苏佳蕾',
    metricsByOwner: {
      苏佳蕾: ownerMetrics({
        owner: '苏佳蕾',
        pressureScore: 35,
        activeProjects: 7,
        workload: 30,
        availableCount: 2,
        entryCoverage: 48,
      }),
      数据待补组: {
        owner: '数据待补组',
        displayName: '数据待补组',
        dashboardContext: 'all',
        summary: {},
        monthlyEntry: {},
        difficultySummary: {},
      },
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.facts.dataRiskTeamCount, 1);
  assert.match(result.limitations.join(''), /数据待补组/);
  assert.equal(result.ownerRecommendations['苏佳蕾'].stance, 'steady');
  assert.match(result.ownerRecommendations['苏佳蕾'].headline, /稳承接|补齐口径/);
});
