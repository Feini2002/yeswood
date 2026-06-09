import { isInYear, parseDateForMetrics } from './calculators.mjs';
import { readFranchiseScope, readStoreNatureKey, readWorkflowStage } from './fieldSemantics.mjs';
import { isPausedProject } from './pausedProjects.mjs';
import { readProjectStatusFromRawFields } from '../projectStatus.mjs';

const CANCELED_STATUSES = new Set(['取消', '已取消', '关闭', '已关闭']);
const CANCELED_PATTERN = /取消|已取消|关闭|已关闭/;

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
  const status = readProjectStatusFromRawFields(project?.rawFields, project?.status);
  if (CANCELED_STATUSES.has(status)) {
    return true;
  }
  const hardStage = readWorkflowStage(project, { discipline: 'hard' });
  const softStage = readWorkflowStage(project, { discipline: 'soft' });
  const text = [hardStage, softStage, status].filter(Boolean).join(' ');
  return CANCELED_PATTERN.test(text);
}

export function isEntryExcludedProject(project) {
  return isPausedProject(project) || isEntryExcludedCanceled(project);
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
