import { state } from '../lib/state.mjs';
import { bindDashboardTooltips, elements } from '../lib/dom.mjs';
import { escapeHtml, displayOrDash, formatDate, formatDateTime } from '../lib/format.mjs';
import { bindTooltipTriggers, tooltipDataAttr } from '../dashboard/tooltip.mjs';
import { renderInsightCard, renderInsightCards } from '../dashboard/insight-card.mjs';
import { renderEmptyState } from '../dashboard/empty-state.mjs';
import { queueVisibleDrillPreload } from '../components/drill-preload.mjs';
import { DASHBOARD_METRICS_ENDPOINT, fetchJson } from '../lib/api.mjs';
import { runtimeStore } from '../lib/runtime-flags.mjs';
import {
  OVERVIEW_KPI_METRICS,
  OWNER_TIER_METRIC_META,
  PROFILE_SUMMARY_METRICS,
  PROFILE_SCOPE_SUMMARY_METRICS,
  PROFILE_SCOPE_SEGMENT_METRICS,
  PROFILE_SEGMENT_ROWS,
  PROFILE_SEGMENT_COLUMNS,
  FALLBACK_STORE_TIER_ROWS,
} from '../lib/constants.mjs';
import {
  buildDrillFilter,
  metricDefinitionTooltip,
  profileLabel,
  formatMetricValue,
  riskQueueProjects,
  collectRiskProjectQueue,
  sourceDisplayLabel,
} from '../domain/metrics-display.mjs';
import { displayProjectHardOwner, displayProjectOwner, displayProjectSoftOwner } from '../domain/project-display.mjs';
import { renderBarChart as renderSharedBarChart } from '../dashboard/chart-bar.mjs';
import { buildDirectorOverviewModel } from '../dashboard/home-director-metrics.mjs';

function profileNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

const PROFILE_OPERATION_COPY = {
  franchise: {
    label: '加盟',
    title: '加盟协同治理看板',
    kicker: 'Franchise Governance Console',
    lead: '按加盟项目的履约、区域压力和总部介入路径组织，不只看任务量，更看外部协同风险是否被管住。',
    healthFocus: '协同治理',
    segmentTitle: '店型履约矩阵',
    segmentKicker: '结构拆解',
    segmentMeta: '新店 / 翻新 × 常规 / 下沉',
    stageTitle: '加盟节点跑道',
    stageKicker: '过程卡点',
    riskTitle: '总部优先介入项目',
    riskKicker: '风险队列',
    regionTitle: '区域治理热区',
    regionKicker: '区域 / 店态',
    ownerTitle: '团队项目数量',
    ownerKicker: '负责人列',
    monthlyTitle: '本月协同节奏',
    monthlyKicker: '节奏压力',
    profileDescription: '组别含「加盟」的空间视觉项目。',
  },
  direct: {
    label: '直营',
    title: '直营履约能力看板',
    kicker: 'Direct Delivery Console',
    lead: '按直营网点的内部交付、节点拥堵和责任承载组织，重点看总部执行效率和交付稳定性。',
    healthFocus: '内部履约',
    segmentTitle: '店型履约矩阵',
    segmentKicker: '结构拆解',
    segmentMeta: '新店 / 翻新 × 常规 / 下沉',
    stageTitle: '直营节点跑道',
    stageKicker: '过程卡点',
    riskTitle: '内部优先处理项目',
    riskKicker: '风险队列',
    regionTitle: '区域执行热区',
    regionKicker: '区域 / 店态',
    ownerTitle: '团队项目数量',
    ownerKicker: '负责人列',
    monthlyTitle: '本月交付节奏',
    monthlyKicker: '节奏压力',
    profileDescription: '组别含「直营」的空间视觉项目。',
  },
};


export function adaptProfileDashboardPayload(metrics) {
  if (!metrics || metrics.summary) {
    return metrics;
  }
  const totals = metrics.totals || {};
  const totalProjects = metrics.scopeCount ?? totals.projectCount ?? 0;
  if (!totalProjects && !metrics.scopeCount) {
    return metrics;
  }
  return {
    ...metrics,
    total: totalProjects,
    summary: {
      totalProjects,
      activeProjects: totals.inProgress ?? 0,
      notStarted: totals.notStarted ?? 0,
      delayedProjects: totals.openDelayed ?? 0,
      schemeDoneYtd: totals.schemeDoneYtd ?? 0,
      schemeDelayDoneYtd: totals.schemeDelayDoneYtd ?? 0,
      pausedProjects: metrics.pausedCount ?? 0,
      averageProgress: 0,
      highRiskProjects: totals.openDelayed ?? 0,
    },
    pausedCount: metrics.pausedCount ?? 0,
    totalScopeCount: metrics.totalScopeCount ?? totalProjects,
  };
}


export function buildOverviewKpiItems(payload, options = {}) {
  const summary = payload?.summary || {};
  const definitions = payload?.metricDefinitions || payload?.tooltipCatalog || {};
  const pausedCount = payload?.pausedOrCanceledCount ?? payload?.pausedCount ?? summary.pausedOrCanceledProjects ?? summary.pausedProjects ?? 0;
  return OVERVIEW_KPI_METRICS.filter((item) => {
    if (item.key === 'pausedProjects') {
      return pausedCount > 0 || options.showZeroPaused;
    }
    return summary[item.key] !== undefined;
  }).map((item) => {
    const value = item.key === 'pausedProjects' ? pausedCount : formatMetricValue(summary[item.key], item.format);
    const tooltip =
      item.key === 'pausedProjects'
        ? {
            title: '暂停/取消',
            value: pausedCount,
            definition: '当前硬装或软装项目进度为「暂停」或「取消」时单独列示；曾暂停但当前恢复的项目继续参与当前 KPI。',
          }
        : metricDefinitionTooltip(definitions, item.key, item.label, value);
    return {
      key: item.key,
      label: item.label,
      value,
      tone: item.tone,
      alert: item.alert,
      tooltip,
      insight:
        item.key === 'totalProjects'
          ? 'Active total snapshot'
          : item.key === 'pausedProjects'
            ? 'Paused and canceled projects are counted separately.'
            : '',
      drillable: item.key !== 'pausedProjects',
      drillFilter:
        item.key === 'pausedProjects'
          ? null
          : buildDrillFilter({
              metric: item.key,
              status: item.drillStatus || '',
              delayed: item.drillDelayed ? '1' : '',
            }),
    };
  });
}

export function scopeProfileMetricLabel(item, profile) {
  if (profile === 'franchise') {
    return item.franchiseLabel || item.label;
  }
  if (profile === 'direct') {
    return item.directLabel || item.label;
  }
  return item.label;
}


export function buildScopeProfileInsightItems(metrics, profile) {
  const payload = adaptProfileDashboardPayload(metrics);
  const summary = payload?.summary || {};
  const definitions = payload?.metricDefinitions || {};
  const items = PROFILE_SCOPE_SUMMARY_METRICS.filter((item) => summary[item.key] !== undefined).map((item) => {
    const value = formatMetricValue(summary[item.key], item.format);
    const tooltip = metricDefinitionTooltip(definitions, item.key, scopeProfileMetricLabel(item, profile), value);
    return {
      key: item.key,
      label: scopeProfileMetricLabel(item, profile),
      value,
      tone: item.tone,
      alert: item.alert,
      tooltip,
      insight:
        item.key === 'totalProjects'
          ? 'Current scope total.'
          : '',
      drillable: true,
      drillFilter: buildDrillFilter({
        profile,
        metric: item.key,
        status: item.drillStatus || '',
        delayed: item.drillDelayed ? '1' : '',
      }),
    };
  });

  const storeSegments = metrics?.storeSegments || {};
  const segmentOrder =
    Array.isArray(metrics?.storeSegmentOrder) && metrics.storeSegmentOrder.length
      ? metrics.storeSegmentOrder
      : Object.keys(storeSegments);
  for (const spec of PROFILE_SCOPE_SEGMENT_METRICS) {
    const segmentMetrics = storeSegments[spec.segmentKey];
    if (!segmentMetrics || segmentMetrics[spec.metricKey] === undefined) {
      continue;
    }
    const value = segmentMetrics[spec.metricKey];
    const label = scopeProfileMetricLabel(spec, profile);
    items.push({
      key: String(spec.segmentKey) + '-' + String(spec.metricKey),
      label,
      value,
      tone: spec.tone,
      alert: spec.alert,
      tooltip: metricDefinitionTooltip(definitions, spec.metricKey, label, value) || null,
      drillable: true,
      drillFilter: buildDrillFilter({
        profile,
        metric: spec.metricKey,
        tier: spec.tierDrill || '',
        storeNature: spec.storeNatureDrill || '',
        storeStatus: spec.tierDrill === 'regular' ? '常规店' : spec.tierDrill === 'sinking' ? '下沉店' : '',
        delayed: spec.drillDelayed ? '1' : '',
      }),
    });
  }

  if (!Object.keys(storeSegments).length) {
    const tiers = metrics?.tiers || {};
    for (const tierKey of metrics?.tierOrder || Object.keys(tiers)) {
      const tierMetrics = tiers[tierKey];
      if (!tierMetrics) {
        continue;
      }
      const tierLabel = metrics?.tierLabels?.[tierKey] || tierKey;
      for (const metricKey of ['projectCount', 'openDelayed']) {
        if (tierMetrics[metricKey] === undefined) {
          continue;
        }
        items.push({
          key: String(tierKey) + '-' + String(metricKey),
          label: `${tierLabel} · ${metricKey === 'openDelayed' ? '已延期' : '项目数'}`,
          value: tierMetrics[metricKey],
          tone: metricKey === 'openDelayed' ? 'coral' : 'teal',
          alert: metricKey === 'openDelayed',
          drillable: true,
          drillFilter: buildDrillFilter({
            profile,
            metric: metricKey,
            tier: tierKey,
            delayed: metricKey === 'openDelayed' ? '1' : '',
          }),
        });
      }
    }
  }

  return { payload, items };
}


export function renderDashboardProfile(metrics, gridElement, options = {}) {
  if (!gridElement) {
    return;
  }

  const payload = adaptProfileDashboardPayload(metrics || options.fallbackMetrics);
  if (!payload?.summary) {
    gridElement.innerHTML = renderEmptyState({
      title: options.emptyTitle || '暂无指标数据',
      description: options.emptyDescription || 'No summary metrics are available.',
    });
    return;
  }

  const definitions = payload.metricDefinitions || payload.tooltipCatalog || {};
  const summary = payload.summary || {};
  const metricList = options.metricList || PROFILE_SUMMARY_METRICS;
  const items = metricList.filter((item) => summary[item.key] !== undefined).map((item) => {
    const value = formatMetricValue(summary[item.key], item.format);
    const label = options.profile ? scopeProfileMetricLabel(item, options.profile) : item.label;
    const tooltip = metricDefinitionTooltip(definitions, item.key, label, value);
    const meta = OWNER_TIER_METRIC_META[item.key] || {};
    return {
      key: item.key,
      label,
      value,
      tone: item.tone,
      alert: item.alert,
      tooltip,
      insight: options.showFilteredTotal && item.key === 'totalProjects' ? 'Current scope total.' : '',
      drillable: Boolean(options.drillable),
      drillFilter: options.drillable
        ? buildDrillFilter({
            metric: item.key,
            status: meta.drillStatus || '',
            delayed: meta.drillDelayed ? '1' : '',
            search: options.drillSearch || '',
          })
        : null,
    };
  });

  if (!items.length && options.fallbackMetrics) {
    renderDashboardProfile(options.fallbackMetrics, gridElement, {
      ...options,
      fallbackMetrics: null,
    });
    return;
  }

  if (!items.length) {
    gridElement.innerHTML = renderEmptyState({
      title: options.emptyTitle || '暂无指标数据',
      description: options.emptyDescription || 'No summary metrics are available.',
    });
    return;
  }

  gridElement.innerHTML = renderInsightCards(items);
  bindDashboardTooltips(gridElement);
}


export async function loadProfileMetrics(profile) {
  try {
    const metrics = await fetchJson(`${DASHBOARD_METRICS_ENDPOINT}?profile=${encodeURIComponent(profile)}`);
    state.profileMetrics[profile] = metrics;
    return metrics;
  } catch (error) {
    if (error.status === 404 || error.status === 501) {
      state.profileMetrics[profile] = null;
      return null;
    }
    throw error;
  }
}


export async function loadProfileProjects(profile) {
  try {
    const payload = await fetchJson(`/api/projects?profile=${encodeURIComponent(profile)}&view=summary`);
    const projects = Array.isArray(payload?.items) ? payload.items : [];
    state.profileProjects[profile] = projects;
    return projects;
  } catch (error) {
    state.profileProjects[profile] = [];
    throw error;
  }
}


export async function loadProfileDashboard(profile, { forceRefresh = false } = {}) {
  if (!profile) {
    return { metrics: null, projects: [] };
  }

  if (!forceRefresh && state.profileDashboardLoaded?.[profile]) {
    return {
      metrics: state.profileMetrics[profile] ?? null,
      projects: state.profileProjects[profile] || [],
    };
  }

  const existingRequest = runtimeStore.profileDashboardPromises.get(profile);
  if (existingRequest) {
    return existingRequest;
  }

  const request = Promise.all([
    loadProfileMetrics(profile),
    loadProfileProjects(profile),
  ])
    .then(([metrics, projects]) => {
      state.profileDashboardLoaded = {
        ...state.profileDashboardLoaded,
        [profile]: true,
      };
      return { metrics, projects };
    })
    .finally(() => {
      if (runtimeStore.profileDashboardPromises.get(profile) === request) {
        runtimeStore.profileDashboardPromises.delete(profile);
      }
    });

  runtimeStore.profileDashboardPromises.set(profile, request);
  return request;
}


export function profileDashboardCopy(profile) {
  return PROFILE_OPERATION_COPY[profile] || {
    label: profileLabel(profile),
    title: `${profileLabel(profile)}看板`,
    kicker: 'Operations Console',
    lead: '按项目履约、节点压力和风险清单组织经营判断。',
    healthFocus: '履约治理',
    segmentTitle: '店型履约矩阵',
    segmentKicker: '结构拆解',
    segmentMeta: '按店态与项目性质拆解',
    stageTitle: '项目节点跑道',
    stageKicker: '过程卡点',
    riskTitle: '优先处理项目',
    riskKicker: '风险队列',
    regionTitle: '区域热区',
    regionKicker: '区域 / 店态',
    ownerTitle: '团队项目数量',
    ownerKicker: '负责人列',
    monthlyTitle: '本月运转节奏',
    monthlyKicker: '节奏压力',
    profileDescription: '按当前看板 profile 筛选项目。',
  };
}


export function profileCountBy(projects = [], labelFn) {
  const counts = new Map();
  for (const project of projects || []) {
    const label = String(labelFn(project) || '').trim() || '未设置';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}


export function profileOwnerNames(project) {
  const raw = [
    displayProjectOwner(project),
    displayProjectHardOwner(project),
    displayProjectSoftOwner(project),
  ].filter(Boolean).join('、');
  const names = raw
    .split(/[、\\/|\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(names.length ? names : ['未分配']));
}


export function profileOwnerLoad(projects = []) {
  const counts = new Map();
  for (const project of projects || []) {
    for (const name of profileOwnerNames(project)) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return Array.from(counts, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}


export function profileMonthLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${parsed.getFullYear()}-${month}`;
}


export function profileMonthlyTrend(projects = []) {
  return profileCountBy(projects, (project) => profileMonthLabel(project.updatedAt || project.startDate)).filter(
    (item) => item.label !== '未设置'
  ).sort((a, b) => a.label.localeCompare(b.label)).slice(-8);
}


export function buildProfileLocalMetrics(metrics = {}, projects = []) {
  const payload = adaptProfileDashboardPayload(metrics) || {};
  return {
    ...payload,
    statusCounts: profileCountBy(projects, (project) => project.status),
    ownerLoad: profileOwnerLoad(projects),
    monthlyTrend: profileMonthlyTrend(projects),
  };
}


export function profilePercent(part, total) {
  const denominator = Number(total);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  const numerator = Number(part);
  return Math.round(((Number.isFinite(numerator) ? numerator : 0) / denominator) * 100);
}


export function profileHealth(summary = {}) {
  const delayedRate = Number(summary.delayedRate || 0);
  const openDelayed = Number(summary.openDelayed || 0);
  const notStarted = Number(summary.notStarted || 0);
  if (delayedRate >= 25 || openDelayed >= 12) {
    return { tone: 'coral', label: '风险预警', caption: '延期压力偏高，需要进入周度追踪。' };
  }
  if (delayedRate >= 10 || notStarted > 0) {
    return { tone: 'amber', label: '重点关注', caption: '存在启动或延期压力，建议看节点与责任分布。' };
  }
  return { tone: 'green', label: '节奏稳定', caption: '当前口径下风险信号相对可控。' };
}


export function profileExecutiveRead(profile, model) {
  const copy = profileDashboardCopy(profile);
  const summary = model.summary || {};
  const stockPressure = Number(summary.inProgress || 0) + Number(summary.notStarted || 0);
  const health = profileHealth(summary);
  return `${copy.label}当前在营 ${summary.scopeCount || 0} 项，存量压力 ${stockPressure} 项；未闭环延期 ${summary.openDelayed || 0} 项，延期率 ${summary.delayedRate || 0}%。${health.caption}`;
}


export function withProfileDrillFilter(filter, profile, { allowProfileOnly = false } = {}) {
  const hasFilter = filter && Object.keys(filter).length > 0;
  if (!hasFilter && !allowProfileOnly) {
    return null;
  }
  return {
    ...(filter || {}),
    profile,
  };
}


export function profileDrillAttr(filter, profile, options = {}) {
  return overviewDrillAttr(withProfileDrillFilter(filter, profile, options));
}

function overviewDrillAttr(filter) {
  if (!filter || !Object.keys(filter).length) {
    return '';
  }
  return ` data-drill="${escapeHtml(JSON.stringify(filter))}"`;
}

function overviewToneClass(tone = '') {
  return String(tone || '').replace(/[^a-zA-Z0-9_-]/g, '');
}


export function buildProfileSegmentMatrix(metrics = {}) {
  const storeSegments = metrics?.storeSegments || {};
  const hasSegments = Object.keys(storeSegments).length > 0;
  if (!hasSegments) {
    return { rows: [], columns: [], cells: [] };
  }
  const cells = [];
  for (const row of PROFILE_SEGMENT_ROWS) {
    for (const column of PROFILE_SEGMENT_COLUMNS) {
      const key = `${row.key}-${column.key}`;
      const segment = storeSegments[key] || {};
      const total = Number(segment.projectCount || 0);
      const delayed = Number(segment.openDelayed || 0);
      const inProgress = Number(segment.inProgress || 0);
      const notStarted = Number(segment.notStarted || 0);
      cells.push({
        key,
        row,
        column,
        total,
        delayed,
        inProgress,
        notStarted,
        delayRate: profilePercent(delayed, total),
        tone: delayed > 0 && profilePercent(delayed, total) >= 25 ? 'alert' : delayed > 0 ? 'watch' : 'steady',
      });
    }
  }
  return {
    rows: PROFILE_SEGMENT_ROWS,
    columns: PROFILE_SEGMENT_COLUMNS,
    cells,
  };
}


export function renderProfileCommandCenterMarkup(profile, model, snapshot = {}) {
  const copy = profileDashboardCopy(profile);
  const summary = model.summary || {};
  const health = profileHealth(summary);
  return `
    <header class="overview-command-center profile-command-summary is-${escapeHtml(health.tone)}">
      <div class="overview-command-main">
        <span class="overview-command-kicker">${escapeHtml(copy.kicker)}</span>
        <h2>${escapeHtml(copy.title)}</h2>
        <strong class="profile-executive-read">${escapeHtml(profileExecutiveRead(profile, model))}</strong>
      </div>
      <dl class="overview-command-facts" aria-label="${escapeHtml(copy.label)}看板数据口径">
        <div><dt>数据源</dt><dd>${escapeHtml(sourceDisplayLabel(snapshot.source))}</dd></div>
        <div><dt>同步</dt><dd>${escapeHtml(formatDateTime(snapshot.syncedAt))}</dd></div>
        <div><dt>在营</dt><dd>${summary.scopeCount ?? 0}</dd></div>
        <div><dt>暂停</dt><dd>${summary.pausedCount ?? 0}</dd></div>
        <div><dt>${escapeHtml(copy.healthFocus)}</dt><dd>${escapeHtml(health.label)}</dd></div>
      </dl>
    </header>
  `;
}


export function renderProfileSignalStripMarkup(profile, model) {
  const signals = model.signals || [];
  if (!signals.length) {
    return `<section class="overview-signal-strip profile-signal-strip">${renderEmptyState({ title: '暂无经营信号', compact: true })}</section>`;
  }
  return `
    <section class="overview-signal-strip profile-signal-strip" aria-label="${escapeHtml(profileLabel(profile))}经营指挥台>
      ${signals
        .map((item) => {
          const tone = overviewToneClass(item.tone);
          const tooltip = {
            title: item.label,
            value: `${item.value ?? 0}`,
            definition: item.caption || '当前看板口径下的经营信号。',
          };
          const drillAttr = profileDrillAttr(item.drillFilter, profile, { allowProfileOnly: item.key === 'scopeCount' });
          return `
            <article
              class="overview-signal-cell${item.alert ? ' is-alert' : ''}${drillAttr ? ' is-drillable' : ''}"
              data-tone="${escapeHtml(tone)}"
              ${tooltipDataAttr(tooltip)}
              ${drillAttr}
              ${drillAttr ? 'tabindex="0"' : ''}
            >
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value ?? 0)}</strong>
              <small>${escapeHtml(item.caption || '')}</small>
            </article>
          `;
        })
        .join('')}
    </section>
  `;
}


export function renderProfileSegmentMatrixMarkup(profile, metrics = {}) {
  const matrix = buildProfileSegmentMatrix(metrics);
  const copy = profileDashboardCopy(profile);
  if (!matrix.rows.length || !matrix.columns.length) {
    return renderEmptyState({
      title: '暂无店型矩阵',
      description: '当前 profile 未返回 storeSegments，先保留项目阶段、风险和责任分析。',
      compact: true,
    });
  }
  const cellByKey = new Map(matrix.cells.map((cell) => [`${cell.row.key}::${cell.column.key}`, cell]));
  return `
    <div class="profile-segment-grid" style="--profile-segment-columns:${matrix.columns.length}">
      <span class="overview-matrix-corner">店型</span>
      ${matrix.columns.map((column) => `<span class="overview-matrix-head">${escapeHtml(column.label)}</span>`).join('')}
      ${matrix.rows
        .map(
          (row) => `
            <strong class="overview-matrix-row-label">${escapeHtml(row.label)}</strong>
            ${matrix.columns
              .map((column) => {
                const cell = cellByKey.get(`${row.key}::${column.key}`) || {
                  total: 0,
                  delayed: 0,
                  inProgress: 0,
                  notStarted: 0,
                  delayRate: 0,
                  tone: 'steady',
                };
                const storeNature = row.key === 'newStore' ? '新店' : '老店';
                const drillFilter = {
                  profile,
                  tier: column.key,
                  storeStatus: column.storeStatus,
                  storeNature,
                };
                return `
                  <button
                    type="button"
                    class="profile-segment-cell is-${escapeHtml(cell.tone)}"
                    ${overviewDrillAttr(drillFilter)}
                    ${tooltipDataAttr({
                      title: `${copy.label} · ${row.label} · ${column.label}`,
                      value: `${cell.total} 项`,
                      definition: `推进中 ${cell.inProgress} · 未开始 ${cell.notStarted}`,
                      compare: `未闭环延期 ${cell.delayed} · 延期率 ${cell.delayRate}%`,
                    })}
                  >
                    <b>${cell.total}</b>
                    <small>延 ${cell.delayed} · ${cell.delayRate}%</small>
                  </button>
                `;
              })
              .join('')}
          `
        )
        .join('')}
    </div>
  `;
}


export function renderProfileStageLaneMarkup(profile, model) {
  const stages = model.stageLane || [];
  if (!stages.length) {
    return renderEmptyState({
      title: '暂无阶段数据',
      description: '当前项目缺少硬装/软装进度字段。',
      compact: true,
    });
  }
  return `
    <div class="overview-stage-lane">
      ${stages
        .map((stage) => {
          const parallelNotes = [];
          if (stage.parallelHardConstruction) {
            parallelNotes.push(`并行施工图 ${stage.parallelHardConstruction} 项`);
          }
          const tooltip = {
            title: stage.label,
            value: `${stage.total} 项`,
            definition: [`平均进度 ${stage.avgProgress}% · 阶段占比 ${stage.share}%`, ...parallelNotes].join(' · '),
            compare: `延期 ${stage.delayed} 项 · 紧急 ${stage.urgent} 项`,
          };
          const drillAttr = profileDrillAttr(stage.drillFilter, profile);
          return `
            <button
              type="button"
              class="overview-stage-node${stage.congested ? ' is-congested' : ''}${stage.urgent || stage.delayedRate >= 40 ? ' is-alert' : ''}"
              style="--stage-pressure:${Math.max(10, stage.pressure || 0)}%"
              ${tooltipDataAttr(tooltip)}
              ${drillAttr}
              data-drill-count="${escapeHtml(stage.total)}"
              data-drill-title="${escapeHtml(stage.label)}"
            >
              <span class="overview-stage-head">
                <b>${escapeHtml(stage.label)}</b>
                <em>${stage.total}</em>
              </span>
              <span class="overview-stage-track"><i></i></span>
              <span class="overview-stage-foot">
                <small>延期 ${stage.delayed}</small>
                <small>均进度${stage.avgProgress}%</small>
              </span>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}


export function renderProfileRiskQueueMarkup(profile, model) {
  const items = model.riskQueue || [];
  if (!items.length) {
    return renderEmptyState({
      title: '暂无高优先级风险',
      description: '当前没有延期、紧急或临近开业的高优先级项目。',
      compact: true,
    });
  }
  return `
    <div class="overview-risk-queue">
      ${items
        .map((project, index) => {
          const tooltip = {
            title: project.name,
            value: `${project.score} 分`,
            definition: `${project.stage} · ${project.progress}% · ${project.province}`,
            compare: `负责人：${project.owner}`,
            extra: project.dueDate ? `计划开业：${formatDate(project.dueDate)}` : '',
          };
          return `
            <button
              type="button"
              class="overview-risk-item"
              ${profileDrillAttr(project.drillFilter, profile)}
              ${tooltipDataAttr(tooltip)}
            >
              <span class="overview-risk-rank">${index + 1}</span>
              <span class="overview-risk-main">
                <strong title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</strong>
                <small>${escapeHtml(project.owner)} · ${escapeHtml(project.province)} · ${escapeHtml(project.stage)}</small>
              </span>
              <span class="overview-risk-tags">
                ${project.tags.slice(0, 3).map((tag) => `<em class="is-${escapeHtml(overviewToneClass(tag.tone))}">${escapeHtml(tag.label)}</em>`).join('')}
              </span>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}


export function renderProfileOwnerPressureMarkup(profile, model) {
  const owners = model.ownerPressure || [];
  if (!owners.length) {
    return renderEmptyState({ title: '暂无团队项目数量', compact: true });
  }
  return `
    <div class="overview-owner-pressure">
      ${owners
        .map((owner) => {
          const tooltip = {
            title: owner.name,
            value: `${owner.projectCount} 项`,
            definition: '按 CD 负责人、VM 负责人两栏统计，同项目同人只计一次。',
          };
          return `
            <button
              type="button"
              class="overview-owner-row is-${escapeHtml(owner.status)}"
              style="--owner-load:${owner.loadScore}%"
              ${profileDrillAttr(owner.drillFilter, profile)}
              ${tooltipDataAttr(tooltip)}
            >
              <span class="overview-owner-name" title="${escapeHtml(owner.name)}">${escapeHtml(owner.name)}</span>
              <span class="overview-owner-bar"><i></i></span>
              <span class="overview-owner-meta">
                <b>${owner.projectCount}</b>
              </span>
            </button>
          `;
        })
        .join('')}
    </div>
  `;
}


export function renderProfileRegionMatrixMarkup(profile, model) {
  const matrix = model.regionMatrix || {};
  if (!matrix.rows?.length || !matrix.cols?.length) {
    return renderEmptyState({ title: '暂无区域战情', compact: true });
  }
  const cellByKey = new Map((matrix.cells || []).map((cell) => [`${cell.province}::${cell.storeStatus}`, cell]));
  return `
    <div class="overview-matrix-scroll">
      <div class="overview-region-grid" style="--overview-region-columns:${matrix.cols.length}">
        <span class="overview-matrix-corner">省份</span>
        ${matrix.cols.map((col) => `<span class="overview-matrix-head">${escapeHtml(col)}</span>`).join('')}
        ${matrix.rows
          .map(
            (row) => `
              <strong class="overview-matrix-row-label">${escapeHtml(row)}</strong>
              ${matrix.cols
                .map((col) => {
                  const cell = cellByKey.get(`${row}::${col}`) || { total: 0, drillFilter: { province: row, storeStatus: col } };
                  return `
                    <button
                      type="button"
                      class="overview-region-cell${cell.total ? '' : ' is-zero'}"
                      ${profileDrillAttr(cell.drillFilter, profile)}
                    >
                      <b>${cell.total}</b>
                    </button>
                  `;
                })
                .join('')}
            `
          )
          .join('')}
      </div>
    </div>
  `;
}


export function renderProfileMonthlyOpsMarkup(profile, model) {
  const matrix = model.monthlyOpsMatrix || {};
  const maxMonthlyValue = Math.max(
    ...(matrix.rows || []).flatMap((row) => (row.values || []).map((cell) => profileNumber(cell.value))),
    1
  );
  const opsMarkup =
    matrix.rows?.length && matrix.columns?.length
      ? `
        <div class="overview-matrix-scroll">
          <div class="overview-monthly-grid" style="--overview-monthly-columns:${matrix.columns.length}">
            <span class="overview-matrix-corner">节点</span>
            ${matrix.columns.map((column) => `<span class="overview-matrix-head">${escapeHtml(column.label)}</span>`).join('')}
            ${matrix.rows
              .map(
                (row) => `
                  <strong class="overview-matrix-row-label">${escapeHtml(row.label)}</strong>
                  ${row.values
                    .map(
                      (cell) => `
                        <button
                          type="button"
                          class="overview-matrix-cell${cell.value ? ' is-teal' : ' is-zero'}"
                          style="--cell-heat:${cell.value ? Math.max(8, Math.round((cell.value / maxMonthlyValue) * 100)) : 0}%"
                          ${profileDrillAttr(cell.drillFilter, profile)}
                          ${tooltipDataAttr({
                            title: `${row.label} · ${cell.tier}`,
                            value: `${cell.value} 项`,
                            definition: '本月责任域节点推进量。',
                          })}
                        >
                          ${cell.value}
                        </button>
                      `
                    )
                    .join('')}
                `
              )
              .join('')}
          </div>
        </div>
      `
      : renderEmptyState({ title: '暂无本月运转量', compact: true });
  return opsMarkup;
}


export function buildProfileDashboardModel(profile, metrics = {}, projects = []) {
  const localMetrics = buildProfileLocalMetrics(metrics, projects);
  return buildDirectorOverviewModel({
    metrics: localMetrics,
    departmentMetrics: metrics,
    projects,
    snapshot: state.snapshot || {},
  });
}


export function renderProfilePanel({ kicker, title, meta = '', body = '', className = '' } = {}) {
  return `
    <article class="overview-panel ${className}">
      <header class="overview-panel-header">
        <div>
          <span class="overview-panel-kicker">${escapeHtml(kicker)}</span>
          <h2>${escapeHtml(title)}</h2>
        </div>
        ${meta ? `<span>${escapeHtml(meta)}</span>` : ''}
      </header>
      ${body}
    </article>
  `;
}


export function renderProfileDashboardMarkup(profile, metrics = {}, projects = []) {
  const copy = profileDashboardCopy(profile);
  const model = buildProfileDashboardModel(profile, metrics, projects);
  return `
    <section class="overview-dashboard profile-overview-dashboard" data-profile="${escapeHtml(profile)}" aria-label="${escapeHtml(copy.title)}">
      <section class="overview-command-deck profile-command-deck">
        ${renderProfileCommandCenterMarkup(profile, model, state.snapshot || {})}
        ${renderProfileSignalStripMarkup(profile, model)}
      </section>

      <section class="overview-control-grid profile-control-grid">
        <div class="overview-action-stack">
          ${renderProfilePanel({
            kicker: copy.riskKicker,
            title: copy.riskTitle,
            meta: 'Top 10',
            className: 'overview-risk-command profile-risk-panel',
            body: renderProfileRiskQueueMarkup(profile, model),
          })}
          ${renderProfilePanel({
            kicker: copy.ownerKicker,
            title: copy.ownerTitle,
            meta: '可下钻',
            className: 'overview-owner-panel profile-owner-panel',
            body: renderProfileOwnerPressureMarkup(profile, model),
          })}
        </div>

        <div class="overview-diagnostic-stack">
          ${renderProfilePanel({
            kicker: copy.stageKicker,
            title: copy.stageTitle,
            meta: '按进度字段',
            className: 'overview-stage-panel profile-stage-panel',
            body: renderProfileStageLaneMarkup(profile, model),
          })}
          ${renderProfilePanel({
            kicker: copy.regionKicker,
            title: copy.regionTitle,
            meta: '省份 × 店态',
            className: 'overview-region-panel profile-region-panel',
            body: renderProfileRegionMatrixMarkup(profile, model),
          })}
        </div>
      </section>

      <section class="overview-lower-grid profile-lower-grid" aria-label="${escapeHtml(copy.label)}下方矩阵总览">
        ${renderProfilePanel({
          kicker: copy.segmentKicker,
          title: copy.segmentTitle,
          meta: copy.segmentMeta,
          className: 'overview-tier-panel profile-segment-panel',
          body: renderProfileSegmentMatrixMarkup(profile, metrics),
        })}
        ${renderProfilePanel({
          kicker: copy.monthlyKicker,
          title: copy.monthlyTitle,
          meta: '节点 × 店态',
          className: 'overview-monthly-panel profile-monthly-panel',
          body: renderProfileMonthlyOpsMarkup(profile, model),
        })}
      </section>
    </section>
  `;
}


export function renderProfilePage(profile) {
  const metrics = state.profileMetrics[profile];
  const projects = state.profileProjects[profile] || [];
  const grid = profile === 'franchise' ? elements.franchiseKpiGrid : elements.directKpiGrid;
  const headline = profile === 'franchise' ? elements.franchiseHeadline : elements.directHeadline;
  const copy = profileDashboardCopy(profile);

  if (!grid) {
    return;
  }
  grid.className = 'profile-dashboard-body';

  if (!metrics?.totals && !metrics?.summary && !(metrics?.scopeCount > 0)) {
    if (headline) {
      headline.textContent = copy.lead;
    }
    grid.innerHTML = renderEmptyState({
      title: profile === 'franchise' ? '加盟看板暂无数据' : '直营看板暂无数据',
      description: '当前没有匹配「组别」的项目，请确认数据已同步且组别含「加盟」或「直营」。',
      actionHref: '#details',
      actionLabel: '查看项目明细',
    });
    return;
  }

  if (headline) {
    const scopeCount = metrics.scopeCount ?? adaptProfileDashboardPayload(metrics)?.summary?.totalProjects ?? 0;
    headline.textContent = `${copy.healthFocus} · ${scopeCount} 项 · ${copy.profileDescription}`;
  }

  grid.innerHTML = renderProfileDashboardMarkup(profile, metrics, projects);
  bindDashboardTooltips(grid);
  queueVisibleDrillPreload();
}


export function buildOverviewInsights(metrics) {
  const total = metrics.summary.totalProjects || 0;
  const delayedRate = total ? Math.round((metrics.summary.delayedProjects / total) * 100) : 0;
  const statusTop = (metrics.statusCounts || [])[0];
  const urgentStatus = (metrics.statusCounts || []).find((item) => item.label === '紧急');
  const trend = metrics.monthlyTrend || [];
  const latest = trend[trend.length - 1];
  return {
    status: urgentStatus?.value
      ? `项目状态里有 ${urgentStatus.value} 项标记紧急，应放到运营风险诊断里优先带班；未设置和一般只作填报参考。`
      : statusTop
        ? '项目状态暂无紧急项；未设置和一般只作填报参考，不作为风险判断。'
        : '暂无状态分布数据。',
    trend: latest ? `最近更新高峰在 ${latest.label}（${latest.value} 项）。` : '暂无足够趋势数据。',
    delayedRate,
  };
}


export function profileHasRenderableSummary(payload) {
  if (!payload) {
    return false;
  }
  const summary = payload.summary;
  if (summary && typeof summary === 'object') {
    return PROFILE_SUMMARY_METRICS.some((item) => summary[item.key] !== undefined);
  }
  const totals = payload.totals;
  return Boolean(totals && (payload.scopeCount > 0 || totals.projectCount > 0));
}

