import { state } from '../lib/state.mjs';
import { elements } from '../lib/dom.mjs';
import { currentPageId } from '../lib/router.mjs';

import {
  runtimeStore,
  setAnalysisAgentInFlight as setAnalysisAgentInFlightFlag,
  clearSyncMessageTimer,
  scheduleSyncMessageClear,
} from '../lib/runtime-flags.mjs';

export function isAnalysisAgentInFlight() {
  return runtimeStore.analysisAgentInFlight;
}

export function setAnalysisAgentInFlight(value) {
  setAnalysisAgentInFlightFlag(value);
}

export function isDashboardSyncEnabled() {
  return Boolean(state.snapshot?.dashboardSyncEnabled);
}


export function isDashboardAutoUpdateEnabled() {
  return state.snapshot?.dashboardAutoUpdateEnabled !== false;
}


export function setSyncMessage(message) {
  if (!elements.syncMessage) {
    return;
  }

  clearSyncMessageTimer();
  elements.syncMessage.textContent = message;
  if (message) {
    scheduleSyncMessageClear(() => {
      elements.syncMessage.textContent = '';
    }, 4200);
  }
}


export function updateSyncControl() {
  if (!elements.syncButton) {
    return;
  }

  const enabled = isDashboardSyncEnabled();
  elements.syncButton.disabled = !enabled;
  elements.syncButton.title = enabled ? '同步项目数据' : '同步入口未开启';
}


export function currentAnalysisAgentLabel(pageId = currentPageId()) {
  return (
    {
      overview: '分析总览',
      franchise: '分析加盟',
      direct: '分析直营',
      teams: '分析小组',
      'owner-review': '分析复盘',
      details: '分析项目',
      rules: '分析规则',
    }[pageId] || '分析 Agent'
  );
}


export function updateAnalysisAgentControl() {
  if (!elements.analysisAgentButton) {
    return;
  }
  const label = currentAnalysisAgentLabel();
  elements.analysisAgentButton.disabled = runtimeStore.analysisAgentInFlight;
  elements.analysisAgentButton.textContent = runtimeStore.analysisAgentInFlight ? '分析中' : label;
  elements.analysisAgentButton.title = `${label} Agent`;
}

