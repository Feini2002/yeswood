import fs from 'node:fs/promises';

import { applySoleDualDisciplineOwnerPolicy } from './personnelOwners.mjs';
import { normalizeResponsibilityIdentities } from './responsibilityIdentities.mjs';

const DISCIPLINE_LABELS = {
  hard: '硬装',
  soft: '软装',
  both: '硬装+软装',
  pending: '待确认',
};

const POSITION_LABELS = {
  owner: '负责人',
  lead: '组长',
  designer: '设计师',
  member: '成员',
};

const DEFAULT_SOURCE_PRIORITY = ['localPersonnelDatabase', 'dingtalkProjectData', 'systemInference'];

const OWNER_DISCIPLINE_FIELD_PATTERN = /负责人.*(硬装|软装)|(?:硬装|软装).*负责人/;

function disciplineLabel(value) {
  return DISCIPLINE_LABELS[value] || value || '';
}

function positionLabel(value) {
  return POSITION_LABELS[value] || value || '';
}

function categoryKey(position, discipline) {
  if (!position || !discipline) {
    return '';
  }
  return `${position}${discipline[0].toUpperCase()}${discipline.slice(1)}`;
}

function categoryLabel(position, discipline) {
  const disciplineText = disciplineLabel(discipline);
  const positionText = positionLabel(position);
  return disciplineText && positionText ? `${disciplineText}${positionText}` : '';
}

function normalizePeople(rawPeople = {}, categories = {}) {
  const entries = Array.isArray(rawPeople)
    ? rawPeople.filter((person) => person?.name).map((person) => [person.name, person])
    : Object.entries(rawPeople);

  return Object.fromEntries(
    entries.map(([name, person]) => {
      const normalized = { ...person };
      if (!normalized.name && Array.isArray(rawPeople)) {
        normalized.name = name;
      }
      if (normalized.discipline && !normalized.disciplineLabel) {
        normalized.disciplineLabel = disciplineLabel(normalized.discipline);
      }
      if (normalized.position && !normalized.positionLabel) {
        normalized.positionLabel = positionLabel(normalized.position);
      }
      if (normalized.position && normalized.discipline) {
        normalized.category = normalized.category || categoryKey(normalized.position, normalized.discipline);
        normalized.categoryLabel =
          normalized.categoryLabel || categories[normalized.category]?.label || categoryLabel(normalized.position, normalized.discipline);
      }
      if (normalized.category && categories[normalized.category]?.label) {
        normalized.categoryLabel = normalized.categoryLabel || categories[normalized.category].label;
      }
      return [name, normalized];
    })
  );
}

function mergeAliases(rawAliases = {}, people = {}) {
  const aliases = { ...rawAliases };
  for (const [name, person] of Object.entries(people)) {
    if (Array.isArray(person.aliases) && person.aliases.length) {
      aliases[name] = Array.from(new Set([...(aliases[name] || []), ...person.aliases]));
    }
  }
  return aliases;
}

export function normalizePersonnelArchitecture(raw = {}) {
  const categories = raw.categories || {};
  const people = normalizePeople(raw.people || {}, categories);
  const responsibilityIdentities = normalizeResponsibilityIdentities(raw.responsibilityIdentities || []);
  const roleGroups = raw.roleGroups || raw.groups || {};
  const roleDisciplines = {
    ...Object.fromEntries(
      Object.entries(roleGroups)
        .filter(([, group]) => group?.discipline)
        .map(([key, group]) => [key, group.discipline])
    ),
    ...(raw.roleDisciplines || {}),
  };

  const architecture = {
    schemaVersion: Number(raw.schemaVersion || raw.version || 1),
    version: Number(raw.version || raw.schemaVersion || 1),
    sourcePriority: Array.isArray(raw.sourcePriority) ? raw.sourcePriority : DEFAULT_SOURCE_PRIORITY,
    categories,
    soleDualDisciplineOwner: raw.soleDualDisciplineOwner || null,
    responsibilityIdentities,
    responsibilityIdentitiesById: Object.fromEntries(
      responsibilityIdentities.map((identity) => [identity.identityId, identity])
    ),
    people,
    roleDisciplines,
    roleGroups,
    groups: roleGroups,
    teams: Array.isArray(raw.teams) ? raw.teams : [],
    aliases: mergeAliases(raw.aliases || {}, people),
    hiddenPeople: Array.isArray(raw.hiddenPeople) ? raw.hiddenPeople : [],
  };

  return applySoleDualDisciplineOwnerPolicy(architecture);
}

export async function readPersonnelArchitecture(filePath) {
  if (!filePath) {
    return normalizePersonnelArchitecture();
  }

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return normalizePersonnelArchitecture(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return normalizePersonnelArchitecture();
    }
    throw error;
  }
}

export function findOwnerDisciplineEvidence(projects = []) {
  const fields = new Set();

  for (const project of projects) {
    for (const key of Object.keys(project.rawFields || {})) {
      if (OWNER_DISCIPLINE_FIELD_PATTERN.test(key)) {
        fields.add(key);
      }
    }
  }

  return {
    hasExplicitOwnerDisciplineField: fields.size > 0,
    fields: Array.from(fields).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
  };
}
