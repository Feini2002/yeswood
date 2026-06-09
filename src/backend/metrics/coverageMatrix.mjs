/** Documented parity dimensions for audits and tests. */
export const DASHBOARD_PROFILES = ['department', 'direct', 'franchise', 'ownerMonthly'];

export const KPI_KEYS = [
  'notStarted',
  'inProgress',
  'openDelayed',
  'schemeDoneYtd',
  'schemeDelayDoneYtd',
  'schemeDelayDoneMonth',
];

export const MONTHLY_OPS_KEYS = [
  'hardMeetingMeasureVolume',
  'hardPlanVolume',
  'hardConstructionVolume',
  'pointVolume',
  'productListVolume',
  'schemeVolume',
  'purchaseVolume',
  'siteVolume',
];

export const OWNER_MONTHLY_TIERS = ['regular', 'sinking'];

export const RESPONSIBILITY_SLOT_KEYS = [
  'owner',
  'cd_lead',
  'vm_lead',
  'cd_designer',
  'vm_designer',
  'point_designer',
  'display_designer',
];

export function listCoverageCells({ profiles = DASHBOARD_PROFILES, tiers = OWNER_MONTHLY_TIERS } = {}) {
  const cells = [];
  for (const profileId of profiles) {
    if (profileId === 'ownerMonthly') {
      for (const tier of tiers) {
        for (const kpi of [...KPI_KEYS, ...MONTHLY_OPS_KEYS]) {
          cells.push({ profileId, tier, kpi, requiresOwner: true });
        }
      }
      continue;
    }
    for (const kpi of KPI_KEYS) {
      cells.push({ profileId, tier: 'all', kpi, requiresOwner: false });
    }
  }
  for (const slotKey of RESPONSIBILITY_SLOT_KEYS) {
    cells.push({ profileId: 'personnel', slotKey, kpi: 'projectCount', requiresOwner: false });
  }
  return cells;
}
