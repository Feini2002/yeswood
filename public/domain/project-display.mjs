import { escapeHtml } from '../lib/format.mjs';

export const SLEEP_STORE_STATUS = '睡眠店';
export const SLEEP_STORE_NAME_PATTERN = /睡眠店/;
export const SLEEP_STORE_STATUS_FIELDS = ['店态'];
export const PROJECT_NAME_FIELDS = ['项目名称', '门店名称'];

export function isSleepStoreProject(project = {}) {
  const storeStatus = String(project.storeStatus ?? '').trim() || readRawFieldDisplay(project, SLEEP_STORE_STATUS_FIELDS);
  if (storeStatus === SLEEP_STORE_STATUS) {
    return true;
  }
  const projectName = [project.name, readRawFieldDisplay(project, PROJECT_NAME_FIELDS)]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return SLEEP_STORE_NAME_PATTERN.test(projectName);
}

export function progressFallbackStage(value) {
  const text = String(value ?? '').trim();
  if (!text || /^\d+(?:\.\d+)?%?$/.test(text)) {
    return '';
  }
  return text;
}

export function readRawFieldDisplay(project, fieldNames = []) {
  const rawFields = project?.rawFields || {};
  const entries = Object.entries(rawFields);

  for (const fieldName of fieldNames) {
    const exact = rawFields[fieldName]?.display;
    if (String(exact ?? '').trim()) {
      return String(exact).trim();
    }
  }

  for (const fieldName of fieldNames) {
    const needle = String(fieldName || '').trim().toLowerCase();
    if (!needle) {
      continue;
    }
    const match = entries.find(([key, cell]) => {
      const display = String(cell?.display ?? '').trim();
      return display && String(key).toLowerCase().includes(needle);
    });
    if (match) {
      return String(match[1]?.display ?? '').trim();
    }
  }

  return '';
}

export function displayProjectOwner(project) {
  const owner = String(project?.ownerDisplay || project?.owner || '').trim();
  if (owner) {
    return owner;
  }
  return [displayProjectHardOwner(project), displayProjectSoftOwner(project)].filter(Boolean).join('、');
}

export function displayProjectHardOwner(project) {
  const owner = String(project?.cdOwner ?? '').trim();
  const hardOwner = owner || readRawFieldDisplay(project, ['CD负责人', '硬装负责人']);
  if (hardOwner) {
    return hardOwner;
  }
  if (isSleepStoreProject(project)) {
    return String(project?.ownerDisplay || project?.owner || '').trim();
  }
  return '';
}

export function displayProjectSoftOwner(project) {
  if (isSleepStoreProject(project)) {
    return '';
  }
  const owner = String(project?.vmOwner ?? '').trim();
  return owner || readRawFieldDisplay(project, ['VM负责人', '软装负责人']);
}

const HIDDEN_FILTER_VALUES = new Set(['未填写', '未填入']);

export function isAssignmentValueMissing(value) {
  const text = String(value ?? '').trim();
  return !text || text === '--' || HIDDEN_FILTER_VALUES.has(text);
}

export function projectAssignmentGap(project) {
  const slots = [
    { kind: 'leader', label: '硬组', value: readRawFieldDisplay(project, ['CD组长']) },
    { kind: 'designer', label: '硬装设计师', value: readRawFieldDisplay(project, ['CD设计师']) },
  ];
  if (!isSleepStoreProject(project)) {
    slots.push(
      { kind: 'leader', label: '软组', value: readRawFieldDisplay(project, ['VM组长']) },
      { kind: 'designer', label: '软装设计师', value: readRawFieldDisplay(project, ['VM设计师']) }
    );
  }
  const missingSlots = slots.filter((slot) => isAssignmentValueMissing(slot.value));
  const leaderSlots = slots.filter((slot) => slot.kind === 'leader');
  const designerSlots = slots.filter((slot) => slot.kind === 'designer');
  const missingLeader = missingSlots.some((slot) => slot.kind === 'leader');
  const missingDesigner = missingSlots.some((slot) => slot.kind === 'designer');
  const missingAllLeaders = leaderSlots.every((slot) => isAssignmentValueMissing(slot.value));
  const missingAllDesigners = designerSlots.every((slot) => isAssignmentValueMissing(slot.value));
  return {
    missingLeader,
    missingDesigner,
    missingAny: missingLeader || missingDesigner,
    missingBoth: missingLeader && missingDesigner,
    missingAllLeaders,
    missingAllDesigners,
    missingAllCoreAssignments: missingAllLeaders && missingAllDesigners,
    missingLabels: missingSlots.map((slot) => slot.label),
  };
}

export function firstVersionAssignmentGap(projectOrGap) {
  const gap = projectOrGap?.missingLabels ? projectOrGap : projectAssignmentGap(projectOrGap);
  return Boolean(gap.missingAllCoreAssignments);
}

export function projectAssignmentStatusLabel(gap) {
  if (firstVersionAssignmentGap(gap)) {
    return '组长 / 设计师均未填写';
  }
  if (gap.missingLeader && gap.missingDesigner) {
    return '缺组长 / 缺设计师';
  }
  if (gap.missingLeader) {
    return '缺组长';
  }
  if (gap.missingDesigner) {
    return '缺设计师';
  }
  return '配置完整';
}

export function projectAssignmentDetailLabel(gap) {
  if (firstVersionAssignmentGap(gap)) {
    return '组长和设计师均未填写';
  }
  return gap.missingLabels.length ? gap.missingLabels.join('、') : '配置完整';
}

export function projectAssignmentReminderText(project) {
  const gap = projectAssignmentGap(project);
  if (!gap.missingAny) {
    return '';
  }
  const labels = gap.missingLabels.map(
    (label) =>
      ({
        硬组: '硬装组长',
        软组: '软装组长',
      })[label] || label
  );
  return `请尽快填写${labels.join('、')}，避免项目责任链断档。`;
}

export function renderProjectAssignmentReminder(project) {
  const reminder = projectAssignmentReminderText(project);
  if (!reminder) {
    return '';
  }
  return `
    <div class="project-detail-assignment-reminder" role="note">
      <strong>人员配置待补全</strong>
      <span>${escapeHtml(reminder)}</span>
    </div>
  `;
}

export function summarizeProjectAssignments(projects = []) {
  const items = projects
    .map((project) => ({ project, gap: projectAssignmentGap(project) }))
    .filter((item) => firstVersionAssignmentGap(item.gap));

  return {
    total: items.length,
    missingLeader: items.filter((item) => item.gap.missingAllLeaders).length,
    missingDesigner: items.filter((item) => item.gap.missingAllDesigners).length,
    missingBoth: items.length,
    items,
  };
}
