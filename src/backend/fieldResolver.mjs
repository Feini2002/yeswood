export const CANONICAL_FIELD_RULES = {
  name: {
    baseNames: ['项目名称', '门店名称'],
    matchMode: 'prefix',
    requireUnique: true,
  },
  province: {
    baseNames: ['省份'],
    matchMode: 'exact',
  },
  businessType: {
    baseNames: ['业态'],
    matchMode: 'exact',
  },
  storeStatus: {
    baseNames: ['店态'],
    matchMode: 'exact',
  },
  status: {
    baseNames: ['项目状态'],
    matchMode: 'prefix',
    excludeIfContains: ['进度'],
    requireUnique: true,
  },
  owner: {
    baseNames: ['负责人', 'CD负责人', '硬装负责人', 'VM负责人', '软装负责人'],
    matchMode: 'exact',
  },
  progress: {
    baseNames: ['硬装项目进度', '进度'],
    matchMode: 'progress',
  },
  startDate: {
    baseNames: ['启动时间', '启动日期', '开始日期'],
    matchMode: 'exact',
  },
  dueDate: {
    baseNames: ['计划开业时间', '计划完成日期', '截止日期'],
    matchMode: 'prefixOrExact',
  },
  riskLevel: {
    baseNames: ['风险等级'],
    matchMode: 'prefixOrExact',
  },
  riskNotes: {
    baseNames: ['风险说明', '风险备注'],
    matchMode: 'prefixOrExact',
  },
  updatedAt: {
    baseNames: ['更新时间', '最后更新时间'],
    matchMode: 'prefixOrExact',
  },
};

const CANONICAL_FIELD_ORDER = Object.keys(CANONICAL_FIELD_RULES);

export function normalizeFieldLabel(label) {
  return String(label || '')
    .trim()
    .replace(/\([^)]*\)/g, '')
    .replace(/（[^）]*）/g, '')
    .trim();
}

export function scanSourceFieldKeys(records) {
  const keys = new Set();
  for (const record of records || []) {
    const fields = record?.fields && typeof record.fields === 'object' ? record.fields : {};
    for (const key of Object.keys(fields)) {
      keys.add(key);
    }
  }
  return Array.from(keys);
}

function asFieldName(value) {
  if (Array.isArray(value)) {
    return value.find(Boolean) || '';
  }
  return typeof value === 'string' ? value : '';
}

function isExcluded(sourceFieldKey, rule) {
  if (!Array.isArray(rule.excludeIfContains) || rule.excludeIfContains.length === 0) {
    return false;
  }
  return rule.excludeIfContains.some((token) => sourceFieldKey.includes(token));
}

function scoreCandidate(sourceFieldKey, baseName, rule) {
  if (isExcluded(sourceFieldKey, rule)) {
    return 0;
  }

  const normalizedSource = normalizeFieldLabel(sourceFieldKey);
  const normalizedBase = normalizeFieldLabel(baseName);

  if (rule.matchMode === 'exact') {
    if (sourceFieldKey === baseName || normalizedSource === normalizedBase) {
      return 100;
    }
    return 0;
  }

  if (rule.matchMode === 'prefix') {
    if (sourceFieldKey === baseName || normalizedSource === normalizedBase) {
      return 100;
    }
    if (sourceFieldKey.startsWith(baseName)) {
      return 80 + baseName.length;
    }
    return 0;
  }

  if (rule.matchMode === 'prefixOrExact') {
    if (sourceFieldKey === baseName || normalizedSource === normalizedBase) {
      return 100;
    }
    if (sourceFieldKey.startsWith(baseName)) {
      return 80 + baseName.length;
    }
    return 0;
  }

  if (rule.matchMode === 'progress') {
    if (sourceFieldKey.includes('软装')) {
      return 0;
    }
    if (sourceFieldKey === '硬装项目进度' || normalizedSource === '硬装项目进度') {
      return 100;
    }
    if (sourceFieldKey.startsWith('硬装项目进度')) {
      return 95;
    }
    if (normalizedSource === '进度' || sourceFieldKey === '进度') {
      return 70;
    }
    return 0;
  }

  return 0;
}

function findAutoCandidates(sourceFieldKeys, rule) {
  const scored = [];

  for (const sourceFieldKey of sourceFieldKeys) {
    let bestScore = 0;
    for (const baseName of rule.baseNames) {
      bestScore = Math.max(bestScore, scoreCandidate(sourceFieldKey, baseName, rule));
    }
    if (bestScore > 0) {
      scored.push({ sourceFieldKey, score: bestScore });
    }
  }

  scored.sort((left, right) => right.score - left.score || left.sourceFieldKey.localeCompare(right.sourceFieldKey, 'zh-CN'));
  return scored;
}

function pickUniqueCandidate(candidates, rule) {
  if (candidates.length === 0) {
    return null;
  }

  const topScore = candidates[0].score;
  const topCandidates = candidates.filter((candidate) => candidate.score === topScore);

  if (topCandidates.length === 1) {
    return topCandidates[0];
  }

  if (rule.requireUnique) {
    return null;
  }

  return null;
}

function resolveCanonicalField(canonicalKey, sourceFieldKeys, { envFieldMap = {}, cachedBindings = [] } = {}) {
  const rule = CANONICAL_FIELD_RULES[canonicalKey];
  if (!rule) {
    return { binding: null, ambiguous: null };
  }

  const envFieldName = asFieldName(envFieldMap[canonicalKey]);
  if (envFieldName && sourceFieldKeys.includes(envFieldName)) {
    return {
      binding: {
        canonicalKey,
        sourceFieldKey: envFieldName,
        matchMethod: 'env',
        confidence: 1,
      },
      ambiguous: null,
    };
  }

  const cachedBinding = cachedBindings.find(
    (item) => item.canonicalKey === canonicalKey && sourceFieldKeys.includes(item.sourceFieldKey)
  );
  if (cachedBinding) {
    return {
      binding: {
        canonicalKey,
        sourceFieldKey: cachedBinding.sourceFieldKey,
        matchMethod: 'cache',
        confidence: Number(cachedBinding.confidence ?? 0.95),
      },
      ambiguous: null,
    };
  }

  const candidates = findAutoCandidates(sourceFieldKeys, rule);
  const winner = pickUniqueCandidate(candidates, rule);
  if (winner) {
    const matchMethod =
      winner.score >= 100 ? 'exact' : rule.matchMode === 'progress' ? 'keyword' : rule.matchMode === 'prefix' ? 'prefix' : 'prefix';
    return {
      binding: {
        canonicalKey,
        sourceFieldKey: winner.sourceFieldKey,
        matchMethod,
        confidence: Math.min(1, winner.score / 100),
      },
      ambiguous: null,
    };
  }

  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    return {
      binding: null,
      ambiguous: {
        canonicalKey,
        candidates: candidates.filter((candidate) => candidate.score === candidates[0].score).map((candidate) => candidate.sourceFieldKey),
      },
    };
  }

  return { binding: null, ambiguous: null };
}

export function resolveFieldMap(sourceFieldKeys, { envFieldMap = {}, cachedBindings = [] } = {}) {
  const fieldMap = {};
  const bindings = [];
  const unresolved = [];
  const ambiguous = [];

  for (const canonicalKey of CANONICAL_FIELD_ORDER) {
    const result = resolveCanonicalField(canonicalKey, sourceFieldKeys, { envFieldMap, cachedBindings });
    if (result.binding) {
      fieldMap[canonicalKey] = result.binding.sourceFieldKey;
      bindings.push(result.binding);
      continue;
    }

    if (result.ambiguous) {
      ambiguous.push(result.ambiguous);
      continue;
    }

    unresolved.push(canonicalKey);
  }

  return {
    fieldMap,
    bindings,
    unresolved,
    ambiguous,
    fieldMappingWarnings: {
      unresolved,
      ambiguous,
    },
  };
}
