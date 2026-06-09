import crypto from 'node:crypto';

export const AGENT_MODEL_NAME = 'deterministic-js';
export const AGENT_SCOPE_MODE = 'per-owner-context';
export const AGENT_RUN_DIMENSIONS = ['owner', 'dashboardContext'];

export function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildAgentScope({ owner = '', dashboardContext = 'all', channel = '' } = {}) {
  const normalizedOwner = String(owner || '').trim();
  const normalizedContext = String(dashboardContext || 'all').trim() || 'all';
  const scopeBase = `${normalizedContext}:${normalizedOwner || 'all-owners'}`;
  return {
    owner: normalizedOwner,
    dashboardContext: normalizedContext,
    scopeKey: channel ? `${scopeBase}:${channel}` : scopeBase,
    scopeMode: AGENT_SCOPE_MODE,
    runDimensions: AGENT_RUN_DIMENSIONS,
  };
}

export function promptHashFor(promptVersion, prompt) {
  return hashText(`${promptVersion}\n${prompt}`);
}

export function inputSnapshotHashFor(inputSnapshot = {}) {
  return hashText(stableJson(inputSnapshot));
}

export function buildAgentRunMetadata({ channel, agentName, promptVersion, prompt, owner, dashboardContext } = {}) {
  return {
    channel,
    agentName,
    promptVersion,
    promptHash: promptHashFor(promptVersion, prompt),
    modelName: AGENT_MODEL_NAME,
    mode: AGENT_MODEL_NAME,
    analysisScope: buildAgentScope({ owner, dashboardContext, channel }),
  };
}
