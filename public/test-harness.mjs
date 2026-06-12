/**
 * Test harness for public app behavior tests.
 * Baseline (pre-split): app.js ~10754 lines, styles.css ~10650 lines.
 *
 * Loads app.js via native ESM import with fake browser globals injected first.
 */

export function fakeElement() {
  return {
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    focus() {},
    insertAdjacentElement() {},
    querySelector() {
      return fakeElement();
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    dataset: {},
    style: {},
    options: [],
    value: '',
    hidden: false,
    textContent: '',
    innerHTML: '',
  };
}

function setupTestGlobals({ fetchImpl } = {}) {
  const location = { hash: '' };
  const history = { replaceState() {}, pushState() {} };
  const body = fakeElement();
  const windowEventListeners = {};
  const documentRef = {
    querySelector: fakeElement,
    querySelectorAll: () => [],
    createElement: fakeElement,
    addEventListener() {},
    removeEventListener() {},
    body,
  };

  const windowRef = {
    location,
    history,
    __eventListeners: windowEventListeners,
    addEventListener(type, listener) {
      windowEventListeners[type] = windowEventListeners[type] || [];
      windowEventListeners[type].push(listener);
    },
    removeEventListener(type, listener) {
      windowEventListeners[type] = (windowEventListeners[type] || []).filter((item) => item !== listener);
    },
    scrollTo() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: documentRef,
  };

  globalThis.window = windowRef;
  globalThis.document = documentRef;
  globalThis.location = location;
  globalThis.history = history;
  globalThis.localStorage = { getItem: () => '', setItem() {}, removeItem() {} };
  globalThis.fetch = fetchImpl || (async () => ({ ok: true, json: async () => ({}) }));
  globalThis.URLSearchParams = URLSearchParams;
  globalThis.DASHBOARD_UPDATE_CHECK_INTERVAL_MS = 1000;
  globalThis.shouldReloadDashboard = () => false;
  globalThis.startDevReload = () => {};
  globalThis.__PUBLIC_APP_TEST_HARNESS__ = true;
}

export async function loadPublicAppHarness({ fetchImpl } = {}) {
  setupTestGlobals({ fetchImpl });

  const { resetAppState } = await import('./lib/state.mjs');
  resetAppState();
  const { runtimeStore } = await import('./lib/runtime-flags.mjs');
  runtimeStore.updateCheckInFlight = false;
  runtimeStore.pageRefreshInFlight = false;
  runtimeStore.syncMessageTimer = null;
  runtimeStore.drillModalRequestId = 0;
  runtimeStore.projectDetailRequestId = 0;
  runtimeStore.teamMetricsRequestId = 0;
  runtimeStore.teamWorkCompletionRequestId = 0;
  runtimeStore.teamWorkCompletionRequestPromises = new Map();
  runtimeStore.teamWorkCompletionDetailPromises = new Map();
  runtimeStore.ownerReviewRequestId = 0;
  runtimeStore.ownerReviewRequestPromises = new Map();
  runtimeStore.teamMetricsBatchPromises = new Map();
  runtimeStore.teamMetricsCacheGeneration = 0;
  runtimeStore.teamMetricsPreloadTimer = null;
  runtimeStore.teamMetricsPreloadToken = 0;
  runtimeStore.teamWorkCompletionPreloadTimer = null;
  runtimeStore.teamWorkCompletionPreloadToken = 0;
  runtimeStore.projectCatalogPromise = null;
  runtimeStore.drillProjectsCache = new Map();
  runtimeStore.drillResolvePromises = new Map();
  runtimeStore.projectDetailCache = new Map();
  runtimeStore.projectDetailPromises = new Map();
  runtimeStore.profileDashboardPromises = new Map();
  runtimeStore.annualEntryStructureController = null;
  runtimeStore.teamAnnualEntryStructureController = null;

  const moduleUrl = new URL('./app.js', import.meta.url);
  moduleUrl.searchParams.set('harness', String(Date.now()));
  const mod = await import(moduleUrl.href);

  return {
    state: mod.state,
    elements: mod.elements,
    window: globalThis.window,
    normalizeDashboardPayload: mod.normalizeDashboardPayload,
    parsePageHash: mod.parsePageHash,
    currentPageId: mod.currentPageId,
    showPage: mod.showPage,
    init: mod.init,
    bindEvents: mod.bindEvents,
    isDevelopmentDocumentationVisible: mod.isDevelopmentDocumentationVisible,
    applyDevelopmentDocumentationVisibility: mod.applyDevelopmentDocumentationVisibility,
    renderProjectWorkbenchEmptyState: mod.renderProjectWorkbenchEmptyState,
    loadTeamMetrics: mod.loadTeamMetrics,
    loadProfileDashboard: mod.loadProfileDashboard,
    loadTeamAnnualEntryStructure: mod.loadTeamAnnualEntryStructure,
    loadOwnerResponsibilityReview: mod.loadOwnerResponsibilityReview,
    navigateToOwnerReview: mod.navigateToOwnerReview,
    resetOwnerReviewForTeamOwnerChange: mod.resetOwnerReviewForTeamOwnerChange,
    refresh: mod.refresh,
    refreshCurrentPage: mod.refreshCurrentPage,
    resolveProjectKeyDate: mod.resolveProjectKeyDate,
    resolveProjectKeyDateReminders: mod.resolveProjectKeyDateReminders,
    readProjectKeyDate: mod.readProjectKeyDate,
    riskQueueProjects: mod.riskQueueProjects,
    collectRiskProjectQueue: mod.collectRiskProjectQueue,
    riskActionRowCounts: mod.riskActionRowCounts,
    riskDutyHeadline: mod.riskDutyHeadline,
    riskClass: mod.riskClass,
    renderProjectOwnersCell: mod.renderProjectOwnersCell,
    renderProjectTeamCell: mod.renderProjectTeamCell,
    renderProjectDesignersCell: mod.renderProjectDesignersCell,
    projectFieldGapReminders: mod.projectFieldGapReminders,
    renderProjectFieldGapReminder: mod.renderProjectFieldGapReminder,
    readProjectStage: mod.readProjectStage,
    renderProjectDetailModal: mod.renderProjectDetailModal,
    renderProjectWorkbench: mod.renderProjectWorkbench,
    loadTeamWorkCompletion: mod.loadTeamWorkCompletion,
    loadTeamDashboardScope: mod.loadTeamDashboardScope,
    loadSelectedTeamOwner: mod.loadSelectedTeamOwner,
    renderTeamWorkCompletionDashboard: mod.renderTeamWorkCompletionDashboard,
    handleTeamWorkCompletionContextClick: mod.handleTeamWorkCompletionContextClick,
    handleTeamWorkCompletionYearChange: mod.handleTeamWorkCompletionYearChange,
    handleTeamCompletionFilterClick: mod.handleTeamCompletionFilterClick,
    handleTeamCompletionGroupGridClick: mod.handleTeamCompletionGroupGridClick,
    handleTeamCompletionMemberClick: mod.handleTeamCompletionMemberClick,
    handleTeamCompletionMonthClick: mod.handleTeamCompletionMonthClick,
    handleTeamCompletionMemberModalClick: mod.handleTeamCompletionMemberModalClick,
    openTeamCompletionGroupModal: mod.openTeamCompletionGroupModal,
    openTeamCompletionMemberModal: mod.openTeamCompletionMemberModal,
    openTeamCompletionMonthModal: mod.openTeamCompletionMonthModal,
    closeTeamCompletionMemberModal: mod.closeTeamCompletionMemberModal,
    renderOwnerReviewTeamStructure: mod.renderOwnerReviewTeamStructure,
    renderOwnerReviewPersonRows: mod.renderOwnerReviewPersonRows,
    renderOwnerReviewDetailRows: mod.renderOwnerReviewDetailRows,
    renderOwnerReviewMemberModal: mod.renderOwnerReviewMemberModal,
    renderOwnerReviewGroupMatrix: mod.renderOwnerReviewGroupMatrix,
    renderOwnerReviewDashboard: mod.renderOwnerReviewDashboard,
    handleOwnerReviewPersonClick: mod.handleOwnerReviewPersonClick,
    openOwnerReviewMemberModal: mod.openOwnerReviewMemberModal,
    openOwnerReviewFloorDetailModal: mod.openOwnerReviewFloorDetailModal,
    openOwnerReviewDecisionModal: mod.openOwnerReviewDecisionModal,
    closeOwnerReviewDecisionModal: mod.closeOwnerReviewDecisionModal,
    closeOwnerReviewMemberModal: mod.closeOwnerReviewMemberModal,
    ownerReviewVisibleReview: mod.ownerReviewVisibleReview,
    ownerReviewPreferredPersonName: mod.ownerReviewPreferredPersonName,
    ownerReviewFloorLoadGroups: mod.ownerReviewFloorLoadGroups,
    ownerReviewLoadLevel: mod.ownerReviewLoadLevel,
    ownerReviewCopySummaryText: mod.ownerReviewCopySummaryText,
  };
}
