/** Module-scoped runtime flags migrated from legacy app.js singletons. */
export const runtimeStore = {
  updateCheckInFlight: false,
  pageRefreshInFlight: false,
  syncMessageTimer: null,
  drillModalRequestId: 0,
  projectDetailRequestId: 0,
  teamMetricsRequestId: 0,
  teamDashboardScopeRequestId: 0,
  teamWorkCompletionRequestId: 0,
  teamWorkCompletionRequestPromises: new Map(),
  teamWorkCompletionDetailPromises: new Map(),
  teamWorkCompletionDetailStatuses: new Map(),
  ownerReviewRequestId: 0,
  ownerReviewRequestPromises: new Map(),
  teamMetricsBatchPromises: new Map(),
  teamMetricsCacheGeneration: 0,
  teamMetricsPreloadTimer: null,
  teamMetricsPreloadToken: 0,
  teamWorkCompletionPreloadTimer: null,
  teamWorkCompletionPreloadToken: 0,
  projectCatalogPromise: null,
  drillProjectsCache: null,
  drillResolvePromises: null,
  drillPreloadKeys: new Set(),
  overviewLifecycleDrillPreloadKey: '',
  overviewLifecycleDrillPreloadPromise: null,
  projectDetailCache: null,
  projectDetailPromises: null,
  profileDashboardPromises: new Map(),
  annualEntryStructureController: null,
  teamAnnualEntryStructureController: null,
};

export function setPageRefreshInFlight(value) {
  runtimeStore.pageRefreshInFlight = Boolean(value);
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
