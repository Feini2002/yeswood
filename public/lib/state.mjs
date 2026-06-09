export function createAppState() {
  return {
    filters: {},
    projects: [],
    fieldCatalog: [],
    metrics: null,
    fullMetrics: null,
    snapshot: null,
    personnelArchitecture: null,
    teamMetrics: null,
    teamMetricsByOwner: {},
    teamMetricsBatchKey: '',
    teamMetricsBatchLoading: false,
    teamMetricsLoading: false,
    teamMetricsError: '',
    selectedTeamOwner: '',
    ownerReview: null,
    ownerReviewByKey: {},
    ownerReviewLoading: false,
    ownerReviewError: '',
    ownerReviewRefreshStatus: '',
    ownerReviewRefreshError: '',
    ownerReviewShowBorrowing: true,
    selectedOwnerReviewPerson: '',
    selectedOwnerReviewMember: '',
    ownerReviewMemberModalMode: 'member',
    ownerReviewMemberFilter: 'all',
    ownerReviewSearchQuery: '',
    ownerReviewLoadFilter: 'all',
    ownerReviewExpandedIdleGroups: {},
    ownerReviewCopyMessage: '',
    ownerReviewSelectedGroup: '',
    ownerReviewDecisionModalType: '',
    selectedProjectId: '',
    projectDetailContext: null,
    detailsWorkbenchView: 'list',
    showPausedProjects: false,
    showIncompleteAssignments: false,
    assignmentAlertExpanded: false,
    drillWorkbenchView: 'list',
    pendingDetailsDrill: null,
    drillModal: {
      open: false,
      loading: false,
      error: '',
      title: '项目明细',
      subtitle: '',
      targetCount: null,
      filters: {},
      projects: [],
    },
    profileMetrics: {
      franchise: null,
      direct: null,
      department: null,
    },
    profileProjects: {
      franchise: [],
      direct: [],
    },
    annualEntryStructure: null,
  };
}

export const state = createAppState();

export function resetAppState() {
  const next = createAppState();
  Object.keys(state).forEach((key) => {
    delete state[key];
  });
  Object.assign(state, next);
}
