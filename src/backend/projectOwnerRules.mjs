import { SOLE_DUAL_DISCIPLINE_OWNER_NAME, isSoleDualDisciplineOwner } from './personnelOwners.mjs';
import { splitPersonnelNames } from './personnelNames.mjs';
import { isSleepStoreProject } from './projectTypeRules.mjs';

function mergePersonnelName(value, name) {
  const names = splitPersonnelNames(value);
  if (!names.some((item) => item === name)) {
    names.push(name);
  }
  return Array.from(new Set(names)).join('、');
}

function hasSoleDualOwner(value) {
  return splitPersonnelNames(value).some((name) => isSoleDualDisciplineOwner(name));
}

export function applySoleDualOwnerProjectRule(project) {
  if (
    !project ||
    (!hasSoleDualOwner(project.owner) && !hasSoleDualOwner(project.cdOwner) && !hasSoleDualOwner(project.vmOwner))
  ) {
    return project;
  }

  const hasDisciplineSlot = hasSoleDualOwner(project.cdOwner) || hasSoleDualOwner(project.vmOwner);
  const reviewChannel = hasSoleDualOwner(project.owner) && !hasDisciplineSlot
    ? 'multi-identity-owner-total-without-discipline-slot'
    : '';
  project.derivedOwners = {
    ...(project.derivedOwners || {}),
    ownerResponsibilityRouting: true,
    soleDualOwnerName: SOLE_DUAL_DISCIPLINE_OWNER_NAME,
    cdOwner: project.cdOwner || '',
    vmOwner: project.vmOwner,
    owner: project.owner,
    reviewChannel,
  };

  return project;
}

export function applySleepStoreHardOnlyProjectRule(project) {
  if (!isSleepStoreProject(project)) {
    return project;
  }

  const ignoredVmOwner = project.vmOwner || '';
  project.vmOwner = '';
  project.derivedOwners = {
    ...(project.derivedOwners || {}),
    sleepStoreHardOnlyRule: true,
    ignoredVmOwner,
  };

  return project;
}
