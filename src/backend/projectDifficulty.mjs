import { isSleepStoreProject } from './projectTypeRules.mjs';

export const PROJECT_DIFFICULTY_RULES = [
  {
    ruleKey: 'direct-hard-regular',
    label: '直营-硬装（含旗舰店）',
    scope: 'direct',
    discipline: 'hard',
    storeTier: 'regular',
    benchmarkArea: 700,
    baseWorkdays: 26,
    monthlyCapacity: 0.8,
  },
  {
    ruleKey: 'direct-hard-sinking',
    label: '直营-硬装（下沉）',
    scope: 'direct',
    discipline: 'hard',
    storeTier: 'sinking',
    benchmarkArea: 400,
    baseWorkdays: 17,
    monthlyCapacity: 1.3,
  },
  {
    ruleKey: 'franchise-hard-regular',
    label: '加盟-硬装（含旗舰店）',
    scope: 'franchise',
    discipline: 'hard',
    storeTier: 'regular',
    benchmarkArea: 500,
    baseWorkdays: 19,
    monthlyCapacity: 1.2,
  },
  {
    ruleKey: 'franchise-hard-sinking',
    label: '加盟-硬装（下沉）',
    scope: 'franchise',
    discipline: 'hard',
    storeTier: 'sinking',
    benchmarkArea: 400,
    baseWorkdays: 17,
    monthlyCapacity: 1.3,
  },
  {
    ruleKey: 'direct-soft-regular',
    label: '直营-软装（含旗舰店）',
    scope: 'direct',
    discipline: 'soft',
    storeTier: 'regular',
    benchmarkArea: 700,
    baseWorkdays: 18,
    monthlyCapacity: 1.2,
  },
  {
    ruleKey: 'franchise-soft-regular',
    label: '加盟-软装（含旗舰店）',
    scope: 'franchise',
    discipline: 'soft',
    storeTier: 'regular',
    benchmarkArea: 500,
    baseWorkdays: 14.5,
    monthlyCapacity: 1.5,
  },
  {
    ruleKey: 'creative-soft-black',
    label: '创意团队-软装（黑标店）',
    scope: 'creative',
    discipline: 'soft',
    storeTier: 'black',
    benchmarkArea: 700,
    baseWorkdays: 16,
    monthlyCapacity: 1.4,
  },
  {
    ruleKey: 'creative-hard-black',
    label: '创意团队-硬装（黑标店）',
    scope: 'creative',
    discipline: 'hard',
    storeTier: 'black',
    benchmarkArea: 700,
    baseWorkdays: 26,
    monthlyCapacity: 0.8,
  },
  {
    ruleKey: 'creative-soft-super',
    label: '创意团队-软装（超体店）',
    scope: 'creative',
    discipline: 'soft',
    storeTier: 'super',
    benchmarkArea: 1800,
    baseWorkdays: 51,
    monthlyCapacity: 0.4,
  },
  {
    ruleKey: 'creative-hard-super',
    label: '创意团队-硬装（超体店）',
    scope: 'creative',
    discipline: 'hard',
    storeTier: 'super',
    benchmarkArea: 1800,
    baseWorkdays: 60,
    monthlyCapacity: 0.4,
  },
  {
    ruleKey: 'creative-design-specialty',
    label: '创意团队（睡眠/儿童/维莎）',
    scope: 'creative',
    discipline: 'design',
    storeTier: 'specialty',
    benchmarkArea: 300,
    baseWorkdays: 20.5,
    monthlyCapacity: 1.1,
  },
  {
    ruleKey: 'purchase-super',
    label: '软装采购（超体/旗舰店）',
    scope: 'purchase',
    discipline: 'purchase',
    storeTier: 'super',
    benchmarkArea: 1500,
    baseWorkdays: 2,
    monthlyCapacity: 11,
  },
  {
    ruleKey: 'purchase-regular',
    label: '软装采购（直营+加盟+黑标+睡眠+维莎+儿童）',
    scope: 'purchase',
    discipline: 'purchase',
    storeTier: 'regular',
    benchmarkArea: 500,
    baseWorkdays: 1,
    monthlyCapacity: 22,
  },
].map((rule, index) => ({
  ...rule,
  sortOrder: index + 1,
  notes: rule.scope === 'purchase'
    ? '采购规则仅保留备案，当前项目综合负荷不计入采购工作量。'
    : '来自项目负荷人效标准：启动损耗 5%，不再把理想人力 8 折计入项目综合负荷。',
}));

export const PROJECT_DIFFICULTY_SCHEMA_VERSION = 2;
const STARTUP_LOSS_FACTOR = 1.05;
// 2025 口径切换：不再把理想人力 8 折计入项目综合负荷，ADJUSTMENT_FACTOR 仅含启动损耗。
// 保留历史常量引用以便回溯变更原因：原 EFFICIENCY_FACTOR = 0.8 已于 2025-04 移除计算链。
const EFFICIENCY_FACTOR = 1;
const MONTHLY_WORKDAYS = 22;
const ADJUSTMENT_FACTOR = STARTUP_LOSS_FACTOR;

const HARD_FIELDS = [
  '硬装项目进度',
  '硬装方案情况',
  '硬装方案评分',
  '硬装资料',
  'CD组长',
  'CD设计师',
  '施工图初稿完成时间',
  '施工图完成审核时间',
  '翱平链接',
  '躺平链接',
  '上会日期',
  '上会情况',
  '复尺时间',
  '复尺情况',
  '平面开始时间',
  '内部审核结束时间',
];

const SOFT_FIELDS = [
  '软装项目进度',
  '软装完成情况',
  '软装方案评分',
  '软装资料',
  'VM组长',
  'VM设计师',
  '点位设计师',
  '摆场设计师',
  '点位完成情况',
  '软装方案开始时间',
  '软装发项目群时间',
];

const PURCHASE_FIELDS = ['采购完成情况', '采购时间', '采购资料', '采购清单', '产品清单发出时间'];

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean).join('、');
  }
  if (typeof value === 'object') {
    return normalizeText(value.display ?? value.text ?? value.name ?? value.value ?? '');
  }
  return String(value).trim();
}

function normalizeKey(value) {
  return normalizeText(value).replace(/\s+/g, '').toLowerCase();
}

function rawEntries(project = {}) {
  return Object.entries(project.rawFields || {}).map(([key, value]) => [key, normalizeText(value)]);
}

export function readDifficultyField(project, fieldNames = []) {
  const rawFields = project?.rawFields || {};
  const entries = rawEntries(project);

  for (const fieldName of fieldNames) {
    const exact = normalizeText(rawFields[fieldName]);
    if (exact) {
      return exact;
    }
  }

  for (const fieldName of fieldNames) {
    const needle = normalizeKey(fieldName);
    if (!needle) {
      continue;
    }
    const match = entries.find(([key, value]) => {
      if (!value) {
        return false;
      }
      const normalizedKey = normalizeKey(key);
      return normalizedKey.includes(needle) || needle.includes(normalizedKey);
    });
    if (match) {
      return match[1];
    }
  }

  return '';
}

function hasAnyField(project, fieldNames) {
  return fieldNames.some((fieldName) => Boolean(readDifficultyField(project, [fieldName])));
}

function parseArea(value) {
  const raw = normalizeText(value).replace(/,/g, '');
  const match = raw.match(/\d+(?:\.\d+)?/);
  if (!match) {
    return 0;
  }
  const area = Number(match[0]);
  return Number.isFinite(area) ? area : 0;
}

function inferStoreTier(project) {
  if (isSleepStoreProject(project)) {
    return 'sleep';
  }

  const text = [
    project?.storeStatus,
    project?.businessType,
    project?.name,
    readDifficultyField(project, ['店态']),
    readDifficultyField(project, ['业态']),
    readDifficultyField(project, ['组别']),
  ]
    .map(normalizeText)
    .join(' ');

  if (/超体|超一线/.test(text)) return 'super';
  if (/黑标/.test(text)) return 'black';
  if (/睡眠|儿童|维莎|维沙/.test(text)) return 'specialty';
  if (/下沉/.test(text)) return 'sinking';
  if (/旗舰/.test(text)) return 'flagship';
  return 'regular';
}

function inferScope(project, storeTier) {
  const group = readDifficultyField(project, ['组别']);
  const text = [group, project?.storeStatus, project?.businessType].map(normalizeText).join(' ');

  if (storeTier === 'black' || storeTier === 'super' || storeTier === 'specialty' || /创意/.test(text)) {
    return 'creative';
  }
  if (/加盟/.test(text)) {
    return 'franchise';
  }
  return 'direct';
}

function inferStoreNature(project) {
  const text = [
    readDifficultyField(project, ['店铺性质']),
    readDifficultyField(project, ['组别']),
    project?.storeStatus,
    project?.name,
  ]
    .map(normalizeText)
    .join(' ');
  if (/老店|老|调整|改造|翻新|换址|重装|扩店/.test(text)) {
    return 'old-adjustment';
  }
  if (/新店|新/.test(text)) {
    return 'new-store';
  }
  return 'unknown';
}

function designTierForRule(storeTier) {
  if (storeTier === 'sinking') return 'sinking';
  if (storeTier === 'black') return 'black';
  if (storeTier === 'super') return 'super';
  if (storeTier === 'specialty') return 'specialty';
  return 'regular';
}

function purchaseTierForRule(storeTier) {
  return storeTier === 'super' || storeTier === 'flagship' ? 'super' : 'regular';
}

function findRule({ scope, discipline, storeTier }) {
  return PROJECT_DIFFICULTY_RULES.find(
    (rule) => rule.scope === scope && rule.discipline === discipline && rule.storeTier === storeTier
  );
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function round1(number) {
  return Math.round(number * 10) / 10;
}

function round2(number) {
  return Math.round(number * 100) / 100;
}

function levelForScore(score) {
  if (!score) return '未判定';
  if (score < 18) return '轻';
  if (score < 36) return '中';
  if (score < 55) return '难';
  return '重';
}

function componentFromRule(rule, { area, storeNature }) {
  const benchmarkArea =
    storeNature === 'old-adjustment' && rule.discipline !== 'purchase' && rule.storeTier === 'regular'
      ? 500
      : rule.benchmarkArea;
  const areaFactor = area > 0 ? clamp(area / benchmarkArea, 0.6, 1.8) : 1;
  const adjustedWorkdays = rule.baseWorkdays * areaFactor * ADJUSTMENT_FACTOR;

  return {
    ruleKey: rule.ruleKey,
    label: rule.label,
    scope: rule.scope,
    discipline: rule.discipline,
    storeTier: rule.storeTier,
    baseWorkdays: rule.baseWorkdays,
    benchmarkArea,
    actualArea: area || null,
    areaFactor: round2(areaFactor),
    adjustedWorkdays: round1(adjustedWorkdays),
    adjustedWorkdaysExact: adjustedWorkdays,
    monthlyCapacity: rule.monthlyCapacity,
  };
}

function emptySegment() {
  return {
    score: 0,
    workdays: 0,
    weight: 0,
    ruleKeys: [],
  };
}

function segmentFromComponents(components, discipline) {
  const matched = components.filter((component) => component.discipline === discipline);
  const workdays = round1(
    matched.reduce((sum, component) => sum + (component.adjustedWorkdaysExact ?? component.adjustedWorkdays), 0)
  );
  return {
    score: Math.round(workdays),
    workdays,
    weight: round2(workdays / MONTHLY_WORKDAYS),
    ruleKeys: matched.map((component) => component.ruleKey),
  };
}

function inferWorkDimensions(project) {
  const sleepStore = isSleepStoreProject(project);
  return {
    hard: hasAnyField(project, HARD_FIELDS),
    soft: sleepStore ? false : hasAnyField(project, SOFT_FIELDS),
    purchase: hasAnyField(project, PURCHASE_FIELDS),
  };
}

export function scoreProjectDifficulty(project = {}) {
  const area = parseArea(readDifficultyField(project, ['面积']) || project.area);
  const storeTier = inferStoreTier(project);
  const storeNature = inferStoreNature(project);
  const scope = inferScope(project, storeTier);
  const dimensions = inferWorkDimensions(project);
  const components = [];
  const designTier = designTierForRule(storeTier);

  if (designTier === 'specialty' && (dimensions.hard || dimensions.soft)) {
    const rule = findRule({ scope: 'creative', discipline: 'design', storeTier: 'specialty' });
    if (rule) {
      components.push(componentFromRule(rule, { area, storeNature }));
    }
  } else {
    if (dimensions.hard) {
      const hardRule =
        findRule({ scope, discipline: 'hard', storeTier: designTier }) ||
        findRule({ scope, discipline: 'hard', storeTier: 'regular' });
      if (hardRule) {
        components.push(componentFromRule(hardRule, { area, storeNature }));
      }
    }
    if (dimensions.soft) {
      const softRule =
        findRule({ scope, discipline: 'soft', storeTier: designTier }) ||
        findRule({ scope, discipline: 'soft', storeTier: 'regular' });
      if (softRule) {
        components.push(componentFromRule(softRule, { area, storeNature }));
      }
    }
  }

  const workdays = round1(
    components.reduce((sum, component) => sum + (component.adjustedWorkdaysExact ?? component.adjustedWorkdays), 0)
  );
  const score = Math.round(workdays);
  const weight = round2(workdays / MONTHLY_WORKDAYS);
  const hard = segmentFromComponents(components, 'hard');
  const soft = segmentFromComponents(components, 'soft');
  const design = segmentFromComponents(components, 'design');
  const ignoredPurchaseRule = dimensions.purchase
    ? findRule({
        scope: 'purchase',
        discipline: 'purchase',
        storeTier: purchaseTierForRule(storeTier),
      })
    : null;

  return {
    schemaVersion: PROJECT_DIFFICULTY_SCHEMA_VERSION,
    score,
    level: levelForScore(score),
    weight,
    workdays,
    hard,
    soft,
    design: design.ruleKeys.length ? design : emptySegment(),
    ignoredPurchase: Boolean(ignoredPurchaseRule),
    ignoredPurchaseRuleKey: ignoredPurchaseRule?.ruleKey || '',
    area: area || null,
    storeTier,
    storeNature,
    scope,
    startupLossFactor: STARTUP_LOSS_FACTOR,
    efficiencyFactor: EFFICIENCY_FACTOR,
    monthlyWorkdays: MONTHLY_WORKDAYS,
    ruleKeys: components.map((component) => component.ruleKey),
    components,
  };
}
