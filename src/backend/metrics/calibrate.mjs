import {
  calculateMonthlyOps,
  calculateTierKpis,
  countSchemeDoneYtd,
  countSchemeDelayDoneMonth,
  countSchemeDelayDoneYtd,
  countSiteVolume,
} from './calculators.mjs';
import { DEFAULT_DATE_FIELDS, resolveDateFieldsForTier } from './profiles.mjs';
import { filterProjectsByProfile } from './scopes.mjs';

const DATE_FIELD_CANDIDATES = {
  schemeDoneYtd: ['startDate', 'updatedAt', '上会日期', '复尺时间', '软装方案开始时间', '点位完成时间'],
  schemeDelayDoneYtd: ['startDate', 'updatedAt', '上会日期', '复尺时间'],
  schemeDelayDoneMonth: ['updatedAt', 'startDate', '上会日期'],
  siteVolume: ['软装发项目群时间', 'updatedAt', '报告发项目钉钉大群时间', 'startDate'],
};

function scoreDiff(actual, target) {
  return Math.abs(Number(actual || 0) - Number(target || 0));
}

function pickBestDateField(projects, tier, kpiKey, targetValue, options = {}) {
  const tierDefaults = resolveDateFieldsForTier(tier, options);
  const candidates = DATE_FIELD_CANDIDATES[kpiKey] || tierDefaults[kpiKey] || DEFAULT_DATE_FIELDS[kpiKey] || [];
  let best = { field: candidates[0] || 'updatedAt', value: 0, diff: Number.POSITIVE_INFINITY };

  for (const field of candidates) {
    const dateFields = { ...tierDefaults, [kpiKey]: [field] };
    let value = 0;
    if (kpiKey === 'schemeDoneYtd') {
      value = countSchemeDoneYtd(projects, tier, { ...options, dateFields });
    } else if (kpiKey === 'schemeDelayDoneYtd') {
      value = countSchemeDelayDoneYtd(projects, tier, { ...options, dateFields });
    } else if (kpiKey === 'schemeDelayDoneMonth') {
      value = countSchemeDelayDoneMonth(projects, tier, { ...options, dateFields });
    } else if (kpiKey === 'siteVolume') {
      value = countSiteVolume(projects, tier, { ...options, dateFields });
    }

    const diff = scoreDiff(value, targetValue);
    if (diff < best.diff) {
      best = { field, value, diff };
    }
  }

  return best;
}

export function compareBenchmark(projects, benchmark, options = {}) {
  const owner = benchmark.owner;
  const team = benchmark.team || { owner, cdLeads: benchmark.cdLeads || [], vmLeads: benchmark.vmLeads || [] };
  const dashboardContext = benchmark.dashboardContext || options.dashboardContext || 'all';
  const scopeOptions = {
    team,
    owner,
    dashboardContext,
    personnelArchitecture: options.personnelArchitecture,
  };
  const scopedProjects = filterProjectsByProfile(projects, 'ownerMonthly', scopeOptions);
  const tiers = Object.keys(benchmark.targets || {});
  const diffs = [];
  const dateFieldRecommendations = {};

  for (const tier of tiers) {
    const targets = benchmark.targets[tier] || {};
    const actualKpis = calculateTierKpis(scopedProjects, tier, {
      ...options,
      team,
      owner,
      dashboardContext,
      profileId: 'ownerMonthly',
    });
    const actualOps = calculateMonthlyOps(scopedProjects, tier, {
      ...options,
      team,
      owner,
      dashboardContext,
      profileId: 'ownerMonthly',
    });

    for (const [key, target] of Object.entries(targets)) {
      if (key === 'monthlyOps') {
        for (const [opsKey, opsTarget] of Object.entries(target)) {
          const actual = actualOps[opsKey] ?? 0;
          diffs.push({
            tier,
            kpi: opsKey,
            target: opsTarget,
            actual,
            diff: actual - opsTarget,
            absDiff: scoreDiff(actual, opsTarget),
          });
        }
        continue;
      }

      const actual = actualKpis[key] ?? 0;
      diffs.push({
        tier,
        kpi: key,
        target,
        actual,
        diff: actual - target,
        absDiff: scoreDiff(actual, target),
      });

      if (DATE_FIELD_CANDIDATES[key]) {
        const recommendation = pickBestDateField(scopedProjects, tier, key, target, { ...options, team, owner });
        dateFieldRecommendations[`${tier}.${key}`] = recommendation;
      }
    }
  }

  const maxAbsDiff = diffs.reduce((max, item) => Math.max(max, item.absDiff), 0);
  const tolerance = benchmark.tolerance ?? 3;
  const withinTolerance = diffs.every((item) => item.absDiff <= tolerance);

  let regression = null;
  if (benchmark.expected) {
    const regressionDiffs = [];
    for (const tier of tiers) {
      const expectedTier = benchmark.expected[tier] || {};
      const actualKpis = calculateTierKpis(scopedProjects, tier, {
        ...options,
        team,
        owner,
        dashboardContext,
        profileId: 'ownerMonthly',
      });
      const actualOps = calculateMonthlyOps(scopedProjects, tier, {
        ...options,
        team,
        owner,
        dashboardContext,
        profileId: 'ownerMonthly',
      });

      for (const [key, expectedValue] of Object.entries(expectedTier)) {
        if (key === 'monthlyOps') {
          for (const [opsKey, opsExpected] of Object.entries(expectedValue)) {
            const actual = actualOps[opsKey] ?? 0;
            regressionDiffs.push({
              tier,
              kpi: opsKey,
              expected: opsExpected,
              actual,
              absDiff: scoreDiff(actual, opsExpected),
            });
          }
          continue;
        }

        const actual = actualKpis[key] ?? 0;
        regressionDiffs.push({
          tier,
          kpi: key,
          expected: expectedValue,
          actual,
          absDiff: scoreDiff(actual, expectedValue),
        });
      }
    }

    const regressionMax = regressionDiffs.reduce((max, item) => Math.max(max, item.absDiff), 0);
    regression = {
      diffs: regressionDiffs,
      summary: {
        totalChecks: regressionDiffs.length,
        maxAbsDiff: regressionMax,
        withinTolerance: regressionDiffs.every((item) => item.absDiff === 0),
      },
    };
  }

  return {
    owner,
    targetSource: benchmark.targetSource || 'fixture',
    diffs,
    regression,
    dateFieldRecommendations,
    summary: {
      totalChecks: diffs.length,
      maxAbsDiff,
      withinTolerance,
      tolerance,
    },
  };
}

export function formatCalibrationReport(result) {
  const lines = [
    `Benchmark owner: ${result.owner}`,
    `Target source: ${result.targetSource}`,
    `DingTalk screenshot: ${result.summary.totalChecks} checks, max abs diff: ${result.summary.maxAbsDiff}, within ±${result.summary.tolerance}: ${result.summary.withinTolerance ? 'yes' : 'no'}`,
  ];

  if (result.regression) {
    lines.push(
      `Formula regression: ${result.regression.summary.totalChecks} checks, max abs diff: ${result.regression.summary.maxAbsDiff}, locked: ${result.regression.summary.withinTolerance ? 'yes' : 'no'}`
    );
  }

  lines.push('', 'DingTalk KPI diffs:');

  for (const item of result.diffs) {
    lines.push(`  [${item.tier}] ${item.kpi}: actual=${item.actual}, target=${item.target}, diff=${item.diff}`);
  }

  if (result.regression?.diffs?.length) {
    lines.push('', 'Formula regression diffs:');
    for (const item of result.regression.diffs) {
      if (item.absDiff > 0) {
        lines.push(`  [${item.tier}] ${item.kpi}: actual=${item.actual}, expected=${item.expected}, diff=${item.actual - item.expected}`);
      }
    }
  }

  if (Object.keys(result.dateFieldRecommendations).length) {
    lines.push('', 'Date field recommendations:');
    for (const [key, recommendation] of Object.entries(result.dateFieldRecommendations)) {
      lines.push(`  ${key}: ${recommendation.field} (value=${recommendation.value}, diff=${recommendation.diff})`);
    }
  }

  return lines.join('\n');
}
