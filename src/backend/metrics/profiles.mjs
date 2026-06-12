const CORE_STORE_TIERS = ['regular', 'sinking', 'premium', 'flagship', 'super', 'black', 'other'];

export const DASHBOARD_PROFILES = {
  department: {
    id: 'department',
    label: '部门总盘',
    description: '全部项目，对应项目统计仪表盘。',
    tiers: CORE_STORE_TIERS,
  },
  direct: {
    id: 'direct',
    label: '直营看板',
    description: '组别包含「直营」的项目。',
    tiers: CORE_STORE_TIERS,
  },
  franchise: {
    id: 'franchise',
    label: '加盟看板',
    description: '组别包含「加盟」的项目。',
    tiers: CORE_STORE_TIERS,
  },
  ownerMonthly: {
    id: 'ownerMonthly',
    label: '负责人月度',
    description: '负责人列项目 + 看盘上下文（加盟/直营），按该负责人实际店态展示 KPI。',
    tiers: ['regular', 'sinking'],
    includeSoftPauseInNotStarted: true,
    schemeCountMode: 'yearRequired',
  },
};

export const TIER_LABELS = {
  regular: '常规店',
  sinking: '下沉店',
  super: '超一线',
  flagship: '旗舰店',
  premium: '高标店',
  black: '黑标店',
  other: '其他店态',
};

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

/** 全局默认日期字段（无店态覆盖时使用） */
export const DEFAULT_DATE_FIELDS = {
  schemeDoneYtd: ['施工图初稿完成时间（外包首次提供图纸的时间）', '上会日期'],
  schemeDelayDoneYtd: ['上会日期', 'updatedAt'],
  schemeDelayDoneMonth: ['updatedAt', '上会日期'],
  hardMeetingMeasureVolume: ['上会日期', '复尺时间', '复尺日期'],
  hardPlanVolume: ['平面开始时间', '躺平内部审核结束时间', '内部审核结束时间'],
  hardConstructionVolume: [
    '施工图初稿完成时间（外包首次提供图纸的时间）',
    '施工图初稿完成时间',
    '施工图完成审核时间（施工图终稿完成时间/商场审核完成时间）',
    '施工图完成审核时间',
  ],
  pointVolume: ['点位完成时间'],
  productListVolume: ['产品清单发出时间'],
  schemeVolume: ['软装方案开始时间'],
  purchaseVolume: ['采购时间'],
  siteVolume: ['摆场文件发出时间(项目群）', '摆场开始时间', '摆场时间', '现场摆场时间'],
};

/**
 * 店态分层 KPI 选项（仅筛项目 + 日期列优先级，不绑定硬装/软装工种）。
 * schemeCountMode 全 profile 统一 predicate；dateField 见 TIER_DATE_FIELDS。
 */
export const TIER_METRIC_OPTIONS = {
  regular: {
    includeSoftPauseInNotStarted: true,
    schemeCountMode: 'yearRequired',
  },
  sinking: {
    includeSoftPauseInNotStarted: false,
    schemeCountMode: 'yearRequired',
  },
};

export const TIER_DATE_FIELDS = {
  regular: {
    schemeDoneYtd: ['躺平内部审核结束时间', '上会日期', '施工图初稿完成时间（外包首次提供图纸的时间）', '复尺时间'],
    schemeDelayDoneYtd: ['上会日期', '躺平内部审核结束时间', 'updatedAt'],
    schemeDelayDoneMonth: ['updatedAt', '上会日期'],
    siteVolume: ['摆场文件发出时间(项目群）', '摆场开始时间', '摆场时间', '现场摆场时间'],
  },
  sinking: {
    schemeDoneYtd: ['上会日期', '复尺时间', '躺平内部审核结束时间', '施工图初稿完成时间（外包首次提供图纸的时间）'],
    schemeDelayDoneYtd: ['上会日期', 'updatedAt'],
    schemeDelayDoneMonth: ['updatedAt', '上会日期'],
    siteVolume: ['摆场文件发出时间(项目群）', '摆场开始时间', '摆场时间', '现场摆场时间'],
  },
};

export function getProfile(profileId) {
  return DASHBOARD_PROFILES[profileId] || DASHBOARD_PROFILES.department;
}

export function resolveTierMetricOptions(tier, options = {}) {
  const fallbackTier = tier === 'sinking' ? 'sinking' : 'regular';
  const tierOptions = TIER_METRIC_OPTIONS[tier] || TIER_METRIC_OPTIONS[fallbackTier] || {
    includeSoftPauseInNotStarted: false,
    schemeCountMode: 'yearRequired',
  };
  const profile = getProfile(options.profileId || 'ownerMonthly');
  return {
    includeSoftPauseInNotStarted:
      options.includeSoftPauseInNotStarted ??
      tierOptions.includeSoftPauseInNotStarted ??
      profile.includeSoftPauseInNotStarted ??
      false,
    schemeCountMode: options.schemeCountMode ?? tierOptions.schemeCountMode ?? profile.schemeCountMode ?? 'yearRequired',
  };
}

export function resolveDateFieldsForTier(tier, options = {}) {
  const fallbackTier = tier === 'sinking' ? 'sinking' : 'regular';
  const tierFields = TIER_DATE_FIELDS[tier] || TIER_DATE_FIELDS[fallbackTier] || {};
  const override = options.dateFields || {};
  return {
    schemeDoneYtd: override.schemeDoneYtd || tierFields.schemeDoneYtd || DEFAULT_DATE_FIELDS.schemeDoneYtd,
    schemeDelayDoneYtd:
      override.schemeDelayDoneYtd || tierFields.schemeDelayDoneYtd || DEFAULT_DATE_FIELDS.schemeDelayDoneYtd,
    schemeDelayDoneMonth:
      override.schemeDelayDoneMonth || tierFields.schemeDelayDoneMonth || DEFAULT_DATE_FIELDS.schemeDelayDoneMonth,
    hardMeetingMeasureVolume:
      override.hardMeetingMeasureVolume ||
      tierFields.hardMeetingMeasureVolume ||
      DEFAULT_DATE_FIELDS.hardMeetingMeasureVolume,
    hardPlanVolume: override.hardPlanVolume || tierFields.hardPlanVolume || DEFAULT_DATE_FIELDS.hardPlanVolume,
    hardConstructionVolume:
      override.hardConstructionVolume ||
      tierFields.hardConstructionVolume ||
      DEFAULT_DATE_FIELDS.hardConstructionVolume,
    pointVolume: override.pointVolume || tierFields.pointVolume || DEFAULT_DATE_FIELDS.pointVolume,
    productListVolume:
      override.productListVolume || tierFields.productListVolume || DEFAULT_DATE_FIELDS.productListVolume,
    schemeVolume: override.schemeVolume || tierFields.schemeVolume || DEFAULT_DATE_FIELDS.schemeVolume,
    purchaseVolume: override.purchaseVolume || tierFields.purchaseVolume || DEFAULT_DATE_FIELDS.purchaseVolume,
    siteVolume: override.siteVolume || tierFields.siteVolume || DEFAULT_DATE_FIELDS.siteVolume,
  };
}

export function getMetricDefinitions() {
  return {
    notStarted: {
      title: '未开始',
      definition:
        '同店态下，硬装与软装项目进度均为未开始/未安排（或为空）；当前暂停项目单独列示，不按未开始统计，曾暂停但当前恢复的项目回到当前流程阶段。',
      fields: ['店态', '软装项目进度', '硬装项目进度'],
    },
    inProgress: {
      title: '进行中',
      definition:
        '同店态下，硬装或软装任一侧在推进（非未开始/未安排/当前暂停/闭环/完成）；曾暂停但当前恢复的项目按恢复后的阶段统计。',
      fields: ['店态', '硬装项目进度', '软装项目进度'],
      excludeRules: ['不使用项目状态(紧急/一般)判断流程', '店态不绑定单一工种'],
    },
    openDelayed: {
      title: '未闭环延期',
      definition:
        '设计责任未闭环，且硬装方案或软装完成情况含延期；计划开业逾期单独作为管理边界校准项。',
      fields: ['硬装项目进度', '软装项目进度', '硬装方案情况（每周五刷新）', '软装完成情况', '计划开业时间'],
      excludeRules: ['设计责任已闭环不计入，即使项目状态或计划开业日未及时更新'],
    },
    schemeDoneYtd: {
      title: '今年已完成方案',
      definition:
        '硬装方案情况含准时/延期完成，且任一年度日期字段落在本年（店态仅决定日期列优先级，不区分硬装/软装工种）。',
      fields: ['硬装方案情况（每周五刷新）', '躺平内部审核结束时间', '上会日期'],
    },
    schemeDelayDoneYtd: {
      title: '今年方案延期完成',
      definition: '硬装方案为延期完成，且任一年度日期字段落在本年。',
      fields: ['硬装方案情况（每周五刷新）'],
    },
    schemeDelayDoneMonth: {
      title: '本月方案延期完成',
      definition: '硬装方案为延期完成，月度日期字段落在本月，且软装未闭环。',
      fields: ['硬装方案情况（每周五刷新）', '软装项目进度'],
    },
    hardMeetingMeasureVolume: {
      title: '硬装上会复尺推进',
      definition: '硬装责任域的上会日期或复尺时间落在本月，表示项目进入硬装前置确认与复尺推进。',
      fields: ['上会日期', '复尺时间'],
    },
    hardPlanVolume: {
      title: '硬装平面推进',
      definition: '硬装责任域的平面开始、平面方案完成或躺平内部审核结束时间落在本月。',
      fields: ['平面开始时间', '躺平内部审核结束时间'],
    },
    hardConstructionVolume: {
      title: '施工图记录',
      definition: '公司项目进度记录：施工图发外包、施工图初稿完成或施工图审核完成时间落在本月；施工图外包不计入本公司设计师责任制完成口径。',
      fields: ['施工图初稿完成时间（外包首次提供图纸的时间）', '施工图完成审核时间'],
    },
    pointVolume: {
      title: '点位设计推进',
      definition: '软装责任域的点位设计有进展，且点位完成时间在本月；点位设计师与软装负责人按点位完成情况承担责任。',
      fields: ['点位完成情况', '点位完成时间'],
    },
    productListVolume: {
      title: '产品清单接收',
      definition: '公司协同记录：外部产品清单到达时间在本月；产品清单不驱动首页主流程阶段，也不计入设计责任制完成口径。',
      fields: ['产品清单发出时间'],
    },
    schemeVolume: {
      title: '方案设计推进',
      definition: '软装责任域的方案设计开始时间在本月；方案设计可参考产品清单，但不以产品清单接收作为开始前置条件。',
      fields: ['软装方案开始时间'],
    },
    purchaseVolume: {
      title: '采购推进',
      definition: '公司协同阶段的采购时间在本月，不计入设计责任制完成口径。',
      fields: ['采购时间'],
    },
    siteVolume: {
      title: '摆场交付',
      definition: '公司协同阶段的进度为摆场，且摆场开始、摆场文件发出或现场摆场时间在本月；不计入设计责任制完成口径。',
      fields: ['软装项目进度', '摆场开始时间', '摆场文件发出时间(项目群）', '摆场时间', '现场摆场时间'],
    },
    priorityStatus: {
      title: '项目状态（优先级）',
      definition: '项目状态表示紧急/一般优先级，不用于流程阶段统计。',
      fields: ['项目状态'],
    },
    workflowStage: {
      title: '流程阶段',
      definition: '硬装/软装项目进度表示流程阶段。',
      fields: ['硬装项目进度', '软装项目进度'],
    },
  };
}
