import { ENTRY_RHYTHM_ADVICE_AGENT_PROMPT_VERSION } from './entryRhythmAdviceAgentPrompt.mjs';
import { RISK_HEALTH_AGENT_PROMPT_VERSION } from './riskHealthAgentPrompt.mjs';
import { TEAM_COLLABORATION_SIMULATION_AGENT_PROMPT_VERSION } from './teamCollaborationSimulationAgentPrompt.mjs';
import { DEPARTMENT_OPERATIONS_AGENT_PROMPT_VERSION } from './departmentOperationsAgentPrompt.mjs';
import { buildTeamCollaborationSimulation } from './teamCollaborationSimulationAgent.mjs';
import { AGENT_MODEL_NAME, AGENT_RUN_DIMENSIONS, AGENT_SCOPE_MODE, buildAgentScope } from './agentMetadata.mjs';

export const AGENT_WORKER_VERSION = 'owner-dashboard-agent-worker-v1';

export const AGENT_CHANNEL_REGISTRY = {
  entryRhythm: {
    key: 'entryRhythm',
    name: '进店节奏分析 Agent',
    promptVersion: ENTRY_RHYTHM_ADVICE_AGENT_PROMPT_VERSION,
    owner: 'calculateTeamDashboardMetrics',
    runMode: AGENT_MODEL_NAME,
    modelName: AGENT_MODEL_NAME,
    scopeMode: AGENT_SCOPE_MODE,
    runDimensions: AGENT_RUN_DIMENSIONS,
    trigger: 'team-metrics',
    outputField: 'monthlyEntry.rhythmAdvice',
  },
  teamCollaboration: {
    key: 'teamCollaboration',
    name: '小组协作负载 Agent',
    promptVersion: TEAM_COLLABORATION_SIMULATION_AGENT_PROMPT_VERSION,
    owner: 'owner-dashboard-worker',
    runMode: AGENT_MODEL_NAME,
    modelName: AGENT_MODEL_NAME,
    scopeMode: AGENT_SCOPE_MODE,
    runDimensions: AGENT_RUN_DIMENSIONS,
    trigger: 'team-metrics',
    outputField: 'collaborationSimulation',
  },
  riskHealth: {
    key: 'riskHealth',
    name: '运营风险健康 Agent',
    promptVersion: RISK_HEALTH_AGENT_PROMPT_VERSION,
    owner: 'risk-health-worker',
    runMode: AGENT_MODEL_NAME,
    modelName: AGENT_MODEL_NAME,
    scopeMode: AGENT_SCOPE_MODE,
    runDimensions: AGENT_RUN_DIMENSIONS,
    trigger: 'team-metrics-risk-health',
    outputField: 'riskHealthAnalysis',
  },
  departmentOperations: {
    key: 'departmentOperations',
    name: '部门团队运转分析 Agent',
    promptVersion: DEPARTMENT_OPERATIONS_AGENT_PROMPT_VERSION,
    owner: 'team-metrics-batch',
    runMode: AGENT_MODEL_NAME,
    modelName: AGENT_MODEL_NAME,
    scopeMode: AGENT_SCOPE_MODE,
    runDimensions: ['dashboardContext', 'owner', 'departmentBenchmark'],
    trigger: 'team-metrics-batch',
    outputField: 'departmentOperations',
  },
};

function channelScopeFor(key, output, scopeInput = {}) {
  return output?.analysisScope || buildAgentScope({ ...scopeInput, channel: key });
}

function readyChannel(key, output, scopeInput = {}) {
  const registry = AGENT_CHANNEL_REGISTRY[key];
  const analysisScope = channelScopeFor(key, output, scopeInput);
  return {
    ...registry,
    status: output ? 'ready' : 'empty',
    modelName: output?.modelName || registry.modelName || registry.runMode,
    analysisScope,
    scopeKey: analysisScope.scopeKey,
    output: output || null,
  };
}

function failedChannel(key, error, scopeInput = {}) {
  const analysisScope = buildAgentScope({ ...scopeInput, channel: key });
  return {
    ...AGENT_CHANNEL_REGISTRY[key],
    modelName: AGENT_CHANNEL_REGISTRY[key].modelName || AGENT_MODEL_NAME,
    analysisScope,
    scopeKey: analysisScope.scopeKey,
    status: 'failed',
    error: error?.message || String(error || 'Agent channel failed'),
    output: null,
  };
}

function buildTeamCollaborationChannel(metrics = {}) {
  return buildTeamCollaborationSimulation({
    owner: metrics.owner,
    dashboardContext: metrics.dashboardContext,
    summary: metrics.summary,
    leadLoad: metrics.leadLoad,
    weightedLeadLoad: metrics.weightedLeadLoad,
    difficultySummary: metrics.difficultySummary,
  });
}

export function buildOwnerDashboardAgentBundle(metrics = {}) {
  const channels = {};

  for (const [key, builder] of Object.entries({
    teamCollaboration: buildTeamCollaborationChannel,
  })) {
    try {
      channels[key] = readyChannel(key, builder(metrics), metrics);
    } catch (error) {
      channels[key] = failedChannel(key, error, metrics);
    }
  }

  channels.entryRhythm = readyChannel('entryRhythm', metrics.monthlyEntry?.rhythmAdvice || null, metrics);
  channels.riskHealth = readyChannel('riskHealth', metrics.riskHealthAnalysis || null, metrics);

  return {
    workerVersion: AGENT_WORKER_VERSION,
    runMode: AGENT_MODEL_NAME,
    modelName: AGENT_MODEL_NAME,
    owner: metrics.owner || '',
    dashboardContext: metrics.dashboardContext || 'all',
    analysisScope: buildAgentScope({
      owner: metrics.owner,
      dashboardContext: metrics.dashboardContext,
    }),
    channels,
  };
}

export function withAgentChannelOutput(bundle = {}, key, output) {
  if (!AGENT_CHANNEL_REGISTRY[key]) {
    return bundle;
  }
  const scopeInput = output?.analysisScope || {
    owner: bundle.owner || bundle.analysisScope?.owner || '',
    dashboardContext: bundle.dashboardContext || bundle.analysisScope?.dashboardContext || 'all',
  };
  return {
    ...bundle,
    workerVersion: bundle.workerVersion || AGENT_WORKER_VERSION,
    runMode: bundle.runMode || AGENT_CHANNEL_REGISTRY[key].runMode,
    modelName: bundle.modelName || AGENT_CHANNEL_REGISTRY[key].modelName || AGENT_MODEL_NAME,
    channels: {
      ...(bundle.channels || {}),
      [key]: readyChannel(key, output, scopeInput),
    },
  };
}
