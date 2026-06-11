import { startDevReload } from './realtime.js';
import { initTooltipSystem } from './dashboard/tooltip.mjs';
import { state } from './lib/state.mjs';
import { elements } from './lib/dom.mjs';
import { normalizeDashboardPayload } from './lib/api.mjs';
import {
  configureRouter,
  isDevelopmentDocumentationVisible,
  isDevelopmentOnlyPage,
  applyDevelopmentDocumentationVisibility,
  parsePageHash,
  currentPageId,
  applyHashSearch,
  showPage,
  navigateToTeam,
  navigateToOwnerReview,
} from './lib/router.mjs';
import * as projectReminders from './domain/project-reminders.mjs';
import * as projectWorkflow from './domain/project-workflow.mjs';
import * as personnel from './domain/personnel.mjs';
import * as metricsDisplay from './domain/metrics-display.mjs';
import * as syncControls from './components/sync-controls.mjs';
import * as filterBar from './components/filter-bar.mjs';
import * as drillModal from './components/drill-modal.mjs';
import * as projectWorkbench from './components/project-workbench.mjs';
import * as projectDetailModal from './components/project-detail-modal.mjs';
import * as rulesPage from './pages/rules.mjs';
import * as profileShared from './pages/profile-shared.mjs';
import * as ownerReviewPage from './pages/owner-review.mjs';
import * as teamsPage from './pages/teams.mjs';
import {
  renderAll,
  loadDashboard,
  loadProjectCatalog,
  applyVisibleProjects,
  loadTeamPageModules,
  loadFilters,
  refresh,
  softRefresh,
  hardRefresh,
  debounce,
  syncDingTalk,
  runAnalysisAgent,
  startAutoUpdateChecks,
  renderDashboardStatusState,
} from './lib/dashboard-loader.mjs';
import { configureViewCoordinator } from './lib/view-coordinator.mjs';

const {
  resolveProjectKeyDate,
  resolveProjectKeyDateReminders,
  readProjectKeyDate,
  projectFieldGapReminders,
} = projectReminders;
const { readProjectStage } = projectWorkflow;
const { riskQueueProjects, collectRiskProjectQueue, riskActionRowCounts, riskDutyHeadline, riskClass, tierStoreStatusLabel } =
  metricsDisplay;
const {
  renderProjectOwnersCell,
  renderProjectTeamCell,
  renderProjectDesignersCell,
  renderProjectFieldGapReminder,
  renderProjectWorkbenchEmptyState,
  renderProjectWorkbench,
  renderPendingDetailsDrill,
  renderPausedProjectToggle,
  setPausedProjectFilter,
  handleDetailsViewTabClick,
  handleProjectDetailsClick,
  handleProjectDetailsKeydown,
} = projectWorkbench;
const {
  handleDashboardDrillClick,
  handleDashboardDrillKeydown,
  handleGlobalModalKeydown,
  handleDrillProjectModalClick,
  renderDrillProjectRows,
} = drillModal;

configureViewCoordinator({
  renderProjectWorkbench,
  renderDrillProjectRows,
});
const { renderProjectDetailModal } = projectDetailModal;
const {
  cancelTeamMetricsPreload,
  cancelTeamWorkCompletionPreload,
  loadTeamMetrics,
  loadTeamWorkCompletion,
  loadTeamDashboardScope,
  loadTeamAnnualEntryStructure,
  loadOwnerResponsibilityReview,
  renderTeamDashboard,
  renderTeamDashboardError,
  renderTeamWorkCompletionDashboard,
  handleTeamWorkCompletionContextClick,
  handleTeamWorkCompletionYearChange,
  handleTeamCompletionFilterClick,
  handleTeamCompletionMemberClick,
  handleTeamCompletionMemberModalClick,
  handleTeamCompletionMemberModalKeydown,
  handleTeamCompletionMonthClick,
  openTeamCompletionMemberModal,
  openTeamCompletionMonthModal,
  closeTeamCompletionMemberModal,
  resetOwnerReviewForTeamOwnerChange,
} = teamsPage;
const {
  renderOwnerReviewTeamStructure,
  renderOwnerReviewPersonRows,
  renderOwnerReviewDetailRows,
  renderOwnerReviewMemberModal,
  renderOwnerReviewGroupMatrix,
  renderOwnerReviewDashboard,
  handleOwnerReviewPersonClick,
  openOwnerReviewMemberModal,
  openOwnerReviewFloorDetailModal,
  openOwnerReviewDecisionModal,
  closeOwnerReviewDecisionModal,
  closeOwnerReviewMemberModal,
  ownerReviewVisibleReview,
  ownerReviewPreferredPersonName,
  ownerReviewFloorLoadGroups,
  ownerReviewLoadLevel,
  ownerReviewCopySummaryText,
  handleOwnerReviewContextClick,
  handleOwnerReviewSearchInput,
  handleOwnerReviewLoadFilterChange,
  handleOwnerReviewDecisionClick,
  handleOwnerReviewGroupMatrixClick,
  handleOwnerReviewKeydown,
  handleOwnerReviewTeamStructureClick,
  handleOwnerReviewMemberModalClick,
  handleOwnerReviewDecisionModalClick,
} = ownerReviewPage;
const {
  filterControlsForPage,
  readActiveProjectFilters,
  detailsRouteFiltersChanged,
  renderAllFilterSelects,
  handleFilterSelectClick,
  handleFilterSelectKeydown,
} = filterBar;
const { ensureTeamOwnerOptions, ensureOwnerReviewControls, resolveTeamOwner, resolveTeamDashboardContext, resolveOwnerReviewOwner, resolveOwnerReviewDashboardContext } = personnel;
const { updateSyncControl, updateAnalysisAgentControl, isDashboardAutoUpdateEnabled } = syncControls;
const { loadProfileDashboard, renderProfilePage } = profileShared;
const { openRulesInfoDialog } = rulesPage;

export function bindEvents() {
  const debouncedSoftRefresh = debounce(() => {
    softRefresh().catch((error) => {
      console.warn('Filter refresh failed', error);
    });
  }, 180);
  elements.searchInput.addEventListener('input', debouncedSoftRefresh);
  [
    elements.provinceFilter,
    elements.businessTypeFilter,
    elements.storeStatusFilter,
    elements.statusFilter,
  ].forEach((select) =>
    select.addEventListener('change', () => {
      softRefresh().catch((error) => {
        console.warn('Filter refresh failed', error);
      });
    })
  );
  document.addEventListener('click', handleFilterSelectClick);
  document.addEventListener('keydown', handleFilterSelectKeydown);
  document.addEventListener('keydown', handleDashboardDrillKeydown);
  document.addEventListener('keydown', handleGlobalModalKeydown);
  document.addEventListener('keydown', handleTeamCompletionMemberModalKeydown);
  document.addEventListener('keydown', handleOwnerReviewKeydown);
  if (elements.detailsViewTabs) {
    elements.detailsViewTabs.addEventListener('click', handleDetailsViewTabClick);
  }
  if (elements.pausedProjectToggle) {
    elements.pausedProjectToggle.addEventListener('click', () => {
      setPausedProjectFilter(!state.showPausedProjects);
    });
  }
  elements.syncButton.addEventListener('click', syncDingTalk);
  if (elements.analysisAgentButton) {
    elements.analysisAgentButton.addEventListener('click', runAnalysisAgent);
  }
  if (elements.rulesInfoOpen) {
    elements.rulesInfoOpen.addEventListener('click', openRulesInfoDialog);
  }
  elements.teamOwnerSelect.addEventListener('change', () => {
    loadSelectedTeamOwner(elements.teamOwnerSelect.value).catch((error) => {
      console.warn('Team owner switch failed', error);
    });
  });
  if (elements.ownerReviewContextTabs) {
    elements.ownerReviewContextTabs.addEventListener('click', (event) => {
      const selection = handleOwnerReviewContextClick(event);
      if (!selection) {
        return;
      }
      loadOwnerResponsibilityReview(selection.owner, selection.dashboardContext)
        .then(() => renderOwnerReviewDashboard())
        .catch((error) => {
          console.warn('Owner responsibility review context switch failed', error);
        });
    });
  }
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-team-completion-context]')) {
      return;
    }
    handleTeamWorkCompletionContextClick(event);
  });
  if (elements.teamCompletionYearSelect) {
    elements.teamCompletionYearSelect.addEventListener('change', handleTeamWorkCompletionYearChange);
  }
  if (elements.teamCompletionHeroStats) {
    elements.teamCompletionHeroStats.addEventListener('click', handleTeamCompletionFilterClick);
  }
  if (elements.teamCompletionMonthlyChart) {
    elements.teamCompletionMonthlyChart.addEventListener('click', handleTeamCompletionMonthClick);
  }
  if (elements.teamCompletionGroupGrid) {
    elements.teamCompletionGroupGrid.addEventListener('click', handleTeamCompletionMemberClick);
  }
  if (elements.teamCompletionMemberGrid) {
    elements.teamCompletionMemberGrid.addEventListener('click', handleTeamCompletionMemberClick);
  }
  if (elements.teamCompletionMemberModal) {
    elements.teamCompletionMemberModal.addEventListener('click', handleTeamCompletionMemberModalClick);
  }
  if (elements.ownerReviewBorrowToggle) {
    elements.ownerReviewBorrowToggle.addEventListener('change', () => {
      state.ownerReviewShowBorrowing = elements.ownerReviewBorrowToggle.checked;
      state.selectedOwnerReviewPerson = ownerReviewPreferredPersonName(ownerReviewVisibleReview());
      renderOwnerReviewDashboard();
    });
  }
  if (elements.ownerReviewSearchInput) {
    elements.ownerReviewSearchInput.addEventListener('input', handleOwnerReviewSearchInput);
  }
  if (elements.ownerReviewLoadFilter) {
    elements.ownerReviewLoadFilter.addEventListener('change', handleOwnerReviewLoadFilterChange);
  }
  if (elements.ownerReviewDecisionSummary) {
    elements.ownerReviewDecisionSummary.addEventListener('click', handleOwnerReviewDecisionClick);
  }
  if (elements.ownerReviewGroupMatrix) {
    elements.ownerReviewGroupMatrix.addEventListener('click', handleOwnerReviewGroupMatrixClick);
  }
  if (elements.ownerReviewPersonRows) {
    elements.ownerReviewPersonRows.addEventListener('click', handleOwnerReviewPersonClick);
  }
  if (elements.ownerReviewDetailRows) {
    elements.ownerReviewDetailRows.addEventListener('click', handleOwnerReviewPersonClick);
  }
  if (elements.ownerReviewTeamStructure) {
    elements.ownerReviewTeamStructure.addEventListener('click', handleOwnerReviewTeamStructureClick);
  }
  if (elements.ownerReviewMemberModal) {
    elements.ownerReviewMemberModal.addEventListener('click', handleOwnerReviewMemberModalClick);
  }
  if (elements.ownerReviewDecisionModal) {
    elements.ownerReviewDecisionModal.addEventListener('click', handleOwnerReviewDecisionModalClick);
  }
  document.addEventListener('click', handleDashboardDrillClick);
  if (elements.drillProjectModal) {
    elements.drillProjectModal.addEventListener('click', handleDrillProjectModalClick);
  }
  if (elements.teamTierKpiBoard) {
    elements.teamTierKpiBoard.addEventListener('click', handleDashboardDrillClick);
  }
  if (elements.kpiGrid) {
    elements.kpiGrid.addEventListener('click', handleDashboardDrillClick);
  }
  if (elements.franchiseKpiGrid) {
    elements.franchiseKpiGrid.addEventListener('click', handleDashboardDrillClick);
  }
  if (elements.directKpiGrid) {
    elements.directKpiGrid.addEventListener('click', handleDashboardDrillClick);
  }
  document.addEventListener('click', handleProjectDetailsClick);
  document.addEventListener('keydown', handleProjectDetailsKeydown);
  window.addEventListener('hashchange', () => showPage(currentPageId()));
}

async function loadSelectedTeamOwner(owner = elements.teamOwnerSelect.value) {
  cancelTeamMetricsPreload();
  cancelTeamWorkCompletionPreload();
  resetOwnerReviewForTeamOwnerChange();
  navigateToTeam(owner);
  const dashboardContext = resolveTeamDashboardContext();
  await loadTeamWorkCompletion(owner, dashboardContext);
  const results = await Promise.allSettled([
    loadTeamMetrics(owner, dashboardContext),
    loadOwnerResponsibilityReview(owner, dashboardContext),
  ]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed && results.every((result) => result.status === 'rejected')) {
    throw failed.reason;
  }
  return results;
}

export async function init() {
  initTooltipSystem();
  showPage(currentPageId(), { skipPageDataLoad: true });
  bindEvents();
  updateSyncControl();
  updateAnalysisAgentControl();
  startDevReload();
  renderDashboardStatusState('loading');
  try {
    await loadDashboard();
  } catch (error) {
    renderDashboardStatusState('error', error);
    console.warn('Dashboard init failed', error);
    return;
  }
  if (isDevelopmentOnlyPage(currentPageId())) {
    showPage(currentPageId());
  }
  applyHashSearch();
  if (isDashboardAutoUpdateEnabled()) {
    startAutoUpdateChecks();
  }
}

configureRouter({
  filterControlsForPage,
  readActiveProjectFilters,
  detailsRouteFiltersChanged,
  renderAllFilterSelects,
  renderPendingDetailsDrill,
  refresh: softRefresh,
  tierStoreStatusLabel,
  renderPausedProjectToggle,
  updateAnalysisAgentControl,
  ensureTeamOwnerOptions,
  ensureOwnerReviewControls,
  resolveTeamOwner,
  resolveTeamDashboardContext,
  resolveOwnerReviewOwner,
  resolveOwnerReviewDashboardContext,
  loadTeamPageModules,
  loadTeamMetrics,
  loadTeamWorkCompletion,
  ensurePageProjects: async () => {
    await loadProjectCatalog();
    await applyVisibleProjects();
    renderAll();
  },
  renderTeamDashboard,
  renderTeamDashboardError,
  renderTeamWorkCompletionDashboard,
  loadOwnerResponsibilityReview,
  renderOwnerReviewDashboard,
  loadProfileDashboard,
  renderProfilePage,
});

export {
  state,
  elements,
  normalizeDashboardPayload,
  parsePageHash,
  currentPageId,
  showPage,
  isDevelopmentDocumentationVisible,
  applyDevelopmentDocumentationVisibility,
  renderProjectWorkbenchEmptyState,
  loadTeamMetrics,
  loadSelectedTeamOwner,
  loadTeamAnnualEntryStructure,
  loadOwnerResponsibilityReview,
  navigateToOwnerReview,
  resetOwnerReviewForTeamOwnerChange,
  refresh,
  resolveProjectKeyDate,
  resolveProjectKeyDateReminders,
  readProjectKeyDate,
  riskQueueProjects,
  collectRiskProjectQueue,
  riskActionRowCounts,
  riskDutyHeadline,
  riskClass,
  renderProjectOwnersCell,
  renderProjectTeamCell,
  renderProjectDesignersCell,
  projectFieldGapReminders,
  renderProjectFieldGapReminder,
  readProjectStage,
  renderProjectDetailModal,
  renderProjectWorkbench,
  loadProfileDashboard,
  renderOwnerReviewTeamStructure,
  loadTeamWorkCompletion,
  loadTeamDashboardScope,
  renderTeamWorkCompletionDashboard,
  handleTeamWorkCompletionContextClick,
  handleTeamWorkCompletionYearChange,
  handleTeamCompletionFilterClick,
  handleTeamCompletionMemberClick,
  handleTeamCompletionMemberModalClick,
  handleTeamCompletionMonthClick,
  openTeamCompletionMemberModal,
  openTeamCompletionMonthModal,
  closeTeamCompletionMemberModal,
  renderOwnerReviewPersonRows,
  renderOwnerReviewDetailRows,
  renderOwnerReviewMemberModal,
  renderOwnerReviewGroupMatrix,
  renderOwnerReviewDashboard,
  handleOwnerReviewPersonClick,
  openOwnerReviewMemberModal,
  openOwnerReviewFloorDetailModal,
  openOwnerReviewDecisionModal,
  closeOwnerReviewDecisionModal,
  closeOwnerReviewMemberModal,
  ownerReviewVisibleReview,
  ownerReviewPreferredPersonName,
  ownerReviewFloorLoadGroups,
  ownerReviewLoadLevel,
  ownerReviewCopySummaryText,
};

if (!globalThis.__PUBLIC_APP_TEST_HARNESS__) {
  init().catch((error) => {
    console.error(error);
    elements.kpiGrid.innerHTML = '<div class="empty-state">看板加载失败</div>';
  });
}
