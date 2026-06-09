import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildRiskHealthAnalysis } from '../src/backend/agents/riskHealthAnalysis.mjs';
import { RISK_HEALTH_AGENT_PROMPT_VERSION } from '../src/backend/agents/riskHealthAgentPrompt.mjs';
import { openInitializedDatabase } from '../src/backend/database.mjs';
import { readLatestRiskHealthAnalysis, saveRiskHealthAnalysis } from '../src/backend/riskHealthRepository.mjs';

function sampleMetrics() {
  return {
    owner: '苏佳蕾',
    dashboardContext: 'all',
    summary: {
      totalProjects: 136,
    },
    alerts: {
      schemeDelayedThisMonth: 5,
      schemeDelayedYtd: 24,
      openDelayed: 47,
      unscheduled: 8,
    },
    statusCounts: [
      { label: '未设置', value: 103 },
      { label: '紧急', value: 13 },
      { label: '一般', value: 1 },
    ],
    urgentStatusProjects: [
      { id: 'urgent-1', name: '合肥吾悦紧急店', status: '紧急', dueDate: '2026-06-03' },
      { id: 'urgent-2', name: '长沙开福紧急店', status: '紧急', dueDate: '2026-06-05' },
    ],
    openDelayedProjects: [
      { id: 'delay-1', name: '延期闭环店 A', dueDate: '2026-05-01', isDelayed: true },
      { id: 'delay-2', name: '延期闭环店 B', dueDate: '2026-05-02', isDelayed: true },
    ],
    dataHealth: {
      totalProjects: 136,
      warningCount: 133,
      issueCount: 251,
      fieldCoverage: [
        { key: 'softDoneTime', label: '软装完成时间', rate: 0, status: 'warn' },
        { key: 'owner', label: '负责人', rate: 100, status: 'ok' },
      ],
      checks: [
        {
          key: 'hardSchemeMeetingConflict',
          label: '方案情况与上会情况冲突',
          severity: 'warn',
          description: '硬装方案情况和上会情况不是同一口径，冲突记录需要回到源表核对。',
          count: 73,
          samples: [
            { id: 'p-1', name: '保定安国白氏家居店', dueDate: '2026-05-20' },
            { id: 'p-2', name: '洛阳偃师万达店', dueDate: '2026-05-22' },
          ],
        },
        {
          key: 'softDelayDoneMissingDate',
          label: '软装延期完成缺少完成时间',
          severity: 'warn',
          description: '软装完成情况写了延期完成，但软装完成时间为空。',
          count: 10,
          samples: [{ id: 'p-3', name: '桂林灵川亚洲国际店' }],
        },
        {
          key: 'openPlanPast',
          label: '未闭环且计划开业过期',
          severity: 'info',
          description: '这是管理边界校准项，不应进入风险列表。',
          count: 6,
          suppressRiskItem: true,
          samples: [{ id: 'plan-1', name: '采购协同待更新店' }],
        },
        {
          key: 'healthyRule',
          label: '无风险规则',
          severity: 'info',
          description: '不应进入风险列表。',
          count: 0,
          samples: [],
        },
      ],
    },
    riskProjects: [
      { id: 'high-1', name: '高风险非延期店', dueDate: '2026-06-20', riskLevel: '高' },
      { id: 'delay-1', name: '延期闭环店 A', dueDate: '2026-05-01', isDelayed: true },
    ],
  };
}

test('buildRiskHealthAnalysis produces explainable risk-only items from health checks and alerts', () => {
  const analysis = buildRiskHealthAnalysis(sampleMetrics(), {
    generatedAt: '2026-05-31T10:00:00.000+08:00',
    inputSnapshotHash: 'snapshot-hash',
  });

  assert.equal(analysis.channel, 'riskHealth');
  assert.equal(analysis.agentName, '运营风险健康 Agent');
  assert.equal(analysis.modelName, 'deterministic-js');
  assert.equal(analysis.promptVersion, RISK_HEALTH_AGENT_PROMPT_VERSION);
  assert.ok(analysis.promptHash);
  assert.equal(analysis.analysisScope.scopeKey, 'all:苏佳蕾:riskHealth');
  assert.equal(analysis.owner, '苏佳蕾');
  assert.equal(analysis.dashboardContext, 'all');
  assert.equal(analysis.inputSnapshotHash, 'snapshot-hash');
  assert.deepEqual(analysis.inputSnapshot.openDelayedProjects.map((item) => item.id), ['delay-1', 'delay-2']);
  assert.equal(analysis.summary.totalRisks, analysis.riskItems.length);
  assert.match(analysis.summary.headline, /紧急/);
  assert.equal(analysis.riskItems.some((item) => item.dedupeKey === 'status:urgent'), true);
  assert.equal(analysis.riskItems.some((item) => item.dedupeKey === 'health:healthyRule'), false);
  assert.equal(analysis.riskItems.some((item) => item.dedupeKey === 'health:openPlanPast'), false);
  assert.equal(analysis.riskItems.some((item) => item.source === 'field_coverage'), false);
  assert.equal(analysis.riskItems.some((item) => item.dedupeKey === 'alert:openDelayed'), true);
  assert.equal(analysis.riskItems.some((item) => item.dedupeKey === 'health:hardSchemeMeetingConflict'), true);
  assert.equal(analysis.summary.dataQuality.level, 'low');
  assert.equal(analysis.summary.dataQuality.coverageWarningCount, 1);
  assert.equal(analysis.summary.dataQuality.checkWarningCount, 2);
  assert.deepEqual(analysis.summary.dataQuality.coverageWarnings.map((item) => item.key), ['softDoneTime']);
  assert.match(analysis.summary.dataQuality.limitations.join(' '), /软装完成时间覆盖率 0%/);
  assert.equal(analysis.summary.dataQuality.hasLimitations, true);
  assert.equal(analysis.summary.dataQuality.riskPolicy, 'data_quality_only');
  assert.match(analysis.summary.dataQuality.accountabilityNote, /不作为业务风险追责/);

  const urgentStatus = analysis.riskItems.find((item) => item.dedupeKey === 'status:urgent');
  assert.equal(urgentStatus.severity, 'P1');
  assert.equal(urgentStatus.category, 'priority_status');
  assert.equal(urgentStatus.impactCount, 13);
  assert.deepEqual(urgentStatus.relatedProjectIds, ['urgent-1', 'urgent-2']);
  assert.match(urgentStatus.reasoning, /未设置/);

  const openDelayed = analysis.riskItems.find((item) => item.dedupeKey === 'alert:openDelayed');
  assert.equal(openDelayed.severity, 'P1');
  assert.equal(openDelayed.category, 'execution_delay');
  assert.equal(openDelayed.impactCount, 47);
  assert.ok(openDelayed.reasoning);
  assert.ok(openDelayed.recommendedAction);
  assert.ok(openDelayed.evidence.length > 0);
  assert.deepEqual(openDelayed.relatedProjectIds, ['delay-1', 'delay-2']);
  assert.equal(openDelayed.evidence.some((item) => item.projectId === 'high-1'), false);

  const healthConflict = analysis.riskItems.find((item) => item.dedupeKey === 'health:hardSchemeMeetingConflict');
  assert.equal(healthConflict.severity, 'P2');
  assert.equal(healthConflict.category, 'state_conflict');
  assert.deepEqual(healthConflict.relatedProjectIds, ['p-1', 'p-2']);
  assert.ok(healthConflict.evidence.every((item) => item.projectName));
});

test('risk health Agent writes owner-specific action recommendation from current risk facts', () => {
  const urgentTeam = buildRiskHealthAnalysis({
    owner: 'Owner A',
    dashboardContext: 'all',
    summary: { totalProjects: 12 },
    alerts: { openDelayed: 2 },
    statusCounts: [{ label: '紧急', value: 3 }],
    urgentStatusProjects: [
      { id: 'u-1', name: 'Urgent One', status: '紧急' },
      { id: 'u-2', name: 'Urgent Two', status: '紧急' },
    ],
    openDelayedProjects: [
      { id: 'd-1', name: 'Delayed One', isDelayed: true },
      { id: 'd-2', name: 'Delayed Two', isDelayed: true },
    ],
    dataHealth: { totalProjects: 12, checks: [], fieldCoverage: [] },
  });
  const waitingTeam = buildRiskHealthAnalysis({
    owner: 'Owner B',
    dashboardContext: 'direct',
    summary: { totalProjects: 6 },
    alerts: { unscheduled: 4 },
    statusCounts: [],
    urgentStatusProjects: [],
    openDelayedProjects: [],
    dataHealth: { totalProjects: 6, checks: [], fieldCoverage: [] },
  });

  assert.equal(urgentTeam.summary.actionRecommendationSource, 'riskHealthAgent');
  assert.match(urgentTeam.summary.actionRecommendation, /^建议优先处理：/);
  assert.match(urgentTeam.summary.actionRecommendation, /2 项紧急点铺/);
  assert.match(urgentTeam.summary.actionRecommendation, /2 项延期未闭环/);
  assert.doesNotMatch(urgentTeam.summary.actionRecommendation, /今天只看/);
  assert.doesNotMatch(urgentTeam.summary.actionRecommendation, /改变推进结果/);
  assert.match(waitingTeam.summary.actionRecommendation, /4 项排期待确认/);
  assert.notEqual(urgentTeam.summary.actionRecommendation, waitingTeam.summary.actionRecommendation);
});

test('risk health keeps closed design work with overdue plan date visible as delivery risk', () => {
  const analysis = buildRiskHealthAnalysis({
    owner: 'Owner C',
    dashboardContext: 'all',
    summary: { totalProjects: 3 },
    alerts: {},
    statusCounts: [],
    urgentStatusProjects: [],
    openDelayedProjects: [],
    dataHealth: {
      totalProjects: 3,
      checks: [
        {
          key: 'closedButPlanPast',
          label: '已闭环但计划开业过期',
          severity: 'info',
          description: '设计责任已闭环，但计划开业日期仍过期，需要转入交付/协同复核。',
          count: 2,
          suppressRiskItem: true,
          samples: [
            { id: 'closed-plan-1', name: 'Closed Plan One', dueDate: '2026-05-01' },
            { id: 'closed-plan-2', name: 'Closed Plan Two', dueDate: '2026-05-02' },
          ],
        },
      ],
      fieldCoverage: [],
    },
    riskProjects: [],
  });

  const closedPlanPast = analysis.riskItems.find((item) => item.dedupeKey === 'health:closedButPlanPast');

  assert.ok(closedPlanPast);
  assert.equal(closedPlanPast.source, 'data_health');
  assert.equal(closedPlanPast.category, 'delivery_boundary');
  assert.equal(closedPlanPast.severity, 'P3');
  assert.equal(closedPlanPast.impactCount, 2);
  assert.deepEqual(closedPlanPast.relatedProjectIds, ['closed-plan-1', 'closed-plan-2']);
  assert.equal(analysis.riskItems.some((item) => item.dedupeKey === 'alert:openDelayed'), false);
});

test('risk health analysis can be saved and loaded as the latest owner dashboard diagnosis', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-risk-health-'));
  const db = openInitializedDatabase(path.join(tempDir, 'app.sqlite'));
  const analysis = buildRiskHealthAnalysis(sampleMetrics(), {
    generatedAt: '2026-05-31T10:00:00.000+08:00',
    inputSnapshotHash: 'snapshot-hash',
  });

  saveRiskHealthAnalysis(db, analysis, { createdBy: 'manual_agent', modelName: 'manual' });
  const loaded = readLatestRiskHealthAnalysis(db, { owner: '苏佳蕾', dashboardContext: 'all' });

  assert.equal(loaded.runId, analysis.runId);
  assert.equal(loaded.createdBy, 'manual_agent');
  assert.equal(loaded.summary.highCount, analysis.summary.highCount);
  assert.equal(loaded.riskItems.length, analysis.riskItems.length);
  assert.equal(loaded.riskItems[0].runId, analysis.runId);
  assert.ok(loaded.riskItems[0].firstSeenAt);
  db.close();
});
