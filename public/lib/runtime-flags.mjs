/** Module-scoped runtime flags migrated from legacy app.js singletons. */
export const runtimeStore = {
  updateCheckInFlight: false,
  analysisAgentInFlight: false,
  syncMessageTimer: null,
  drillModalRequestId: 0,
  teamMetricsRequestId: 0,
  ownerReviewRequestId: 0,
  teamMetricsBatchPromises: new Map(),
  teamMetricsPreloadTimer: null,
  teamMetricsPreloadToken: 0,
  annualEntryStructureController: null,
};

export function setAnalysisAgentInFlight(value) {
  runtimeStore.analysisAgentInFlight = Boolean(value);
}

export function clearSyncMessageTimer() {
  if (runtimeStore.syncMessageTimer) {
    window.clearTimeout(runtimeStore.syncMessageTimer);
    runtimeStore.syncMessageTimer = null;
  }
}

export function scheduleSyncMessageClear(callback, delayMs) {
  clearSyncMessageTimer();
  runtimeStore.syncMessageTimer = window.setTimeout(callback, delayMs);
}
