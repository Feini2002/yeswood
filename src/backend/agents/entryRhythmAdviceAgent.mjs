import { buildAgentRunMetadata, inputSnapshotHashFor } from './agentMetadata.mjs';
import {
  ENTRY_RHYTHM_ADVICE_AGENT_PROMPT,
  ENTRY_RHYTHM_ADVICE_AGENT_PROMPT_VERSION,
} from './entryRhythmAdviceAgentPrompt.mjs';

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round1(value) {
  return Math.round(safeNumber(value) * 10) / 10;
}

function pct(value, total) {
  return total ? Math.round((safeNumber(value) / safeNumber(total)) * 100) : 0;
}

function monthText(label = '') {
  const text = String(label || '');
  if (!text) return '未知月份';
  const parts = text.split('-');
  if (parts.length >= 2) {
    return `${Number(parts[1]) || parts[1]}月`;
  }
  return text;
}

function monthIndex(label = '') {
  const match = String(label || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]);
}

function sameOrAdjacentMonth(a = '', b = '') {
  const indexA = monthIndex(a);
  const indexB = monthIndex(b);
  return indexA !== null && indexB !== null && Math.abs(indexA - indexB) <= 1;
}

function valueByLabel(points = [], label = '') {
  return safeNumber(points.find((item) => item.label === label)?.value);
}

function combinedEntrySeries(newStore = [], oldStore = []) {
  const labels = Array.from(new Set([...newStore, ...oldStore].map((item) => item.label).filter(Boolean))).sort();
  return labels.map((label) => {
    const newValue = valueByLabel(newStore, label);
    const oldValue = valueByLabel(oldStore, label);
    return {
      label,
      newValue,
      oldValue,
      value: newValue + oldValue,
    };
  });
}

function average(items = [], key = 'value') {
  return items.length ? items.reduce((sum, item) => sum + safeNumber(item[key]), 0) / items.length : 0;
}

function peakBy(items = [], key = 'value') {
  return items.reduce((best, item) => (safeNumber(item[key]) > safeNumber(best[key]) ? item : best), {});
}

function labelYear(label = '') {
  const match = String(label || '').match(/^(\d{4})-/);
  return match ? match[1] : '';
}

function preferredYear(...groups) {
  const labels = groups
    .flat()
    .map((item) => item?.label)
    .filter(Boolean)
    .sort();
  return labelYear(labels.at(-1) || '') || String(new Date().getFullYear());
}

function rowsInYear(rows = [], year = '') {
  return year ? rows.filter((item) => labelYear(item.label) === year) : rows;
}

function difficultyCoverage(overall = {}) {
  return pct(overall.measuredProjectCount, overall.projectCount);
}

function confidenceFor({ entrySeries = [], monthlyDifficulty = [], coverage = {}, overallDifficulty = {} } = {}) {
  if (!entrySeries.length || !monthlyDifficulty.length) {
    return 'low';
  }
  const entryDateCoverage = safeNumber(coverage.entryDate);
  const measuredCoverage = difficultyCoverage(overallDifficulty);
  if (entryDateCoverage >= 70 && measuredCoverage >= 70) {
    return 'high';
  }
  if (entryDateCoverage >= 50 && measuredCoverage >= 50) {
    return 'medium';
  }
  return 'low';
}

function cleanInterpretation(item) {
  return {
    severity: item.severity || 'P3',
    title: item.title || '节奏观察',
    text: item.text || '',
    evidence: (item.evidence || []).filter(Boolean),
    action: item.action || '',
  };
}

function addInterpretation(items, item) {
  const cleaned = cleanInterpretation(item);
  if (cleaned.text && cleaned.evidence.length && cleaned.action) {
    items.push(cleaned);
  }
}

export function buildEntryRhythmAdvice(input = {}) {
  const context = input.context || {};
  const owner = input.owner || context.owner || '';
  const dashboardContext = input.dashboardContext || context.dashboardContext || 'all';
  const entry = input.entry || {};
  const difficulty = input.difficulty || {};
  const coverage = entry.coverage || input.coverage || {};
  const risk = input.risk || {};
  const inputSnapshot = {
    owner,
    dashboardContext,
    entry,
    difficulty,
    coverage,
    risk,
  };
  const metadata = buildAgentRunMetadata({
    channel: 'entryRhythm',
    agentName: '进店节奏分析 Agent',
    promptVersion: ENTRY_RHYTHM_ADVICE_AGENT_PROMPT_VERSION,
    prompt: ENTRY_RHYTHM_ADVICE_AGENT_PROMPT,
    owner,
    dashboardContext,
  });
  const entrySeries = Array.isArray(entry.series)
    ? entry.series.slice().sort((a, b) => String(a.label).localeCompare(String(b.label)))
    : combinedEntrySeries(entry.newStore || [], entry.oldStore || []);
  const monthlyDifficulty = (difficulty.monthly || [])
    .slice()
    .filter((item) => item?.label)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  const pressureByMonth = (entry.pressureByMonth || [])
    .slice()
    .filter((item) => item?.label)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  const overallDifficulty = difficulty.overall || {};

  if (!entrySeries.length && !monthlyDifficulty.length && !pressureByMonth.length) {
    return {
      ...metadata,
      inputSnapshotHash: inputSnapshotHashFor(inputSnapshot),
      inputSnapshot,
      status: 'empty',
      confidence: 'low',
      tone: 'data-risk',
      headline: '暂无可判断的进店与难度节奏',
      facts: {},
      interpretations: [],
      recommendations: [],
      warnings: ['缺少进店月份与月度难度数据。'],
    };
  }

  const latest = entrySeries.at(-1) || {};
  const previous = entrySeries.length > 1 ? entrySeries.at(-2) : {};
  const analysisYear = preferredYear(entrySeries, monthlyDifficulty, pressureByMonth);
  const yearlyEntrySeries = rowsInYear(entrySeries, analysisYear);
  const yearlyDifficulty = rowsInYear(monthlyDifficulty, analysisYear);
  const yearlyPressure = rowsInYear(pressureByMonth, analysisYear);
  const entryPeak = peakBy(yearlyEntrySeries, 'value');
  const entryAverage = average(yearlyEntrySeries, 'value');
  const difficultyPeak = peakBy(yearlyDifficulty, 'responsibleWeightedWorkload');
  const yearlyDifficultyPeak = peakBy(yearlyDifficulty, 'responsibleWeightedWorkload');
  const pressurePeak = peakBy(yearlyPressure, 'pressureScore');
  const newPressurePeak = peakBy(yearlyPressure, 'newStorePressureScore');
  const oldPressurePeak = peakBy(yearlyPressure, 'oldStorePressureScore');
  const latestDifficulty = monthlyDifficulty.find((item) => item.label === latest.label) || {};
  const totalEntry = yearlyEntrySeries.reduce((sum, item) => sum + safeNumber(item.value), 0);
  const totalNew = yearlyEntrySeries.reduce((sum, item) => sum + safeNumber(item.newValue), 0);
  const totalOld = yearlyEntrySeries.reduce((sum, item) => sum + safeNumber(item.oldValue), 0);
  const totalDifficulty = yearlyDifficulty.reduce((sum, item) => sum + safeNumber(item.responsibleWeightedWorkload), 0);
  const totalHighDifficulty = yearlyDifficulty.reduce((sum, item) => sum + safeNumber(item.highDifficultyCount), 0);
  const latestDelta = safeNumber(latest.value) - safeNumber(previous.value);
  const entryPeakAndDifficultyPeakOverlap = sameOrAdjacentMonth(entryPeak.label, difficultyPeak.label);
  const difficultyPeakShare = pct(difficultyPeak.responsibleWeightedWorkload, totalDifficulty);
  const newShare = pct(totalNew, totalEntry);
  const confidence = confidenceFor({ entrySeries, monthlyDifficulty, coverage, overallDifficulty });
  const interpretations = [];
  const warnings = [];

  if (safeNumber(pressurePeak.pressureScore)) {
    addInterpretation(interpretations, {
      severity: safeNumber(pressurePeak.pressureScore) >= 78 ? 'P1' : 'P2',
      title: '年度主峰',
      text: `${monthText(pressurePeak.label)}压力值 ${safeNumber(pressurePeak.pressureScore)}，新店 ${safeNumber(pressurePeak.newStoreCount)} / 老店 ${safeNumber(pressurePeak.oldStoreCount)}。`,
      evidence: [
        `${pressurePeak.label} 压力值 ${safeNumber(pressurePeak.pressureScore)}`,
        `新店 ${safeNumber(pressurePeak.newStoreCount)} 项`,
        `老店 ${safeNumber(pressurePeak.oldStoreCount)} 项`,
      ],
      action: '设为排期上限，非刚需错峰。',
    });
  }

  if (safeNumber(newPressurePeak.newStorePressureScore) || safeNumber(oldPressurePeak.oldStorePressureScore)) {
    const pressureSegments = [
      safeNumber(newPressurePeak.newStorePressureScore)
        ? `新店峰值 ${monthText(newPressurePeak.label)} ${safeNumber(newPressurePeak.newStorePressureScore)}`
        : '',
      safeNumber(oldPressurePeak.oldStorePressureScore)
        ? `老店峰值 ${monthText(oldPressurePeak.label)} ${safeNumber(oldPressurePeak.oldStorePressureScore)}`
        : '',
    ].filter(Boolean);
    addInterpretation(interpretations, {
      severity:
        Math.max(safeNumber(newPressurePeak.newStorePressureScore), safeNumber(oldPressurePeak.oldStorePressureScore)) >= 78
          ? 'P1'
          : 'P2',
      title: '两类压力',
      text: `${pressureSegments.join('，')}。`,
      evidence: [
        safeNumber(newPressurePeak.newStorePressureScore)
          ? `${newPressurePeak.label} 新店压力 ${safeNumber(newPressurePeak.newStorePressureScore)}`
          : '',
        safeNumber(oldPressurePeak.oldStorePressureScore)
          ? `${oldPressurePeak.label} 老店压力 ${safeNumber(oldPressurePeak.oldStorePressureScore)}`
          : '',
      ].filter(Boolean),
      action: '新店保开业，老店留复核缓冲。',
    });
  }

  if (safeNumber(yearlyDifficultyPeak.responsibleWeightedWorkload)) {
    addInterpretation(interpretations, {
      severity: safeNumber(yearlyDifficultyPeak.highDifficultyCount) > 0 ? 'P2' : 'P3',
      title: '难度集中',
      text: `${monthText(yearlyDifficultyPeak.label)}责任人月 ${round1(yearlyDifficultyPeak.responsibleWeightedWorkload)}，难/重 ${safeNumber(yearlyDifficultyPeak.highDifficultyCount)} 项。`,
      evidence: [
        `${yearlyDifficultyPeak.label} 责任人月 ${round1(yearlyDifficultyPeak.responsibleWeightedWorkload)}`,
        `难/重项目 ${safeNumber(yearlyDifficultyPeak.highDifficultyCount)} 项`,
      ],
      action: '提前拆分评审，预留调整缓冲。',
    });
  }

  if (entryPeakAndDifficultyPeakOverlap && safeNumber(entryPeak.value) && safeNumber(difficultyPeak.responsibleWeightedWorkload)) {
    const sameMonth = entryPeak.label === difficultyPeak.label;
    addInterpretation(interpretations, {
      severity: difficultyPeakShare >= 35 || safeNumber(difficultyPeak.highDifficultyCount) > 0 ? 'P1' : 'P2',
      title: sameMonth ? '进店峰值与难度峰值重叠' : '进店峰值贴近难度峰值',
      text: `${monthText(entryPeak.label)}进店 ${safeNumber(entryPeak.value)} 项，${sameMonth ? '同月' : `与${monthText(difficultyPeak.label)}`}责任人月 ${round1(difficultyPeak.responsibleWeightedWorkload)} 为窗口峰值，占月度难度 ${difficultyPeakShare}%。`,
      evidence: [
        `${entryPeak.label} 进店 ${safeNumber(entryPeak.value)} 项`,
        `${difficultyPeak.label} 责任人月 ${round1(difficultyPeak.responsibleWeightedWorkload)}`,
        `难度占比 ${difficultyPeakShare}%`,
      ],
      action: '建议将非开业刚需项目错峰，并提前锁定高难项目方案评审与复核资源。',
    });
  } else if (safeNumber(difficultyPeak.responsibleWeightedWorkload)) {
    addInterpretation(interpretations, {
      severity: safeNumber(difficultyPeak.highDifficultyCount) > 0 ? 'P2' : 'P3',
      title: '难度峰值需单独排布',
      text: `${monthText(difficultyPeak.label)}责任人月 ${round1(difficultyPeak.responsibleWeightedWorkload)} 为窗口峰值，难/重项目 ${safeNumber(difficultyPeak.highDifficultyCount)} 项。`,
      evidence: [
        `${difficultyPeak.label} 责任人月 ${round1(difficultyPeak.responsibleWeightedWorkload)}`,
        `难/重项目 ${safeNumber(difficultyPeak.highDifficultyCount)} 项`,
      ],
      action: '建议给该月高难项目预留评审缓冲，不把新增插单集中压到同一窗口。',
    });
  }

  if (safeNumber(latest.value)) {
    const latestVsAverage = Math.round(safeNumber(latest.value) - entryAverage);
    const latestDifficultyText = safeNumber(latestDifficulty.responsibleWeightedWorkload)
      ? `；同月责任人月 ${round1(latestDifficulty.responsibleWeightedWorkload)}`
      : '';
    const isRising = entrySeries.length > 1 && (latestDelta > 0 || safeNumber(latest.value) >= entryAverage * 1.2);
    addInterpretation(interpretations, {
      severity: isRising ? 'P2' : 'P3',
      title: isRising ? '最近月进店抬升' : '最近月节奏观察',
      text: `${monthText(latest.label)}进店 ${safeNumber(latest.value)} 项，较上月 ${latestDelta >= 0 ? '+' : ''}${latestDelta}，较月均 ${latestVsAverage >= 0 ? '+' : ''}${latestVsAverage}${latestDifficultyText}。`,
      evidence: [
        `${latest.label} 进店 ${safeNumber(latest.value)} 项`,
        `环比 ${latestDelta >= 0 ? '+' : ''}${latestDelta}`,
        `月均 ${round1(entryAverage)} 项`,
      ],
      action: isRising
        ? '建议提前拆分当月评审批次，避免新老店同时挤占同一组方案资源。'
        : '建议维持当前节奏，并把下月触发线设在高于月均 20% 时提前复核。',
    });
  }

  if (totalHighDifficulty > 0) {
    const measuredProjectCount = safeNumber(overallDifficulty.measuredProjectCount || overallDifficulty.projectCount);
    addInterpretation(interpretations, {
      severity: totalHighDifficulty >= 3 ? 'P1' : 'P2',
      title: '难重项目形成承载压力',
      text: `当前月度窗口内难/重项目 ${totalHighDifficulty} 项，已判定项目 ${measuredProjectCount || '—'} 项，平均难度 ${safeNumber(overallDifficulty.avgScore) || '—'}。`,
      evidence: [
        `难/重项目 ${totalHighDifficulty} 项`,
        `已判定项目 ${measuredProjectCount || 0} 项`,
        `平均难度 ${safeNumber(overallDifficulty.avgScore) || 0}`,
      ],
      action: '建议给难/重项目预留现场复核与方案调整缓冲，低优先级老店改造不要同周压入。',
    });
  }

  if (totalEntry > 0 && (newShare >= 65 || newShare <= 35)) {
    const dominant = newShare >= 65 ? '新店' : '老店';
    const dominantShare = newShare >= 65 ? newShare : 100 - newShare;
    addInterpretation(interpretations, {
      severity: 'P3',
      title: `${dominant}结构偏高`,
      text: `累计进店 ${totalEntry} 项，其中${dominant}占比 ${dominantShare}%。`,
      evidence: [`累计进店 ${totalEntry} 项`, `新店 ${totalNew} 项`, `老店 ${totalOld} 项`],
      action:
        dominant === '新店'
          ? '建议优先保障开业节点，把评审资源向新店首轮方案倾斜。'
          : '建议为老店改造预留现场复核和变更确认时间，减少返工挤压。',
    });
  }

  if (safeNumber(coverage.entryDate) > 0 && safeNumber(coverage.entryDate) < 50) {
    warnings.push(`启动时间覆盖率 ${safeNumber(coverage.entryDate)}%，进店节奏仅作辅助参考。`);
    addInterpretation(interpretations, {
      severity: 'P2',
      title: '启动时间覆盖不足',
      text: `启动时间覆盖率 ${safeNumber(coverage.entryDate)}%，月份归属可能被更新时间兜底影响。`,
      evidence: [`启动时间覆盖率 ${safeNumber(coverage.entryDate)}%`],
      action: '建议先补齐启动时间字段，再用月度节奏判断是否需要错峰。',
    });
  }

  if (difficultyCoverage(overallDifficulty) > 0 && difficultyCoverage(overallDifficulty) < 60) {
    warnings.push(`难度系数覆盖率 ${difficultyCoverage(overallDifficulty)}%，难度判断已降级。`);
  }

  if (coverage.usesUpdatedAtFallback) {
    warnings.push('部分月份可能使用更新时间兜底。');
  }

  const status = entrySeries.length && monthlyDifficulty.length ? 'ready' : 'partial';
  const tone =
    confidence === 'low'
      ? 'data-risk'
      : interpretations.some((item) => item.severity === 'P1') || safeNumber(pressurePeak.pressureScore) >= 78
        ? 'pressure'
        : latestDelta > 0
          ? 'rising'
          : 'stable';
  const headline = safeNumber(pressurePeak.pressureScore)
    ? `${analysisYear}年压力峰值在${monthText(pressurePeak.label)}，压力值 ${safeNumber(pressurePeak.pressureScore)}`
    : entryPeakAndDifficultyPeakOverlap && entryPeak.label
      ? `${monthText(entryPeak.label)}进店与难度峰值${entryPeak.label === difficultyPeak.label ? '重叠' : '贴近'}，节奏压力偏高`
      : latest.label
        ? `${monthText(latest.label)}进店 ${safeNumber(latest.value)} 项，结合难度节奏排布资源`
        : '已生成进店与难度节奏判断';

  return {
    ...metadata,
    inputSnapshotHash: inputSnapshotHashFor(inputSnapshot),
    inputSnapshot,
    status,
    confidence,
    tone,
    headline,
    facts: {
      latestMonth: latest.label || '',
      latestEntryTotal: safeNumber(latest.value),
      entryMoMDelta: latestDelta,
      entryAverage: round1(entryAverage),
      entryPeakMonth: entryPeak.label || '',
      difficultyPeakMonth: difficultyPeak.label || '',
      difficultyPeakWorkload: round1(difficultyPeak.responsibleWeightedWorkload),
      difficultyPeakShare,
      pressurePeakMonth: pressurePeak.label || '',
      pressurePeakScore: safeNumber(pressurePeak.pressureScore),
      newStorePressurePeakMonth: newPressurePeak.label || '',
      newStorePressurePeakScore: safeNumber(newPressurePeak.newStorePressureScore),
      oldStorePressurePeakMonth: oldPressurePeak.label || '',
      oldStorePressurePeakScore: safeNumber(oldPressurePeak.oldStorePressureScore),
      highDifficultyCount: totalHighDifficulty,
      highDifficultyShare: pct(totalHighDifficulty, overallDifficulty.projectCount),
      delayedProjects: safeNumber(risk.delayedProjects),
      highRiskProjects: safeNumber(risk.highRiskProjects),
    },
    interpretations: interpretations.slice(0, 3),
    recommendations: interpretations.map((item) => item.action).slice(0, 3),
    warnings,
  };
}
