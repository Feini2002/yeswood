import { enrichProjectWithHardDecorationDeadline } from './hardDecorationDeadlineRules.mjs';
import { EMPTY_PERSONNEL_VALUES, splitPersonnelNames } from './personnelNames.mjs';

export function buildPersonDisplayLookup(personnelArchitecture = {}) {
  const lookup = new Map();
  const people = personnelArchitecture.people || {};
  const entries = Array.isArray(people)
    ? people.filter((person) => person?.name).map((person) => [person.name, person])
    : Object.entries(people);

  for (const [canonicalName, person] of entries) {
    const display = String(person.displayName || '').trim() || canonicalName;
    const variants = new Set([canonicalName, person.name, person.displayName, ...(person.aliases || [])].filter(Boolean));
    for (const variant of variants) {
      lookup.set(variant, display);
    }
  }

  for (const [canonical, aliases] of Object.entries(personnelArchitecture.aliases || {})) {
    const person = Array.isArray(people) ? people.find((item) => item.name === canonical) : people[canonical];
    const display = String(person?.displayName || '').trim() || canonical;
    lookup.set(canonical, display);
    for (const alias of aliases || []) {
      lookup.set(alias, display);
    }
  }

  return lookup;
}

export function resolvePersonDisplayName(name, lookupOrArchitecture) {
  const text = String(name ?? '').trim();
  if (!text) {
    return text;
  }
  const lookup =
    lookupOrArchitecture instanceof Map ? lookupOrArchitecture : buildPersonDisplayLookup(lookupOrArchitecture);
  return lookup.get(text) || text;
}

function joinFormattedNames(formatted, originalText) {
  if (originalText.includes('、')) {
    return formatted.join('、');
  }
  if (originalText.includes('，')) {
    return formatted.join('，');
  }
  if (originalText.includes(',')) {
    return formatted.join(', ');
  }
  if (originalText.includes(';') || originalText.includes('；')) {
    return formatted.join('；');
  }
  return formatted.join('、');
}

export function formatPersonnelDisplay(value, lookupOrArchitecture) {
  const text = String(value ?? '').trim();
  if (!text || EMPTY_PERSONNEL_VALUES.has(text)) {
    return text;
  }

  const lookup =
    lookupOrArchitecture instanceof Map ? lookupOrArchitecture : buildPersonDisplayLookup(lookupOrArchitecture);
  const names = splitPersonnelNames(text);
  if (!names.length) {
    return text;
  }

  const formatted = names.map((name) => resolvePersonDisplayName(name, lookup));
  if (formatted.length === 1) {
    return formatted[0];
  }
  return joinFormattedNames(formatted, text);
}

export function enrichProjectForDisplay(project, lookupOrArchitecture, options = {}) {
  if (!project) {
    return project;
  }

  const lookup =
    lookupOrArchitecture instanceof Map ? lookupOrArchitecture : buildPersonDisplayLookup(lookupOrArchitecture);
  const owner = formatPersonnelDisplay(project.owner, lookup);
  const cdOwner = formatPersonnelDisplay(project.cdOwner, lookup);
  const vmOwner = formatPersonnelDisplay(project.vmOwner, lookup);
  const ownerDisplay = owner;
  const rawFields = {};

  for (const [key, cell] of Object.entries(project.rawFields || {})) {
    const display = cell?.display;
    rawFields[key] = {
      ...cell,
      ...(display === undefined || display === null
        ? {}
        : { display: formatPersonnelDisplay(String(display), lookup) }),
    };
  }

  const deadlineOptions = {};
  const calendar = options.hardDecorationCalendar || options.calendar;
  if (calendar) {
    deadlineOptions.calendar = calendar;
  }
  if (options.today) {
    deadlineOptions.today = options.today;
  }

  return enrichProjectWithHardDecorationDeadline({
    ...project,
    owner,
    cdOwner,
    vmOwner,
    ownerDisplay,
    rawFields,
  }, deadlineOptions);
}

export function enrichProjectsForDisplay(projects, personnelArchitecture = {}, options = {}) {
  const lookup = buildPersonDisplayLookup(personnelArchitecture);
  return (projects || []).map((project) => enrichProjectForDisplay(project, lookup, options));
}
