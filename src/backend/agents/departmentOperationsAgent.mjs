import { AGENT_MODEL_NAME, buildAgentRunMetadata, inputSnapshotHashFor } from './agentMetadata.mjs';
import {
  DEPARTMENT_OPERATIONS_AGENT_PROMPT,
  DEPARTMENT_OPERATIONS_AGENT_PROMPT_VERSION,
} from './departmentOperationsAgentPrompt.mjs';

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round1(value) {
  return Math.round(safeNumber(value) * 10) / 10;
}

function average(rows = [], key) {
  const values = rows.map((row) => safeNumber(row[key])).filter((value) => value > 0);
  if (!values.length) {
    return 0;
  }
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function latestByLabel(rows = []) {
  return rows
    .slice()
    .filter((row) => row?.label)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
    .at(-1) || null;
}

function peakPressure(rows = []) {
  return rows
    .slice()
    .filter((row) => row?.label)
    .sort((a, b) => safeNumber(b.pressureScore) - safeNumber(a.pressureScore))[0] || null;
}

function rankBy(rows = [], key) {
  const ranked = rows
    .slice()
    .filter((row) => !row.dataRisk)
    .sort((a, b) => safeNumber(b[key]) - safeNumber(a[key]) || String(a.owner).localeCompare(String(b.owner), 'zh-Hans-CN'));
  return new Map(ranked.map((row, index) => [row.owner, index + 1]));
}

function compactTeamMetrics(metrics = {}) {
  const pressureRows = Array.isArray(metrics.monthlyEntry?.pressureByMonth) ? metrics.monthlyEntry.pressureByMonth : [];
  const latestPressure = latestByLabel(pressureRows);
  const pressurePeak = peakPressure(pressureRows);
  const summary = metrics.summary || {};
  const difficulty = metrics.difficultySummary || {};
  const collaborationFacts = metrics.collaborationSimulation?.facts || {};
  const entryCoverage = safeNumber(metrics.fieldCoverage?.entryDate);
  const owner = metrics.owner || metrics.displayName || '';
  const activeProjects = safeNumber(summary.activeProjects || summary.totalProjects || metrics.total);
  const delayedProjects = safeNumber(summary.delayedProjects || metrics.alerts?.openDelayed);
  const highRiskProjects = safeNumber(summary.highRiskProjects);
  const responsibleWeightedWorkload = round1(
    difficulty.responsibleWeightedWorkload || difficulty.weightedWorkload || difficulty.workload
  );
  const currentPressureScore = round1(latestPressure?.pressureScore);
  const peakPressureScore = round1(pressurePeak?.pressureScore);
  const dataRisk = !owner || (!pressureRows.length && !activeProjects && !responsibleWeightedWorkload);

  return {
    owner,
    displayName: metrics.displayName || owner,
    dashboardContext: metrics.dashboardContext || 'all',
    analysisMonth: latestPressure?.label || '',
    currentPressureScore,
    peakPressureMonth: pressurePeak?.label || '',
    peakPressureScore,
    activeProjects,
    delayedProjects,
    highRiskProjects,
    responsibleWeightedWorkload,
    highDifficultyCount: safeNumber(difficulty.highDifficultyCount),
    overloadedPeople: safeNumber(collaborationFacts.overloadedCount),
    availablePeople: safeNumber(collaborationFacts.availableCount),
    entryDateCoverage: entryCoverage,
    dataRisk,
  };
}

function buildDepartmentBenchmark(validRows = []) {
  const pressureRank = rankBy(validRows, 'currentPressureScore');
  const workloadRank = rankBy(validRows, 'responsibleWeightedWorkload');
  return {
    teamCount: validRows.length,
    averagePressureScore: average(validRows, 'currentPressureScore'),
    averageResponsibleWeightedWorkload: average(validRows, 'responsibleWeightedWorkload'),
    averageActiveProjects: average(validRows, 'activeProjects'),
    pressureRank,
    workloadRank,
  };
}

function stanceFor(row, benchmark) {
  if (row.dataRisk) {
    return 'dataRisk';
  }
  const pressure = safeNumber(row.currentPressureScore);
  const workload = safeNumber(row.responsibleWeightedWorkload);
  const delayedRisk = safeNumber(row.delayedProjects) + safeNumber(row.highRiskProjects);
  const avgPressure = safeNumber(benchmark.averagePressureScore);
  const avgWorkload = safeNumber(benchmark.averageResponsibleWeightedWorkload);
  const abovePressure = avgPressure ? pressure >= avgPressure * 1.25 : pressure >= 80;
  const aboveWorkload = avgWorkload ? workload >= avgWorkload * 1.3 : workload >= 80;
  const belowPressure = avgPressure ? pressure <= avgPressure * 0.85 : pressure < 45;
  const belowWorkload = avgWorkload ? workload <= avgWorkload * 0.85 : workload < 45;

  if (pressure >= 80 || abovePressure || aboveWorkload || delayedRisk >= 3 || row.overloadedPeople > 0) {
    return 'less';
  }
  if (belowPressure && belowWorkload && delayedRisk === 0 && row.availablePeople > 0) {
    return 'more';
  }
  return 'steady';
}

function stanceLabel(stance) {
  return {
    more: '多承接',
    steady: '稳承接',
    less: '少承接',
    dataRisk: '数据待补',
  }[stance] || '稳承接';
}

function lessStanceDriver(row, benchmark) {
  const avgPressure = safeNumber(benchmark.averagePressureScore);
  const avgWorkload = safeNumber(benchmark.averageResponsibleWeightedWorkload);
  const delayedRisk = safeNumber(row.delayedProjects) + safeNumber(row.highRiskProjects);
  if (row.currentPressureScore >= 80 || (avgPressure && row.currentPressureScore >= avgPressure * 1.25)) {
    return `当前压力 ${row.currentPressureScore} 高于部门均值 ${avgPressure}`;
  }
  if (avgWorkload && row.responsibleWeightedWorkload >= avgWorkload * 1.3) {
    return `剩余责任人月 ${row.responsibleWeightedWorkload} 高于部门均值 ${avgWorkload}`;
  }
  if (delayedRisk >= 3) {
    return `延期/高风险遗留 ${delayedRisk} 项`;
  }
  if (row.overloadedPeople > 0) {
    return `协作偏满 ${row.overloadedPeople} 人`;
  }
  return `推进 ${row.activeProjects} 项`;
}

function headlineFor(row, stance, benchmark) {
  const avgPressure = benchmark.averagePressureScore || 0;
  const avgWorkload = benchmark.averageResponsibleWeightedWorkload || 0;
  if (stance === 'less') {
    return `${row.displayName} ${lessStanceDriver(row, benchmark)}；下月建议少承接、控新增。`;
  }
  if (stance === 'more') {
    return `${row.displayName} 压力 ${row.currentPressureScore}、责任人月 ${row.responsibleWeightedWorkload} 均低于部门均值；下月可多承接普通低中难项目。`;
  }
  if (stance === 'dataRisk') {
    return `${row.displayName} 关键口径缺失，先补齐数据再判断承接量。`;
  }
  return `${row.displayName} 压力 ${row.currentPressureScore} / 部门 ${avgPressure}，责任人月 ${row.responsibleWeightedWorkload} / 部门 ${avgWorkload}；建议稳承接。`;
}

function evidenceFor(row, benchmark) {
  return [
    `压力值 ${row.currentPressureScore}，部门均值 ${benchmark.averagePressureScore}`,
    `剩余责任人月 ${row.responsibleWeightedWorkload}，部门均值 ${benchmark.averageResponsibleWeightedWorkload}`,
    `推进 ${row.activeProjects} 项，延期 ${row.delayedProjects} / 高风险 ${row.highRiskProjects}`,
    row.entryDateCoverage && row.entryDateCoverage < 50 ? `进店时间覆盖率 ${row.entryDateCoverage}%` : '',
  ].filter(Boolean);
}

function actionsFor(row, stance) {
  if (stance === 'less') {
    const delayedRisk = safeNumber(row.delayedProjects) + safeNumber(row.highRiskProjects);
    return [
      delayedRisk ? '先清理延期和高风险遗留' : '先复核存量项目排期',
      row.currentPressureScore >= 60 ? '冻结高难新店插单' : '谨慎新增高难项目',
      row.overloadedPeople > 0 ? '新增前复核协作人负载' : '保留评审缓冲',
    ];
  }
  if (stance === 'more') {
    return ['承接普通低中难项目', '优先接低风险老店', '保留高难项目评审缓冲'];
  }
  if (stance === 'dataRisk') {
    return ['补齐进店月份和难度口径', '确认负责人归属', '暂不放大承接判断'];
  }
  return ['维持当前承接节奏', '新增前检查遗留闭环', '补齐低覆盖字段'];
}

function buildOwnerRecommendations(rows = [], benchmark = {}) {
  const recommendations = {};
  for (const row of rows) {
    const stance = stanceFor(row, benchmark);
    recommendations[row.owner] = {
      owner: row.owner,
      displayName: row.displayName,
      stance,
      stanceLabel: stanceLabel(stance),
      headline: headlineFor(row, stance, benchmark),
      reason:
        stance === 'less'
          ? '相对部门压力或遗留偏高，应先控新增。'
          : stance === 'more'
            ? '相对部门压力和剩余责任人月较低，可承接普通新增。'
            : stance === 'dataRisk'
              ? '关键输入不足，判断降级。'
              : '相对部门处于中位区间，适合稳承接。',
      evidence: evidenceFor(row, benchmark),
      actions: actionsFor(row, stance),
      pressureRank: benchmark.pressureRank?.get(row.owner) || 0,
      workloadRank: benchmark.workloadRank?.get(row.owner) || 0,
    };
  }
  return recommendations;
}

function buildDepartmentRecommendations(ownerRecommendations = {}) {
  const rows = Object.values(ownerRecommendations);
  const less = rows.filter((row) => row.stance === 'less');
  const more = rows.filter((row) => row.stance === 'more');
  const dataRisk = rows.filter((row) => row.stance === 'dataRisk');
  const recommendations = [];

  if (less.length) {
    recommendations.push({
      priority: 'P1',
      title: '承压组先控新增',
      action: `${less.map((row) => row.displayName).slice(0, 2).join('、')} 下月先控新增，优先清遗留和高风险。`,
      evidence: less.slice(0, 2).flatMap((row) => row.evidence.slice(0, 2)),
    });
  }
  if (more.length) {
    recommendations.push({
      priority: 'P2',
      title: '低压组承接普通项目',
      action: `${more.map((row) => row.displayName).slice(0, 2).join('、')} 可优先承接普通低中难项目。`,
      evidence: more.slice(0, 2).flatMap((row) => row.evidence.slice(0, 2)),
    });
  }
  if (dataRisk.length) {
    recommendations.push({
      priority: 'P2',
      title: '补齐团队口径',
      action: `${dataRisk.map((row) => row.displayName).slice(0, 3).join('、')} 数据缺口较多，先补负责人、进店和难度口径。`,
      evidence: dataRisk.map((row) => row.displayName),
    });
  }
  if (!recommendations.length && rows.length) {
    recommendations.push({
      priority: 'P3',
      title: '部门承接保持平稳',
      action: '各组压力接近部门均值，下月按店态难度常规分配。',
      evidence: [`参与分析 ${rows.length} 个小组`],
    });
  }

  return recommendations.slice(0, 4);
}

export function buildDepartmentOperationsAnalysis(input = {}) {
  const dashboardContext = input.dashboardContext || 'all';
  const currentOwner = input.currentOwner || '';
  const metricsByOwner = input.metricsByOwner || {};
  const rows = Object.values(metricsByOwner).map(compactTeamMetrics).filter((row) => row.owner);
  const validRows = rows.filter((row) => !row.dataRisk);
  const benchmark = buildDepartmentBenchmark(validRows);
  const inputSnapshot = {
    dashboardContext,
    currentOwner,
    teams: rows,
    departmentBenchmark: {
      teamCount: benchmark.teamCount,
      averagePressureScore: benchmark.averagePressureScore,
      averageResponsibleWeightedWorkload: benchmark.averageResponsibleWeightedWorkload,
      averageActiveProjects: benchmark.averageActiveProjects,
    },
  };
  const metadata = buildAgentRunMetadata({
    channel: 'departmentOperations',
    agentName: '部门团队运转分析 Agent',
    promptVersion: DEPARTMENT_OPERATIONS_AGENT_PROMPT_VERSION,
    prompt: DEPARTMENT_OPERATIONS_AGENT_PROMPT,
    owner: 'department',
    dashboardContext,
  });
  const ownerRecommendations = buildOwnerRecommendations(rows, benchmark);
  const limitations = rows
    .filter((row) => row.dataRisk)
    .map((row) => `${row.displayName} 缺少进店压力、项目数或剩余难度口径。`);
  const currentOwnerRecommendation = ownerRecommendations[currentOwner] || null;

  return {
    ...metadata,
    runMode: AGENT_MODEL_NAME,
    inputSnapshotHash: inputSnapshotHashFor(inputSnapshot),
    inputSnapshot,
    generatedAt: new Date().toISOString(),
    status: rows.length ? 'ready' : 'empty',
    context: {
      dashboardContext,
      currentOwner,
      analysisMode: 'department_relative',
    },
    summary: {
      title: rows.length ? '部门团队运转研判' : '暂无部门团队数据',
      level: Object.values(ownerRecommendations).some((item) => item.stance === 'less') ? 'P1' : 'P3',
      text: currentOwnerRecommendation?.headline || `当前口径纳入 ${rows.length} 个小组。`,
      confidence: limitations.length ? 'medium' : rows.length ? 'high' : 'low',
    },
    facts: {
      teamCount: rows.length,
      readyTeamCount: validRows.length,
      dataRiskTeamCount: limitations.length,
      averagePressureScore: benchmark.averagePressureScore,
      averageResponsibleWeightedWorkload: benchmark.averageResponsibleWeightedWorkload,
    },
    teams: rows.map((row) => ({
      ...row,
      pressureRank: benchmark.pressureRank?.get(row.owner) || 0,
      workloadRank: benchmark.workloadRank?.get(row.owner) || 0,
    })),
    ownerRecommendations,
    currentOwnerRecommendation,
    departmentRecommendations: buildDepartmentRecommendations(ownerRecommendations),
    limitations,
  };
}
