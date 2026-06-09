import { readStoreTier } from './fieldSemantics.mjs';
import { resolveOwnerMonthlyProjects, resolveProfileProjects } from './projectScopes.mjs';

export { resolveOwnerMonthlyProjects, resolveProfileProjects } from './projectScopes.mjs';

export function filterProjectsByProfile(projects, profileId, options = {}) {
  const scoped = resolveProfileProjects(projects, profileId, options);
  if (options.tier) {
    return scoped.filter((project) => readStoreTier(project) === options.tier);
  }
  return scoped;
}

export function filterProjectsByTier(projects, tier) {
  if (!tier || tier === 'all') {
    return projects.slice();
  }
  return projects.filter((project) => readStoreTier(project) === tier);
}

/** @deprecated Organizational team mounting — do not use for KPI scope. */
export function filterProjectsForTeamDeprecated(projects, team) {
  return resolveOwnerMonthlyProjects(projects, team?.owner || '', {
    dashboardContext: 'all',
    personnelArchitecture: {},
  });
}
