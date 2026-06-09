import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_CHANNEL_REGISTRY,
  buildOwnerDashboardAgentBundle,
  withAgentChannelOutput,
} from '../src/backend/agents/agentWorker.mjs';

test('owner dashboard agent worker excludes removed monthly ops LLM channel', () => {
  const bundle = buildOwnerDashboardAgentBundle({
    owner: '苏佳蕾',
    dashboardContext: 'franchise',
    summary: { totalProjects: 10 },
    leadLoad: [],
    weightedLeadLoad: [],
    difficultySummary: {},
    monthlyEntry: { rhythmAdvice: { channel: 'entryRhythm', confidence: 'medium', interpretations: [] } },
  });

  assert.equal(AGENT_CHANNEL_REGISTRY.monthlyOps, undefined);
  assert.equal(bundle.channels.monthlyOps, undefined);
  assert.equal(bundle.channels.entryRhythm.status, 'ready');
  assert.equal(bundle.channels.teamCollaboration.status, 'ready');
  assert.equal(bundle.channels.riskHealth.status, 'empty');

  const unchangedBundle = withAgentChannelOutput(bundle, 'monthlyOps', { channel: 'monthlyOps' });
  assert.equal(unchangedBundle, bundle);

  const mergedBundle = withAgentChannelOutput(bundle, 'riskHealth', { channel: 'riskHealth' });
  assert.equal(mergedBundle.channels.riskHealth.status, 'ready');
  assert.equal(mergedBundle.channels.riskHealth.output.channel, 'riskHealth');
});
