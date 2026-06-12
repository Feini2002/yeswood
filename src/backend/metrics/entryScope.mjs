import { isInYear, parseDateForMetrics } from './calculators.mjs';
import { readFranchiseScope, readStoreNatureKey } from './fieldSemantics.mjs';
import { isCanceledProject, isPausedOrCanceledProject } from './pausedProjects.mjs';

export function isDirectFranchiseScoped(project) {
  const scope = readFranchiseScope(project);
  return scope === 'direct' || scope === 'franchise';
}

export function matchesEntryScope(project, scope = 'directFranchise') {
  const franchiseScope = readFranchiseScope(project);
  if (scope === 'direct') {
    return franchiseScope === 'direct';
  }
  if (scope === 'franchise') {
    return franchiseScope === 'franchise';
  }
  return isDirectFranchiseScoped(project);
}

export function isEntryExcludedCanceled(project) {
  return isCanceledProject(project);
}

export function isEntryExcludedProject(project) {
  return isPausedOrCanceledProject(project);
}

export function hasValidEntryStartDate(project) {
  return Boolean(parseDateForMetrics(project?.startDate));
}

export function isClassifiedEntryStoreAge(project) {
  const nature = readStoreNatureKey(project);
  return nature === 'newStore' || nature === 'renovated';
}

export function entryMonth(project) {
  const date = parseDateForMetrics(project?.startDate);
  if (!date) {
    return 0;
  }
  return date.getMonth() + 1;
}

export function isValidYearEntryProject(project, year, scope = 'directFranchise') {
  if (!matchesEntryScope(project, scope)) {
    return false;
  }
  if (isEntryExcludedProject(project)) {
    return false;
  }
  if (!hasValidEntryStartDate(project)) {
    return false;
  }
  if (!isInYear(project.startDate, year)) {
    return false;
  }
  return isClassifiedEntryStoreAge(project);
}

export function countYearEntry(projects, year, options = {}) {
  const scope = options.scope || 'directFranchise';
  return projects.filter((project) => isValidYearEntryProject(project, year, scope)).length;
}
