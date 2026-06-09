export const DEFAULT_RESPONSIBILITY_IDENTITIES = [
  {
    identityId: 'resp-017',
    displayName: '杨锦帆（硬装）',
    sourceName: '杨锦帆',
    discipline: 'hard',
    scope: 'both',
    validFrom: '',
    validTo: null,
  },
  {
    identityId: 'resp-018',
    displayName: '杨锦帆（软装）',
    sourceName: '杨锦帆',
    discipline: 'soft',
    scope: 'both',
    validFrom: '',
    validTo: null,
  },
  {
    identityId: 'resp-019',
    displayName: '马琳琳（硬装）',
    sourceName: '马琳琳',
    discipline: 'hard',
    scope: 'both',
    validFrom: '',
    validTo: null,
  },
  {
    identityId: 'resp-020',
    displayName: '马琳琳（软装）',
    sourceName: '马琳琳',
    discipline: 'soft',
    scope: 'both',
    validFrom: '',
    validTo: null,
  },
  {
    identityId: 'resp-021',
    displayName: '熊亮（硬装）',
    sourceName: '熊亮',
    discipline: 'hard',
    scope: 'both',
    validFrom: '',
    validTo: null,
  },
  {
    identityId: 'resp-022',
    displayName: '熊亮（软装）',
    sourceName: '熊亮',
    discipline: 'soft',
    scope: 'both',
    validFrom: '',
    validTo: null,
  },
  {
    identityId: 'resp-023',
    displayName: '周俊彤（硬装）',
    sourceName: '周俊彤',
    discipline: 'hard',
    scope: 'both',
    validFrom: '',
    validTo: null,
  },
  {
    identityId: 'resp-024',
    displayName: '周俊彤（软装）',
    sourceName: '周俊彤',
    discipline: 'soft',
    scope: 'both',
    validFrom: '',
    validTo: null,
  },
];

const DISCIPLINE_SLOT_KEYS = {
  hard: ['cd_owner'],
  soft: ['vm_owner'],
  both: ['cd_owner', 'vm_owner'],
};

const DISCIPLINE_FIELD_NAMES = {
  hard: ['CD负责人', '硬装负责人'],
  soft: ['VM负责人', '软装负责人'],
  both: ['CD负责人', '硬装负责人', 'VM负责人', '软装负责人'],
};

function normalizeDiscipline(value = '') {
  return ['hard', 'soft', 'both'].includes(value) ? value : '';
}

function normalizeScope(value = '') {
  return ['direct', 'franchise', 'both', 'all'].includes(value) ? value : 'both';
}

function isIdentityActive(identity = {}) {
  if (identity.active === false || identity.status === 'inactive' || identity.status === 'disabled') {
    return false;
  }
  return identity.validTo === undefined || identity.validTo === null || identity.validTo === '';
}

function normalizeResponsibilityIdentity(identity = {}, index = 0) {
  const identityId = String(identity.identityId || identity.id || identity.key || `resp-${index + 1}`).trim();
  const sourceName = String(identity.sourceName || identity.name || '').trim();
  const discipline = normalizeDiscipline(identity.discipline);
  const displayName = String(identity.displayName || sourceName || identityId).trim();
  return {
    ...identity,
    identityId,
    id: identity.id || identityId,
    displayName,
    sourceName,
    discipline,
    scope: normalizeScope(identity.scope || identity.businessScope),
    validFrom: identity.validFrom || '',
    validTo: identity.validTo ?? null,
    active: isIdentityActive(identity),
  };
}

export function normalizeResponsibilityIdentities(rawIdentities = []) {
  const source = Array.isArray(rawIdentities) ? rawIdentities : Object.values(rawIdentities || {});
  const byId = new Map();

  for (const identity of DEFAULT_RESPONSIBILITY_IDENTITIES) {
    const normalized = normalizeResponsibilityIdentity(identity, byId.size);
    byId.set(normalized.identityId, normalized);
  }

  for (const identity of source) {
    const normalized = normalizeResponsibilityIdentity(identity, byId.size);
    if (!normalized.identityId || !normalized.sourceName || !normalized.discipline) {
      continue;
    }
    byId.set(normalized.identityId, normalized);
  }

  return Array.from(byId.values());
}

export function responsibilityIdentitySlotKeys(identity = {}) {
  return DISCIPLINE_SLOT_KEYS[identity.discipline] || [];
}

export function responsibilityIdentityFieldNames(identity = {}) {
  return DISCIPLINE_FIELD_NAMES[identity.discipline] || [];
}

export function findResponsibilityIdentity(token, architecture = {}) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) {
    return null;
  }

  const identities = architecture.responsibilityIdentities || normalizeResponsibilityIdentities();
  return (
    identities.find(
      (identity) =>
        identity.active !== false &&
        [identity.identityId, identity.id, identity.displayName, identity.name].filter(Boolean).includes(normalizedToken)
    ) || null
  );
}

export function responsibilityIdentitiesForSourceName(sourceName, architecture = {}) {
  const normalizedName = String(sourceName || '').trim();
  if (!normalizedName) {
    return [];
  }
  const identities = architecture.responsibilityIdentities || normalizeResponsibilityIdentities();
  return identities.filter((identity) => identity.active !== false && identity.sourceName === normalizedName);
}

export function responsibilityIdentityForAssignment(personName, slot = {}, architecture = {}) {
  const slotDiscipline = normalizeDiscipline(slot?.discipline);
  if (!slotDiscipline) {
    return null;
  }
  return (
    responsibilityIdentitiesForSourceName(personName, architecture).find(
      (identity) => identity.discipline === slotDiscipline || identity.discipline === 'both'
    ) || null
  );
}

export function ownerTokenInfo(owner, architecture = {}) {
  const identity = findResponsibilityIdentity(owner, architecture);
  if (!identity) {
    return {
      owner: String(owner || '').trim(),
      identity: null,
      sourceName: String(owner || '').trim(),
      displayName: String(owner || '').trim(),
      discipline: '',
    };
  }
  return {
    owner: identity.identityId,
    identity,
    sourceName: identity.sourceName,
    displayName: identity.displayName,
    discipline: identity.discipline,
  };
}
