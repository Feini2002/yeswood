const SLEEP_STORE_STATUS = '睡眠店';
const SLEEP_STORE_NAME_PATTERN = /睡眠店/;
const SLEEP_STORE_STATUS_FIELDS = ['店态'];
const PROJECT_NAME_FIELDS = ['项目名称', '门店名称'];
const SLEEP_HARD_CLOSED_STAGE_PATTERN = /^(闭环|完成|已完成)$/;
const SLEEP_CONSTRUCTION_CLOSED_STAGE_PATTERN =
  /施工.*闭环|施工图.*完成.*审核|施工图.*审核.*完成|施工图.*审核.*通过|施工图完成审核|施工图审核通过/;

export const HARD_CONSTRUCTION_REVIEW_FIELDS = [
  '施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）',
  '施工图完成审核时间',
  '施工图终稿完成时间',
  '商场审核完成时间',
];

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean).join('、');
  }
  if (typeof value === 'object') {
    return normalizeText(value.display ?? value.text ?? value.name ?? value.value ?? value.label ?? '');
  }
  return String(value).trim();
}

function readRawDisplay(project, fieldNames = []) {
  const rawFields = project?.rawFields || {};
  const entries = Object.entries(rawFields);
  for (const fieldName of fieldNames) {
    const exact = normalizeText(rawFields[fieldName]);
    if (exact) {
      return exact;
    }
  }
  for (const fieldName of fieldNames) {
    const needle = normalizeText(fieldName).toLowerCase();
    if (!needle) {
      continue;
    }
    const match = entries.find(([key, cell]) => {
      const display = normalizeText(cell);
      return display && String(key).toLowerCase().includes(needle);
    });
    if (match) {
      return normalizeText(match[1]);
    }
  }
  return '';
}

export function isSleepStoreProject(project = {}) {
  const storeStatus = normalizeText(project.storeStatus) || readRawDisplay(project, SLEEP_STORE_STATUS_FIELDS);
  if (storeStatus === SLEEP_STORE_STATUS) {
    return true;
  }

  const projectName = [project.name, readRawDisplay(project, PROJECT_NAME_FIELDS)]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
  return SLEEP_STORE_NAME_PATTERN.test(projectName);
}

export function isSleepHardDecorationClosed(project = {}) {
  if (!isSleepStoreProject(project)) {
    return false;
  }

  const hardStage = normalizeText(
    readRawDisplay(project, ['硬装项目进度', '硬装进度']) || project.hardProgressStage || project.progress
  );
  const constructionReview = readRawDisplay(project, HARD_CONSTRUCTION_REVIEW_FIELDS);

  return (
    Boolean(constructionReview) ||
    SLEEP_HARD_CLOSED_STAGE_PATTERN.test(hardStage) ||
    SLEEP_CONSTRUCTION_CLOSED_STAGE_PATTERN.test(hardStage)
  );
}
