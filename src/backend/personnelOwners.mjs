/** 公司有且只有一位同时负责硬装与软装的负责人（项目看盘归属口径）。 */
export const SOLE_DUAL_DISCIPLINE_OWNER_NAME = '杨锦帆';

export const CREATIVE_OWNER_CATEGORY_LABEL = '创意负责人';

export function isSoleDualDisciplineOwner(name) {
  return String(name || '').trim() === SOLE_DUAL_DISCIPLINE_OWNER_NAME;
}

export function resolveOwnerDisplayTitle(person = {}, categories = {}) {
  if (person.categoryLabel) {
    return person.categoryLabel;
  }
  if (person.category && categories[person.category]?.label) {
    return categories[person.category].label;
  }
  if (isSoleDualDisciplineOwner(person.name) || person.dualDisciplineOwner) {
    return CREATIVE_OWNER_CATEGORY_LABEL;
  }
  return '';
}

export function applySoleDualDisciplineOwnerPolicy(architecture = {}) {
  const policy = architecture.soleDualDisciplineOwner || {
    name: SOLE_DUAL_DISCIPLINE_OWNER_NAME,
    displayTitle: CREATIVE_OWNER_CATEGORY_LABEL,
    discipline: 'both',
  };
  const name = policy.name || SOLE_DUAL_DISCIPLINE_OWNER_NAME;
  const person = architecture.people?.[name];
  if (!person) {
    return architecture;
  }

  architecture.soleDualDisciplineOwner = policy;
  person.dualDisciplineOwner = true;
  person.discipline = person.discipline || policy.discipline || 'both';
  person.position = person.position || 'owner';
  person.category = person.category || 'ownerBoth';
  person.categoryLabel = CREATIVE_OWNER_CATEGORY_LABEL;
  return architecture;
}
