import { bindTooltipTriggers } from '../dashboard/tooltip.mjs';
import { state } from './state.mjs';
import { elements } from './dom.mjs';
import {
  DEVELOPMENT_ONLY_PAGES,
  FILTERABLE_PAGES,
  DEFAULT_TEAM_DASHBOARD_CONTEXT,
  normalizeDashboardContext,
  resolveTeamPageDashboardContext,
  contextLabel,
} from './constants.mjs';

let routerHooks = {};
let activePageId = '';

export function configureRouter(hooks = {}) {
  routerHooks = { ...routerHooks, ...hooks };
  activePageId = '';
}

export function isDevelopmentDocumentationVisible() {
  return Boolean(state.snapshot?.developerDocumentationVisible);
}

export function isDevelopmentOnlyPage(pageId = '') {
  return DEVELOPMENT_ONLY_PAGES.has(pageId);
}

export function developmentAllowedPages() {
  const visible = isDevelopmentDocumentationVisible();
  return Array.from(elements.pageSections)
    .map((section) => section.dataset.page)
    .filter((pageId) => visible || !isDevelopmentOnlyPage(pageId));
}

export function applyDevelopmentDocumentationVisibility() {
  const visible = isDevelopmentDocumentationVisible();
  document.body?.classList?.toggle('is-development-dashboard', visible);
  document.body?.classList?.toggle('is-intranet-dashboard', !visible);

  elements.navItems.forEach((item) => {
    if (!isDevelopmentOnlyPage(item.dataset.page)) {
      return;
    }
    item.hidden = !visible;
    if (!visible) {
      item.classList.remove('active');
      item.setAttribute('aria-current', 'false');
    }
  });

  elements.pageSections.forEach((section) => {
    if (!isDevelopmentOnlyPage(section.dataset.page)) {
      return;
    }
    if (!visible) {
      section.hidden = true;
      section.classList.remove('is-active');
    }
  });
}

export function parsePageHash() {
  const raw = window.location.hash.replace('#', '') || 'overview';
  const [pageRaw, queryString] = raw.split('?');
  const page = pageRaw.startsWith('developer-docs/') ? 'developer-docs' : pageRaw;
  const params = new URLSearchParams(queryString || '');
  const validPages = developmentAllowedPages();
  const legacyOwnerReview = page === 'owner-review';
  const pageId = legacyOwnerReview ? 'teams' : validPages.includes(page) ? page : 'overview';
  const owner = params.get('owner') || (legacyOwnerReview ? params.get('ownerPressurePerson') || '' : '');
  return {
    pageId,
    owner,
    teamProjectOwner: params.get('teamProjectOwner') || params.get('ownerPressurePerson') || '',
    collaborator: params.get('collaborator') || '',
    collaborationDiscipline: params.get('collaborationDiscipline') || '',
    search: params.get('search') || '',
    province: params.get('province') || '',
    businessType: params.get('businessType') || '',
    storeStatus: params.get('storeStatus') || '',
    status: params.get('status') || '',
    tier: params.get('tier') || '',
    metric: params.get('metric') || '',
    lifecycleStage: params.get('lifecycleStage') || '',
    delayed: params.get('delayed') || '',
    storeNature: params.get('storeNature') || '',
    excludePaused: params.get('excludePaused') || '',
    activeResponsibility: params.get('activeResponsibility') || '',
    profile: params.get('profile') || '',
    dashboardContext: params.get('dashboardContext') || '',
    month: params.get('month') || '',
    year: params.get('year') || '',
  };
}

export function currentPageId() {
  return parsePageHash().pageId;
}

export function normalizeLegacyRulesRoute() {
  const raw = window.location.hash.replace('#', '');
  const [page] = raw.split('?');
  if (page !== 'rules' && !page.startsWith('rules/')) {
    return;
  }
  const nextHash = '#developer-docs/dev-doc-rules-layers';
  if (window.history?.replaceState) {
    window.history.replaceState(null, '', nextHash);
  } else {
    window.location.hash = nextHash;
  }
}

export function normalizeLegacyOwnerReviewRoute() {
  const raw = window.location.hash.replace('#', '');
  const [page, queryString] = raw.split('?');
  if (page !== 'owner-review') {
    return;
  }
  const params = new URLSearchParams(queryString || '');
  if (!params.get('owner') && params.get('ownerPressurePerson')) {
    params.set('owner', params.get('ownerPressurePerson'));
  }
  params.delete('ownerPressurePerson');
  const query = params.toString();
  const nextHash = query ? `#teams?${query}` : '#teams';
  if (window.history?.replaceState) {
    window.history.replaceState(null, '', nextHash);
  } else {
    window.location.hash = nextHash;
  }
}

export function ownerReviewModuleVisible(pageId = currentPageId()) {
  return pageId === 'teams';
}

export { normalizeDashboardContext, contextLabel };

export function applyHashRouteParams() {
  const hash = parsePageHash();
  if (hash.pageId !== 'details') {
    return;
  }

  let changed = false;
  const controls = routerHooks.filterControlsForPage?.('details') || {};
  const assignFilter = (element, value) => {
    if (!element || !value) {
      return;
    }
    const option = Array.from(element.options).find((item) => item.value === value);
    if (option && element.value !== value) {
      element.value = value;
      changed = true;
    }
  };

  if (hash.search && controls.searchInput?.value !== hash.search) {
    controls.searchInput.value = hash.search;
    changed = true;
  }
  assignFilter(controls.provinceFilter, hash.province);
  assignFilter(controls.businessTypeFilter, hash.businessType);
  assignFilter(controls.storeStatusFilter, hash.storeStatus || routerHooks.tierStoreStatusLabel?.(hash.tier));
  assignFilter(controls.statusFilter, hash.status);

  const nextFilters = routerHooks.readActiveProjectFilters?.('details') || {};
  if (
    changed ||
    routerHooks.detailsRouteFiltersChanged?.(state.filters, nextFilters) ||
    state.pendingDetailsDrill
  ) {
    routerHooks.renderAllFilterSelects?.();
    routerHooks.renderPendingDetailsDrill?.(state.pendingDetailsDrill);
    routerHooks.refresh?.();
  }
}

function applyTeamsHashRouteParams({ pageChanged = false } = {}) {
  const hash = parsePageHash();
  if (pageChanged || hash.pageId !== 'teams') {
    return;
  }

  const owner = hash.owner || routerHooks.resolveTeamOwner?.() || '';
  if (!owner) {
    return;
  }
  const dashboardContext =
    resolveTeamPageDashboardContext(hash.dashboardContext) ||
    routerHooks.resolveTeamDashboardContext?.() ||
    DEFAULT_TEAM_DASHBOARD_CONTEXT;
  const year = Number(hash.year || 0) || routerHooks.resolveTeamWorkCompletionYear?.() || undefined;
  const currentOwner = state.teamWorkCompletion?.owner || state.teamMetrics?.owner || state.selectedTeamOwner || '';
  const currentContext = resolveTeamPageDashboardContext(
    state.teamWorkCompletion?.dashboardContext || state.teamMetrics?.dashboardContext || ''
  );
  const currentYear = Number(state.teamWorkCompletion?.year || state.teamWorkCompletionYear || 0);
  const targetYear = Number(year || currentYear || 0);
  if (
    currentOwner === owner &&
    currentContext === dashboardContext &&
    (!targetYear || !currentYear || currentYear === targetYear)
  ) {
    return;
  }

  routerHooks.ensureTeamOwnerOptions?.();
  routerHooks.ensureOwnerReviewControls?.();
  routerHooks
    .loadTeamDashboardScope?.(owner, dashboardContext, year)
    ?.catch((error) => {
      console.warn('Same-page teams scope load failed', error);
    });
}

export function applyHashSearch(options = {}) {
  applyHashRouteParams();
  applyTeamsHashRouteParams(options);
}

export function showPage(pageId = currentPageId(), options = {}) {
  normalizeLegacyRulesRoute();
  normalizeLegacyOwnerReviewRoute();
  applyDevelopmentDocumentationVisibility();
  pageId = currentPageId();
  const skipPageDataLoad = Boolean(options.skipPageDataLoad);
  const pageChanged = activePageId !== pageId;
  elements.pageSections.forEach((section) => {
    const active = section.dataset.page === pageId;
    section.classList.toggle('is-active', active);
    section.hidden = !active;
  });

  elements.navItems.forEach((item) => {
    const active = item.dataset.page === pageId;
    item.classList.toggle('active', active);
    item.setAttribute('aria-current', active ? 'page' : 'false');
  });

  const showProjectFilters = FILTERABLE_PAGES.has(pageId);
  const showPausedToggle = pageId === 'details' && showProjectFilters;
  elements.projectFilterBar.hidden = !showProjectFilters;
  elements.projectFilterBar.classList.toggle('has-details-action', showPausedToggle);
  if (elements.pausedProjectFilterField) {
    elements.pausedProjectFilterField.hidden = !showPausedToggle;
  }
  if (!showPausedToggle) {
    state.showPausedProjects = false;
    state.showIncompleteAssignments = false;
    state.assignmentAlertExpanded = false;
  }
  routerHooks.renderPausedProjectToggle?.();
  routerHooks.updatePageRefreshControl?.();
  if (pageChanged) {
    window.scrollTo(0, 0);
  }
  applyHashSearch({ pageChanged });
  activePageId = pageId;

  if (!skipPageDataLoad && pageChanged && pageId === 'teams') {
    routerHooks.ensureTeamOwnerOptions?.();
    routerHooks.ensureOwnerReviewControls?.();
    const owner = routerHooks.resolveTeamOwner?.() || parsePageHash().owner || '';
    const dashboardContext =
      routerHooks.resolveTeamDashboardContext?.() ||
      resolveTeamPageDashboardContext(parsePageHash().dashboardContext) ||
      DEFAULT_TEAM_DASHBOARD_CONTEXT;
    const year = routerHooks.resolveTeamWorkCompletionYear?.() || Number(parsePageHash().year || 0) || undefined;
    if (routerHooks.loadTeamDashboardScope) {
      routerHooks
        .loadTeamDashboardScope(owner, dashboardContext, year)
        ?.catch((error) => {
          console.warn('Team dashboard scope load failed; keeping current team page state', error);
          routerHooks.renderTeamDashboardError?.();
          routerHooks.renderTeamWorkCompletionDashboard?.();
          routerHooks.renderOwnerReviewDashboard?.();
        });
    } else {
    routerHooks
      .loadTeamDashboardSession?.({ owner, dashboardContext, year })
      ?.then((payload) => {
        if (payload?.status === 'preparing' && !payload.team) {
          console.warn('Team dashboard session read model is preparing', {
            owner,
            dashboardContext,
            year,
            reason: payload.reason || payload.status,
          });
          return routerHooks.loadTeamPageModules?.();
        }
        const team = payload?.team || {};
        if (!team.metrics || !team.workCompletion || !team.responsibilityReview) {
          console.warn('Team dashboard session missing requested bundle; falling back to module loaders', {
            owner,
            dashboardContext,
            year,
          });
          return routerHooks.loadTeamPageModules?.();
        }
        return payload;
      })
      ?.then(() => {
        routerHooks.renderTeamDashboard?.();
        routerHooks.renderTeamWorkCompletionDashboard?.();
        routerHooks.renderOwnerReviewDashboard?.();
      })
      ?.catch((error) => {
        console.warn('Team dashboard session load failed; keeping current team page state', error);
        routerHooks.renderTeamDashboardError?.();
        routerHooks.renderTeamWorkCompletionDashboard?.();
        routerHooks.renderOwnerReviewDashboard?.();
      });
    }
  }

  if (!skipPageDataLoad && pageChanged && (pageId === 'overview' || pageId === 'details')) {
    routerHooks
      .ensurePageProjects?.()
      ?.catch((error) => {
        console.warn('Page project catalog load failed', error);
      });
  }

  if (!skipPageDataLoad && pageChanged && (pageId === 'franchise' || pageId === 'direct')) {
    routerHooks
      .loadProfileDashboard?.(pageId)
      ?.then(() => routerHooks.renderProfilePage?.(pageId))
      ?.catch((error) => {
        console.warn('Profile dashboard load failed', error);
        routerHooks.renderProfilePage?.(pageId);
      });
  }

  if (pageId === 'developer-docs') {
    routerHooks.loadDeveloperDocsPage?.();
  }
}

export function navigateToDetailsDrill(filter = {}, { targetCount = null } = {}) {
  const params = new URLSearchParams();
  Object.entries(filter).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  const normalizedTargetCount = Number(targetCount);
  state.pendingDetailsDrill = {
    targetCount: Number.isFinite(normalizedTargetCount) ? normalizedTargetCount : null,
  };
  const query = params.toString();
  window.location.hash = query ? `#details?${query}` : '#details';
  showPage('details');
}

export function navigateToTeam(owner) {
  const params = new URLSearchParams();
  const dashboardContext = routerHooks.resolveTeamDashboardContext?.() || '';
  if (owner) {
    params.set('owner', owner);
  }
  if (dashboardContext) {
    params.set('dashboardContext', dashboardContext);
  }
  const query = params.toString();
  window.location.hash = query ? `#teams?${query}` : '#teams';
}

export function navigateToOwnerReview(
  owner = routerHooks.resolveOwnerReviewOwner?.() || '',
  dashboardContext = routerHooks.resolveOwnerReviewDashboardContext?.() || ''
) {
  const params = new URLSearchParams();
  if (owner) {
    params.set('owner', owner);
  }
  if (dashboardContext) {
    params.set('dashboardContext', dashboardContext);
  }
  const query = params.toString();
  window.location.hash = query ? `#teams?${query}` : '#teams';
}
