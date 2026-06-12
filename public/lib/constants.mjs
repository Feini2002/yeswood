export const DASHBOARD_CONTEXTS = new Set(['all', 'franchise', 'direct']);
export const DEVELOPMENT_ONLY_PAGES = new Set(['developer-docs']);
export const FILTERABLE_PAGES = new Set(['details']);
export const TEAM_OWNER_STORAGE_KEY = 'teamDashboardOwner';
export const TEAM_WORK_COMPLETION_CACHE_LIMIT = 12;

export function normalizeDashboardContext(value = '') {
  return DASHBOARD_CONTEXTS.has(value) ? value : '';
}

export function contextLabel(value = '') {
  return {
    franchise: '加盟',
    direct: '直营',
  }[value] || '全部';
}

export const OWNER_REVIEW_CACHE_LIMIT = 12;
export const SOURCE_DISPLAY_LABELS = {
  dingtalk: '导入数据',
  sqlite: '本地数据',
  'local-sqlite': '本地数据',
  local: '本地数据',
  mock: '演示数据',
  empty: '暂无数据',
};

export const FALLBACK_STORE_TIER_ROWS = [
  { key: 'regular', label: '常规店' },
  { key: 'sinking', label: '下沉店' },
];

export const PROFILE_SEGMENT_ROWS = [
  { key: 'newStore', label: '新店' },
  { key: 'renovated', label: '翻新店' },
];

export const PROFILE_SEGMENT_COLUMNS = [
  { key: 'regular', label: '常规店', storeStatus: '常规店' },
  { key: 'sinking', label: '下沉店', storeStatus: '下沉店' },
];

export const OWNER_TIER_METRIC_ORDER = [
  'notStarted',
  'inProgress',
  'openDelayed',
  'schemeDoneYtd',
  'schemeDelayDoneYtd',
  'schemeDelayDoneMonth',
  'schemeDelayedActiveMonth',
  'projectCount',
];

export const OWNER_TIER_METRIC_META = {
  notStarted: { label: '未开始', tone: 'amber' },
  inProgress: { label: '进行中', tone: 'green' },
  openDelayed: { label: '延期未闭环', tone: 'coral', alert: true, drillDelayed: true },
  schemeDoneYtd: { label: '全年完成方案', tone: 'teal' },
  schemeDelayDoneYtd: { label: '延期完成·全年', tone: 'coral', alert: true },
  schemeDelayDoneMonth: { label: '延期完成·本月', tone: 'coral', alert: true },
  schemeDelayedActiveMonth: { label: '本月延期中', tone: 'coral', alert: true },
  projectCount: { label: '项目数', tone: 'teal' },
};

export const PROFILE_SUMMARY_METRICS = [
  { key: 'totalProjects', label: '项目总数', tone: 'teal' },
  { key: 'activeProjects', label: '推进项目', tone: 'green' },
  { key: 'delayedProjects', label: '延期项目', tone: 'coral', alert: true },
  { key: 'averageProgress', label: '平均进度', tone: 'amber', format: 'percent' },
  { key: 'notStarted', label: '未开始', tone: 'amber' },
  { key: 'highRiskProjects', label: '高风险项目', tone: 'coral', alert: true },
];

export const OVERVIEW_KPI_METRICS = [
  { key: 'totalProjects', label: '项目总数', tone: 'teal' },
  { key: 'activeProjects', label: '推进项目', tone: 'green' },
  { key: 'delayedProjects', label: '延期项目', tone: 'coral', alert: true },
  { key: 'notStarted', label: '未开始', tone: 'amber' },
  { key: 'pausedProjects', label: '暂停/取消', tone: 'amber' },
];

export const PROFILE_SCOPE_SUMMARY_METRICS = [
  { key: 'totalProjects', franchiseLabel: '加盟任务总量', directLabel: '直营任务总量', tone: 'teal' },
  { key: 'schemeDoneYtd', franchiseLabel: '全年已完成任务总量', directLabel: '全年已完成任务总量', tone: 'green' },
  { key: 'activeProjects', franchiseLabel: '现阶段运转中项目总量', directLabel: '现阶段运转中项目总量', tone: 'green' },
  { key: 'notStarted', franchiseLabel: '未开始项目', directLabel: '未开始项目', tone: 'amber' },
];

export const PROFILE_SCOPE_SEGMENT_METRICS = [
  {
    segmentKey: 'newStore-regular',
    metricKey: 'projectCount',
    franchiseLabel: '新店-常规总任务量',
    directLabel: '新店-常规总任务量',
    tone: 'teal',
    tierDrill: 'regular',
    storeNatureDrill: '新店',
  },
  {
    segmentKey: 'renovated-regular',
    metricKey: 'projectCount',
    franchiseLabel: '翻新-常规总任务量',
    directLabel: '翻新-常规总任务量',
    tone: 'teal',
    tierDrill: 'regular',
    storeNatureDrill: '老店',
  },
  {
    segmentKey: 'newStore-sinking',
    metricKey: 'projectCount',
    franchiseLabel: '新店-下沉总任务量',
    directLabel: '新店-下沉总任务量',
    tone: 'teal',
    tierDrill: 'sinking',
    storeNatureDrill: '新店',
  },
  {
    segmentKey: 'renovated-sinking',
    metricKey: 'projectCount',
    franchiseLabel: '翻新-下沉总任务量',
    directLabel: '翻新-下沉总任务量',
    tone: 'teal',
    tierDrill: 'sinking',
    storeNatureDrill: '老店',
  },
  {
    segmentKey: 'newStore-regular',
    metricKey: 'openDelayed',
    franchiseLabel: '已延期新店常规',
    directLabel: '已延期新店常规',
    tone: 'coral',
    alert: true,
    tierDrill: 'regular',
    storeNatureDrill: '新店',
    drillDelayed: true,
  },
  {
    segmentKey: 'renovated-regular',
    metricKey: 'openDelayed',
    franchiseLabel: '已延期翻新常规',
    directLabel: '已延期翻新常规',
    tone: 'coral',
    alert: true,
    tierDrill: 'regular',
    storeNatureDrill: '老店',
    drillDelayed: true,
  },
  {
    segmentKey: 'newStore-sinking',
    metricKey: 'openDelayed',
    franchiseLabel: '已延期新店下沉',
    directLabel: '已延期新店下沉',
    tone: 'coral',
    alert: true,
    tierDrill: 'sinking',
    storeNatureDrill: '新店',
    drillDelayed: true,
  },
  {
    segmentKey: 'renovated-sinking',
    metricKey: 'openDelayed',
    franchiseLabel: '已延期翻新下沉',
    directLabel: '已延期翻新下沉',
    tone: 'coral',
    alert: true,
    tierDrill: 'sinking',
    storeNatureDrill: '老店',
    drillDelayed: true,
  },
];

export const HIDDEN_FILTER_VALUES = new Set(['未填写', '未填入']);

/** 来源店态未填时不参与店态分类展示（矩阵、排行、tier 聚合），但项目仍保留在本地库与其他模块。 */
export function isHiddenFilterValue(value) {
  const label = String(value ?? '').trim();
  return !label || HIDDEN_FILTER_VALUES.has(label);
}

export function isClassifiableStoreStatus(value) {
  return !isHiddenFilterValue(value);
}

export const DETAILS_WORKBENCH_VIEWS = {
  list: {
    key: 'list',
    gridClass: 'is-list-view',
    columns: ['项目', '负责人', '组长', '设计师', '门店 / 阶段', '下一提醒'],
  },
  progress: {
    key: 'progress',
    gridClass: 'is-progress-view',
    columns: ['项目', '硬装进度', '点位/软装进度', '方案情况', '上会 / 点位', '下一提醒'],
  },
  deadlineExceptions: {
    key: 'deadlineExceptions',
    gridClass: 'is-deadline-exception-view',
    columns: ['项目', '系统提醒', '复核原因', '负责人', '下一动作'],
  },
};
