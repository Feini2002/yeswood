import { readFranchiseScope } from './fieldSemantics.mjs';
import { readNamesFromRawField, readProjectOwnerNames } from '../personnelNames.mjs';
import { expandOwnerNames } from '../responsibilityRepository.mjs';
import {
  findResponsibilityIdentity,
  ownerTokenInfo,
  responsibilityIdentityFieldNames,
} from '../responsibilityIdentities.mjs';

export const DASHBOARD_CONTEXTS = new Set(['all', 'franchise', 'direct']);

export function matchesDashboardContext(project, context = 'all') {
  if (!context || context === 'all') {
    return true;
  }
  const scope = readFranchiseScope(project);
  if (context === 'franchise') {
    return scope === 'franchise';
  }
  if (context === 'direct') {
    return scope === 'direct';
  }
  return true;
}

export function resolveProfileProjects(projects, profileId, options = {}) {
  switch (profileId) {
    case 'department':
      return projects.slice();
    case 'direct':
      return projects.filter((project) => readFranchiseScope(project) === 'direct');
    case 'franchise':
      return projects.filter((project) => readFranchiseScope(project) === 'franchise');
    case 'ownerMonthly':
      return resolveOwnerMonthlyProjects(projects, options.owner || options.team?.owner || '', {
        dashboardContext: options.dashboardContext || 'all',
        personnelArchitecture: options.personnelArchitecture,
        ownerNameIndex: options.ownerNameIndex,
      });
    default:
      return projects.slice();
  }
}

function projectHasOwnerName(project, ownerNames) {
  return readProjectOwnerNames(project).some((name) => ownerNames.has(name));
}

function projectHasResponsibilityIdentity(project, identity, personnelArchitecture = {}, ownerNameIndex = null) {
  const ownerNames = expandOwnerNames(identity.sourceName, personnelArchitecture, ownerNameIndex);
  const fieldNames = responsibilityIdentityFieldNames(identity);
  return fieldNames.some((fieldName) => readNamesFromRawField(project, fieldName).some((name) => ownerNames.has(name)));
}

export function resolveOwnerMonthlyProjects(projects, owner, options = {}) {
  if (!owner) {
    return [];
  }
  const identity = findResponsibilityIdentity(owner, options.personnelArchitecture || {});
  if (identity) {
    const context = options.dashboardContext || 'all';
    return projects.filter(
      (project) =>
        projectHasResponsibilityIdentity(project, identity, options.personnelArchitecture, options.ownerNameIndex) &&
        matchesDashboardContext(project, context)
    );
  }
  const ownerNames = expandOwnerNames(owner, options.personnelArchitecture, options.ownerNameIndex);
  const context = options.dashboardContext || 'all';

  return projects.filter(
    (project) => projectHasOwnerName(project, ownerNames) && matchesDashboardContext(project, context)
  );
}

export function resolveCanonicalOwner(owner, personnelArchitecture = {}, ownerNameIndex = null) {
  const identity = findResponsibilityIdentity(owner, personnelArchitecture);
  if (identity) {
    return identity.identityId;
  }
  const names = expandOwnerNames(owner, personnelArchitecture, ownerNameIndex);
  const people = personnelArchitecture.people || {};
  for (const name of names) {
    if (people[name]) {
      return name;
    }
  }
  return owner;
}

export function resolveOwnerTokenInfo(owner, personnelArchitecture = {}) {
  return ownerTokenInfo(owner, personnelArchitecture);
}

/** Infer franchise vs direct from 组别 on this owner's projects (钉钉负责人列). */
export function inferOwnerDashboardContext(projects, owner, options = {}) {
  const scoped = resolveOwnerMonthlyProjects(projects, owner, {
    ...options,
    dashboardContext: 'all',
  });
  let franchise = 0;
  let direct = 0;
  for (const project of scoped) {
    const scope = readFranchiseScope(project);
    if (scope === 'franchise') {
      franchise += 1;
    } else if (scope === 'direct') {
      direct += 1;
    }
  }
  if (franchise > direct) {
    return 'franchise';
  }
  if (direct > franchise) {
    return 'direct';
  }
  return options.fallback || 'all';
}

export function resolvePersonSlotProjects(projects, personName, slotKey, options = {}) {
  if (!personName || !slotKey) {
    return [];
  }
  const names = expandOwnerNames(personName, options.personnelArchitecture, options.ownerNameIndex);

  return projects.filter((project) => {
    const slot = options.slotDefinition;
    const fieldNames = slot?.fields || [];
    for (const fieldName of fieldNames) {
      const display = project.rawFields?.[fieldName]?.display ?? '';
      const rowNames = String(display)
        .split(/[、,，；;\n\r]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      if (rowNames.some((name) => names.has(name))) {
        return true;
      }
    }
    return false;
  });
}
