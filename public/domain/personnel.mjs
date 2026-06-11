import { state } from '../lib/state.mjs';
import { elements } from '../lib/dom.mjs';
import { escapeHtml } from '../lib/format.mjs';
import { TEAM_OWNER_STORAGE_KEY, normalizeDashboardContext } from '../lib/constants.mjs';
import { currentPageId, parsePageHash } from '../lib/router.mjs';
import {
  enhanceTeamOwnerSelect,
  enhanceOwnerReviewSelects,
  enhanceOwnerReviewLoadFilterSelect,
} from '../components/filter-bar.mjs';

const TEAM_OWNER_ROLE_LABELS = {
  cdOwner: '硬装负责人',
  vmOwner: '软装负责人',
};
const SOLE_DUAL_DISCIPLINE_OWNER_NAME = '杨锦帆';
const CREATIVE_OWNER_CATEGORY_LABEL = '创意负责人';

export function peopleFromArchitecture(architecture = {}) {
  const rawPeople = architecture.people || {};
  const people = Array.isArray(rawPeople) ? rawPeople : Object.values(rawPeople);
  return people.filter((person) => person?.name);
}


export function peopleByName(architecture = {}) {
  return new Map(peopleFromArchitecture(architecture).map((person) => [person.name, person]));
}


export function personnelArchitectureForDisplay() {
  return state.personnelArchitecture || state.snapshot?.personnelArchitecture || null;
}


export function personFromPersonnelArchitecture(name, architecture = personnelArchitectureForDisplay()) {
  if (!architecture || !name) {
    return null;
  }
  return peopleByName(architecture).get(name) || null;
}


export function teamOwnerRoleLabel(role, person) {
  if (person.identityId) {
    return role.label || TEAM_OWNER_ROLE_LABELS[role.key] || '负责人';
  }
  if (person.name === SOLE_DUAL_DISCIPLINE_OWNER_NAME) {
    return CREATIVE_OWNER_CATEGORY_LABEL;
  }
  const archPerson = personFromPersonnelArchitecture(person.sourceName || person.name);
  if (archPerson?.categoryLabel) {
    return archPerson.categoryLabel;
  }
  return role.label || TEAM_OWNER_ROLE_LABELS[role.key] || '负责人';
}


export function formatTeamOwnerDisplay(roleLabel, displayName) {
  return `${displayName} · ${roleLabel}`;
}


export function teamOwnerDisplayName(owner) {
  if (!owner) {
    return '';
  }
  const option = teamOwnerOptions().find((item) => item.owner === owner);
  return option ? formatTeamOwnerDisplay(option.roleLabel, option.displayName) : owner;
}


export function teamOwnerOptions() {
  const ownerRoles = (state.metrics?.personnel?.roles || state.fullMetrics?.personnel?.roles || []).filter((role) =>
    ['cdOwner', 'vmOwner'].includes(role.key)
  );
  const options = new Map();
  for (const role of ownerRoles) {
    for (const person of role.people || []) {
      if (!person?.name) {
        continue;
      }
      const ownerKey = person.identityId || person.name;
      const displayName = person.displayName || person.name;
      const roleLabel = teamOwnerRoleLabel(role, person);
      const existing = options.get(ownerKey);
      if (!existing) {
        options.set(ownerKey, {
          owner: ownerKey,
          displayName,
          roleLabel,
          sourceName: person.sourceName || person.name,
          identityId: person.identityId || '',
        });
        continue;
      }
      if (!person.identityId && person.name === SOLE_DUAL_DISCIPLINE_OWNER_NAME) {
        existing.roleLabel = CREATIVE_OWNER_CATEGORY_LABEL;
        continue;
      }
      const archPerson = personFromPersonnelArchitecture(person.sourceName || person.name);
      if (archPerson?.categoryLabel) {
        existing.roleLabel = archPerson.categoryLabel;
      }
    }
  }
  return Array.from(options.values());
}


export function teamOwnerDirectoryReady() {
  const roles = state.metrics?.personnel?.roles ?? state.fullMetrics?.personnel?.roles;
  return Array.isArray(roles);
}


export function resolveTeamOwner() {
  const { pageId, owner } = parsePageHash();
  const options = teamOwnerOptions();
  if (pageId === 'teams' && owner) {
    return owner;
  }
  const stored = localStorage.getItem(TEAM_OWNER_STORAGE_KEY);
  if (stored && options.some((item) => item.owner === stored)) {
    return stored;
  }
  return options[0]?.owner || '';
}


export function resolveTeamDashboardContext() {
  const { pageId, dashboardContext } = parsePageHash();
  if (pageId !== 'teams') {
    return '';
  }
  return normalizeDashboardContext(dashboardContext);
}


export function resolveOwnerReviewOwner() {
  const { pageId, owner } = parsePageHash();
  const options = teamOwnerOptions();
  if ((pageId === 'teams' || pageId === 'owner-review') && owner) {
    return owner;
  }
  const stored = localStorage.getItem(TEAM_OWNER_STORAGE_KEY);
  if (stored && options.some((item) => item.owner === stored)) {
    return stored;
  }
  return options[0]?.owner || '';
}


export function resolveOwnerReviewDashboardContext() {
  const { pageId, dashboardContext } = parsePageHash();
  if (pageId !== 'teams' && pageId !== 'owner-review') {
    return '';
  }
  return normalizeDashboardContext(dashboardContext);
}


export function ensureTeamOwnerOptions() {
  const options = teamOwnerOptions();
  const selected = resolveTeamOwner();
  const displayOptions =
    selected && !options.some((item) => item.owner === selected)
      ? [{ owner: selected, displayName: selected, roleLabel: '负责人' }, ...options]
      : options;
  elements.teamOwnerSelect.innerHTML = displayOptions.length
    ? displayOptions
        .map(
          (item) =>
            `<option value="${escapeHtml(item.owner)}"${item.owner === selected ? ' selected' : ''}>${escapeHtml(
              formatTeamOwnerDisplay(item.roleLabel, item.displayName)
            )}</option>`
        )
        .join('')
    : '<option value="">暂无负责人</option>';
  if (selected) {
    elements.teamOwnerSelect.value = selected;
  }
  enhanceTeamOwnerSelect();
}


export function ensureOwnerReviewControls() {
  enhanceOwnerReviewSelects();
  enhanceOwnerReviewLoadFilterSelect();

  if (elements.ownerReviewBorrowToggle) {
    elements.ownerReviewBorrowToggle.checked = state.ownerReviewShowBorrowing;
  }
}

