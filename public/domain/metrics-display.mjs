import { escapeHtml, formatDate } from '../lib/format.mjs';
import { state } from '../lib/state.mjs';
import {
  SOURCE_DISPLAY_LABELS,
  FALLBACK_STORE_TIER_ROWS,
  OWNER_TIER_METRIC_ORDER,
  OWNER_TIER_METRIC_META,
  isClassifiableStoreStatus,
  normalizeDashboardContext,
} from '../lib/constants.mjs';
import { currentPageId } from '../lib/router.mjs';
import { readActiveProjectFilters } from '../components/filter-bar.mjs';
import { lifecycleStageLabel } from '../dashboard/project-lifecycle.mjs';
import { isProjectResponsibilityDelayed } from './project-workflow.mjs';
import { isSleepStoreProject } from './project-display.mjs';

export function sourceDisplayLabel(source) {
  const key = String(source || '').trim();
  return SOURCE_DISPLAY_LABELS[key] || key || '本地数据';
}


export function ownerTierRows(metrics = {}) {
  const tiers = metrics.tiers || {};
  const labels = metrics.tierLabels || {};
  const order = Array.isArray(metrics.tierOrder) && metrics.tierOrder.length ? metrics.tierOrder : Object.keys(tiers);
  const rows = order
    .filter((key) => tiers[key] && Object.keys(tiers[key]).length)
    .map((key) => ({
      key,
      label: labels[key] || (key.startsWith('custom:') ? key.slice('custom:'.length) : key),
      storeStatus: labels[key] || '',
    }))
    .filter((row) => isClassifiableStoreStatus(row.storeStatus || row.label));
  return rows.length ? rows : FALLBACK_STORE_TIER_ROWS;
}


export function tierStoreStatusLabel(tierKey, metrics = {}) {
  const row = ownerTierRows(metrics).find((item) => item.key === tierKey);
  return row?.storeStatus || row?.label || '';
}


export function ownerTierMetricMeta(key) {
  return OWNER_TIER_METRIC_META[key] || { label: '未命名指标', tone: 'teal' };
}


export function metricDefinitionTooltip(metricDefinitions, key, fallbackLabel = '', fallbackValue = '') {
  const definition = metricDefinitions?.[key];
  if (!definition) {
    return fallbackLabel
      ? { title: fallbackLabel, value: fallbackValue, definition: '' }
      : null;
  }
  if (typeof definition === 'string') {
    return { title: fallbackLabel || key, value: fallbackValue, definition };
  }
  return {
    title: definition.title || definition.label || fallbackLabel || key,
    value: definition.value ?? fallbackValue,
    definition: definition.definition || definition.description || '',
    compare: definition.compare || '',
    extra: definition.extra || '',
  };
}


export function formatMetricValue(value, format) {
  if (format === 'percent') {
    return `${value ?? 0}%`;
  }
  return value ?? 0;
}


export function buildDrillFilter({
  owner = '',
  profile = '',
  tier = '',
  metric = '',
  lifecycleStage = '',
  status = '',
  storeStatus = '',
  storeNature = '',
  collaborator = '',
  collaborationDiscipline = '',
  teamProjectOwner = '',
  excludePaused = '',
  activeResponsibility = '',
  search = '',
  delayed = '',
  dashboardContext = '',
} = {}) {
  const filter = {};
  if (owner) {
    filter.owner = owner;
    if (search || !collaborator) {
      filter.search = search || owner;
    }
  } else if (search) {
    filter.search = search;
  }
  if (profile) {
    filter.profile = profile;
  }
  if (tier) {
    filter.tier = tier;
  }
  if (storeStatus) {
    filter.storeStatus = storeStatus;
  }
  if (storeNature) {
    filter.storeNature = storeNature;
  }
  if (collaborator) {
    filter.collaborator = collaborator;
  }
  if (collaborationDiscipline) {
    filter.collaborationDiscipline = collaborationDiscipline;
  }
  if (teamProjectOwner) {
    filter.teamProjectOwner = teamProjectOwner;
  }
  if (excludePaused) {
    filter.excludePaused = excludePaused;
  }
  if (activeResponsibility) {
    filter.activeResponsibility = activeResponsibility;
  }
  if (status) {
    filter.status = status;
  }
  if (metric) {
    filter.metric = metric;
  }
  if (lifecycleStage) {
    filter.lifecycleStage = lifecycleStage;
  }
  if (delayed) {
    filter.delayed = delayed;
  }
  const normalizedDashboardContext = normalizeDashboardContext(dashboardContext);
  if (normalizedDashboardContext) {
    filter.dashboardContext = normalizedDashboardContext;
  }
  return filter;
}


export function drillCardTitle(card) {
  return card?.dataset.drillTitle || card?.querySelector('.insight-card-label')?.textContent?.trim() || '项目明细';
}


export function effectiveDrillFilters(filter = {}) {
  return {
    ...readActiveProjectFilters(currentPageId()),
    ...filter,
  };
}


export function profileLabel(profile) {
  return (
    {
      franchise: '加盟',
      direct: '直营',
      department: '总览',
      ownerMonthly: '负责人',
    }[profile] || profile
  );
}


export function drillFilterSummary(filter = {}) {
  const metricLabel = filter.metric ? ownerTierMetricMeta(filter.metric).label : '';
  const stageLabel = filter.lifecycleStage ? lifecycleStageLabel(filter.lifecycleStage) : '';
  return [
    filter.owner ? `负责人：${filter.owner}` : '',
    filter.teamProjectOwner ? `CD/VM负责人：${filter.teamProjectOwner}` : '',
    filter.collaborator ? `协作人：${filter.collaborator}` : '',
    filter.profile ? `看板：${profileLabel(filter.profile)}` : '',
    filter.storeStatus ? `店态：${filter.storeStatus}` : filter.tier ? `店态：${tierStoreStatusLabel(filter.tier)}` : '',
    filter.storeNature ? `店型：${filter.storeNature}` : '',
    metricLabel ? `指标：${metricLabel}` : '',
    stageLabel ? `阶段：${stageLabel}` : '',
    filter.delayed ? '延期未闭环' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}


export function ownerTierMetricKeys(tierMetrics = {}) {
  const ordered = OWNER_TIER_METRIC_ORDER.filter((key) => tierMetrics[key] !== undefined);
  const extras = Object.keys(tierMetrics).filter((key) => !ordered.includes(key) && typeof tierMetrics[key] === 'number');
  return [...ordered, ...extras];
}


export function buildOwnerTierDrillFilter(metrics, tierKey, metricKey, meta = {}, tierRow = null) {
  return buildDrillFilter({
    owner: metrics.owner || metrics.displayName || '',
    dashboardContext: metrics.dashboardContext || '',
    tier: tierKey,
    metric: metricKey,
    status: meta.drillStatus || '',
    storeStatus: tierRow?.storeStatus || tierRow?.label || tierStoreStatusLabel(tierKey, metrics),
    delayed: meta.drillDelayed ? '1' : '',
  });
}


export function ownerTotalMetrics(metrics = {}) {
  return {
    ...(metrics.totals || {}),
    projectCount: metrics.totals?.projectCount ?? metrics.scopeCount ?? metrics.summary?.totalProjects ?? 0,
  };
}


export function riskClass(level) {
  if (level === '高') return 'high';
  if (level === '中') return 'medium';
  if (!level || level === '--' || level === '未设置' || level === '未知') return 'unknown';
  return 'low';
}


export function riskCategoryLabel(category = '') {
  return {
    priority_status: '紧急点铺',
    execution_delay: '执行延期',
    state_conflict: '状态口径需核对',
    data_missing: '资料待补',
    start_lag: '排期待确认',
    historical_trace: '历史归因',
  }[category] || category || '未分类';
}

const RISK_FIELD_LABELS = {
  hardSchemeMeetingConflict: '硬装方案与上会口径',
  softCompletionStageConflict: '软装完成状态与阶段',
  softDelayDoneMissingDate: '软装完成日期',
  openPlanPast: '计划开业日期',
  owner: '负责人',
  dueDate: '截止日期',
};


export function riskFieldDisplayLabel(field = '') {
  const key = String(field || '').trim();
  return RISK_FIELD_LABELS[key] || key;
}


export function humanizeRiskText(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return Object.entries(RISK_FIELD_LABELS).reduce(
    (result, [key, label]) => result.replaceAll(key, label),
    text
  );
}


export function riskDiagnosisCounts(analysis = {}) {
  const items = analysis.riskItems || [];
  return {
    p1: items.filter((item) => item.severity === 'P1').length,
    p2: items.filter((item) => item.severity === 'P2').length,
    p3: items.filter((item) => item.severity === 'P3').length,
    impact: items.reduce((sum, item) => sum + Number(item.impactCount || 0), 0),
  };
}


export function findUrgentStatusItem(items = []) {
  return items.find((item) => item.source === 'priority_status' || item.category === 'priority_status' || item.dedupeKey === 'status:urgent');
}


export function projectQueueSeverity(project = {}) {
  if (project.queueSeverity) {
    return project.queueSeverity;
  }
  if (project.status === '紧急' || isProjectResponsibilityDelayed(project) || project.riskLevel === '高') {
    return 'P1';
  }
  if (project.riskLevel === '中') {
    return 'P2';
  }
  return 'P3';
}


export function projectQueueTitle(project = {}) {
  if (project.queueTitle) {
    return project.queueTitle;
  }
  if (project.status === '紧急') {
    return '紧急点插';
  }
  if (isProjectResponsibilityDelayed(project)) {
    return '延期未闭环';
  }
  if (project.riskLevel === '高') {
    return '高风险项目';
  }
  return project.riskLevel ? `${project.riskLevel}风险项目` : '风险项目';
}


export function projectQueueMeta(project = {}) {
  return [
    project.ownerDisplay || project.owner,
    project.province,
    project.status,
    project.dueDate ? formatDate(project.dueDate) : '',
  ].filter(Boolean).join(' · ');
}


export function riskQueueProjects(metrics = {}) {
  return [
    ...(metrics.urgentStatusProjects || []).map((project) => ({
      ...project,
      queueSeverity: 'P1',
      queueTitle: '紧急点铺',
      queueCategory: 'priority_status',
    })),
    ...(metrics.openDelayedProjects || []).map((project) => ({
      ...project,
      queueSeverity: 'P1',
      queueTitle: '延期未闭环',
      queueCategory: 'execution_delay',
    })),
    ...(metrics.riskProjects || []).map((project) => ({
      ...project,
      queueSeverity: projectQueueSeverity(project),
      queueTitle: projectQueueTitle(project),
      queueCategory: 'risk_project',
    })),
  ];
}


export function riskProjectNextAction(project = {}) {
  const title = `${project.title || ''} ${project.category || ''}`;
  if (title.includes('紧急点铺') || project.category === 'priority_status') {
    return '确认是否需要调人支援';
  }
  if (title.includes('延期') || project.category === 'execution_delay') {
    return '当天能闭环就收口，不能则补反馈时间';
  }
  if (title.includes('状态') || project.category === 'state_conflict') {
    return '回源表核对状态口径';
  }
  if (title.includes('资料') || title.includes('数据') || project.category === 'data_missing') {
    return '补齐关键日期或责任人';
  }
  if (title.includes('排期') || project.category === 'start_lag') {
    return '补齐启动排期、责任人和承诺时间';
  }
  if (title.includes('高风险') || project.severity === 'P1') {
    return '确认风险是否影响交付';
  }
  return '补清当前卡点和跟进时间';
}


export function addRiskQueueItem(queue, seen, entry = {}) {
  const sourceProject = entry.project || {};
  const name = entry.name || entry.projectName || sourceProject.name || '';
  if (!name) {
    return;
  }
  const key = entry.id || entry.projectId || sourceProject.id || name;
  const category = entry.category || sourceProject.queueCategory || '';
  if (seen.has(key)) {
    const existing = typeof seen.get === 'function' ? seen.get(key) : null;
    if (existing && category && !existing.categories.includes(category)) {
      existing.categories.push(category);
    }
    return;
  }
  const title = humanizeRiskText(entry.title || sourceProject.queueTitle || riskCategoryLabel(category));
  const owner = entry.owner || sourceProject.ownerDisplay || sourceProject.owner || '';
  const province = entry.province || sourceProject.province || '';
  const status = entry.status || sourceProject.status || '';
  const dueDate = entry.dueDate || sourceProject.dueDate || '';
  const row = {
    id: entry.id || entry.projectId || sourceProject.id || '',
    name,
    owner,
    province,
    status,
    dueDate,
    field: riskFieldDisplayLabel(entry.field || ''),
    value: humanizeRiskText(entry.value || ''),
    severity: entry.severity || sourceProject.queueSeverity || projectQueueSeverity(sourceProject) || 'P3',
    title: title || '风险项目',
    meta: humanizeRiskText(entry.meta || ''),
    category,
    categories: category ? [category] : [],
  };
  queue.push(row);
  if (typeof seen.set === 'function') {
    seen.set(key, row);
  } else {
    seen.add(key);
  }
}


export function collectRiskProjectQueue(items = [], projects = []) {
  const seen = new Map();
  const queue = [];
  const projectLookup = new Map();
  projects.forEach((project) => {
    if (project.id) {
      projectLookup.set(project.id, project);
    }
    if (project.name) {
      projectLookup.set(project.name, project);
    }
    addRiskQueueItem(queue, seen, {
      project,
      severity: projectQueueSeverity(project),
      title: projectQueueTitle(project),
      meta: projectQueueMeta(project),
      category: project.queueCategory || '',
    });
  });
  items.forEach((item) => {
    (item.evidence || []).forEach((entry) => {
      const sourceProject = projectLookup.get(entry.projectId) || projectLookup.get(entry.projectName) || {};
      addRiskQueueItem(queue, seen, {
        project: sourceProject,
        id: entry.projectId,
        name: entry.projectName,
        dueDate: entry.dueDate || '',
        field: entry.field || '',
        value: entry.value || '',
        severity: item.severity || 'P3',
        title: item.title || riskCategoryLabel(item.category),
        meta: entry.value || entry.field || '',
        category: item.category || '',
      });
    });
  });
  return queue;
}


export function riskActionRowCounts(rows = []) {
  return rows.reduce(
    (counts, row) => {
      const categories = row.categories?.length ? row.categories : [row.category || ''];
      const uniqueCategories = new Set(categories);
      if (uniqueCategories.has('priority_status')) {
        counts.urgent += 1;
      }
      if (uniqueCategories.has('execution_delay')) {
        counts.delayed += 1;
      }
      if (uniqueCategories.has('state_conflict')) {
        counts.stateConflict += 1;
      }
      if (uniqueCategories.has('data_missing')) {
        counts.dataMissing += 1;
      }
      if (uniqueCategories.has('start_lag')) {
        counts.startLag += 1;
      }
      if (uniqueCategories.has('risk_project') || row.title?.includes('高风险')) {
        counts.highRisk += 1;
      }
      return counts;
    },
    {
      urgent: 0,
      delayed: 0,
      stateConflict: 0,
      dataMissing: 0,
      startLag: 0,
      highRisk: 0,
    }
  );
}


export function riskDutyHeadline({
  actionRecommendation = '',
  urgentCount,
  openDelayedCount,
  highRiskCount,
  queueCount,
  counts,
  startLagCount = 0,
}) {
  if (String(actionRecommendation || '').trim()) {
    return String(actionRecommendation).trim();
  }

  const actions = [];
  if (urgentCount) {
    actions.push(`${urgentCount} 项紧急点铺，先确认卡点、责任人和反馈时间`);
  }
  if (openDelayedCount) {
    actions.push(`${openDelayedCount} 项延期未闭环项目，先判断能否当天收口`);
  }
  if (!actions.length && highRiskCount) {
    actions.push(`${highRiskCount} 项高风险项目，先判断影响交付节点`);
  }
  if (startLagCount) {
    actions.push(`${startLagCount} 项排期待确认项目，先补齐责任人和时间`);
  }
  if (!actions.length && queueCount) {
    actions.push(`${queueCount} 项待跟进店铺，逐项补清下一步`);
  }
  if (actions.length) {
    return `建议优先处理：${actions.join('、')}。点击店铺可查看完整项目明细。`;
  }
  if (counts.p2) {
    return `当前暂无需优先处理的项目，建议先核对 ${counts.p2} 类会影响判断的口径问题。`;
  }
  return '当前暂无需优先处理的风险，保持常规巡检。';
}


export function riskItemImpactCount(items = [], category = '') {
  return items
    .filter((item) => item.category === category || item.source === category)
    .reduce((sum, item) => sum + Number(item.impactCount || 0), 0);
}

