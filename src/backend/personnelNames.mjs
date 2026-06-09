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
