import { AGENT_MODEL_NAME, buildAgentRunMetadata, hashText, inputSnapshotHashFor } from './agentMetadata.mjs';
import { RISK_HEALTH_AGENT_PROMPT, RISK_HEALTH_AGENT_PROMPT_VERSION } from './riskHealthAgentPrompt.mjs';

const CATEGORY_LABELS = {
  priority_status: '紧急项目',
  execution_delay: '执行延期',
  delivery_boundary: '交付/协同边界',
  state_conflict: '状态冲突',
  data_missing: '数据缺失',
  start_lag: '排期待确认',
  historical_trace: '历史归因',
};

const SEVERITY_ORDER = {
  P1: 1,
  P2: 2,
  P3: 3,
};

const ALERT_DEFINITIONS = {
  openDelayed: {
    title: '已延期项目先闭环',
    category: 'execution_delay',
    severity: 'P1',
    confidence: 0.94,
    reasoning: '这些项目存在设计责任内的明确延期状态且尚未闭环，今天需要先看是否卡在责任人或进度更新。',
    recommendedAction: '请负责人逐项确认卡点、下一步动作和最晚闭环时间；采购、产品清单等后续协同不作为设计延期追责依据。',
  },
  schemeDelayedThisMonth: {
    title: '本月方案延期完成',
    category: 'execution_delay',
    severity: 'P2',
    confidence: 0.9,
    reasoning: '本月已有延期完成记录，会影响月度复盘和责任归因，需要在月底前补齐原因。',
    recommendedAction: '请负责人补充延期原因、完成日期和责任节点；同类原因超过 2 次时安排复盘。',
  },
  schemeDelayedYtd: {
    title: '全年方案延期完成累计',
    category: 'historical_trace',
    severity: 'P3',
    confidence: 0.86,
    reasoning: '这是年度节奏复盘线索，不抢占今日处理队列，但能解释某些负责人或店态的长期压力。',
    recommendedAction: '周/月复盘时再按负责人和店态拆开看；今天只处理仍未闭环的项目。',
  },
  unscheduled: {
    title: '未开始项目排期空窗',
    category: 'start_lag',
    severity: 'P2',
    confidence: 0.88,
    reasoning: '项目仍处于未开始口径，可能是真空排期，也可能是源表进度没有及时更新。',
    recommendedAction: '请负责人确认是否已经启动；已启动的当天回填进度，未启动的补明确认排期。',
  },
};

const HEALTH_RULE_DEFINITIONS = {
  hardSchemeMeetingConflict: {
    category: 'state_conflict',
    severity: 'P2',
    confidence: 0.9,
    recommendedAction: '今天先让负责人回源表确认方案情况和上会情况，以同一个口径为准再做延期判断。',
  },
  softCompletionStageConflict: {
    category: 'state_conflict',
    severity: 'P2',
    confidence: 0.9,
    recommendedAction: '请负责人把软装完成情况和软装项目进度对齐；已闭环的当天补状态，未闭环的补下一步动作。',
  },
  closedButPlanPast: {
    category: 'delivery_boundary',
    severity: 'P3',
    confidence: 0.78,
    recommendedAction: '转入交付/协同复核，不作为设计延期追责；复盘时确认计划日期、采购、摆场或开业节点是否需要更新。',
  },
  openPlanPast: {
    category: 'execution_delay',
    severity: 'P1',
    confidence: 0.94,
    recommendedAction: '今天先核对计划开业日期和闭环状态；日期无误的项目立即推动闭环或更新计划。',
  },
  softDelayDoneMissingDate: {
    category: 'data_missing',
    severity: 'P2',
    confidence: 0.92,
    recommendedAction: '请负责人当天补录软装完成时间，否则本月延期完成无法准确归属到月份。',
  },
  hardStageSchemeConflict: {
    category: 'state_conflict',
    severity: 'P3',
    confidence: 0.8,
    recommendedAction: '先作为观察项；若方案已完成但硬装进度滞后，请在复盘前同步进度节点。',
  },
};

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function generatedRunId({ owner, dashboardContext, generatedAt }) {
  const fingerprint = hashText(`${owner || ''}|${dashboardContext || 'all'}|${generatedAt}`).slice(0, 16);
  return `risk-health-${fingerprint}`;
}

function evidenceFromSamples(samples = [], fallback = {}) {
  const evidence = samples
    .filter((sample) => sample && (sample.id || sample.name))
    .slice(0, 5)
    .map((sample) => ({
      projectId: sample.id || '',
      projectName: sample.name || '未命名项目',
      field: fallback.field || '',
      value: fallback.value || '',
      dueDate: sample.dueDate || '',
    }));
  return evidence.length ? evidence : [fallback].filter((item) => item.field || item.value);
}

function projectIdsFromEvidence(evidence = []) {
  return [...new Set(evidence.map((item) => item.projectId).filter(Boolean))];
}

function urgentStatusCount(metrics = {}) {
  const explicit = metrics.statusCounts?.find((item) => item.label === '紧急')?.value;
  return safeNumber(explicit || metrics.urgentStatusProjects?.length || 0);
}

function createUrgentStatusRiskItem(metrics = {}) {
  const count = urgentStatusCount(metrics);
  if (count <= 0) {
    return null;
  }
  const evidence = evidenceFromSamples(metrics.urgentStatusProjects || [], {
    field: '项目状态',
    value: '紧急',
  });
  return {
    dedupeKey: 'status:urgent',
    source: 'priority_status',
    title: '紧急状态点铺待带班跟进',
    category: 'priority_status',
    categoryLabel: CATEGORY_LABELS.priority_status,
    severity: 'P1',
    confidence: 0.96,
    impactCount: count,
    reasoning: '项目状态被人工标注为紧急，说明这些点铺需要插队关注；未设置和一般状态不进入本次风险判断。',
    recommendedAction: '今天先逐一确认卡点、下一步责任人和最晚反馈时间；确认并不紧急的项目及时改回一般或未设置。',
    evidence,
    relatedProjectIds: projectIdsFromEvidence(evidence),
    status: 'open',
  };
}

function createAlertRiskItem(metrics, key, value) {
  const definition = ALERT_DEFINITIONS[key];
  if (!definition || value <= 0) {
    return null;
  }
  const openDelayedEvidenceSource = metrics.openDelayedProjects?.length ? metrics.openDelayedProjects : metrics.riskProjects || [];
  const evidence =
    key === 'openDelayed'
      ? evidenceFromSamples(openDelayedEvidenceSource, { field: 'openDelayed', value })
      : [{ field: key, value }];
  return {
    dedupeKey: `alert:${key}`,
    source: 'metric_alert',
    title: definition.title,
    category: definition.category,
    categoryLabel: CATEGORY_LABELS[definition.category] || definition.category,
    severity: definition.severity,
    confidence: definition.confidence,
    impactCount: value,
    reasoning: definition.reasoning,
    recommendedAction: definition.recommendedAction,
    evidence,
    relatedProjectIds: projectIdsFromEvidence(evidence),
    status: 'open',
  };
}

function createHealthRiskItem(check) {
  if (!check || safeNumber(check.count) <= 0) {
    return null;
  }
  // Closed design work can still leave a delivery/date risk visible.
  if (check.suppressRiskItem && check.key !== 'closedButPlanPast') {
    return null;
  }
  const definition = HEALTH_RULE_DEFINITIONS[check.key] || {
    category: check.severity === 'warn' ? 'state_conflict' : 'historical_trace',
    severity: check.severity === 'warn' ? 'P2' : 'P3',
    confidence: 0.82,
    recommendedAction: '请负责人回源表核对对应字段，并在当天明确是否需要修正状态。',
  };
  const evidence = evidenceFromSamples(check.samples || [], {
    field: check.key,
    value: check.label,
  });
  return {
    dedupeKey: `health:${check.key}`,
    source: 'data_health',
    title: check.label || check.key,
    category: definition.category,
    categoryLabel: CATEGORY_LABELS[definition.category] || definition.category,
    severity: definition.severity,
    confidence: definition.confidence,
    impactCount: safeNumber(check.count),
    reasoning: check.description || '这类记录会影响负责人判断，需要人工核对后再进入统计口径。',
    recommendedAction: definition.recommendedAction,
    evidence,
    relatedProjectIds: projectIdsFromEvidence(evidence),
    status: 'open',
  };
}

function createCoverageRiskItem(item, totalProjects) {
  if (!item || item.status !== 'warn') {
    return null;
  }
  const rate = safeNumber(item.rate);
  return {
    dedupeKey: `coverage:${item.key}`,
    source: 'field_coverage',
    title: `${item.label || item.key}覆盖率偏低`,
    category: 'data_missing',
    categoryLabel: CATEGORY_LABELS.data_missing,
    severity: rate < 60 ? 'P2' : 'P3',
    confidence: 0.76,
    impactCount: totalProjects,
    reasoning: `${item.label || item.key}字段覆盖率为 ${rate}%，会影响对应指标的可信度。`,
    recommendedAction: `优先补齐${item.label || item.key}字段，低覆盖率字段暂不作为唯一运营判断依据。`,
    evidence: [{ field: item.key || '', value: `${rate}%` }],
    relatedProjectIds: [],
    status: 'open',
  };
}

function riskActionRecommendation(riskItems, inputSnapshot = {}) {
  const urgent = riskItems.find((item) => item.dedupeKey === 'status:urgent');
  const openDelayed = riskItems.find((item) => item.dedupeKey === 'alert:openDelayed');
  const startLag = riskItems.find((item) => item.dedupeKey === 'alert:unscheduled');
  const highRisk = riskItems.find((item) => item.category === 'risk_project');
  const p2 = riskItems.filter((item) => item.severity === 'P2');
  const urgentActionCount = inputSnapshot.urgentStatusProjects?.length || urgent?.impactCount || 0;
  const openDelayedActionCount = inputSnapshot.openDelayedProjects?.length || openDelayed?.impactCount || 0;
  const actions = [];

  if (urgent && urgentActionCount) {
    actions.push(`${urgentActionCount} 项紧急点铺，先确认卡点、责任人和反馈时间`);
  }
  if (openDelayed && openDelayedActionCount) {
    actions.push(`${openDelayedActionCount} 项延期未闭环项目，先判断能否当天收口`);
  }
  if (!actions.length && highRisk) {
    actions.push(`${highRisk.impactCount} 项高风险项目，先确认是否影响交付节点`);
  }
  if (!actions.length && startLag) {
    actions.push(`${startLag.impactCount} 项排期待确认项目，先补齐责任人和时间`);
  }
  if (actions.length) {
    return `建议优先处理：${actions.join('；')}。点击店铺可查看完整项目明细。`;
  }
  if (p2.length) {
    return `当前暂无需优先处理的项目，建议先核对 ${p2.length} 类会影响判断的口径问题。`;
  }
  return '当前暂无需优先处理的风险，保持常规巡检。';
}

function buildDataQualitySummary(inputSnapshot = {}) {
  const dataHealth = inputSnapshot.dataHealth || {};
  const coverageWarnings = (inputSnapshot.coverageNotes || []).map((item) => {
    const evidence = item.evidence?.[0] || {};
    const key = evidence.field || String(item.dedupeKey || '').replace(/^coverage:/, '');
    const label = String(item.title || key).replace(/覆盖率偏低$/, '');
    const rate = safeNumber(String(evidence.value || '').replace('%', ''));
    return {
      key,
      label,
      rate,
      severity: item.severity || 'P3',
    };
  });
  const checkWarnings = (dataHealth.checks || [])
    .filter((check) => check?.severity === 'warn' && safeNumber(check.count) > 0)
    .map((check) => ({
      key: check.key,
      label: check.label || check.key,
      count: safeNumber(check.count),
    }));
  const hasVeryLowCoverage = coverageWarnings.some((item) => item.rate < 50);
  const level = hasVeryLowCoverage || checkWarnings.length ? 'low' : coverageWarnings.length ? 'medium' : 'high';
  const limitations = [
    ...coverageWarnings.map((item) => `${item.label}覆盖率 ${item.rate}%，对应指标仅供参考`),
    ...checkWarnings.map((item) => `${item.label} ${item.count} 条，需回源表核对`),
  ];
  const hasLimitations = limitations.length > 0;

  return {
    level,
    coverageWarningCount: coverageWarnings.length,
    checkWarningCount: checkWarnings.length,
    hasLimitations,
    riskPolicy: 'data_quality_only',
    accountabilityNote: '字段覆盖率和口径冲突只作为数据可信度限制，不作为业务风险追责依据。',
    coverageWarnings,
    checkWarnings,
    limitations,
  };
}

function summarizeRiskItems(riskItems, inputSnapshot = {}) {
  const categoryCounts = new Map();
  riskItems.forEach((item) => {
    categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + item.impactCount);
  });
  const distribution = [...categoryCounts.entries()]
    .map(([category, value]) => ({
      category,
      label: CATEGORY_LABELS[category] || category,
      value,
    }))
    .sort((a, b) => b.value - a.value);
  const p1 = riskItems.filter((item) => item.severity === 'P1');
  const p2 = riskItems.filter((item) => item.severity === 'P2');
  const p3 = riskItems.filter((item) => item.severity === 'P3');
  const urgent = riskItems.find((item) => item.dedupeKey === 'status:urgent');
  const openDelayed = riskItems.find((item) => item.dedupeKey === 'alert:openDelayed');
  const lead = p1[0] || p2[0] || riskItems[0];
  const actionRecommendation = riskActionRecommendation(riskItems, inputSnapshot);
  const dataQuality = buildDataQualitySummary(inputSnapshot);
  return {
    actionRecommendation,
    actionRecommendationSource: 'riskHealthAgent',
    dataQuality,
    headline:
      urgent && openDelayed
        ? `今天先处理 ${urgent.impactCount} 个紧急点铺 + ${openDelayed.impactCount} 个延期未闭环；状态冲突和数据口径只做核对。`
        : urgent
          ? `今天先处理 ${urgent.impactCount} 个紧急点铺，逐个确认卡点、责任人和反馈时间。`
          : openDelayed
            ? `今天先闭环 ${openDelayed.impactCount} 个延期未闭环，逐项确认卡点、责任人和最晚反馈时间。`
            : lead
              ? `今天先处理「${lead.title}」；其余低优先级问题放到核对或复盘。`
              : '今天暂无需要插队处理的运营风险。',
    actionNote: '首屏只展示今日动作，原因、证据和字段口径默认放到二级展开。',
    totalRisks: riskItems.length,
    criticalCount: 0,
    highCount: p1.length,
    mediumCount: p2.length,
    observeCount: p3.length,
    totalImpactCount: riskItems.reduce((sum, item) => sum + item.impactCount, 0),
    distribution,
  };
}

export function buildRiskHealthAnalysis(metrics = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const owner = metrics.owner || options.owner || '';
  const dashboardContext = metrics.dashboardContext || options.dashboardContext || 'all';
  const dataHealth = metrics.dataHealth || {};
  const alerts = metrics.alerts || {};
  const totalProjects = dataHealth.totalProjects || metrics.summary?.totalProjects || 0;
  const urgentStatusItem = createUrgentStatusRiskItem(metrics);
  const alertItems = Object.entries(ALERT_DEFINITIONS)
    .map(([key]) => createAlertRiskItem(metrics, key, safeNumber(alerts[key])))
    .filter(Boolean);
  const healthItems = (dataHealth.checks || []).map(createHealthRiskItem).filter(Boolean);
  const coverageItems = (dataHealth.fieldCoverage || [])
    .map((item) => createCoverageRiskItem(item, totalProjects))
    .filter(Boolean);
  const riskItems = [urgentStatusItem, ...alertItems, ...healthItems]
    .filter(Boolean)
    .sort((a, b) => {
      const severityDiff = (SEVERITY_ORDER[a.severity] || 9) - (SEVERITY_ORDER[b.severity] || 9);
      return severityDiff || b.impactCount - a.impactCount || a.title.localeCompare(b.title, 'zh-Hans-CN');
    })
    .map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
  const runId = options.runId || generatedRunId({ owner, dashboardContext, generatedAt });
  const inputSnapshot = {
    owner,
    dashboardContext,
    summary: metrics.summary || {},
    alerts,
    statusCounts: metrics.statusCounts || [],
    urgentStatusProjects: metrics.urgentStatusProjects || [],
    dataHealth,
    openDelayedProjects: metrics.openDelayedProjects || [],
    riskProjects: metrics.riskProjects || [],
    coverageNotes: coverageItems,
  };
  const metadata = buildAgentRunMetadata({
    channel: 'riskHealth',
    agentName: '运营风险健康 Agent',
    promptVersion: RISK_HEALTH_AGENT_PROMPT_VERSION,
    prompt: RISK_HEALTH_AGENT_PROMPT,
    owner,
    dashboardContext,
  });

  return {
    ...metadata,
    runId,
    owner,
    dashboardContext,
    generatedAt,
    promptHash: options.promptHash || metadata.promptHash,
    modelName: options.modelName || AGENT_MODEL_NAME,
    runMode: AGENT_MODEL_NAME,
    inputSnapshotHash: options.inputSnapshotHash || inputSnapshotHashFor(inputSnapshot),
    inputSnapshot,
    summary: summarizeRiskItems(riskItems, inputSnapshot),
    riskItems: riskItems.map((item) => ({
      riskItemId: `${runId}:${hashText(item.dedupeKey).slice(0, 12)}`,
      runId,
      owner,
      dashboardContext,
      ...item,
    })),
  };
}
