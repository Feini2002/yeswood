import { readNamesFromRawField } from './personnelNames.mjs';

const ROLE_DEFINITIONS = [
  { label: '硬装设计师', fields: ['CD设计师'] },
  { label: '点位设计师', fields: ['点位设计师'] },
  { label: '软装设计师', fields: ['VM设计师', '软装设计师'] },
  { label: '摆场设计师', fields: ['摆场设计师'] },
  { label: '硬装组长', fields: ['CD组长'] },
  { label: '软装组长', fields: ['VM组长'] },
  { label: '硬装负责人', fields: ['CD负责人', '硬装负责人'] },
  { label: '软装负责人', fields: ['VM负责人', '软装负责人'] },
  { label: '负责人', fields: ['负责人'] },
];

function normalizeName(value) {
  return String(value || '').trim();
}

function canonicalPersonName(name, architecture = {}) {
  const raw = normalizeName(name);
  if (!raw) {
    return '';
  }
  const people = architecture.people || {};
  if (people[raw]) {
    return people[raw].name || raw;
  }
  for (const [personKey, person] of Object.entries(people)) {
    const variants = new Set([personKey, person?.name, person?.displayName, ...(person?.aliases || [])].filter(Boolean));
    if (variants.has(raw)) {
      return person?.name || personKey;
    }
  }
  for (const [canonical, aliases] of Object.entries(architecture.aliases || {})) {
    if (canonical === raw || (aliases || []).includes(raw)) {
      return canonical;
    }
  }
  return raw;
}

function uniquePush(list, value) {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

function hiddenPeopleSet(architecture = {}) {
  return new Set(
    (architecture.hiddenPeople || [])
      .map((name) => canonicalPersonName(name, architecture))
      .filter(Boolean)
  );
}

export function projectAssociationKey(project = {}) {
  if (project.id) {
    return { key: String(project.id), weak: false };
  }
  if (project.rawId) {
    return { key: String(project.rawId), weak: false };
  }
  if (project.name && project.storeCode) {
    return { key: `${project.name}:${project.storeCode}`, weak: false };
  }
  return { key: String(project.name || 'unknown-project'), weak: true };
}

export function buildTeamRoster(team = {}, personnelArchitecture = {}) {
  const membersByName = new Map();
  const groups = [];
  const hiddenPeople = hiddenPeopleSet(personnelArchitecture);
  const isHiddenPerson = (name) => hiddenPeople.has(canonicalPersonName(name, personnelArchitecture));
  const owner = canonicalPersonName(team.owner, personnelArchitecture);

  const addMember = (name, group) => {
    const canonical = canonicalPersonName(name, personnelArchitecture);
    if (!canonical || hiddenPeople.has(canonical)) {
      return;
    }
    if (!membersByName.has(canonical)) {
      membersByName.set(canonical, {
        name: canonical,
        displayName: personnelArchitecture.people?.[canonical]?.displayName || canonical,
        groupId: group?.id || '',
        groupName: group?.name || '',
      });
      return;
    }
    const entry = membersByName.get(canonical);
    if (!entry.groupId && group?.id) {
      entry.groupId = group.id;
      entry.groupName = group.name || '';
    }
  };

  if (owner && !hiddenPeople.has(owner)) {
    addMember(owner, null);
  }

  for (const [index, rawGroup] of (team.groups || []).entries()) {
    const lead = canonicalPersonName(rawGroup.lead, personnelArchitecture);
    const group = {
      id: rawGroup.id || `group-${index + 1}`,
      name: rawGroup.name || `小组${index + 1}`,
      lead: lead && !hiddenPeople.has(lead) ? lead : '',
      leadDisplay: '',
      members: [],
    };
    group.leadDisplay = group.lead || '组长未配置';

    if (group.lead) {
      addMember(group.lead, group);
    }
    for (const member of rawGroup.members || []) {
      const canonical = canonicalPersonName(member, personnelArchitecture);
      if (!canonical || isHiddenPerson(canonical)) {
        continue;
      }
      uniquePush(group.members, canonical);
      addMember(canonical, group);
    }
    groups.push(group);
  }

  for (const member of [...(team.members || []), ...(team.designers || [])]) {
    addMember(member, null);
  }

  return {
    owner,
    groupCount: groups.length,
    memberCount: membersByName.size,
    groups,
    members: Array.from(membersByName.values()),
    membersByName,
  };
}

export function buildProjectTeamAssociations(project = {}, roster, personnelArchitecture = {}) {
  const memberNames = [];
  const groupIds = [];
  const groupNames = [];
  const roleLabelsByMember = {};
  const unmappedNames = [];
  const seenUnmapped = new Set();

  const registerMappedMember = (canonicalName, roleLabel) => {
    const member = roster.membersByName.get(canonicalName);
    if (!member) {
      return false;
    }
    uniquePush(memberNames, canonicalName);
    uniquePush(groupIds, member.groupId);
    uniquePush(groupNames, member.groupName);
    roleLabelsByMember[canonicalName] ||= [];
    uniquePush(roleLabelsByMember[canonicalName], roleLabel);
    return true;
  };

  const registerUnmapped = (fieldName, sourceName, canonicalName, roleLabel) => {
    const key = `${fieldName}:${canonicalName}`;
    if (seenUnmapped.has(key)) {
      return;
    }
    seenUnmapped.add(key);
    unmappedNames.push({ fieldName, sourceName, canonicalName, roleLabel });
  };

  for (const definition of ROLE_DEFINITIONS) {
    for (const fieldName of definition.fields) {
      for (const sourceName of readNamesFromRawField(project, fieldName)) {
        const canonicalName = canonicalPersonName(sourceName, personnelArchitecture);
        if (!canonicalName) {
          continue;
        }
        if (!registerMappedMember(canonicalName, definition.label)) {
          registerUnmapped(fieldName, sourceName, canonicalName, definition.label);
        }
      }
    }
  }

  return {
    ...projectAssociationKey(project),
    memberNames,
    groupIds,
    groupNames,
    roleLabelsByMember,
    unmappedNames,
  };
}
