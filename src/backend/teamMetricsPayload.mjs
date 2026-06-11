import { openInitializedDatabase } from './database.mjs';
import { withAgentChannelOutput } from './agents/agentWorker.mjs';
import { buildRiskHealthAnalysis } from './agents/riskHealthAnalysis.mjs';
import { calculateTeamDashboardMetrics } from './projectData.mjs';
import { readLatestRiskHealthAnalysis, saveRiskHealthAnalysis } from './riskHealthRepository.mjs';
import { enrichTeamDashboardMetrics } from './teamInsights.mjs';

export function resolveTeamForOwner(owner, architecture = {}) {
  return (
    (Array.isArray(architecture.teams) ? architecture.teams : []).find((item) => item.owner === owner) || {
      owner,
      cdLeads: [],
      vmLeads: [],
    }
  );
}

function resolveRiskHealthAnalysis(config, metrics, { owner, dashboardContext }) {
  const generated = buildRiskHealthAnalysis(metrics, { owner, dashboardContext });
  if (!config.databaseFile) {
    return {
      ...generated,
      createdBy: 'live_preview',
      modelName: 'deterministic-js',
    };
  }

  const database = openInitializedDatabase(config.databaseFile);
  try {
    const existing = readLatestRiskHealthAnalysis(database, { owner, dashboardContext });
    if (
      existing &&
      existing.inputSnapshotHash === generated.inputSnapshotHash &&
      existing.promptHash === generated.promptHash
    ) {
      return existing;
    }
    saveRiskHealthAnalysis(database, generated, {
      createdBy: 'manual_agent',
      modelName: 'deterministic-js',
    });
    return readLatestRiskHealthAnalysis(database, { owner, dashboardContext }) || generated;
  } finally {
    database.close();
  }
}

export function buildTeamMetricsPayload(config, snapshot, architecture, owner, dashboardContext, options = {}) {
  const team = resolveTeamForOwner(owner, architecture);
  const metrics = enrichTeamDashboardMetrics(
    snapshot.projects || [],
    calculateTeamDashboardMetrics(snapshot.projects || [], team, architecture, { dashboardContext }),
    architecture,
    { ownerRates: options.ownerRates }
  );
  const riskHealthAnalysis = resolveRiskHealthAnalysis(config, metrics, { owner, dashboardContext });
  return {
    ...metrics,
    agentWorker: withAgentChannelOutput(metrics.agentWorker, 'riskHealth', riskHealthAnalysis),
    riskHealthAnalysis,
    readOnly: true,
    dashboardContext,
    owner,
  };
}

function compactDepartmentOperationsForOwner(departmentOperations = {}, owner = '') {
  const ownerRecommendation = departmentOperations.ownerRecommendations?.[owner] || null;
  return {
    channel: departmentOperations.channel,
    agentName: departmentOperations.agentName,
    promptVersion: departmentOperations.promptVersion,
    promptHash: departmentOperations.promptHash,
    modelName: departmentOperations.modelName,
    mode: departmentOperations.mode,
    runMode: departmentOperations.runMode,
    analysisScope: departmentOperations.analysisScope,
    inputSnapshotHash: departmentOperations.inputSnapshotHash,
    generatedAt: departmentOperations.generatedAt,
    status: departmentOperations.status,
    context: departmentOperations.context,
    summary: {
      ...(departmentOperations.summary || {}),
      text: ownerRecommendation?.headline || departmentOperations.summary?.text || '',
    },
    facts: departmentOperations.facts || {},
    ownerRecommendation,
    departmentRecommendations: departmentOperations.departmentRecommendations || [],
    limitations: departmentOperations.limitations || [],
  };
}

export function attachDepartmentOperations(metrics = {}, departmentOperations = {}) {
  const owner = metrics.owner || '';
  const ownerDepartmentOperations = compactDepartmentOperationsForOwner(departmentOperations, owner);
  return {
    ...metrics,
    departmentOperations: ownerDepartmentOperations,
    agentWorker: withAgentChannelOutput(metrics.agentWorker, 'departmentOperations', ownerDepartmentOperations),
  };
}
