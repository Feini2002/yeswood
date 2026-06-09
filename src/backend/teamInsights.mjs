import { calculateTeamDashboardMetrics } from './projectData.mjs';
import { isOpenDesignResponsibilityDelayed } from './metrics/fieldSemantics.mjs';
import { excludePausedProjects } from './metrics/pausedProjects.mjs';
import { matchesDashboardContext } from './metrics/projectScopes.mjs';
import { buildOwnerDashboardAgentBundle } from './agents/agentWorker.mjs';

function rate(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return Math.round((numerator / denominator) * 100);
}

function pctText(value) {
  return `${value}%`;
}

function deltaText(delta) {
  if (delta > 0) {
    return `较上月 +${delta}`;
  }
  if (delta < 0) {
    return `较上月 ${delta}`;
  }
  return '与上月持平';
}

function latestMonthComparison(series = []) {
  if (!series.length) {
    return { label: '', value: 0, prevValue: 0, delta: 0 };
  }
  const sorted = series.slice().sort((a, b) => a.label.localeCompare(b.label));
  const latest = sorted[sorted.length - 1];
  const prev = sorted.length > 1 ? sorted[sorted.length - 2] : { value: 0 };
  return {
    label: latest.label,
    value: latest.value,
    prevValue: prev.value,
    delta: latest.value - prev.value,
  };
}

function projectMatchesBenchmarkDelay(project, ownerDiscipline = '') {
  if (ownerDiscipline === 'hard' || ownerDiscipline === 'soft') {
    return isOpenDesignResponsibilityDelayed(project, { discipline: ownerDiscipline });
  }
  return isOpenDesignResponsibilityDelayed(project);
}

function normalizeOwnerRates(ownerRates = []) {
  return (Array.isArray(ownerRates) ? ownerRates : [])
    .map((item) => ({
      owner: item.owner || '',
      delayedRate: Number(item.delayedRate || 0),
      total: Number(item.total || 0),
    }))
    .filter((item) => item.owner && item.total > 0)
    .sort((a, b) => b.delayedRate - a.delayedRate);
}

export function buildTeamOwnerRates(allProjects, architecture = {}, dashboardContext = 'all') {
  const teams = Array.isArray(architecture.teams) ? architecture.teams : [];
  return normalizeOwnerRates(
    teams.map((team) => {
      const metrics = calculateTeamDashboardMetrics(allProjects, team, architecture, { dashboardContext });
      const total = metrics.summary?.totalProjects || 0;
      const delayed = metrics.summary?.delayedProjects || 0;
      return {
        owner: team.owner,
        delayedRate: rate(delayed, total),
        total,
      };
    })
  );
}

export function buildTeamBenchmark(allProjects, teamMetrics, architecture = {}, options = {}) {
  const dashboardContext = teamMetrics.dashboardContext || 'all';
  const benchmarkProjects = excludePausedProjects(
    allProjects.filter((project) => matchesDashboardContext(project, dashboardContext))
  );
  const departmentTotal = benchmarkProjects.length;
  const ownerDiscipline = teamMetrics.ownerDiscipline || '';
  const departmentDelayed = benchmarkProjects.filter((project) => projectMatchesBenchmarkDelay(project, ownerDiscipline)).length;
  const departmentAvgProgress =
    departmentTotal === 0
      ? 0
      : Math.round(benchmarkProjects.reduce((sum, project) => sum + Number(project.progress || 0), 0) / departmentTotal);

  const teamTotal = teamMetrics.summary?.totalProjects || 0;
  const teamDelayed = teamMetrics.summary?.delayedProjects || 0;
  const teamDelayedRate = rate(teamDelayed, teamTotal);
  const departmentDelayedRate = rate(departmentDelayed, departmentTotal);

  const ownerRates = options.ownerRates
    ? normalizeOwnerRates(options.ownerRates)
    : buildTeamOwnerRates(allProjects, architecture, dashboardContext);

  const rankAmongOwners =
    ownerRates.findIndex((item) => item.owner === teamMetrics.owner) >= 0
      ? ownerRates.findIndex((item) => item.owner === teamMetrics.owner) + 1
      : 0;

  return {
    dashboardContext,
    departmentTotal,
    departmentDelayedRate,
    departmentAvgProgress,
    teamDelayedRate,
    teamShareOfDepartment: rate(teamTotal, departmentTotal),
    rankAmongOwners,
    ownerTeamCount: ownerRates.length,
  };
}

export function buildTeamComparisons(teamMetrics) {
  const monthly = teamMetrics.monthlyEntry || {};
  return {
    newStoreLatestMonth: latestMonthComparison(monthly.newStore),
    oldStoreLatestMonth: latestMonthComparison(monthly.oldStore),
    delayedShare: {
      value: teamMetrics.summary?.delayedProjects || 0,
      total: teamMetrics.summary?.totalProjects || 0,
    },
  };
}

function delayedRateInsight(teamDelayedRate, departmentDelayedRate) {
  const diff = teamDelayedRate - departmentDelayedRate;
  if (teamDelayedRate === 0) {
    return '当前团队暂无延期项目，节奏相对稳健。';
  }
  if (diff > 5) {
    return `延期率 ${pctText(teamDelayedRate)}，高于部门均值 ${Math.abs(diff)} 个百分点，需优先排查方案节点。`;
  }
  if (diff < -5) {
    return `延期率 ${pctText(teamDelayedRate)}，低于部门均值 ${Math.abs(diff)} 个百分点，整体推进较好。`;
  }
  return `延期率 ${pctText(teamDelayedRate)}，与部门均值接近，宜持续跟踪高风险项目。`;
}

function buildDataQualityInsight(dataHealth = {}) {
  const limitations = Array.isArray(dataHealth.limitations) ? dataHealth.limitations.filter(Boolean) : [];
  const warningCount = Number(dataHealth.warningCount || 0);
  const lowCoverageFields = Number(dataHealth.lowCoverageFields || 0);
  const hasWarnings = warningCount > 0 || lowCoverageFields > 0 || dataHealth.qualityLevel === 'low' || dataHealth.qualityLevel === 'medium';
  if (!hasWarnings && !limitations.length) {
    return '字段覆盖和口径状态良好，当前洞察可按正常运营辅助使用。';
  }
  if (limitations.length) {
    return `数据可信度受限：${limitations[0]}。仅供辅助判断，需回源表核对，不作为风险追责依据。`;
  }
  return `数据可信度受限：发现 ${lowCoverageFields} 个低覆盖字段、${warningCount} 条口径核对项。仅供辅助判断，需回源表核对，不作为风险追责依据。`;
}

export function buildTeamInsights(teamMetrics, benchmark, comparisons) {
  const summary = teamMetrics.summary || {};
  const alerts = teamMetrics.alerts || {};
  const fieldCoverage = teamMetrics.fieldCoverage || {};
  const dataHealth = teamMetrics.dataHealth || {};
  const team = teamMetrics.team || {};
  const totals = teamMetrics.totals || {};
  const difficultySummary = teamMetrics.difficultySummary || {};
  const total = summary.totalProjects || 0;
  const inProgress = totals.inProgress ?? summary.activeProjects ?? 0;
  const notStarted = totals.notStarted ?? summary.notStarted ?? 0;
  const teamDelayedRate = benchmark.teamDelayedRate || 0;

  const headlineParts = [];
  if (total) {
    headlineParts.push(`总看盘 ${total} 项`);
    headlineParts.push(`进行中 ${inProgress} 项`);
    headlineParts.push(`延期率 ${pctText(teamDelayedRate)}`);
    const diff = teamDelayedRate - (benchmark.departmentDelayedRate || 0);
    if (Math.abs(diff) > 5) {
      headlineParts.push(diff > 0 ? `高于部门均值 ${Math.abs(diff)} 个百分点` : `低于部门均值 ${Math.abs(diff)} 个百分点`);
    }
  } else {
    headlineParts.push('当前负责人团队暂无匹配项目');
  }

  const newStore = comparisons.newStoreLatestMonth || {};
  const oldStore = comparisons.oldStoreLatestMonth || {};
  const statusTop = (teamMetrics.statusCounts || [])[0];
  const urgentStatus = (teamMetrics.statusCounts || []).find((item) => item.label === '紧急');
  const leadLoad = teamMetrics.leadLoad || [];
  const weightedLeadLoad = teamMetrics.weightedLeadLoad || [];
  const leadWithProjects = leadLoad.filter((item) => item.value > 0);
  const leadWithWorkload = weightedLeadLoad.filter((item) => Number(item.weightedWorkload || 0) > 0);
  const tierKeys = Object.keys(teamMetrics.monthlyEntry?.byStoreTier || {});
  const tierWithData = tierKeys.filter((key) => (teamMetrics.monthlyEntry.byStoreTier[key] || []).length > 0);
  const highDifficultyCount = (difficultySummary.byLevel || [])
    .filter((item) => item.label === '难' || item.label === '重')
    .reduce((sum, item) => sum + Number(item.projectCount || item.value || 0), 0);
  const topDifficultyTier = (difficultySummary.byStoreTier || [])
    .slice()
    .sort((a, b) => Number(b.responsibleWeightedWorkload || 0) - Number(a.responsibleWeightedWorkload || 0))[0];

  const modules = {
    summary:
      total === 0
        ? '尚未匹配到负责人列中包含该人的项目，请检查负责人字段与看盘上下文（加盟/直营）。'
        : `总看盘 ${total} 项，${inProgress} 项进行中，${notStarted} 项未开始，责任人月 ${difficultySummary.responsibleWeightedWorkload || 0}，平均难度 ${difficultySummary.avgScore || 0}。`,
    alerts:
      alerts.openDelayed > 0
        ? `${alerts.openDelayed} 项未闭环延期，${alerts.schemeDelayedThisMonth || 0} 项本月方案延期，建议优先介入。`
        : '当前未闭环延期较少，可继续按节点推进方案与摆场。',
    newStoreEntry:
      newStore.value > 0
        ? `最近月份 ${newStore.label || '—'} 新店进店 ${newStore.value} 项，${deltaText(newStore.delta || 0)}。`
        : fieldCoverage.entryDate < 50
          ? `源表进店月份字段覆盖率仅 ${fieldCoverage.entryDate || 0}%，新店进店趋势仅供参考。`
          : '近期暂无新店进店记录，可结合排期关注后续进店节奏。',
    oldStoreEntry:
      oldStore.value > 0
        ? `最近月份 ${oldStore.label || '—'} 老店进店 ${oldStore.value} 项，${deltaText(oldStore.delta || 0)}。`
        : '近期暂无老店进店记录，老店改造压力相对有限。',
    storeTier:
      topDifficultyTier?.projectCount
        ? `${topDifficultyTier.label} 责任人月最高（${topDifficultyTier.responsibleWeightedWorkload || 0}），难/重项目 ${highDifficultyCount} 项，需结合进店节奏看压力。`
        : tierWithData.length
          ? `${tierWithData.join('、')} 等店态有进店记录，可结合延期率判断哪类店态压力更高。`
        : '店态分层暂无足够进店数据，建议完善业态/店态字段后再分析。',
    statusDistribution: urgentStatus?.value
      ? `项目状态里有 ${urgentStatus.value} 项标记紧急，应放到运营风险诊断里优先带班；未设置和一般只作填报参考。`
      : statusTop
        ? '项目状态暂无紧急项；未设置和一般只作填报参考，不作为风险判断。'
        : '暂无状态分布数据。',
    dataQuality: buildDataQualityInsight(dataHealth),
    leadLoad: leadWithProjects.length
      ? leadWithWorkload.length
        ? `${leadWithWorkload[0].displayName || leadWithWorkload[0].name} 责任人月最高（${leadWithWorkload[0].weightedWorkload}），项目数 ${leadWithWorkload[0].value} 项。`
        : `${leadWithProjects[0].displayName || leadWithProjects[0].name} 负载最高（${leadWithProjects[0].value} 项），需关注是否超负荷。`
      : '当前负责人项目暂无硬装/软装组长责任列。',
    teamStructure:
      leadWithProjects.length
        ? '协作人负载按项目责任列自动聚合，不再依赖本地团队从属配置。'
        : '协作人负载按项目责任列自动聚合，当前负责人项目暂无可统计协作人。',
    riskProjects:
      (teamMetrics.riskProjects || []).length
        ? `当前有 ${teamMetrics.riskProjects.length} 项延期或高风险项目需要优先跟进。`
        : '暂无延期或高风险项目，团队风险面相对可控。',
    yearSummary:
      (teamMetrics.yearSummary?.totalAssignedYtd || 0) > 0
        ? `本年已承接 ${teamMetrics.yearSummary.totalAssignedYtd} 项，完成 ${teamMetrics.yearSummary.completedSchemes || 0} 项。`
        : '本年至今暂无新承接或完成记录。',
  };

  return {
    headline: `${headlineParts.join('，')}。`.replace('。。', '。'),
    modules,
  };
}

export function buildTeamTooltipCatalog(teamMetrics, benchmark) {
  const summary = teamMetrics.summary || {};
  const total = summary.totalProjects || 0;
  const alerts = teamMetrics.alerts || {};
  const fieldCoverage = teamMetrics.fieldCoverage || {};

  return {
    totalProjects: {
      title: '团队项目总数',
      value: total,
      definition: '负责人列包含该负责人的项目数。',
      compare: `占部门总量 ${benchmark.teamShareOfDepartment || 0}%`,
    },
    activeProjects: {
      title: '推进项目',
      value: summary.activeProjects || 0,
      definition: '当前负责人责任域内仍未完成的硬装或软装设计责任项目。',
      compare: `占团队 ${rate(summary.activeProjects || 0, total)}%`,
    },
    notStarted: {
      title: '未开始',
      value: summary.notStarted || 0,
      definition: '当前负责人相关店态内，硬装与软装项目进度均为未开始/未安排（或为空）。',
      compare: `占团队 ${rate(summary.notStarted || 0, total)}%`,
    },
    delayedProjects: {
      title: '延期项目',
      value: summary.delayedProjects || 0,
      definition: '当前负责人责任域内，硬装方案或软装完成情况明确延期且尚未完成。',
      compare: `团队延期率 ${benchmark.teamDelayedRate || 0}%，部门 ${benchmark.departmentDelayedRate || 0}%`,
    },
    averageProgress: {
      title: '平均进度',
      value: `${summary.averageProgress || 0}%`,
      definition: '团队项目 progress 字段算术平均。',
      compare: `部门平均 ${benchmark.departmentAvgProgress || 0}%`,
    },
    schemeDelayedThisMonth: {
      title: '本月方案延期完成',
      value: alerts.schemeDelayedThisMonth || 0,
      definition: '硬装方案情况为延期完成，且完成日期在本月。',
      compare: `方案字段覆盖率 ${fieldCoverage.schemeStatus || 0}%`,
    },
    schemeDelayedYtd: {
      title: '本年方案延期完成累计',
      value: alerts.schemeDelayedYtd || 0,
      definition: '本年度硬装方案延期完成项目数。',
      compare: `未闭环延期 ${alerts.openDelayed || 0} 项`,
    },
    openDelayed: {
      title: '未闭环延期',
      value: alerts.openDelayed || 0,
      definition: '设计责任未完成，且硬装方案或软装完成情况处于延期状态；不含计划开业和采购摆场边界。',
      compare: delayedRateInsight(benchmark.teamDelayedRate || 0, benchmark.departmentDelayedRate || 0),
    },
    unscheduled: {
      title: '未开始项目',
      value: alerts.unscheduled || 0,
      definition: '硬装项目进度为空或属于未开始/未安排。',
      compare: `占团队 ${rate(alerts.unscheduled || 0, total)}%`,
    },
  };
}

export function enrichTeamDashboardMetrics(allProjects, teamMetrics, architecture = {}, options = {}) {
  const benchmark = buildTeamBenchmark(allProjects, teamMetrics, architecture, options);
  const comparisons = buildTeamComparisons(teamMetrics);
  const insights = buildTeamInsights(teamMetrics, benchmark, comparisons);
  const tooltipCatalog = buildTeamTooltipCatalog(teamMetrics, benchmark);
  const agentWorker = buildOwnerDashboardAgentBundle(teamMetrics);
  const collaborationSimulation = agentWorker.channels.teamCollaboration?.output || null;

  return {
    ...teamMetrics,
    benchmark,
    comparisons,
    insights,
    tooltipCatalog,
    collaborationSimulation,
    agentWorker,
  };
}
