import { isSleepStoreProject } from './projectTypeRules.mjs';

export const EMPTY_PERSONNEL_VALUES = new Set(['未填写', '未填入', '未分配', '暂无', '无']);

export function splitPersonnelNames(value) {
  if (value === null || value === undefined) {
    return [];
  }

  const text = typeof value === 'string' ? value : String(value);
  return text
    .split(/[、,，；;\n\r]+/)
    .map((name) => name.trim())
    .filter((name) => name && !EMPTY_PERSONNEL_VALUES.has(name));
}

function personnelEntries(personnelArchitecture = {}) {
  const architecture = personnelArchitecture || {};
  const people = architecture.people || {};
  return Array.isArray(people)
    ? people.filter((person) => person?.name).map((person) => [person.name, person])
    : Object.entries(people).map(([name, person]) => [person?.name || name, person || {}]);
}

function addCanonicalVariant(variants, variant, canonicalName) {
  const text = String(variant || '').trim();
  const canonical = String(canonicalName || '').trim();
  if (!text || !canonical || EMPTY_PERSONNEL_VALUES.has(text)) {
    return;
  }
  if (!variants.has(text)) {
    variants.set(text, new Set());
  }
  variants.get(text).add(canonical);
}

export function buildCanonicalPersonnelNameLookup(personnelArchitecture = {}) {
  const architecture = personnelArchitecture || {};
  const variants = new Map();

  for (const [canonicalName, person] of personnelEntries(architecture)) {
    const canonical = String(canonicalName || '').trim();
    if (!canonical) {
      continue;
    }
    [canonical, person.name, person.displayName, ...(person.aliases || [])].forEach((variant) =>
      addCanonicalVariant(variants, variant, canonical)
    );
  }

  for (const [canonical, aliases] of Object.entries(architecture.aliases || {})) {
    addCanonicalVariant(variants, canonical, canonical);
    for (const alias of aliases || []) {
      addCanonicalVariant(variants, alias, canonical);
    }
  }

  return new Map(
    Array.from(variants.entries())
      .filter(([, canonicalNames]) => canonicalNames.size === 1)
      .map(([variant, canonicalNames]) => [variant, Array.from(canonicalNames)[0]])
  );
}

export function resolveCanonicalPersonnelName(name, lookupOrArchitecture = {}) {
  const text = String(name || '').trim();
  if (!text || EMPTY_PERSONNEL_VALUES.has(text)) {
    return '';
  }
  const lookup =
    lookupOrArchitecture instanceof Map ? lookupOrArchitecture : buildCanonicalPersonnelNameLookup(lookupOrArchitecture);
  return lookup.get(text) || text;
}

export function canonicalizePersonnelNames(names = [], lookupOrArchitecture = {}) {
  const lookup =
    lookupOrArchitecture instanceof Map ? lookupOrArchitecture : buildCanonicalPersonnelNameLookup(lookupOrArchitecture);
  const result = [];
  const seen = new Set();
  for (const name of names || []) {
    const canonical = resolveCanonicalPersonnelName(name, lookup);
    if (!canonical || seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    result.push(canonical);
  }
  return result;
}

export function readNamesFromRawField(project, fieldName) {
  const display = project.rawFields?.[fieldName]?.display;
  if (display === undefined || display === null) {
    return [];
  }
  return splitPersonnelNames(display);
}

export const CD_OWNER_FIELDS = ['CD负责人', '硬装负责人'];
export const VM_OWNER_FIELDS = ['VM负责人', '软装负责人'];

/** DingTalk columns that identify the project owner for team / ownerMonthly scope. */
export const PROJECT_OWNER_FIELDS = ['负责人', ...CD_OWNER_FIELDS, ...VM_OWNER_FIELDS];

export function readProjectOwnerNames(project) {
  const names = new Set();
  const hardOnly = isSleepStoreProject(project);
  const ownerFields = hardOnly ? CD_OWNER_FIELDS : PROJECT_OWNER_FIELDS;
  for (const fieldName of ownerFields) {
    for (const name of readNamesFromRawField(project, fieldName)) {
      names.add(name);
    }
  }
  for (const name of splitPersonnelNames(project?.cdOwner)) {
    names.add(name);
  }
  if (!hardOnly) {
    for (const name of splitPersonnelNames(project?.vmOwner)) {
      names.add(name);
    }
  }
  if (hardOnly && !names.size) {
    for (const name of readNamesFromRawField(project, '负责人')) {
      names.add(name);
    }
  }
  if (!names.size) {
    for (const name of splitPersonnelNames(project?.owner)) {
      names.add(name);
    }
  }
  return Array.from(names);
}

export function primaryProjectOwner(project) {
  const names = readProjectOwnerNames(project);
  return names[0] || project?.owner || '未分配';
}
