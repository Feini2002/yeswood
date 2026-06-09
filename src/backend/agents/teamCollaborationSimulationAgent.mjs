import { AGENT_MODEL_NAME, buildAgentRunMetadata, inputSnapshotHashFor } from './agentMetadata.mjs';
import {
  TEAM_COLLABORATION_SIMULATION_AGENT_PROMPT,
  TEAM_COLLABORATION_SIMULATION_AGENT_PROMPT_VERSION,
} from './teamCollaborationSimulationAgentPrompt.mjs';

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round1(value) {
  return Math.round(safeNumber(value) * 10) / 10;
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(100, safeNumber(value))));
}

function pctAbove(value, baseline) {
  if (!baseline) {
    return 0;
  }
  return Math.round(((safeNumber(value) - safeNumber(baseline)) / safeNumber(baseline)) * 100);
}

function groupByRole(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = item.roleLabel || item.positionLabel || item.role || '协作人';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }
  return groups;
}

function roleStats(items = []) {
  const count = items.length || 1;
  const projectCounts = items.map((item) => safeNumber(item.projectCount || item.value));
  const workloads = items.map((item) => safeNumber(item.weightedWorkload));
  const avgProjects = projectCounts.reduce((sum, value) => sum + value, 0) / count;
  const avgWorkload = workloads.reduce((sum, value) => sum + value, 0) / count;
  return {
    avgProjects,
    avgWorkload,
    maxProjects: Math.max(...projectCounts, 1),
    maxWorkload: Math.max(...workloads, 0),
  };
}

function mergedPeopleRows(leadLoad = [], weightedLeadLoad = []) {
  const byName = new Map();
  for (const item of leadLoad || []) {
    if (item?.name) {
      byName.set(item.name, { ...item });
    }
  }
  for (const item of weightedLeadLoad || []) {
    if (!item?.name) {
      continue;
    }
    byName.set(item.name, { ...(byName.get(item.name) || {}), ...item });
  }
  return Array.from(byName.values()).filter((item) => item.name);
}

function scorePerson(row, roleStat, hasWeightedData) {
  const projectCount = safeNumber(row.value || row.projectCount);
  const weightedWorkload = safeNumber(row.weightedWorkload);
  const delayedCount = safeNumber(row.delayed);
  const highRiskCount = safeNumber(row.highRisk);
  const riskPressure = Math.min((delayedCount * 1.4 + highRiskCount * 1.8) / Math.max(projectCount, 1), 1);
  const difficultyPressure = Math.min(safeNumber(row.avgScore) / 80, 1);
  const projectShare = Math.min(projectCount / Math.max(roleStat.maxProjects, 1), 1);

  if (!hasWeightedData) {
    return roundScore(projectShare * 58 + Math.min(projectCount / 8, 1) * 24 + riskPressure * 18);
  }

  const workloadShare = Math.min(weightedWorkload / Math.max(roleStat.maxWorkload, 1), 1);
  const workloadAbsolute = Math.min(weightedWorkload / 70, 1);
  return roundScore(
    workloadShare * 34 +
      workloadAbsolute * 24 +
      projectShare * 20 +
      riskPressure * 14 +
      difficultyPressure * 8
  );
}

function statusFor(row) {
  const riskCount = safeNumber(row.delayedCount) + safeNumber(row.highRiskCount);
  if (!row.hasWeightedData && row.projectCount <= 0) {
    return 'dataRisk';
  }
  if (row.loadScore >= 80 || (row.loadScore >= 70 && riskCount > 0)) {
    return 'overloaded';
  }
  if (row.loadScore >= 60 || riskCount > 0) {
    return 'watch';
  }
  if (row.loadScore < 45 && riskCount === 0) {
    return 'available';
  }
  return 'steady';
}

function statusLabel(status) {
  return {
    overloaded: '任务较多',
    watch: '需要留意',
    steady: '相对平稳',
    available: '可再看看',
    dataRisk: '数据待补',
  }[status] || '相对平稳';
}

function personReason(row, roleStat) {
  const parts = [];
  if (row.hasWeightedData && roleStat.avgWorkload) {
    const delta = pctAbove(row.weightedWorkload, roleStat.avgWorkload);
    if (delta > 20) {
      parts.push(`责任人月高于同角色均值 ${delta}%`);
    } else if (delta < -20) {
      parts.push(`责任人月低于同角色均值 ${Math.abs(delta)}%`);
    }
  }
  if (row.projectCount >= Math.max(4, Math.ceil(roleStat.avgProjects))) {
    parts.push(`项目数 ${row.projectCount} 项`);
  }
  if (row.delayedCount) {
    parts.push(`${row.delayedCount} 项延期`);
  }
  if (row.highRiskCount) {
    parts.push(`${row.highRiskCount} 项高风险`);
  }
  if (row.avgScore) {
    parts.push(`平均难度 ${row.avgScore}`);
  }
  return parts.join('，') || '负载处于同角色常规区间';
}

function personAction(row) {
  if (row.status === 'overloaded') {
    return row.delayedCount || row.highRiskCount ? '先核对延期/高风险项目卡点' : '新增前先看近期开工与审核节点';
  }
  if (row.status === 'watch') {
    return '新增前先核对近期开工与审核节点';
  }
  if (row.status === 'available') {
    return '可作为普通新增候选';
  }
  if (row.status === 'dataRisk') {
    return '先补齐责任列和难度数据';
  }
  return '维持当前排班节奏';
}

function buildRanking(rows = []) {
  const hasWeightedData = rows.some((item) => safeNumber(item.weightedWorkload) > 0);
  const groups = groupByRole(rows);
  const roleStatsMap = new Map(Array.from(groups, ([role, items]) => [role, roleStats(items)]));

  return rows
    .map((row) => {
      const roleLabel = row.roleLabel || row.positionLabel || row.role || '协作人';
      const stat = roleStatsMap.get(roleLabel) || roleStats([row]);
      const projectCount = safeNumber(row.value || row.projectCount);
      const weightedWorkload = round1(row.weightedWorkload);
      const workdays = round1(row.workdays);
      const delayedCount = safeNumber(row.delayed);
      const highRiskCount = safeNumber(row.highRisk);
      const loadScore = scorePerson({ ...row, projectCount }, stat, hasWeightedData);
      const enriched = {
        name: row.name,
        displayName: row.displayName || row.name,
        roleLabel,
        status: 'steady',
        statusLabel: '',
        loadScore,
        projectCount,
        weightedWorkload,
        workdays,
        delayedCount,
        highRiskCount,
        avgScore: safeNumber(row.avgScore),
        hardWeightedWorkload: round1(row.hardWeightedWorkload),
        softWeightedWorkload: round1(row.softWeightedWorkload),
        hasWeightedData,
      };
      enriched.status = statusFor(enriched);
      enriched.statusLabel = statusLabel(enriched.status);
      enriched.reason = personReason(enriched, stat);
      enriched.action = personAction(enriched);
      return enriched;
    })
    .sort((a, b) => {
      if (b.loadScore !== a.loadScore) return b.loadScore - a.loadScore;
      if (b.weightedWorkload !== a.weightedWorkload) return b.weightedWorkload - a.weightedWorkload;
      if (b.projectCount !== a.projectCount) return b.projectCount - a.projectCount;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function groupRanking(ranking = []) {
  return {
    overloaded: ranking.filter((item) => item.status === 'overloaded'),
    watch: ranking.filter((item) => item.status === 'watch'),
    steady: ranking.filter((item) => item.status === 'steady'),
    available: ranking.filter((item) => item.status === 'available'),
    dataRisk: ranking.filter((item) => item.status === 'dataRisk'),
  };
}

function buildRecommendations(ranking = [], groups = {}) {
  const recommendations = [];
  const overloaded = groups.overloaded || [];
  const watch = groups.watch || [];
  const available = groups.available || [];
  const riskPeople = ranking.filter((item) => item.delayedCount || item.highRiskCount);

  if (overloaded.length) {
    recommendations.push({
      type: 'scheduling',
      priority: riskPeople.some((item) => item.status === 'overloaded') ? 'P1' : 'P2',
      title: '新增项目先看任务集中人员',
      action: available.length
        ? `普通新增可先对照 ${available.slice(0, 2).map((item) => item.displayName).join('、')} 的实际排期；${overloaded[0].displayName} 先核对当前节点。`
        : `${overloaded[0].displayName} 等人员任务较多，新增前建议负责人结合节点人工确认。`,
      targetPeople: overloaded.slice(0, 3).map((item) => item.displayName),
      candidatePeople: available.slice(0, 3).map((item) => item.displayName),
      evidence: overloaded.slice(0, 2).map((item) => `${item.displayName} ${item.projectCount} 项`),
    });
  }

  if (riskPeople.length) {
    recommendations.push({
      type: 'risk',
      priority: 'P1',
      title: '先核对延期和高风险协作人',
      action: `${riskPeople[0].displayName} 有延期/高风险项目，建议负责人先确认卡点和转派空间。`,
      targetPeople: riskPeople.slice(0, 3).map((item) => item.displayName),
      candidatePeople: available.slice(0, 3).map((item) => item.displayName),
      evidence: riskPeople
        .slice(0, 2)
        .map((item) => `${item.displayName} 延期 ${item.delayedCount} / 高风险 ${item.highRiskCount}`),
    });
  }

  if (!overloaded.length && watch.length) {
    recommendations.push({
      type: 'monitoring',
      priority: 'P2',
      title: '关注偏满人员的近期节点',
      action: `${watch[0].displayName} 近期任务偏多，新增前先核对近 1-2 周审核、点位和采购节点。`,
      targetPeople: watch.slice(0, 3).map((item) => item.displayName),
      candidatePeople: available.slice(0, 3).map((item) => item.displayName),
      evidence: watch.slice(0, 2).map((item) => `${item.displayName} ${item.projectCount} 项`),
    });
  }

  if (available.length) {
    recommendations.push({
      type: 'capacity',
      priority: 'P3',
      title: '可承接人员用于普通新增',
      action: `${available.slice(0, 2).map((item) => item.displayName).join('、')} 可作为普通店或低/中难项目的候选承接人。`,
      targetPeople: [],
      candidatePeople: available.slice(0, 3).map((item) => item.displayName),
      evidence: available.slice(0, 2).map((item) => `${item.displayName} ${item.projectCount} 项`),
    });
  }

  if (!recommendations.length && ranking.length) {
    recommendations.push({
      type: 'steady',
      priority: 'P3',
      title: '当前协作负载相对均衡',
      action: '维持现有排班，新增项目按角色和店态难度常规分配。',
      targetPeople: [],
      candidatePeople: [],
      evidence: [`协作人 ${ranking.length} 人，暂未发现明显任务集中`],
    });
  }

  return recommendations.slice(0, 4);
}

function buildSummary(ranking = [], groups = {}) {
  if (!ranking.length) {
    return {
      title: '暂无协作负载数据',
      level: 'P3',
      text: '当前负责人项目暂无可识别的协作人责任列。',
      confidence: 'low',
    };
  }

  const top = ranking[0];
  if ((groups.overloaded || []).length) {
    return {
      title: '协作任务较集中',
      level: (groups.overloaded || []).some((item) => item.delayedCount || item.highRiskCount) ? 'P1' : 'P2',
      text: `${top.displayName} 当前任务最多（${top.projectCount} 项），建议负责人排班时结合近期节点人工判断。`,
      confidence: top.hasWeightedData ? 'high' : 'medium',
    };
  }
  if ((groups.watch || []).length) {
    return {
      title: '协作负载需观察',
      level: 'P2',
      text: `${groups.watch.length} 人近期任务偏多，新增前建议先核对近期节点。`,
      confidence: top.hasWeightedData ? 'high' : 'medium',
    };
  }
  return {
    title: '协作负载相对均衡',
    level: 'P3',
    text: `当前 ${ranking.length} 名协作人分布相对平稳，${(groups.available || []).length} 人可作为普通新增参考。`,
    confidence: top.hasWeightedData ? 'high' : 'medium',
  };
}

export function buildTeamCollaborationSimulation(input = {}) {
  const leadLoad = Array.isArray(input.leadLoad) ? input.leadLoad : [];
  const weightedLeadLoad = Array.isArray(input.weightedLeadLoad) ? input.weightedLeadLoad : [];
  const inputSnapshot = {
    owner: input.owner || '',
    dashboardContext: input.dashboardContext || 'all',
    summary: input.summary || {},
    leadLoad,
    weightedLeadLoad,
    difficultySummary: input.difficultySummary || {},
  };
  const ranking = buildRanking(mergedPeopleRows(leadLoad, weightedLeadLoad));
  const groups = groupRanking(ranking);
  const hasWeightedData = ranking.some((item) => item.hasWeightedData);
  const limitations = [];

  if (!ranking.length) {
    limitations.push('当前负责人项目暂无可识别的硬装/软装组长或设计师责任列。');
  }
  if (ranking.length && !hasWeightedData) {
    limitations.push('缺少有效难度或责任人月数据，负载判断已降级为项目数量口径。');
  }

  return {
    ...buildAgentRunMetadata({
      channel: 'teamCollaboration',
      agentName: '小组协作负载 Agent',
      promptVersion: TEAM_COLLABORATION_SIMULATION_AGENT_PROMPT_VERSION,
      prompt: TEAM_COLLABORATION_SIMULATION_AGENT_PROMPT,
      owner: input.owner,
      dashboardContext: input.dashboardContext,
    }),
    runMode: AGENT_MODEL_NAME,
    inputSnapshotHash: inputSnapshotHashFor(inputSnapshot),
    inputSnapshot,
    generatedAt: new Date().toISOString(),
    status: ranking.length ? 'ready' : 'empty',
    context: {
      owner: input.owner || '',
      dashboardContext: input.dashboardContext || 'all',
      roleCompareMode: 'within_role',
    },
    summary: buildSummary(ranking, groups),
    facts: {
      peopleCount: ranking.length,
      overloadedCount: groups.overloaded.length,
      watchCount: groups.watch.length,
      availableCount: groups.available.length,
      topPerson: ranking[0]?.displayName || '',
    },
    ranking,
    groups,
    recommendations: buildRecommendations(ranking, groups),
    limitations,
  };
}
