/** DingTalk column → responsibility slot (SQL key uses snake_case). */
export const RESPONSIBILITY_SLOTS = [
  {
    slotKey: 'owner',
    apiRoleKey: 'owner',
    label: '负责人',
    fields: ['负责人'],
    discipline: null,
  },
  {
    slotKey: 'cd_owner',
    apiRoleKey: 'cdOwner',
    label: '硬装负责人',
    fields: ['CD负责人', '硬装负责人'],
    discipline: 'hard',
  },
  {
    slotKey: 'vm_owner',
    apiRoleKey: 'vmOwner',
    label: '软装负责人',
    fields: ['VM负责人', '软装负责人'],
    discipline: 'soft',
  },
  { slotKey: 'cd_lead', apiRoleKey: 'cdLead', label: '硬装组长', fields: ['CD组长'], discipline: 'hard' },
  { slotKey: 'vm_lead', apiRoleKey: 'vmLead', label: '软装组长', fields: ['VM组长'], discipline: 'soft' },
  { slotKey: 'cd_designer', apiRoleKey: 'cdDesigner', label: '硬装设计师', fields: ['CD设计师'], discipline: 'hard' },
  { slotKey: 'vm_designer', apiRoleKey: 'vmDesigner', label: '软装设计师', fields: ['VM设计师'], discipline: 'soft' },
  { slotKey: 'point_designer', apiRoleKey: 'pointDesigner', label: '点位设计师', fields: ['点位设计师'], discipline: 'soft' },
  { slotKey: 'display_designer', apiRoleKey: 'displayDesigner', label: '摆场设计师', fields: ['摆场设计师'], discipline: null },
];

const SLOT_BY_KEY = new Map(RESPONSIBILITY_SLOTS.map((slot) => [slot.slotKey, slot]));
const SLOT_BY_API_KEY = new Map(RESPONSIBILITY_SLOTS.map((slot) => [slot.apiRoleKey, slot]));

const DESIGNER_FIELD_PATTERN = /设计师$/;

export function slotByKey(slotKey) {
  return SLOT_BY_KEY.get(slotKey);
}

export function slotByApiRoleKey(apiRoleKey) {
  return SLOT_BY_API_KEY.get(apiRoleKey);
}

export function listKnownPersonFieldNames() {
  return RESPONSIBILITY_SLOTS.flatMap((slot) => slot.fields);
}

export function matchSlotForFieldName(fieldName) {
  const known = RESPONSIBILITY_SLOTS.find((slot) => slot.fields.includes(fieldName));
  if (known) {
    return known;
  }
  if (DESIGNER_FIELD_PATTERN.test(fieldName)) {
    return {
      slotKey: `dynamic:${fieldName}`,
      apiRoleKey: `dynamic:${fieldName}`,
      label: fieldName,
      fields: [fieldName],
      discipline: null,
      dynamic: true,
    };
  }
  return null;
}

export function personnelRolesForMetrics() {
  return RESPONSIBILITY_SLOTS.filter((slot) =>
    ['cd_owner', 'vm_owner', 'cd_lead', 'vm_lead'].includes(slot.slotKey)
  ).map((slot) => ({
    key: slot.apiRoleKey,
    slotKey: slot.slotKey,
    label: slot.label,
    fields: slot.fields,
    discipline: slot.discipline,
  }));
}
