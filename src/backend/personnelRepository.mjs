import crypto from 'node:crypto';

import { normalizePersonnelArchitecture } from './personnelArchitecture.mjs';
import { readNamesFromRawField } from './personnelNames.mjs';
import { RESPONSIBILITY_SLOTS } from './responsibilitySlots.mjs';

const ROLE_GROUP_META = {
  cdLead: { position: 'lead', discipline: 'hard' },
  creativeLead: { position: 'lead', discipline: 'both' },
  vmLead: { position: 'lead', discipline: 'soft' },
  cdDesigner: { position: 'designer', discipline: 'hard', sourceField: 'CD设计师' },
  vmDesigner: { position: 'designer', discipline: 'soft', sourceField: 'VM设计师' },
};

const POSITION_VALUES = new Set(['owner', 'lead', 'designer', 'member']);
const STATUS_VALUES = new Set(['active', 'inactive']);
const DISCIPLINE_VALUES = new Set(['', 'hard', 'soft', 'both']);

const PROJECT_FIELD_PERSONNEL_META = {
  cd_owner: { position: 'owner', discipline: 'hard' },
  vm_owner: { position: 'owner', discipline: 'soft' },
  cd_lead: { position: 'lead', discipline: 'hard', roleKey: 'cdLead' },
  vm_lead: { position: 'lead', discipline: 'soft', roleKey: 'vmLead' },
  cd_designer: { position: 'designer', discipline: 'hard', roleKey: 'cdDesigner' },
  vm_designer: { position: 'designer', discipline: 'soft', roleKey: 'vmDesigner' },
  point_designer: { position: 'designer', discipline: 'soft', roleKey: 'vmDesigner' },
  display_designer: { position: 'member', discipline: '' },
};

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function sortZh(items) {
  return unique(items).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function stableDingtalkPersonId(name) {
  const hash = crypto.createHash('sha1').update(String(name || '')).digest('hex').slice(0, 12);
  return `dingtalk-person-${hash}`;
}

function personSortValue(person, index) {
  if (Number.isFinite(Number(person.sortOrder))) {
    return Number(person.sortOrder);
  }
  return index;
}

function groupPeopleFromRows(rows, roleKey) {
  return rows
    .filter((row) => row.role_key === roleKey)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.person_name.localeCompare(b.person_name, 'zh-Hans-CN'))
    .map((row) => row.person_name);
}

function normalizeDraftPeople(rawPeople) {
  const entries = Array.isArray(rawPeople)
    ? rawPeople
    : Object.entries(rawPeople || {}).map(([name, person]) => ({ ...person, name: person.name || name }));

  return entries
    .filter((person) => person?.name)
    .map((person, index) => ({
      id: person.id || crypto.randomUUID(),
      name: String(person.name).trim(),
      displayName: String(person.displayName || '').trim(),
      position: person.position || 'member',
      discipline: person.discipline || '',
      status: person.status || 'active',
      source: person.source || 'local',
      aliases: Array.isArray(person.aliases) ? person.aliases.map(String).filter(Boolean) : [],
      assignmentNote: String(person.assignmentNote || person.reviewNote || '').trim(),
      sourceField: String(person.sourceField || '').trim(),
      sortOrder: personSortValue(person, index),
    }));
}

function roleGroupsFromPeople(people, providedRoleGroups = {}) {
  const roleGroups = {};
  const peopleByName = new Map(people.map((person) => [person.name, person]));
  for (const [roleKey, meta] of Object.entries(ROLE_GROUP_META)) {
    const providedPeople = providedRoleGroups?.[roleKey]?.people;
    const peopleForRole = sortZh(
      people
        .filter(
          (person) =>
            person.status === 'active' && person.position === meta.position && person.discipline === meta.discipline
        )
        .map((person) => person.name)
    );
    const orderedProvidedPeople = Array.isArray(providedPeople)
      ? providedPeople.filter((name) => {
          const person = peopleByName.get(name);
          return person?.status === 'active' && person.position === meta.position && person.discipline === meta.discipline;
        })
      : [];
    roleGroups[roleKey] = {
      position: meta.position,
      discipline: meta.discipline,
      ...(meta.sourceField ? { sourceField: meta.sourceField } : {}),
      people: unique(orderedProvidedPeople.concat(peopleForRole)),
    };
  }
  return roleGroups;
}

function normalizeTeams(rawTeams = []) {
  return Array.isArray(rawTeams)
    ? rawTeams
        .filter((team) => team?.owner)
        .map((team, index) => ({
          id: team.id || `team-${index + 1}`,
          owner: String(team.owner).trim(),
          cdLeads: unique(Array.isArray(team.cdLeads) ? team.cdLeads.map(String) : []),
          vmLeads: unique(Array.isArray(team.vmLeads) ? team.vmLeads.map(String) : []),
          sortOrder: Number.isFinite(Number(team.sortOrder)) ? Number(team.sortOrder) : index,
        }))
    : [];
}

function validatePersonnelDraft(people, roleGroups, teams) {
  const byName = new Map();
  for (const person of people) {
    if (!person.name) {
      throw new Error('人员姓名不能为空');
    }
    if (byName.has(person.name)) {
      throw new Error(`人员姓名重复：${person.name}`);
    }
    if (!POSITION_VALUES.has(person.position)) {
      throw new Error(`不支持的岗位：${person.position}`);
    }
    if (!STATUS_VALUES.has(person.status)) {
      throw new Error(`不支持的人员状态：${person.status}`);
    }
    if (!DISCIPLINE_VALUES.has(person.discipline)) {
      throw new Error(`不支持的硬装/软装属性：${person.discipline}`);
    }
    if (person.position === 'designer' && person.discipline === 'both') {
      throw new Error(`${person.name} 不能设置为硬装+软装设计师`);
    }
    if (person.position === 'lead' && !['hard', 'soft', 'both'].includes(person.discipline)) {
      throw new Error(`${person.name} 作为组长时必须选择 CD、VM 或创意组长`);
    }
    if (person.position === 'designer' && !['hard', 'soft'].includes(person.discipline)) {
      throw new Error(`${person.name} 作为设计师时必须选择硬装或软装`);
    }
    if (person.position === 'owner' && !['hard', 'soft', 'both'].includes(person.discipline)) {
      throw new Error(`${person.name} 作为负责人时必须选择硬装、软装或双边`);
    }
    byName.set(person.name, person);
  }

  for (const [roleKey, group] of Object.entries(roleGroups)) {
    const meta = ROLE_GROUP_META[roleKey];
    if (!meta) {
      continue;
    }
    for (const name of group.people || []) {
      const person = byName.get(name);
      if (!person) {
        throw new Error(`${name} 不存在于本地人员库`);
      }
      if (person.status !== 'active') {
        throw new Error(`${name} 已停用，不能保留在架构总表`);
      }
      if (person.position !== meta.position || person.discipline !== meta.discipline) {
        throw new Error(`${name} 与 ${roleKey} 的岗位或属性不一致`);
      }
    }
  }

  const assignedLeads = new Map();
  for (const team of teams) {
    const owner = byName.get(team.owner);
    if (!owner || owner.position !== 'owner' || owner.status !== 'active') {
      throw new Error(`${team.owner} 不是可用负责人`);
    }
    for (const [roleKey, names] of [
      ['cdLead', team.cdLeads],
      ['vmLead', team.vmLeads],
    ]) {
      const meta = ROLE_GROUP_META[roleKey];
      for (const name of names) {
        const person = byName.get(name);
        if (!person || person.position !== 'lead' || person.discipline !== meta.discipline || person.status !== 'active') {
          throw new Error(`${name} 不能分配到 ${team.owner} 的 ${roleKey}`);
        }
        const assignmentKey = `${roleKey}:${name}`;
        if (assignedLeads.has(assignmentKey)) {
          throw new Error(`${name} 已分配给 ${assignedLeads.get(assignmentKey)}`);
        }
        assignedLeads.set(assignmentKey, team.owner);
      }
    }
  }
}

export function databaseHasPersonnel(database) {
  return database.prepare('select count(*) as count from personnel_people').get().count > 0;
}

function collectProjectPersonnelCandidates(projects = []) {
  const candidates = new Map();
  for (const project of projects || []) {
    for (const slot of RESPONSIBILITY_SLOTS) {
      const meta = PROJECT_FIELD_PERSONNEL_META[slot.slotKey];
      if (!meta) {
        continue;
      }
      for (const fieldName of slot.fields || []) {
        for (const name of readNamesFromRawField(project, fieldName)) {
          if (!candidates.has(name)) {
            candidates.set(name, {
              name,
              position: meta.position,
              discipline: meta.discipline,
              roleKey: meta.roleKey || '',
              sourceField: fieldName,
            });
          }
        }
      }
    }
  }
  return Array.from(candidates.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

function roleSortOrders(database) {
  const rows = database
    .prepare('select role_key, max(sort_order) as max_sort_order from personnel_role_members group by role_key')
    .all();
  return new Map(rows.map((row) => [row.role_key, Number(row.max_sort_order ?? -1)]));
}

function canonicalPersonNameLookup(rows = []) {
  const variants = new Map();
  for (const row of rows) {
    const names = [row.name, row.display_name, ...parseJson(row.aliases_json, [])]
      .map((name) => String(name || '').trim())
      .filter(Boolean);
    for (const name of names) {
      if (!variants.has(name)) {
        variants.set(name, new Set());
      }
      variants.get(name).add(row.name);
    }
  }

  return new Map(
    Array.from(variants.entries())
      .filter(([, canonicalNames]) => canonicalNames.size === 1)
      .map(([variant, canonicalNames]) => [variant, Array.from(canonicalNames)[0]])
  );
}

export function syncPersonnelFromProjects(database, projects = []) {
  const candidates = collectProjectPersonnelCandidates(projects);
  if (!candidates.length) {
    return { insertedPeople: [], addedRoleMembers: [] };
  }

  const existingRows = database
    .prepare('select name, display_name, aliases_json, position, discipline, status from personnel_people')
    .all();
  const existingByName = new Map(existingRows.map((row) => [row.name, row]));
  const canonicalByVariant = canonicalPersonNameLookup(existingRows);
  const maxSortOrder = Number(database.prepare('select max(sort_order) as max_sort_order from personnel_people').get()?.max_sort_order ?? -1);
  const roleOrder = roleSortOrders(database);
  const insertedPeople = [];
  const addedRoleMembers = [];
  const now = nowIso();

  const insertPerson = database.prepare(
    `insert into personnel_people
      (id, name, display_name, position, discipline, status, source, aliases_json,
       assignment_note, source_field, sort_order, updated_at)
     values (?, ?, '', ?, ?, 'active', 'dingtalk-derived', '[]', ?, ?, ?, ?)
     on conflict(name) do nothing`
  );
  const insertRoleMember = database.prepare(
    `insert or ignore into personnel_role_members (role_key, person_name, sort_order)
     values (?, ?, ?)`
  );

  for (const [index, candidate] of candidates.entries()) {
    const canonicalName = canonicalByVariant.get(candidate.name) || candidate.name;
    let person = existingByName.get(canonicalName);
    if (!person) {
      const assignmentNote = `项目责任字段自动补入的正式人员；来源字段：${candidate.sourceField}。`;
      insertPerson.run(
        stableDingtalkPersonId(canonicalName),
        canonicalName,
        candidate.position,
        candidate.discipline,
        assignmentNote,
        candidate.sourceField,
        maxSortOrder + index + 1,
        now
      );
      person = {
        name: canonicalName,
        position: candidate.position,
        discipline: candidate.discipline,
        status: 'active',
      };
      existingByName.set(canonicalName, person);
      canonicalByVariant.set(canonicalName, canonicalName);
      insertedPeople.push({
        name: canonicalName,
        position: candidate.position,
        discipline: candidate.discipline,
        sourceField: candidate.sourceField,
      });
    }

    if (
      candidate.roleKey &&
      person.status === 'active' &&
      person.position === candidate.position &&
      person.discipline === candidate.discipline
    ) {
      const nextSortOrder = (roleOrder.get(candidate.roleKey) ?? -1) + 1;
      const result = insertRoleMember.run(candidate.roleKey, canonicalName, nextSortOrder);
      if (result.changes > 0) {
        roleOrder.set(candidate.roleKey, nextSortOrder);
        addedRoleMembers.push({
          roleKey: candidate.roleKey,
          name: canonicalName,
          sourceField: candidate.sourceField,
        });
      }
    }
  }

  return { insertedPeople, addedRoleMembers };
}

export function savePersonnelArchitectureToDatabase(database, rawArchitecture) {
  const normalized = normalizePersonnelArchitecture(rawArchitecture || {});
  const people = normalizeDraftPeople(rawArchitecture.people || normalized.people);
  const roleGroups = roleGroupsFromPeople(people, rawArchitecture.roleGroups || normalized.roleGroups);
  const teams = normalizeTeams(rawArchitecture.teams || []);

  validatePersonnelDraft(people, roleGroups, teams);

  database.exec('BEGIN');
  try {
    database.prepare('delete from personnel_team_members').run();
    database.prepare('delete from personnel_teams').run();
    database.prepare('delete from personnel_role_members').run();
    database.prepare('delete from personnel_people').run();

    const personStatement = database.prepare(
      `insert into personnel_people
        (id, name, display_name, position, discipline, status, source, aliases_json,
         assignment_note, source_field, sort_order, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    people.forEach((person, index) => {
      personStatement.run(
        person.id,
        person.name,
        person.displayName,
        person.position,
        person.discipline,
        person.status,
        person.source,
        JSON.stringify(person.aliases || []),
        person.assignmentNote,
        person.sourceField,
        person.sortOrder ?? index,
        nowIso()
      );
    });

    const roleStatement = database.prepare(
      `insert into personnel_role_members (role_key, person_name, sort_order)
       values (?, ?, ?)`
    );
    for (const [roleKey, group] of Object.entries(roleGroups)) {
      (group.people || []).forEach((name, index) => roleStatement.run(roleKey, name, index));
    }

    const teamStatement = database.prepare(
      `insert into personnel_teams (id, owner_name, sort_order, updated_at)
       values (?, ?, ?, ?)`
    );
    const teamMemberStatement = database.prepare(
      `insert into personnel_team_members (team_id, person_name, role_key, sort_order)
       values (?, ?, ?, ?)`
    );
    teams.forEach((team, index) => {
      const teamId = team.id || `team-${index + 1}`;
      teamStatement.run(teamId, team.owner, team.sortOrder ?? index, nowIso());
      team.cdLeads.forEach((name, memberIndex) => teamMemberStatement.run(teamId, name, 'cdLead', memberIndex));
      team.vmLeads.forEach((name, memberIndex) => teamMemberStatement.run(teamId, name, 'vmLead', memberIndex));
    });

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }

  return readPersonnelArchitectureFromDatabase(database);
}

function overlayJsonPersonMetadata(databaseArchitecture, jsonArchitecture) {
  const jsonPeople = jsonArchitecture?.people || {};
  const people = { ...(databaseArchitecture.people || {}) };
  for (const [name, jsonPerson] of Object.entries(jsonPeople)) {
    if (!people[name] || !Array.isArray(jsonPerson?.aliases) || !jsonPerson.aliases.length) {
      continue;
    }
    people[name] = {
      ...people[name],
      aliases: Array.from(new Set([...(people[name].aliases || []), ...jsonPerson.aliases])),
    };
  }
  return normalizePersonnelArchitecture({
    ...databaseArchitecture,
    categories: {
      ...(jsonArchitecture.categories || {}),
      ...(databaseArchitecture.categories || {}),
    },
    soleDualDisciplineOwner: databaseArchitecture.soleDualDisciplineOwner || jsonArchitecture.soleDualDisciplineOwner || null,
    responsibilityIdentities: jsonArchitecture.responsibilityIdentities || databaseArchitecture.responsibilityIdentities || [],
    people,
    roleDisciplines: {
      ...(jsonArchitecture.roleDisciplines || {}),
      ...(databaseArchitecture.roleDisciplines || {}),
    },
    aliases: {
      ...(databaseArchitecture.aliases || {}),
      ...(jsonArchitecture.aliases || {}),
    },
  });
}

export function seedPersonnelDatabase(database, rawArchitecture) {
  const jsonArchitecture = normalizePersonnelArchitecture(rawArchitecture);
  if (!databaseHasPersonnel(database)) {
    savePersonnelArchitectureToDatabase(database, jsonArchitecture);
  }
  return overlayJsonPersonMetadata(readPersonnelArchitectureFromDatabase(database), jsonArchitecture);
}

export function readPersonnelArchitectureFromDatabase(database) {
  const people = database
    .prepare('select * from personnel_people order by sort_order, name')
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      ...(row.display_name ? { displayName: row.display_name } : {}),
      position: row.position,
      discipline: row.discipline,
      status: row.status,
      source: row.source,
      ...(parseJson(row.aliases_json, []).length ? { aliases: parseJson(row.aliases_json, []) } : {}),
      ...(row.assignment_note ? { assignmentNote: row.assignment_note } : {}),
      ...(row.source_field ? { sourceField: row.source_field } : {}),
      sortOrder: Number(row.sort_order || 0),
    }));
  const roleRows = database.prepare('select * from personnel_role_members order by role_key, sort_order, person_name').all();
  const teamRows = database.prepare('select * from personnel_teams order by sort_order, owner_name').all();
  const teamMemberRows = database.prepare('select * from personnel_team_members order by team_id, role_key, sort_order, person_name').all();
  const roleGroups = {};

  for (const [roleKey, meta] of Object.entries(ROLE_GROUP_META)) {
    roleGroups[roleKey] = {
      position: meta.position,
      discipline: meta.discipline,
      ...(meta.sourceField ? { sourceField: meta.sourceField } : {}),
      people: groupPeopleFromRows(roleRows, roleKey),
    };
  }

  const teams = teamRows.map((team) => ({
    id: team.id,
    owner: team.owner_name,
    sortOrder: Number(team.sort_order || 0),
    cdLeads: teamMemberRows
      .filter((member) => member.team_id === team.id && member.role_key === 'cdLead')
      .map((member) => member.person_name),
    vmLeads: teamMemberRows
      .filter((member) => member.team_id === team.id && member.role_key === 'vmLead')
      .map((member) => member.person_name),
  }));

  return normalizePersonnelArchitecture({
    schemaVersion: 1,
    sourcePriority: ['localSqlitePersonnelDatabase', 'dingtalkProjectData', 'systemInference'],
    people,
    roleGroups,
    roleDisciplines: {
      cdLead: 'hard',
      creativeLead: 'both',
      vmLead: 'soft',
      cdDesigner: 'hard',
      vmDesigner: 'soft',
    },
    teams,
    hiddenPeople: [],
  });
}
