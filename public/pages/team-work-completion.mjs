import { renderEmptyState } from '../dashboard/empty-state.mjs';
import { resolveTeamDashboardContext, resolveTeamOwner } from '../domain/personnel.mjs';
import {
  contextLabel,
  DEFAULT_TEAM_DASHBOARD_CONTEXT,
  normalizeDashboardContext,
  resolveTeamPageDashboardContext,
} from '../lib/constants.mjs';
import { bindDashboardTooltips, elements } from '../lib/dom.mjs';
import { escapeHtml } from '../lib/format.mjs';
import { currentPageId } from '../lib/router.mjs';
import { runtimeStore } from '../lib/runtime-flags.mjs';
import { state } from '../lib/state.mjs';
import { TEAM_WORK_COMPLETION_ENDPOINT, fetchJson } from '../lib/api.mjs';
import { openProjectDetailByReference } from '../components/project-workbench.mjs';
import { currentCatalogSignature } from '../domain/project-catalog.mjs';
import {
  getTeamWorkCompletionDetailStatus,
  isCurrentTeamWorkCompletionKey,
  markTeamWorkCompletionDetailStatus,
  mergeTeamWorkCompletionDetail,
  rememberTeamWorkCompletion,
  teamWorkCompletionDetailCacheKey,
  teamWorkCompletionHasDetail,
  teamWorkCompletionReviewMatchesOwner,
} from '../domain/team-work-completion-store.mjs';

const TEAM_COMPLETION_ECHARTS_ASSET_URL = '../assets/echarts/echarts.esm.min.mjs';
const TEAM_COMPLETION_ECHARTS_IMPORT_TIMEOUT_MS = 8000;
const TEAM_COMPLETION_CHART_FONT_FAMILY =
  '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei UI", "PingFang SC", sans-serif';
const TEAM_COMPLETION_CHART_COLORS = {
  plan: '#104020',
  planProgress: '#6F9F7A',
  display: '#B7791F',
  displayProgress: '#D49A3A',
  lifecycle: '#1D6680',
  lifecycleProgress: '#5A95A8',
};
const TEAM_COMPLETION_STATIC_GROUP_LEADS = {
  直营1组: '陈菲菲',
  直营2组: '陶媛媛',
  直营3组: '杨晓芸',
  直营4组: '刘雯蓓',
};

let teamCompletionEChartsModulePromise = null;
let teamCompletionMonthlyChartInstance = null;
let teamCompletionMonthlyChartRenderToken = 0;

export const TEAM_COMPLETION_METRICS = [
  { key: 'floorPlan', label: '平面方案', fullLabel: '平面方案躺平完成量', tone: 'plan' },
  { key: 'display', label: '方案摆场', fullLabel: '方案摆场完成量', tone: 'display' },
  { key: 'lifecycle', label: '项目总闭环', fullLabel: '项目总闭环情况', tone: 'lifecycle' },
];

export const TEAM_COMPLETION_FILTERS = [
  {
    key: 'floorPlan:inProgress',
    metricKey: 'floorPlan',
    projectIdsKey: 'inProgressProjectIds',
    countKey: 'inProgressCount',
    label: '平面方案躺平进行中',
    tone: 'plan',
  },
  {
    key: 'floorPlan:completed',
    metricKey: 'floorPlan',
    projectIdsKey: 'completedProjectIds',
    countKey: 'completedCount',
    label: '平面方案躺平完成量',
    tone: 'plan',
  },
  {
    key: 'display:inProgress',
    metricKey: 'display',
    projectIdsKey: 'inProgressProjectIds',
    countKey: 'inProgressCount',
    label: '方案摆场进行中',
    tone: 'display',
  },
  {
    key: 'display:completed',
    metricKey: 'display',
    projectIdsKey: 'completedProjectIds',
    countKey: 'completedCount',
    label: '方案摆场完成量',
    tone: 'display',
  },
  {
    key: 'lifecycle:inProgress',
    metricKey: 'lifecycle',
    projectIdsKey: 'inProgressProjectIds',
    countKey: 'inProgressCount',
    label: '项目未闭环进行中',
    tone: 'lifecycle',
  },
  {
    key: 'lifecycle:completed',
    metricKey: 'lifecycle',
    projectIdsKey: 'completedProjectIds',
    countKey: 'completedCount',
    label: '项目总闭环情况',
    tone: 'lifecycle',
  },
];

const TEAM_COMPLETION_MONTHLY_CHART_SERIES = ['floorPlan', 'display', 'lifecycle'].map((metricKey) => {
  const metric = TEAM_COMPLETION_METRICS.find((item) => item.key === metricKey) || {};
  return {
    key: `${metricKey}:completed`,
    metricKey,
    status: 'completed',
    name: `${metric.label || metricKey}完成`,
    color: TEAM_COMPLETION_CHART_COLORS[metric.tone],
    tone: metric.tone,
  };
});

function safeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function withTeamCompletionEChartsImportTimeout(promise, timeoutMs) {
  const normalizedTimeoutMs = Number(timeoutMs);
  if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
    return promise;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ECharts import timed out after ${normalizedTimeoutMs}ms`));
    }, normalizedTimeoutMs);
    promise.then(
      (module) => {
        clearTimeout(timer);
        resolve(module);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function loadTeamCompletionECharts(options = {}) {
  const importer =
    typeof options.importer === 'function' ? options.importer : () => import(TEAM_COMPLETION_ECHARTS_ASSET_URL);
  const timeoutMs = Object.hasOwn(options, 'timeoutMs')
    ? options.timeoutMs
    : TEAM_COMPLETION_ECHARTS_IMPORT_TIMEOUT_MS;
  if (options.importer) {
    return withTeamCompletionEChartsImportTimeout(importer(), timeoutMs);
  }
  if (!teamCompletionEChartsModulePromise) {
    teamCompletionEChartsModulePromise = importer();
  }
  return withTeamCompletionEChartsImportTimeout(teamCompletionEChartsModulePromise, timeoutMs);
}

function resolveTeamCompletionECharts(module) {
  return module?.default || module?.echarts || module;
}

function shouldSkipTeamCompletionChartRuntime() {
  return Boolean(globalThis.__PUBLIC_APP_TEST_HARNESS__) || typeof window === 'undefined';
}

function disposeTeamCompletionMonthlyChart() {
  if (teamCompletionMonthlyChartInstance) {
    try {
      teamCompletionMonthlyChartInstance.dispose?.();
    } catch {
      // ECharts owns canvas cleanup; stale instances can exist during fast owner switches.
    }
  }
  teamCompletionMonthlyChartInstance = null;
}

function metricSummary(source = {}, key) {
  return source.summary?.[key] || {};
}

function metricCompleted(source = {}, key) {
  return safeNumber(metricSummary(source, key).completedCount);
}

function metricInProgress(source = {}, key) {
  return safeNumber(metricSummary(source, key).inProgressCount);
}

function metricMissingDate(source = {}, key) {
  if (key === 'lifecycle') {
    return 0;
  }
  return safeNumber(metricSummary(source, key).missingDateCount);
}

function teamCompletionFilterByKey(filterKey = '') {
  return TEAM_COMPLETION_FILTERS.find((filter) => filter.key === filterKey) || TEAM_COMPLETION_FILTERS[0];
}

function teamCompletionFilterValue(source = {}, filter = TEAM_COMPLETION_FILTERS[0]) {
  const summary = metricSummary(source, filter.metricKey);
  const projectIds = Array.isArray(summary[filter.projectIdsKey]) ? summary[filter.projectIdsKey] : [];
  return safeNumber(summary[filter.countKey] ?? projectIds.length);
}

function teamCompletionProjectIdsForFilter(source = {}, filter = TEAM_COMPLETION_FILTERS[0]) {
  const summary = metricSummary(source, filter.metricKey);
  if (Array.isArray(summary[filter.projectIdsKey])) {
    return summary[filter.projectIdsKey];
  }
  return [];
}

function firstAvailableTeamCompletionFilter(source = {}) {
  return TEAM_COMPLETION_FILTERS.find((filter) => teamCompletionFilterValue(source, filter) > 0) || TEAM_COMPLETION_FILTERS[0];
}

function firstAvailableGroupCompletionFilter(group = {}, preferredMetricKey = '') {
  const metricKey = String(preferredMetricKey || '').trim();
  if (metricKey) {
    const completedFilter = TEAM_COMPLETION_FILTERS.find(
      (filter) => filter.metricKey === metricKey && filter.countKey === 'completedCount'
    );
    const inProgressFilter = TEAM_COMPLETION_FILTERS.find(
      (filter) => filter.metricKey === metricKey && filter.countKey === 'inProgressCount'
    );
    if (completedFilter && teamCompletionFilterValue(group, completedFilter) > 0) {
      return completedFilter;
    }
    if (inProgressFilter && teamCompletionFilterValue(group, inProgressFilter) > 0) {
      return inProgressFilter;
    }
    return completedFilter || inProgressFilter || firstAvailableTeamCompletionFilter(group);
  }
  return firstAvailableTeamCompletionFilter(group);
}

function teamCompletionProjectsById(review = state.teamWorkCompletion) {
  return review?.projectsById || {};
}

function teamCompletionSourceProjects(review = state.teamWorkCompletion) {
  return Object.values(teamCompletionProjectsById(review));
}

function processingQueueIsReady(queue = null) {
  return Boolean(queue && typeof queue === 'object' && Array.isArray(queue.topProjects));
}

function teamCompletionProcessingQueue(review = state.teamWorkCompletion, queueKey = '') {
  const queue = review?.processingQueues?.[queueKey] || null;
  if (!processingQueueIsReady(queue)) {
    return { unavailable: true, totalCount: null, topProjects: [] };
  }
  return queue;
}

function uniqueProcessingProjects(projects = []) {
  const seen = new Set();
  return (projects || []).filter((project) => {
    const key = project?.id || project?.name || '';
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function teamCompletionProcessingProjects(review = state.teamWorkCompletion, queueKey = '') {
  if (queueKey) {
    const queue = teamCompletionProcessingQueue(review, queueKey);
    return uniqueProcessingProjects([...(queue.projects || []), ...(queue.topProjects || [])]);
  }
  const urgent = teamCompletionProcessingProjects(review, 'urgent');
  const normal = teamCompletionProcessingProjects(review, 'normal');
  return uniqueProcessingProjects([...urgent, ...normal]);
}

function processingQueueTitle(queueKey = '') {
  return queueKey === 'urgent' ? '紧急项目待处理 Top5' : '非紧急项目待处理 Top5';
}

function processingQueueText(value, fallback = '') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function processingQueueMetaParts(project = {}) {
  const storeStatus = processingQueueText(project.storeStatus, '店态待核对');
  const area = processingQueueText(project.areaLabel);
  const stage = processingQueueText(
    project.actionStage ||
      project.stageReminder?.primaryReminder?.message ||
      project.stageReminder?.currentStage?.label,
    '阶段待核对'
  );
  return {
    storeStatus,
    area,
    storeStatusLabel: area ? `店态：${storeStatus} · 面积：${area}` : `店态：${storeStatus}`,
    stage,
    teamGroup: processingQueueText(project.teamGroupText),
    teamDesigner: processingQueueText(project.teamDesignerText),
  };
}

function processingQueueMeta(project = {}) {
  const { storeStatusLabel, stage, teamGroup, teamDesigner } = processingQueueMetaParts(project);
  return [
    storeStatusLabel,
    `当前阶段：${stage}`,
    teamGroup ? `团队：${teamGroup}` : '',
    teamDesigner,
  ].filter(Boolean).join(' · ');
}

function processingQueueWindowText(project = {}) {
  const days = Number(project.windowDays);
  if (project.windowDays === null || project.windowDays === undefined || !Number.isFinite(days)) {
    return '日期待核对';
  }
  const label = processingQueueText(project.windowLabel);
  return label || `${days}天`;
}

function processingQueueDateRangeText(project = {}) {
  const startDate = processingQueueText(project.startDate);
  const targetDate = processingQueueText(project.targetDate);
  if (!startDate && !targetDate) {
    return '启动/目标待核对';
  }
  return `启动：${startDate || '待核对'} → 目标：${targetDate || '待核对'}`;
}

function processingQueueWindowNumber(project = {}) {
  const days = Number(project.windowDays);
  if (project.windowDays === null || project.windowDays === undefined || !Number.isFinite(days)) {
    return '--';
  }
  return String(days);
}

function processingQueueRiskText(project = {}) {
  const risk = processingQueueText(project.riskLabel);
  if (risk) {
    return risk;
  }
  return processingQueueWindowText(project);
}

function processingQueueRiskParts(project = {}) {
  const text = processingQueueRiskText(project);
  const overdue = text.match(/^逾期(\d+)天$/);
  if (overdue) {
    return { value: overdue[1], unit: '天逾期' };
  }
  const remaining = text.match(/^剩余(\d+)天$/);
  if (remaining) {
    return { value: remaining[1], unit: '天剩余' };
  }
  if (text === '今日交付') {
    return { value: '今日', unit: '交付' };
  }
  if (/待核对|日期/.test(text)) {
    return { value: '--', unit: '待核对' };
  }
  return { value: text, unit: '' };
}

function processingQueueRiskReasonText(project = {}) {
  const reasons = Array.isArray(project.riskReasons)
    ? project.riskReasons.map((item) => processingQueueText(item)).filter(Boolean)
    : [];
  return reasons.join('、');
}

function processingQueueRowState(project = {}) {
  if (project.riskStatus === 'date_missing' || project.dateQualityStatus === 'missing_target') {
    return ' is-date-missing';
  }
  if (project.dateQualityStatus === 'anomaly') {
    return ' is-date-anomaly';
  }
  const days = Number(project.windowDays);
  if (project.windowDays === null || project.windowDays === undefined || !Number.isFinite(days)) {
    return ' is-date-missing';
  }
  return days < 0 ? ' is-date-anomaly' : '';
}

function renderProcessingQueueChip(label = '', value = '', className = '') {
  const safeLabel = processingQueueText(label);
  const safeValue = processingQueueText(value);
  if (!safeLabel || !safeValue) {
    return '';
  }
  return `<span class="team-completion-processing-chip${className ? ` ${escapeHtml(className)}` : ''}"><b>${escapeHtml(
    safeLabel
  )}</b><em>${escapeHtml(safeValue)}</em></span>`;
}

function renderProcessingQueueTeamChips(teamGroupText = '') {
  const text = processingQueueText(teamGroupText);
  if (!text) {
    return '';
  }
  const match = text.match(/^(.*?)\s*·\s*组长[:：]\s*(.*)$/);
  if (!match) {
    return renderProcessingQueueChip('团队', text, 'is-team');
  }
  return [
    renderProcessingQueueChip('团队', match[1], 'is-team'),
    renderProcessingQueueChip('组长', match[2], 'is-lead'),
  ].join('');
}

function renderProcessingQueueDesignerChip(teamDesignerText = '') {
  const text = processingQueueText(teamDesignerText).replace(/^设计师[:：]\s*/, '');
  return renderProcessingQueueChip('设计师', text, 'is-designer');
}

function renderProcessingQueueProjectRow(project = {}, { rank = 0, modal = false } = {}) {
  const name = processingQueueText(project.name || project.id, '未命名项目');
  const { storeStatus, area, stage, teamGroup, teamDesigner } = processingQueueMetaParts(project);
  const meta = processingQueueMeta(project);
  const windowText = processingQueueWindowText(project);
  const riskText = processingQueueRiskText(project);
  const riskParts = processingQueueRiskParts(project);
  const riskReasonText = processingQueueRiskReasonText(project);
  const dateRangeText = processingQueueDateRangeText(project);
  const startDate = processingQueueText(project.startDate, '待核对');
  const targetDate = processingQueueText(project.targetDate, '待核对');
  const identityChips = [
    renderProcessingQueueChip('店态', storeStatus, 'is-store'),
    renderProcessingQueueChip('面积', area, 'is-area'),
  ].join('');
  const assignmentChips = [renderProcessingQueueTeamChips(teamGroup), renderProcessingQueueDesignerChip(teamDesigner)].join('');
  const riskReasonLabel = riskReasonText ? `，风险原因：${riskReasonText}` : '';
  const rowLabel = `${rank ? `${rank}、` : ''}${name}，${meta}，交付风险：${riskText}${riskReasonLabel}，交付窗口：${windowText}，周期：${dateRangeText}`;
  return `
    <button
      class="team-completion-processing-row${modal ? ' is-modal-row' : ''}${processingQueueRowState(project)}"
      type="button"
      data-team-processing-project-id="${escapeHtml(project.id || '')}"
      data-team-processing-project-name="${escapeHtml(name)}"
      title="${escapeHtml(`${name} · ${meta} · 交付风险：${riskText}${riskReasonText ? ` · 风险原因：${riskReasonText}` : ''} · 交付窗口：${windowText} · 周期：${dateRangeText}`)}"
      aria-label="${escapeHtml(rowLabel)}"
    >
      <span class="team-completion-processing-rank">${rank ? String(rank).padStart(2, '0') : ''}</span>
      <span class="team-completion-processing-project">
        <strong>${escapeHtml(name)}</strong>
        <small class="team-completion-processing-meta">
          ${identityChips}
        </small>
        ${
          assignmentChips
            ? `<small class="team-completion-processing-assignment">${assignmentChips}</small>`
            : ''
        }
      </span>
      <span class="team-completion-processing-stage">
        <small>当前阶段</small>
        <strong>${escapeHtml(stage)}</strong>
      </span>
      <span class="team-completion-processing-window">
        <span class="team-completion-processing-window-badge">
          <b>交付风险</b>
          <em>${escapeHtml(riskParts.value)}</em>
          <i>${escapeHtml(riskParts.unit)}</i>
        </span>
        <span class="team-completion-processing-date-track" aria-label="${escapeHtml(`周期：${dateRangeText}；交付窗口：${windowText}`)}">
          <span><b>启动</b><em>${escapeHtml(startDate)}</em></span>
          <span><b>目标</b><em>${escapeHtml(targetDate)}</em></span>
          <span><b>窗口</b><em>${escapeHtml(windowText)}</em></span>
        </span>
      </span>
    </button>
  `;
}

function renderProcessingQueuePlaceholder(index) {
  return `
    <div class="team-completion-processing-row team-completion-processing-placeholder" aria-hidden="true">
      <span class="team-completion-processing-rank">${String(index).padStart(2, '0')}</span>
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;
}

function renderProcessingQueueColumn(queueKey = 'normal', queue = {}) {
  const unavailable = Boolean(queue.unavailable);
  const topProjects = Array.isArray(queue.topProjects) ? queue.topProjects.slice(0, 5) : [];
  const totalCount = unavailable ? null : safeNumber(queue.totalCount ?? topProjects.length);
  const placeholders = unavailable
    ? ''
    : Array.from({ length: Math.max(0, 5 - topProjects.length) }, (_, index) =>
        renderProcessingQueuePlaceholder(topProjects.length + index + 1)
      ).join('');
  const canOpen = !unavailable && queueKey === 'urgent' && totalCount > topProjects.length;
  const openIcon = `
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="5" cy="10" r="1.35" />
      <circle cx="10" cy="10" r="1.35" />
      <circle cx="15" cy="10" r="1.35" />
    </svg>
  `;
  return `
    <article class="team-completion-processing-column is-${escapeHtml(queueKey)}" data-team-processing-queue="${escapeHtml(queueKey)}">
      <header>
        <div>
          <span>${queueKey === 'urgent' ? '人工标记紧急' : '未标记紧急'}</span>
          <h4>${escapeHtml(processingQueueTitle(queueKey))}</h4>
        </div>
        <div class="team-completion-processing-count">
          <strong>${escapeHtml(unavailable ? '--' : totalCount)}</strong>
          <small>${unavailable ? '待生成' : '项'}</small>
          ${
            canOpen
              ? `<button type="button" data-team-processing-queue-open="urgent" aria-label="查看全部进行中的紧急项目" title="查看全部进行中的紧急项目">${openIcon}</button>`
              : ''
          }
        </div>
      </header>
      <div class="team-completion-processing-list">
        ${
          unavailable
            ? `<div class="team-completion-processing-state" role="status">
                <strong>队列模型准备中</strong>
                <span>当前 read-model 缺少待处理队列字段，请等待预计算完成或刷新数据。</span>
              </div>`
            : `${topProjects.map((project, index) => renderProcessingQueueProjectRow(project, { rank: index + 1 })).join('')}${placeholders}`
        }
      </div>
    </article>
  `;
}

export function renderTeamCompletionProcessingQueues(review = state.teamWorkCompletion) {
  if (!elements.teamCompletionProcessingQueues) {
    return;
  }
  const urgent = teamCompletionProcessingQueue(review, 'urgent');
  const normal = teamCompletionProcessingQueue(review, 'normal');
  elements.teamCompletionProcessingQueues.innerHTML = `
    ${renderProcessingQueueColumn('urgent', urgent)}
    ${renderProcessingQueueColumn('normal', normal)}
  `;
}

function rerenderOpenTeamCompletionModalIfStillCurrent(requestKey = '') {
  if (
    !elements.teamCompletionMemberModal ||
    elements.teamCompletionMemberModal.hidden ||
    !isCurrentTeamWorkCompletionKey(requestKey)
  ) {
    return;
  }
  renderTeamCompletionMemberModal(state.teamWorkCompletion);
}

export function preloadTeamWorkCompletionDetail(
  review = state.teamWorkCompletion,
  { allowCompute = false, force = false, reason = 'background' } = {}
) {
  if (!review || (!force && teamWorkCompletionHasDetail(review))) {
    return Promise.resolve(review);
  }
  const owner = review.owner || state.selectedTeamOwner || '';
  if (!owner) {
    return Promise.resolve(review);
  }
  const requestSnapshot = state.snapshot ? { ...state.snapshot } : state.snapshot;
  const requestProjectDetailSignature = currentCatalogSignature(requestSnapshot);
  const requestKey = teamWorkCompletionDetailCacheKey(review, { snapshot: requestSnapshot });
  if (!requestKey) {
    return Promise.resolve(review);
  }
  const existingRequest = runtimeStore.teamWorkCompletionDetailPromises.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const dashboardContext = resolveTeamPageDashboardContext(
    review.dashboardContext || resolveTeamDashboardContext() || DEFAULT_TEAM_DASHBOARD_CONTEXT
  );
  const year = Number(review.year || state.teamWorkCompletionYear || new Date().getFullYear());
  const params = new URLSearchParams();
  params.set('owner', owner);
  params.set('context', dashboardContext || DEFAULT_TEAM_DASHBOARD_CONTEXT);
  params.set('year', String(Number.isFinite(year) ? year : new Date().getFullYear()));
  params.set('view', 'detail');
  params.set('fallback', allowCompute ? 'compute' : 'readModel');

  markTeamWorkCompletionDetailStatus(requestKey, 'loading', reason);
  const promise = fetchJson(`${TEAM_WORK_COMPLETION_ENDPOINT}?${params}`, { timeoutMs: allowCompute ? 30_000 : 2_000 })
    .then((detail) => {
      if (detail?.status === 'preparing') {
        markTeamWorkCompletionDetailStatus(requestKey, 'preparing', detail.reason || reason);
        rerenderOpenTeamCompletionModalIfStillCurrent(requestKey);
        return review;
      }

      const merged = mergeTeamWorkCompletionDetail(review, detail);
      const mergedHasDetail = teamWorkCompletionHasDetail(merged);
      if (!isCurrentTeamWorkCompletionKey(requestKey)) {
        markTeamWorkCompletionDetailStatus(requestKey, 'ignored', 'stale-detail-response');
        return review;
      }
      rememberTeamWorkCompletion(merged, owner, dashboardContext, year, {
        snapshot: requestSnapshot,
        projectDetailSignature: requestProjectDetailSignature,
      });
      markTeamWorkCompletionDetailStatus(
        requestKey,
        mergedHasDetail ? 'ready' : 'error',
        mergedHasDetail ? reason : '当前负责人项目明细仍不完整，请稍后重试明细读取。'
      );
      state.teamWorkCompletion = merged;
      state.teamWorkCompletionRefreshStatus = '';
      state.teamWorkCompletionRefreshError = '';
      rerenderOpenTeamCompletionModalIfStillCurrent(requestKey);
      return merged;
    })
    .catch((error) => {
      markTeamWorkCompletionDetailStatus(requestKey, 'error', error?.message || reason);
      rerenderOpenTeamCompletionModalIfStillCurrent(requestKey);
      return review;
    })
    .finally(() => {
      if (runtimeStore.teamWorkCompletionDetailPromises.get(requestKey) === promise) {
        runtimeStore.teamWorkCompletionDetailPromises.delete(requestKey);
      }
    });
  runtimeStore.teamWorkCompletionDetailPromises.set(requestKey, promise);
  return promise;
}

export function queueTeamWorkCompletionDetailPreload(review = state.teamWorkCompletion, options = {}) {
  if (!review || (!options.force && teamWorkCompletionHasDetail(review))) {
    return null;
  }
  const schedule = typeof queueMicrotask === 'function' ? queueMicrotask : (callback) => setTimeout(callback, 0);
  schedule(() => {
    preloadTeamWorkCompletionDetail(review, options);
  });
  return true;
}

function renderTeamCompletionMemberModalPreparing(message = '项目明细准备中') {
  if (!elements.teamCompletionMemberModal || !elements.teamCompletionMemberModalBody) {
    return;
  }
  elements.teamCompletionMemberModalBody.innerHTML = renderEmptyState({
    title: message,
    description: '明细读模型正在生成，稍后再次打开即可查看项目行。',
    compact: true,
  });
  elements.teamCompletionMemberModal.hidden = false;
}

function teamCompletionScopeProjectCount(scope = {}, review = state.teamWorkCompletion) {
  const explicitCount = Number(scope?.projectCount);
  if (Number.isFinite(explicitCount) && explicitCount > 0) {
    return explicitCount;
  }
  if (Array.isArray(scope?.projectIds) && scope.projectIds.length) {
    return scope.projectIds.length;
  }
  return state.teamCompletionModalScopeType === 'team' ? teamCompletionSourceProjects(review).length : 0;
}

function memberMissingDateCount(member = {}) {
  return TEAM_COMPLETION_METRICS.reduce((sum, metric) => sum + metricMissingDate(member, metric.key), 0);
}

function memberByName(name, review = state.teamWorkCompletion) {
  const target = String(name || '').trim();
  if (!target) {
    return null;
  }
  return (review?.members || []).find((member) => member.name === target || member.displayName === target) || null;
}

function groupByName(name, review = state.teamWorkCompletion) {
  const target = String(name || '').trim();
  if (!target) {
    return null;
  }
  return (review?.groups || []).find((group) => group.name === target) || null;
}

function membersByName(review = state.teamWorkCompletion) {
  return new Map((review?.members || []).map((member) => [member.name, member]));
}

function metricStateHasMissingDate(metricState = {}, metricKey = '') {
  return metricKey !== 'lifecycle' && Boolean(metricState.missingDate);
}

function metricStateLabel(metricState = {}, metricKey = '') {
  if (metricState.completed) {
    return metricStateHasMissingDate(metricState, metricKey) ? '完成 · 缺日期' : '已完成';
  }
  if (metricState.inProgress) {
    return '进行中';
  }
  return '未到阶段';
}

function metricStateTone(metricState = {}, metricKey = '') {
  if (metricStateHasMissingDate(metricState, metricKey)) {
    return 'missing';
  }
  if (metricState.completed) {
    return 'completed';
  }
  if (metricState.inProgress) {
    return 'progress';
  }
  return 'idle';
}

function metricStateMeta(metricState = {}) {
  if (metricState.completedAt) {
    return String(metricState.completedAt).slice(0, 10);
  }
  return metricState.status || (metricState.evidence || []).join(' / ') || '--';
}

function projectRowsForMember(review = state.teamWorkCompletion, member = {}) {
  const projectsById = review?.projectsById || {};
  return (member.projectIds || [])
    .map((projectId) => projectsById[projectId] || null)
    .filter(Boolean)
    .sort((a, b) => {
      const bMissing = TEAM_COMPLETION_METRICS.some((metric) => metricStateHasMissingDate(b.metrics?.[metric.key], metric.key)) ? 1 : 0;
      const aMissing = TEAM_COMPLETION_METRICS.some((metric) => metricStateHasMissingDate(a.metrics?.[metric.key], metric.key)) ? 1 : 0;
      return bMissing - aMissing || String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''), 'zh-Hans-CN');
    });
}

function monthlyValue(month = {}, key, status = 'completed') {
  const suffix = status === 'inProgress' ? 'InProgress' : 'Completed';
  return safeNumber(month[`${key}${suffix}`]);
}

function maxMonthlyValue(months = []) {
  return Math.max(
    1,
    ...months.flatMap((month) =>
      TEAM_COMPLETION_METRICS.flatMap((metric) => [
        monthlyValue(month, metric.key, 'completed'),
        monthlyValue(month, metric.key, 'inProgress'),
      ])
    )
  );
}

function barHeight(value, maxValue) {
  return `${Math.max(4, Math.round((safeNumber(value) / maxValue) * 100))}%`;
}

function teamCompletionMonthLabel(month = {}) {
  return month.label || `${safeNumber(month.month)}月`;
}

function totalMonthlyValue(month = {}) {
  return TEAM_COMPLETION_METRICS.reduce((sum, metric) => sum + monthlyValue(month, metric.key, 'completed'), 0);
}

function totalMonthlyChartValue(month = {}) {
  return TEAM_COMPLETION_MONTHLY_CHART_SERIES.reduce(
    (sum, series) => sum + monthlyValue(month, series.metricKey, series.status),
    0
  );
}

function totalMonthlyActivityValue(month = {}) {
  return TEAM_COMPLETION_METRICS.reduce(
    (sum, metric) => sum + monthlyValue(month, metric.key, 'completed') + monthlyValue(month, metric.key, 'inProgress'),
    0
  );
}

function uniqueProjectIds(projectIds = []) {
  return Array.from(new Set((projectIds || []).map((projectId) => String(projectId || '').trim()).filter(Boolean)));
}

function monthlyProjectIdsKey(metricKey = '', status = 'completed') {
  return status === 'inProgress' ? `${metricKey}InProgress` : metricKey;
}

function monthlyProjectIds(month = {}, metricKey = '', status = 'completed') {
  return uniqueProjectIds(month.projectIds?.[monthlyProjectIdsKey(metricKey, status)] || []);
}

function teamCompletionMonthByNumber(monthNumber, review = state.teamWorkCompletion) {
  const targetMonth = safeNumber(monthNumber);
  return (review?.monthly?.months || []).find((month) => safeNumber(month.month) === targetMonth) || null;
}

function monthCompletionScope(month = {}, review = state.teamWorkCompletion) {
  const summary = {};
  const allProjectIds = new Set();
  TEAM_COMPLETION_METRICS.forEach((metric) => {
    const completedProjectIds = monthlyProjectIds(month, metric.key, 'completed');
    const inProgressProjectIds = monthlyProjectIds(month, metric.key, 'inProgress');
    completedProjectIds.forEach((projectId) => allProjectIds.add(projectId));
    inProgressProjectIds.forEach((projectId) => allProjectIds.add(projectId));
    summary[metric.key] = {
      completedCount: safeNumber(monthlyValue(month, metric.key, 'completed') || completedProjectIds.length),
      completedProjectIds,
      inProgressCount: safeNumber(monthlyValue(month, metric.key, 'inProgress') || inProgressProjectIds.length),
      inProgressProjectIds,
      missingDateCount: 0,
    };
  });
  const projectIds = Array.from(allProjectIds);
  return {
    scopeType: 'month',
    month: safeNumber(month.month),
    label: teamCompletionMonthLabel(month),
    year: review?.year || state.teamWorkCompletionYear,
    dashboardContext: review?.dashboardContext || 'all',
    projectCount: projectIds.length,
    projectIds,
    summary,
  };
}

function firstAvailableMonthCompletionFilter(monthScope = {}, preferredFilterKey = '') {
  const preferred =
    TEAM_COMPLETION_FILTERS.find((filter) => filter.key === preferredFilterKey) ||
    TEAM_COMPLETION_FILTERS.find(
      (filter) => filter.metricKey === preferredFilterKey && filter.countKey === 'completedCount'
    );
  if (preferred && teamCompletionFilterValue(monthScope, preferred) > 0) {
    return preferred;
  }
  return (
    TEAM_COMPLETION_FILTERS.find((filter) => teamCompletionFilterValue(monthScope, filter) > 0) ||
    preferred ||
    TEAM_COMPLETION_FILTERS.find((filter) => filter.key === 'floorPlan:completed') ||
    TEAM_COMPLETION_FILTERS[0]
  );
}

function renderTeamCompletionChartFallback(message = '图表加载中') {
  return `<div class="team-completion-chart-fallback">${escapeHtml(message)}</div>`;
}

function chartFilterFromSeriesName(seriesName = '') {
  const series = TEAM_COMPLETION_MONTHLY_CHART_SERIES.find((item) => item.name === seriesName);
  return series ? teamCompletionFilterByKey(series.key) : null;
}

function chartMonthFromClickParams(params = {}) {
  const dataMonth = safeNumber(params.data?.month);
  if (dataMonth) {
    return dataMonth;
  }
  const valueMonth = String(params.value || '').match(/^(\d{1,2})月$/);
  if (valueMonth) {
    return safeNumber(valueMonth[1]);
  }
  const nameMonth = String(params.name || '').match(/^(\d{1,2})月$/);
  return nameMonth ? safeNumber(nameMonth[1]) : 0;
}

export function buildTeamCompletionMonthlyChartOption(months = [], review = state.teamWorkCompletion) {
  const labels = months.map((month) => teamCompletionMonthLabel(month));
  const maxTotal = Math.max(
    1,
    ...months.map((month) =>
      Math.max(
        totalMonthlyChartValue(month),
        ...TEAM_COMPLETION_MONTHLY_CHART_SERIES.map((series) => monthlyValue(month, series.metricKey, series.status))
      )
    )
  );
  const year = review?.year || state.teamWorkCompletionYear;
  const trendLegendIcon = 'path://M1 8 L9 8 A4 4 0 1 0 17 8 L23 8 L23 10 L17 10 A4 4 0 1 0 9 10 L1 10 Z';
  const legendData = [
    ...TEAM_COMPLETION_MONTHLY_CHART_SERIES.map((series) => ({ name: series.name, icon: 'roundRect' })),
    { name: '完成合计', icon: trendLegendIcon },
  ];
  return {
    color: [...TEAM_COMPLETION_MONTHLY_CHART_SERIES.map((series) => series.color), '#C7433E'],
    animationDuration: 420,
    grid: { left: 48, right: 22, top: 38, bottom: 88 },
    legend: {
      data: legendData,
      top: 2,
      right: 8,
      itemWidth: 18,
      itemHeight: 10,
      itemGap: 14,
      textStyle: {
        color: 'rgba(51,51,51,0.68)',
        fontFamily: TEAM_COMPLETION_CHART_FONT_FAMILY,
        fontSize: 12,
        fontWeight: 800,
      },
    },
    dataZoom: [
      {
        type: 'slider',
        xAxisIndex: 0,
        left: 82,
        right: 46,
        bottom: 6,
        height: 16,
        startValue: labels[0],
        endValue: labels[Math.min(labels.length - 1, 11)],
        realtime: true,
        showDetail: true,
        brushSelect: false,
        borderColor: 'rgba(31, 122, 69, 0.18)',
        fillerColor: 'rgba(31, 122, 69, 0.12)',
        backgroundColor: 'rgba(244, 247, 242, 0.94)',
        dataBackground: {
          lineStyle: { color: 'rgba(31, 122, 69, 0.18)' },
          areaStyle: { color: 'rgba(31, 122, 69, 0.08)' },
        },
        selectedDataBackground: {
          lineStyle: { color: 'rgba(31, 122, 69, 0.38)' },
          areaStyle: { color: 'rgba(31, 122, 69, 0.16)' },
        },
        handleStyle: {
          color: '#FFFFFF',
          borderColor: 'rgba(31, 122, 69, 0.36)',
          borderWidth: 1,
        },
        moveHandleStyle: {
          color: 'rgba(31, 122, 69, 0.28)',
        },
        textStyle: {
          color: 'rgba(51,51,51,0.58)',
          fontFamily: TEAM_COMPLETION_CHART_FONT_FAMILY,
          fontSize: 11,
          fontWeight: 700,
        },
        labelFormatter(value, valueLabel) {
          return valueLabel || value;
        },
      },
      {
        type: 'inside',
        xAxisIndex: 0,
        startValue: labels[0],
        endValue: labels[Math.min(labels.length - 1, 11)],
        zoomOnMouseWheel: false,
        zoomLock: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: true,
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(16, 64, 32, 0.08)' } },
      confine: true,
      appendToBody: true,
      backgroundColor: 'rgba(255, 255, 255, 0.96)',
      borderColor: 'rgba(31, 122, 69, 0.24)',
      borderWidth: 1,
      padding: [12, 14],
      extraCssText: 'border-radius:8px;box-shadow:0 14px 34px rgba(20, 28, 23, 0.16);line-height:1.45;',
      textStyle: {
        color: '#334238',
        fontFamily: TEAM_COMPLETION_CHART_FONT_FAMILY,
        fontSize: 13,
        fontWeight: 800,
      },
      formatter(params = []) {
        const month = months[params[0]?.dataIndex || 0] || {};
        const completedTotal = totalMonthlyChartValue(month);
        const rows = params
          .filter((item) => safeNumber(item.value) > 0)
          .map(
            (item) => `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;min-width:176px;">
                <span style="display:inline-flex;align-items:center;gap:7px;color:rgba(51,51,51,0.68);">
                  <i style="width:8px;height:8px;border-radius:2px;background:${item.color};display:inline-block;"></i>
                  ${item.seriesName}
                </span>
                <b style="color:#104020;font-size:14px;font-variant-numeric:tabular-nums;">${safeNumber(item.value)}项</b>
              </div>
            `
          )
          .join('');
        return `
          <div style="display:grid;gap:8px;">
            <div style="display:grid;gap:2px;padding-bottom:7px;border-bottom:1px solid rgba(32,48,38,0.1);">
              <strong style="color:#1F2A22;font-size:15px;">${escapeHtml(year)}年 ${escapeHtml(teamCompletionMonthLabel(month))}</strong>
              <span style="color:rgba(51,51,51,0.58);font-size:12px;">平面/摆场/闭环完成合计 ${completedTotal}项</span>
            </div>
            <div style="display:grid;gap:5px;">${rows || '<span style="color:rgba(51,51,51,0.54);">暂无记录</span>'}</div>
          </div>
        `;
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      triggerEvent: true,
      axisTick: { alignWithLabel: true, length: 0 },
      axisLine: { lineStyle: { color: '#D8DED7' } },
      axisLabel: {
        color: 'rgba(51,51,51,0.62)',
        fontFamily: TEAM_COMPLETION_CHART_FONT_FAMILY,
        fontSize: 14,
        fontWeight: 600,
        interval: 0,
        margin: 10,
        formatter(value, index) {
          const month = months[index] || {};
          const total = totalMonthlyChartValue(month);
          return `{${total ? 'teamAxisMonth' : 'teamAxisMonthEmpty'}|${value}}`;
        },
        rich: {
          teamAxisMonth: {
            height: 30,
            width: 58,
            align: 'center',
            borderWidth: 1,
            borderColor: 'rgba(32, 48, 38, 0.16)',
            borderRadius: 8,
            backgroundColor: '#FFFFFF',
            color: '#4D5A50',
            fontSize: 14,
            fontWeight: 600,
          },
          teamAxisMonthEmpty: {
            height: 30,
            width: 58,
            align: 'center',
            borderWidth: 1,
            borderType: 'dashed',
            borderColor: 'rgba(32, 48, 38, 0.12)',
            borderRadius: 8,
            backgroundColor: '#FBFCFA',
            color: 'rgba(51, 51, 51, 0.42)',
            fontSize: 14,
            fontWeight: 600,
          },
        },
      },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      max: Math.max(5, Math.ceil(maxTotal * 1.18)),
      splitLine: { lineStyle: { color: '#EEF1EC' } },
      axisLabel: {
        color: 'rgba(51,51,51,0.58)',
        fontFamily: TEAM_COMPLETION_CHART_FONT_FAMILY,
        fontSize: 14,
        fontWeight: 600,
      },
    },
    series: [
      ...TEAM_COMPLETION_MONTHLY_CHART_SERIES.map((series) => ({
        name: series.name,
        type: 'bar',
        barWidth: 22,
        barGap: '18%',
        barCategoryGap: '28%',
        itemStyle: {
          color: series.color,
          borderRadius: [3, 3, 0, 0],
        },
        emphasis: { focus: 'series', scale: 1.02 },
        label: {
          show: true,
          position: 'top',
          align: 'center',
          distance: 4,
          color: series.color,
          fontFamily: TEAM_COMPLETION_CHART_FONT_FAMILY,
          fontSize: 12,
          fontWeight: 800,
          formatter(params) {
            return safeNumber(params.value) ? String(params.value) : '';
          },
        },
        data: months.map((month) => ({
          value: monthlyValue(month, series.metricKey, series.status),
          month: safeNumber(month.month),
          metricKey: series.metricKey,
          filterKey: series.key,
        })),
      })),
      {
        name: '完成合计',
        type: 'line',
        smooth: false,
        connectNulls: false,
        symbol: 'circle',
        showSymbol: true,
        symbolSize: 9,
        z: 8,
        lineStyle: { width: 2.4, color: '#C7433E', type: 'dashed', opacity: 0.76 },
        itemStyle: { color: '#FFFFFF', borderColor: '#C7433E', borderWidth: 2.6 },
        emphasis: {
          focus: 'series',
          scale: 1.22,
          lineStyle: { width: 3, opacity: 0.92 },
          itemStyle: { borderWidth: 3.2 },
        },
        label: {
          show: true,
          position: 'top',
          distance: 8,
          color: '#C7433E',
          fontFamily: TEAM_COMPLETION_CHART_FONT_FAMILY,
          fontSize: 12,
          fontWeight: 900,
          formatter(params) {
            return safeNumber(params.value) ? params.value : '';
          },
        },
        data: months.map((month) => ({
          value: totalMonthlyChartValue(month) > 0 ? totalMonthlyChartValue(month) : null,
          month: safeNumber(month.month),
        })),
      },
    ],
  };
}

export async function renderTeamCompletionECharts(months = state.teamWorkCompletion?.monthly?.months || [], review = state.teamWorkCompletion) {
  const host = elements.teamCompletionMonthlyChart?.querySelector?.('[data-team-completion-chart-host]');
  if (!host || shouldSkipTeamCompletionChartRuntime()) {
    return;
  }
  const renderToken = (teamCompletionMonthlyChartRenderToken += 1);
  try {
    const echarts = resolveTeamCompletionECharts(await loadTeamCompletionECharts());
    if (renderToken !== teamCompletionMonthlyChartRenderToken || !echarts?.init) {
      return;
    }
    disposeTeamCompletionMonthlyChart();
    const chart = echarts.init(host);
    chart.setOption(buildTeamCompletionMonthlyChartOption(months, review));
    chart.on('click', (params) => {
      const month = chartMonthFromClickParams(params);
      if (!month) {
        return;
      }
      const filter = chartFilterFromSeriesName(params.seriesName || '');
      openTeamCompletionMonthModal(month, filter?.key || '');
    });
    teamCompletionMonthlyChartInstance = chart;
    window.setTimeout(() => chart.resize?.(), 0);
  } catch (error) {
    host.innerHTML = renderTeamCompletionChartFallback(`ECharts 加载失败：${error?.message || '未知错误'}`);
  }
}

function clearTeamCompletionPanels() {
  disposeTeamCompletionMonthlyChart();
  if (elements.teamCompletionProcessingQueues) {
    elements.teamCompletionProcessingQueues.innerHTML = '';
  }
  if (elements.teamCompletionMonthlyChart) {
    elements.teamCompletionMonthlyChart.innerHTML = '';
  }
  if (elements.teamCompletionGroupGrid) {
    elements.teamCompletionGroupGrid.innerHTML = '';
  }
  if (elements.teamCompletionMemberGrid) {
    elements.teamCompletionMemberGrid.innerHTML = '';
  }
  if (elements.teamCompletionDataQuality) {
    elements.teamCompletionDataQuality.innerHTML = '';
  }
  if (elements.teamCompletionScopeNote) {
    elements.teamCompletionScopeNote.hidden = true;
    elements.teamCompletionScopeNote.textContent = '';
  }
}

export function buildTeamCompletionScopeNoteText(review = {}, ownerMetrics = null) {
  const teamClosed = metricCompleted(review, 'lifecycle');
  const ownerClosed = safeNumber(ownerMetrics?.hardOwnerMetrics?.values?.projectClosed);
  const hasOwnerClosed = ownerMetrics?.hardOwnerMetrics?.values && Number.isFinite(ownerClosed);

  let text =
    '项目总闭环仅统计本团队花名册成员参与的项目；编外协作、未映射人员，或仅挂负责人未挂组员的项目不会计入。';
  if (hasOwnerClosed) {
    text += `下方「负责人项目运营情况」按负责人责任盘统计，当前项目闭环 ${ownerClosed} 项`;
    if (ownerClosed !== teamClosed) {
      text += `（与本模块 ${teamClosed} 项口径不同）`;
    }
    text += '。';
  }
  return text;
}

function renderTeamCompletionScopeNote(review = state.teamWorkCompletion, ownerMetrics = state.teamMetrics) {
  if (!elements.teamCompletionScopeNote) {
    return;
  }
  const text = buildTeamCompletionScopeNoteText(review, ownerMetrics);
  elements.teamCompletionScopeNote.textContent = text;
  elements.teamCompletionScopeNote.hidden = !text;
}

function setTeamCompletionContentVisible(visible) {
  const hasContent = Boolean(visible);
  const overviewModule = elements.teamCompletionHeroStats?.closest?.('.team-completion-overview-module');
  const mainGrid = elements.teamCompletionMonthlyChart?.closest?.('.team-completion-main-grid');
  const groupsModule = elements.teamCompletionGroupGrid?.closest?.('.team-completion-groups-module');
  overviewModule?.classList?.toggle?.('is-empty', !hasContent);
  if (elements.teamCompletionProcessingQueues) {
    elements.teamCompletionProcessingQueues.hidden = !hasContent;
  }
  if (mainGrid) {
    mainGrid.hidden = !hasContent;
  }
  if (groupsModule) {
    groupsModule.hidden = !hasContent;
  }
}

function hideLegacyTeamLoadModule() {
  if (elements.teamLoadModule) {
    elements.teamLoadModule.hidden = true;
  }
}

function completionYearOptions(selectedYear = new Date().getFullYear()) {
  const currentYear = new Date().getFullYear();
  return Array.from(new Set([selectedYear, currentYear - 1, currentYear, currentYear + 1]))
    .filter((year) => Number.isFinite(Number(year)))
    .map(Number)
    .sort((a, b) => a - b);
}

export function renderTeamCompletionYearSelect(selectedYear = state.teamWorkCompletionYear) {
  if (!elements.teamCompletionYearSelect) {
    return;
  }
  elements.teamCompletionYearSelect.innerHTML = completionYearOptions(selectedYear)
    .map((year) => `<option value="${year}"${Number(year) === Number(selectedYear) ? ' selected' : ''}>${year}</option>`)
    .join('');
  elements.teamCompletionYearSelect.value = String(selectedYear);
}

function resolveTeamCompletionDashboardContext(review = state.teamWorkCompletion, pendingDashboardContext = '') {
  const pending = normalizeDashboardContext(pendingDashboardContext);
  if (pending) {
    return pending;
  }
  if (currentPageId() === 'teams') {
    const hashContext = resolveTeamDashboardContext();
    return hashContext || DEFAULT_TEAM_DASHBOARD_CONTEXT;
  }
  return resolveTeamPageDashboardContext(review?.dashboardContext);
}

export function syncTeamCompletionControls(review = state.teamWorkCompletion, pendingDashboardContext = '') {
  const dashboardContext = resolveTeamCompletionDashboardContext(review, pendingDashboardContext);
  if (elements.teamCompletionContextTabs) {
    elements.teamCompletionContextTabs.querySelectorAll('[data-team-completion-context]').forEach((button) => {
      const context = button.dataset.teamCompletionContext || DEFAULT_TEAM_DASHBOARD_CONTEXT;
      const active = context === dashboardContext;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      if (context === 'franchise') {
        button.setAttribute('title', '反向核查原始表单是否误填加盟口径');
        button.setAttribute('aria-label', '加盟口径核查');
      }
    });
  }
  renderTeamCompletionYearSelect(review?.year || state.teamWorkCompletionYear);
}

function renderTeamCompletionFilterCard(source, filter, { active = false, compact = false } = {}) {
  const value = teamCompletionFilterValue(source, filter);
  return `
    <button
      class="team-completion-metric team-completion-filter-card is-${filter.tone}${active ? ' is-active' : ''}${compact ? ' is-compact' : ''}"
      type="button"
      data-team-completion-filter="${escapeHtml(filter.key)}"
      aria-pressed="${active ? 'true' : 'false'}"
    >
      <span>${escapeHtml(filter.label)}</span>
      <strong>${escapeHtml(value)}<small>项</small></strong>
    </button>
  `;
}

export function renderTeamCompletionHeroStats(review = state.teamWorkCompletion) {
  if (!elements.teamCompletionHeroStats) {
    return;
  }
  elements.teamCompletionHeroStats.innerHTML = TEAM_COMPLETION_FILTERS.map((filter) =>
    renderTeamCompletionFilterCard(review, filter)
  ).join('');
}

export function renderTeamCompletionMonthlyChart(months = state.teamWorkCompletion?.monthly?.months || []) {
  if (!elements.teamCompletionMonthlyChart) {
    return;
  }
  disposeTeamCompletionMonthlyChart();
  if (!months.length) {
    elements.teamCompletionMonthlyChart.innerHTML = renderEmptyState({
      title: '暂无月度完成记录',
      description: '当前年份没有可靠完成日期可用于柱状图。',
      compact: true,
    });
    return;
  }
  elements.teamCompletionMonthlyChart.innerHTML = `
    <div class="team-completion-chart-shell">
      <div
        class="team-completion-chart-host"
        data-team-completion-chart-host
        role="img"
        aria-label="${escapeHtml(state.teamWorkCompletion?.year || state.teamWorkCompletionYear)} 年团队月度完成趋势"
      >
        ${renderTeamCompletionChartFallback()}
      </div>
    </div>
  `;
  void renderTeamCompletionECharts(months, state.teamWorkCompletion);
}

function renderMiniMonthlyChart(months = []) {
  if (!months.length) {
    return '';
  }
  const maxValue = maxMonthlyValue(months);
  return `
    <div class="team-completion-mini-chart" aria-hidden="true">
      ${months
        .map(
          (month) => `
            <span>
              ${TEAM_COMPLETION_METRICS.map((metric) => {
                const value = monthlyValue(month, metric.key);
                return `<i class="is-${metric.tone}" style="--bar-height:${barHeight(value, maxValue)}"></i>`;
              }).join('')}
            </span>
          `
        )
        .join('')}
    </div>
  `;
}

function renderScopeMetricStrip(scope = {}, { groupName = '' } = {}) {
  return `
    <div class="team-completion-scope-metrics">
      ${TEAM_COMPLETION_METRICS.map((metric) => {
        const completed = metricCompleted(scope, metric.key);
        const inProgress = metricInProgress(scope, metric.key);
        const content = `
          <small>${escapeHtml(metric.label)}</small>
          <b>${completed}</b>
          <em>${inProgress} 进行中</em>
        `;
        if (groupName) {
          return `
            <button
              class="team-completion-scope-metric is-${metric.tone}"
              type="button"
              data-team-completion-group="${escapeHtml(groupName)}"
              data-team-completion-group-metric="${escapeHtml(metric.key)}"
              aria-label="查看${escapeHtml(groupName)} ${escapeHtml(metric.label)}完成详情，完成${completed}项，进行中${inProgress}项"
            >${content}</button>
          `;
        }
        return `<span class="is-${metric.tone}">${content}</span>`;
      }).join('')}
    </div>
  `;
}

function projectPreviewItems(review = {}, scope = {}) {
  const projectsById = review.projectsById || {};
  return (scope.projectIds || [])
    .map((projectId) => projectsById[projectId])
    .filter(Boolean)
    .slice(0, 3);
}

function renderProjectPreview(review, scope) {
  const projects = projectPreviewItems(review, scope);
  const total = safeNumber(scope.projectCount);
  if (!projects.length) {
    return `<div class="team-completion-project-preview is-empty">${total ? '项目清单待同步' : '暂无关联项目'}</div>`;
  }
  return `
    <div class="team-completion-project-preview" aria-label="关联项目预览">
      ${projects
        .map(
          (project) => `
            <span title="${escapeHtml(project.name || project.id || '未命名项目')}">
              <b>${escapeHtml(project.name || project.id || '未命名项目')}</b>
              <small>${escapeHtml(project.status || project.storeStatus || '状态未维护')}</small>
            </span>
          `
        )
        .join('')}
      ${total > projects.length ? `<em>另 ${total - projects.length} 项</em>` : ''}
    </div>
  `;
}

function renderTeamCompletionMemberButton(member = {}, fallbackName = '') {
  const name = member.name || fallbackName;
  const displayName = member.displayName || name || '未命名成员';
  const projectCount = safeNumber(member.projectCount);
  const missingDateCount = memberMissingDateCount(member);
  const stateClass = missingDateCount ? 'is-warning' : projectCount ? 'is-loaded' : 'is-empty';
  return `
    <button
      class="team-completion-member-pill ${stateClass}"
      type="button"
      data-team-completion-member="${escapeHtml(name)}"
      aria-label="查看${escapeHtml(displayName)}的完成详情，关联${escapeHtml(projectCount)}项${missingDateCount ? `，缺日期${escapeHtml(missingDateCount)}条` : ''}"
      title="${escapeHtml(`${displayName} · ${projectCount} 项${missingDateCount ? ` · 缺日期 ${missingDateCount}` : ''}`)}"
    >
      <span>${escapeHtml(displayName)}</span>
      <b>${escapeHtml(projectCount)}</b>
      ${missingDateCount ? `<i>缺${escapeHtml(missingDateCount)}</i>` : ''}
    </button>
  `;
}

function renderTeamCompletionGroupMembers(group = {}, review = state.teamWorkCompletion) {
  const memberLookup = membersByName(review);
  const names = Array.isArray(group.memberNames) ? group.memberNames : [];
  if (!names.length) {
    return '';
  }
  return `
    <div class="team-completion-group-members" aria-label="${escapeHtml(group.name || '小组')}成员">
      ${names
        .map((name) => renderTeamCompletionMemberButton(memberLookup.get(name) || { name, projectCount: 0 }, name))
        .join('')}
    </div>
  `;
}

function teamCompletionGroupLeadDisplay(group = {}) {
  const display = String(group.leadDisplay || group.lead || '').trim();
  if (display && display !== '组长未配置') {
    return display;
  }
  return TEAM_COMPLETION_STATIC_GROUP_LEADS[group.name] || display || '组长未配置';
}

function renderTeamCompletionUngroupedMembers(review = state.teamWorkCompletion) {
  const members = Array.isArray(review?.members) ? review.members : [];
  if (!members.length) {
    return renderEmptyState({
      title: '暂无成员关联',
      description: '当前筛选下没有成员项目关系。',
      compact: true,
    });
  }
  const grouped = new Map();
  for (const member of members) {
    const groupName = member.groupName || '未分组成员';
    grouped.set(groupName, [...(grouped.get(groupName) || []), member]);
  }
  return Array.from(grouped, ([groupName, groupMembers]) => `
    <article class="team-completion-member-button-panel">
      <header>
        <strong>${escapeHtml(groupName)}</strong>
        <span>${escapeHtml(groupMembers.length)} 人</span>
      </header>
      <div class="team-completion-group-members">
        ${groupMembers.map((member) => renderTeamCompletionMemberButton(member)).join('')}
      </div>
    </article>
  `).join('');
}

export function renderTeamCompletionGroups(review = state.teamWorkCompletion) {
  if (!elements.teamCompletionGroupGrid) {
    return;
  }
  const groups = Array.isArray(review?.groups) ? review.groups : [];
  if (!groups.length) {
    elements.teamCompletionGroupGrid.innerHTML = renderEmptyState({
      title: '暂无小组配置',
      description: '当前负责人还没有挂载小组或成员。',
      compact: true,
    });
    return;
  }
  elements.teamCompletionGroupGrid.innerHTML = groups
    .map(
      (group) => `
        <article class="team-completion-group-card">
          <header>
            <div>
              <span class="team-completion-group-titleline">
                <strong>${escapeHtml(group.name || '未命名小组')}</strong>
                <small><span class="team-completion-group-lead">组长 ${escapeHtml(teamCompletionGroupLeadDisplay(group))}</span> · ${safeNumber(group.memberNames?.length)} 人</small>
              </span>
            </div>
            <span>${safeNumber(group.projectCount)} 项</span>
          </header>
          ${renderScopeMetricStrip(group, { groupName: group.name || '' })}
          ${renderTeamCompletionGroupMembers(group, review)}
        </article>
      `
    )
    .join('');
}

export function renderTeamCompletionMembers(review = state.teamWorkCompletion) {
  if (!elements.teamCompletionMemberGrid) {
    return;
  }
  const section = elements.teamCompletionMemberGrid.closest?.('.team-completion-members');
  const groups = Array.isArray(review?.groups) ? review.groups : [];
  if (groups.length) {
    if (section) {
      section.hidden = true;
    }
    elements.teamCompletionMemberGrid.innerHTML = '';
    return;
  }
  if (section) {
    section.hidden = false;
  }
  elements.teamCompletionMemberGrid.innerHTML = renderTeamCompletionUngroupedMembers(review);
}

function renderTeamCompletionModalFilterCards(scope = {}, activeFilter = TEAM_COMPLETION_FILTERS[0]) {
  return TEAM_COMPLETION_FILTERS.map((filter) =>
    renderTeamCompletionFilterCard(scope, filter, {
      active: filter.key === activeFilter.key,
      compact: true,
    })
  ).join('');
}

function renderTeamCompletionProjectMetric(project = {}, metric) {
  const metricState = project.metrics?.[metric.key] || {};
  return `
    <span class="team-completion-member-project-state is-${escapeHtml(metric.tone)} is-${escapeHtml(metricStateTone(metricState, metric.key))}">
      <strong>${escapeHtml(metricStateLabel(metricState, metric.key))}</strong>
      <small>${escapeHtml(metricStateMeta(metricState))}</small>
    </span>
  `;
}

function projectIdsForCompletionScope(scope = {}, activeFilter = TEAM_COMPLETION_FILTERS[0]) {
  const filteredIds = teamCompletionProjectIdsForFilter(scope, activeFilter);
  if (filteredIds.length) {
    return filteredIds;
  }
  return [];
}

function projectRowsForCompletionScope(review = state.teamWorkCompletion, scope = {}, activeFilter = TEAM_COMPLETION_FILTERS[0]) {
  const projectsById = teamCompletionProjectsById(review);
  return projectIdsForCompletionScope(scope, activeFilter)
    .map((projectId) => projectsById[projectId] || null)
    .filter(Boolean)
    .sort((a, b) => String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''), 'zh-Hans-CN'));
}

function completionScopeMissingDetailRows(review = state.teamWorkCompletion, scope = {}, activeFilter = TEAM_COMPLETION_FILTERS[0]) {
  if (!teamWorkCompletionHasDetail(review)) {
    return false;
  }
  const expectedCount = teamCompletionFilterValue(scope, activeFilter);
  if (expectedCount <= 0) {
    return false;
  }
  const projectIds = projectIdsForCompletionScope(scope, activeFilter);
  if (!projectIds.length) {
    return true;
  }
  const projectsById = teamCompletionProjectsById(review);
  const matchedCount = projectIds.filter((projectId) => projectsById[projectId]).length;
  return matchedCount < Math.min(expectedCount, projectIds.length);
}

function teamCompletionDetailStatusEntry(review = state.teamWorkCompletion) {
  const requestKey = teamWorkCompletionDetailCacheKey(review);
  const entry = requestKey ? runtimeStore.teamWorkCompletionDetailStatuses?.get(requestKey) : null;
  if (!entry) {
    return { status: 'idle', detail: '', elapsedMs: 0 };
  }
  return {
    ...entry,
    elapsedMs: Math.max(0, Date.now() - Number(entry.startedAt || Date.now())),
  };
}

function queueIncompleteCompletionDetailPreload(review = state.teamWorkCompletion) {
  const requestKey = teamWorkCompletionDetailCacheKey(review);
  const detailStatus = teamCompletionDetailStatusEntry(review);
  if (
    !requestKey ||
    runtimeStore.teamWorkCompletionDetailPromises?.has(requestKey) ||
    ['loading', 'preparing', 'ready', 'error'].includes(detailStatus.status)
  ) {
    return;
  }
  queueTeamWorkCompletionDetailPreload(review, {
    reason: 'modal-incomplete-project-rows',
    allowCompute: false,
    force: true,
  });
}

function incompleteCompletionDetailStatus(review = state.teamWorkCompletion) {
  const detailStatus = teamCompletionDetailStatusEntry(review);
  if (detailStatus.status === 'error') {
    return detailStatus;
  }
  if (detailStatus.status === 'ready') {
    return {
      ...detailStatus,
      status: 'error',
      detail: '当前筛选的项目行仍未完整命中，请稍后重试明细读取。',
    };
  }
  return {
    ...detailStatus,
    status: detailStatus.status === 'idle' ? 'preparing' : detailStatus.status,
    detail: detailStatus.detail || '当前筛选的项目行未完整命中，正在重新读取项目明细。',
    elapsedMs: Math.max(detailStatus.elapsedMs || 0, 801),
  };
}

function uniqueTextValues(values = []) {
  return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function projectRoleLabelsForCandidates(project = {}, candidates = []) {
  const roleLabelsByMember = project.roleLabelsByMember || {};
  for (const candidate of uniqueTextValues(candidates)) {
    if (Array.isArray(roleLabelsByMember[candidate])) {
      return uniqueTextValues(roleLabelsByMember[candidate]);
    }
  }
  return [];
}

function projectRoleEntries(project = {}) {
  const roleLabelsByMember = project.roleLabelsByMember || {};
  const entries = Object.entries(roleLabelsByMember)
    .map(([memberName, roleLabels]) => ({
      memberName: String(memberName || '').trim(),
      roleLabels: uniqueTextValues(Array.isArray(roleLabels) ? roleLabels : [roleLabels]),
    }))
    .filter((entry) => entry.memberName || entry.roleLabels.length);
  const coveredMembers = new Set(entries.map((entry) => entry.memberName).filter(Boolean));
  uniqueTextValues(project.memberNames || []).forEach((memberName) => {
    if (!coveredMembers.has(memberName)) {
      entries.push({ memberName, roleLabels: [] });
    }
  });
  return entries;
}

function formatProjectRoleEntry(entry = {}) {
  const memberName = entry.memberName || '成员待核对';
  const roleText = entry.roleLabels?.length ? entry.roleLabels.join('、') : '成员角色待核对';
  return `${memberName} · ${roleText}`;
}

function teamCompletionProjectRole(project = {}, scope = {}) {
  const groupDetail = (project.groupNames || []).join('、') || scope.groupName || '未分组';
  if (state.teamCompletionModalScopeType === 'member') {
    const roleLabels = projectRoleLabelsForCandidates(project, [scope.name, scope.displayName]);
    const memberName = scope.displayName || scope.name || projectRoleEntries(project)[0]?.memberName || '成员待核对';
    return {
      title: `${memberName} · ${roleLabels.length ? roleLabels.join('、') : '成员角色待核对'}`,
      detail: groupDetail,
    };
  }
  if (state.teamCompletionModalScopeType === 'group') {
    const entries = projectRoleEntries(project);
    return {
      title: entries.map(formatProjectRoleEntry).join('；') || '成员待核对',
      detail: scope.name || scope.groupName || '未分组',
    };
  }
  const entries = projectRoleEntries(project);
  return {
    title: entries.map(formatProjectRoleEntry).join('；') || '成员待核对',
    detail: groupDetail,
  };
}

function renderTeamCompletionProjectRowsEmpty(activeFilter = TEAM_COMPLETION_FILTERS[0]) {
  return `
    <div class="team-completion-member-modal-empty">
      <strong>暂无${escapeHtml(activeFilter.label)}项目</strong>
      <span>当前筛选没有可展开项目，弹窗尺寸保持不变。</span>
    </div>
  `;
}

function renderTeamCompletionProjectRowsPending(expectedCount = 0, detailStatus = {}) {
  const delayed = detailStatus.elapsedMs > 800 || detailStatus.status === 'preparing';
  const message = delayed
    ? `预计 ${expectedCount} 项，明细准备好后自动补齐。`
    : `预计 ${expectedCount} 项，正在读取当前负责人的项目明细。`;
  return `
    <div class="team-completion-detail-pending" aria-live="polite">
      <div class="team-completion-detail-pending-copy">
        <strong>正在补齐项目行</strong>
        <span>${escapeHtml(message)}</span>
      </div>
      <div class="team-completion-detail-skeleton" aria-hidden="true">
        ${[0, 1, 2]
          .map(
            () => `
              <div class="team-completion-detail-skeleton-row">
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
              </div>
            `
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderTeamCompletionProjectRowsError(expectedCount = 0, detailStatus = {}) {
  return `
    <div class="team-completion-detail-pending is-error" aria-live="polite">
      <div class="team-completion-detail-pending-copy">
        <strong>项目行暂时无法读取</strong>
        <span>${escapeHtml(detailStatus.detail || `预计 ${expectedCount} 项，稍后可重试明细读取。`)}</span>
      </div>
      <button type="button" data-team-completion-detail-retry>重试</button>
    </div>
  `;
}

function renderTeamCompletionProjectRows(review = state.teamWorkCompletion, scope = {}, activeFilter = TEAM_COMPLETION_FILTERS[0]) {
  const expectedCount = teamCompletionFilterValue(scope, activeFilter);
  if (!teamWorkCompletionHasDetail(review)) {
    if (!expectedCount) {
      return renderTeamCompletionProjectRowsEmpty(activeFilter);
    }
    const detailStatus = getTeamWorkCompletionDetailStatus(review);
    if (detailStatus.status === 'error') {
      return renderTeamCompletionProjectRowsError(expectedCount, detailStatus);
    }
    return renderTeamCompletionProjectRowsPending(expectedCount, detailStatus);
  }

  const projects = projectRowsForCompletionScope(review, scope, activeFilter);
  if (completionScopeMissingDetailRows(review, scope, activeFilter)) {
    queueIncompleteCompletionDetailPreload(review);
    const detailStatus = incompleteCompletionDetailStatus(review);
    if (detailStatus.status === 'error') {
      return renderTeamCompletionProjectRowsError(expectedCount, detailStatus);
    }
    return renderTeamCompletionProjectRowsPending(expectedCount, detailStatus);
  }
  if (!projects.length) {
    return renderTeamCompletionProjectRowsEmpty(activeFilter);
  }
  return projects
    .map((project) => {
      const role = teamCompletionProjectRole(project, scope);
      return `
        <button
          class="team-completion-member-project-row"
          type="button"
          data-team-completion-project-id="${escapeHtml(project.id || '')}"
          data-team-completion-project-name="${escapeHtml(project.name || '')}"
        >
          <span class="team-completion-member-project-main">
            <strong title="${escapeHtml(project.name || project.id || '未命名项目')}">${escapeHtml(project.name || project.id || '未命名项目')}</strong>
            <small>${escapeHtml([project.storeStatus, project.status].filter(Boolean).join(' · ') || '状态未维护')}</small>
          </span>
          ${TEAM_COMPLETION_METRICS.map((metric) => renderTeamCompletionProjectMetric(project, metric)).join('')}
          <span class="team-completion-member-project-role">
            <strong>${escapeHtml(role.title)}</strong>
            <small>${escapeHtml(role.detail)}</small>
          </span>
        </button>
      `;
    })
    .join('');
}

function teamCompletionModalScope(review = state.teamWorkCompletion) {
  if (state.teamCompletionModalScopeType === 'team') {
    return {
      scope: review,
      title: '团队整体',
      subtitle: `${contextLabel(review?.dashboardContext || 'all')} · ${review?.year || state.teamWorkCompletionYear}`,
      emptyTitle: '暂无团队完成详情',
    };
  }
  if (state.teamCompletionModalScopeType === 'month') {
    const month = teamCompletionMonthByNumber(state.selectedTeamCompletionMonth, review);
    const scope = month ? monthCompletionScope(month, review) : null;
    return {
      scope,
      title: month ? `${review?.year || state.teamWorkCompletionYear}年 ${teamCompletionMonthLabel(month)}完成` : '月度完成',
      subtitle: `${contextLabel(review?.dashboardContext || 'all')} · 月度完成明细`,
      emptyTitle: '暂无月度完成详情',
    };
  }
  if (state.teamCompletionModalScopeType === 'group') {
    const group = groupByName(state.selectedTeamCompletionGroup, review);
    return {
      scope: group,
      title: group?.name || '未命名小组',
      subtitle: `${contextLabel(review?.dashboardContext || 'all')} · ${review?.year || state.teamWorkCompletionYear} · 小组完成明细`,
      emptyTitle: '暂无小组完成详情',
    };
  }
  const member = memberByName(state.selectedTeamCompletionMember, review);
  return {
    scope: member,
    title: member?.displayName || member?.name || '未命名成员',
    subtitle: `${member?.groupName || '未分组成员'} · ${contextLabel(review?.dashboardContext || 'all')} · ${
      review?.year || state.teamWorkCompletionYear
    }`,
    emptyTitle: '暂无成员完成详情',
  };
}

export function renderTeamCompletionMemberModal(review = state.teamWorkCompletion) {
  if (!elements.teamCompletionMemberModal || !elements.teamCompletionMemberModalBody) {
    return;
  }
  const modalScope = teamCompletionModalScope(review);
  const scope = modalScope.scope;
  if (!scope) {
    elements.teamCompletionMemberModalBody.innerHTML = renderEmptyState({
      title: modalScope.emptyTitle,
      compact: true,
    });
    return;
  }
  const fallbackFilter = firstAvailableTeamCompletionFilter(scope);
  const activeFilter = teamCompletionFilterByKey(state.teamCompletionModalFilter || fallbackFilter.key);
  state.teamCompletionModalFilter = activeFilter.key;
  const projectCount =
    state.teamCompletionModalScopeType === 'month'
      ? teamCompletionFilterValue(scope, activeFilter)
      : teamCompletionScopeProjectCount(scope, review);
  const missingDateCount = state.teamCompletionModalScopeType === 'member' ? memberMissingDateCount(scope) : 0;
  const helperText =
    state.teamCompletionModalScopeType === 'member'
      ? missingDateCount
        ? `缺日期 ${missingDateCount} 条，优先核对完成时间。`
        : '按成员项目关系汇总，点击分类切换项目列表。'
      : state.teamCompletionModalScopeType === 'month'
        ? '按单月可靠完成日期汇总，点击分类切换三项完成项目。'
        : state.teamCompletionModalScopeType === 'group'
          ? '按小组项目关系汇总，点击分类切换项目列表。'
          : '按团队项目关系汇总，点击分类切换项目列表。';
  elements.teamCompletionMemberModalBody.innerHTML = `
    <section class="team-completion-member-modal-shell" role="document">
      <header class="team-completion-member-modal-header">
        <div>
          <span>${escapeHtml(modalScope.subtitle)}</span>
          <h3 id="teamCompletionMemberModalTitle">${escapeHtml(modalScope.title)} · ${escapeHtml(projectCount)}项</h3>
          <p>${escapeHtml(helperText)}</p>
        </div>
        <button type="button" class="team-completion-member-modal-close" data-team-completion-member-close aria-label="关闭成员完成详情">×</button>
      </header>
      <div class="team-completion-member-modal-stats" aria-label="完成分类筛选">
        ${renderTeamCompletionModalFilterCards(scope, activeFilter)}
      </div>
      <section class="team-completion-member-modal-table" aria-label="成员项目明细">
        <div class="team-completion-member-modal-table-head">
          <span>项目</span>
          <span>平面方案</span>
          <span>方案摆场</span>
          <span>项目总闭环</span>
          <span>角色 / 小组</span>
        </div>
        <div class="team-completion-member-modal-rows">
          ${renderTeamCompletionProjectRows(review, scope, activeFilter)}
        </div>
      </section>
    </section>
  `;
}

function renderTeamCompletionModal() {
  const review = state.teamWorkCompletion;
  if (!review) {
    renderTeamCompletionMemberModalPreparing();
    elements.teamCompletionMemberModal.hidden = false;
    return;
  }
  renderTeamCompletionMemberModal(review);
  elements.teamCompletionMemberModal.hidden = false;
  if (!teamWorkCompletionHasDetail(review)) {
    const detailStatus = getTeamWorkCompletionDetailStatus(review);
    if (!['loading', 'preparing'].includes(detailStatus.status)) {
      preloadTeamWorkCompletionDetail(review, {
        reason: 'modal-cold-click',
        allowCompute: false,
      });
    }
  }
}

function renderProcessingQueueModalRows(projects = []) {
  if (!projects.length) {
    return `
      <div class="team-completion-member-modal-empty">
        <strong>暂无紧急项目</strong>
        <span>当前项目未闭环进行中列表里没有人工标记紧急的项目。</span>
      </div>
    `;
  }
  return projects
    .map((project, index) => renderProcessingQueueProjectRow(project, { rank: index + 1, modal: true }))
    .join('');
}

export function openTeamCompletionProcessingQueueModal(queueKey = 'urgent') {
  if (!elements.teamCompletionMemberModal || !elements.teamCompletionMemberModalBody) {
    return;
  }
  if (queueKey !== 'urgent') {
    return;
  }
  const queue = teamCompletionProcessingQueue(state.teamWorkCompletion, 'urgent');
  const projects = teamCompletionProcessingProjects(state.teamWorkCompletion, 'urgent');
  elements.teamCompletionMemberModalBody.innerHTML = `
    <section class="team-completion-member-modal-shell team-completion-processing-modal-shell" role="document">
      <header class="team-completion-member-modal-header">
        <div>
          <span>${escapeHtml(contextLabel(state.teamWorkCompletion?.dashboardContext || 'all'))} · ${
            state.teamWorkCompletion?.year || state.teamWorkCompletionYear
          }</span>
          <h3 id="teamCompletionMemberModalTitle">全部进行中的紧急项目 · ${escapeHtml(safeNumber(queue.totalCount || projects.length))}项</h3>
          <p>按计划开业目标风险排序，逾期和临期项目靠前。</p>
        </div>
        <button type="button" class="team-completion-member-modal-close" data-team-completion-member-close aria-label="关闭紧急项目列表">×</button>
      </header>
      <section class="team-completion-processing-modal-table" aria-label="全部进行中的紧急项目">
        <div class="team-completion-processing-modal-head">
          <span>序号</span>
          <span>项目</span>
          <span>阶段</span>
          <span>交付窗口 / 周期</span>
        </div>
        <div class="team-completion-processing-modal-rows">
          ${renderProcessingQueueModalRows(projects)}
        </div>
      </section>
    </section>
  `;
  elements.teamCompletionMemberModal.hidden = false;
}

export function openTeamCompletionGroupModal(groupName, metricKey = '') {
  const nextGroupName = String(groupName || '').trim();
  if (!nextGroupName || !elements.teamCompletionMemberModal) {
    return;
  }
  const group = groupByName(nextGroupName);
  if (!group) {
    return;
  }
  state.selectedTeamCompletionMember = '';
  state.selectedTeamCompletionGroup = nextGroupName;
  state.selectedTeamCompletionMonth = 0;
  state.teamCompletionModalScopeType = 'group';
  state.teamCompletionModalFilter = firstAvailableGroupCompletionFilter(group, metricKey).key;
  renderTeamCompletionModal();
}

export function openTeamCompletionMemberModal(name) {
  const nextName = String(name || '').trim();
  if (!nextName || !elements.teamCompletionMemberModal) {
    return;
  }
  state.selectedTeamCompletionMember = nextName;
  state.selectedTeamCompletionGroup = '';
  state.selectedTeamCompletionMonth = 0;
  state.teamCompletionModalScopeType = 'member';
  const member = memberByName(nextName);
  state.teamCompletionModalFilter = firstAvailableTeamCompletionFilter(member || {}).key;
  renderTeamCompletionModal();
}

export function openTeamCompletionScopeModal(filterKey = '') {
  if (!elements.teamCompletionMemberModal) {
    return;
  }
  state.selectedTeamCompletionMember = '';
  state.selectedTeamCompletionGroup = '';
  state.selectedTeamCompletionMonth = 0;
  state.teamCompletionModalScopeType = 'team';
  state.teamCompletionModalFilter = teamCompletionFilterByKey(filterKey).key;
  renderTeamCompletionModal();
}

export function openTeamCompletionMonthModal(monthNumber, metricKey = '') {
  if (!elements.teamCompletionMemberModal) {
    return;
  }
  const month = teamCompletionMonthByNumber(monthNumber);
  if (!month) {
    return;
  }
  const monthScope = monthCompletionScope(month);
  state.selectedTeamCompletionMember = '';
  state.selectedTeamCompletionGroup = '';
  state.selectedTeamCompletionMonth = safeNumber(month.month);
  state.teamCompletionModalScopeType = 'month';
  state.teamCompletionModalFilter = firstAvailableMonthCompletionFilter(monthScope, metricKey).key;
  renderTeamCompletionModal();
}

export function closeTeamCompletionMemberModal() {
  if (elements.teamCompletionMemberModal) {
    elements.teamCompletionMemberModal.hidden = true;
  }
  state.selectedTeamCompletionMember = '';
  state.selectedTeamCompletionGroup = '';
  state.selectedTeamCompletionMonth = 0;
  state.teamCompletionModalScopeType = 'member';
  state.teamCompletionModalFilter = '';
}

export function handleTeamCompletionMonthClick(event) {
  const monthButton = event.target.closest('[data-team-completion-month]');
  if (!monthButton || monthButton.disabled) {
    return false;
  }
  openTeamCompletionMonthModal(monthButton.dataset.teamCompletionMonth || '', monthButton.dataset.teamCompletionMonthMetric || '');
  return true;
}

export function handleTeamCompletionFilterClick(event) {
  const filterButton = event.target.closest('[data-team-completion-filter]');
  if (!filterButton) {
    return false;
  }
  openTeamCompletionScopeModal(filterButton.dataset.teamCompletionFilter || '');
  return true;
}

function teamCompletionProjectDetailMeta(activeFilter = TEAM_COMPLETION_FILTERS[0]) {
  if (state.teamCompletionModalScopeType === 'team') {
    return `团队整体 · ${activeFilter.label}`;
  }
  if (state.teamCompletionModalScopeType === 'group') {
    return `${state.selectedTeamCompletionGroup || ''} · ${activeFilter.label}`;
  }
  if (state.teamCompletionModalScopeType === 'month') {
    const year = state.teamWorkCompletion?.year || state.teamWorkCompletionYear;
    return `${year}年${state.selectedTeamCompletionMonth}月 · ${activeFilter.label}`;
  }
  return `${state.selectedTeamCompletionMember || ''} · ${activeFilter.label}`;
}

export function handleTeamCompletionGroupGridClick(event) {
  const metricButton = event.target.closest('[data-team-completion-group-metric]');
  if (metricButton) {
    openTeamCompletionGroupModal(
      metricButton.dataset.teamCompletionGroup || '',
      metricButton.dataset.teamCompletionGroupMetric || ''
    );
    return;
  }
  handleTeamCompletionMemberClick(event);
}

export function handleTeamCompletionMemberClick(event) {
  const memberButton = event.target.closest('[data-team-completion-member]');
  if (!memberButton) {
    return;
  }
  openTeamCompletionMemberModal(memberButton.dataset.teamCompletionMember || '');
}

export function handleTeamCompletionMemberModalClick(event) {
  if (!elements.teamCompletionMemberModal) {
    return;
  }
  if (event.target.closest('[data-team-completion-member-close]') || event.target === elements.teamCompletionMemberModal) {
    closeTeamCompletionMemberModal();
    return;
  }
  const retryButton = event.target.closest('[data-team-completion-detail-retry]');
  if (retryButton) {
    preloadTeamWorkCompletionDetail(state.teamWorkCompletion, {
      reason: 'modal-retry',
      allowCompute: false,
      force: true,
    });
    renderTeamCompletionMemberModal();
    return;
  }
  if (handleTeamCompletionProcessingQueueClick(event)) {
    return;
  }
  const filterButton = event.target.closest('[data-team-completion-filter]');
  if (filterButton) {
    state.teamCompletionModalFilter = teamCompletionFilterByKey(filterButton.dataset.teamCompletionFilter || '').key;
    renderTeamCompletionMemberModal();
    return;
  }
  const projectRow = event.target.closest('[data-team-completion-project-id], [data-team-completion-project-name]');
  if (projectRow) {
    const activeFilter = teamCompletionFilterByKey(state.teamCompletionModalFilter);
    openProjectDetailByReference(
      {
        projectId: projectRow.dataset.teamCompletionProjectId || '',
        projectName: projectRow.dataset.teamCompletionProjectName || '',
      },
      teamCompletionSourceProjects(),
      {
        action: activeFilter.label,
        reason: '团队工作完成情况',
        meta: teamCompletionProjectDetailMeta(activeFilter),
      }
    );
  }
}

export function handleTeamCompletionProcessingQueueClick(event) {
  const openButton = event.target.closest('[data-team-processing-queue-open]');
  if (openButton) {
    openTeamCompletionProcessingQueueModal(openButton.dataset.teamProcessingQueueOpen || 'urgent');
    return true;
  }
  const projectRow = event.target.closest('[data-team-processing-project-id], [data-team-processing-project-name]');
  if (!projectRow) {
    return false;
  }
  const sourceProjects = teamCompletionProcessingProjects(state.teamWorkCompletion);
  openProjectDetailByReference(
    {
      projectId: projectRow.dataset.teamProcessingProjectId || '',
      projectName: projectRow.dataset.teamProcessingProjectName || '',
    },
    sourceProjects,
    {
      action: '处理进行中项目',
      reason: '团队进行中项目待处理',
      meta: '按交付风险排序',
    }
  );
  return true;
}

export function handleTeamCompletionMemberModalKeydown(event) {
  if (event.key === 'Escape' && elements.teamCompletionMemberModal && !elements.teamCompletionMemberModal.hidden) {
    closeTeamCompletionMemberModal();
  }
}

function dataQualityIssueCount(dataQuality = {}) {
  return (
    safeNumber(dataQuality.unmappedMemberCount) +
    safeNumber(dataQuality.missingDateCompletionCount) +
    safeNumber(dataQuality.weakProjectKeyCount)
  );
}

function dataQualitySummary(dataQuality = {}, notes = []) {
  if (!notes.length) {
    return '当前筛选未发现未映射人员、缺完成日期或弱项目 key。';
  }
  const firstNotes = notes.map((note) => escapeHtml(note.message || note.type || '待核对'));
  const total = dataQualityIssueCount(dataQuality);
  return `${firstNotes.join('；')}${total > notes.length ? `；另有 ${total - notes.length} 条待核对` : ''}`;
}

function isFranchiseAuditEmptyReview(review = state.teamWorkCompletion) {
  return (
    normalizeDashboardContext(review?.dashboardContext) === 'franchise' &&
    safeNumber(review?.projectCount) === 0 &&
    teamCompletionSourceProjects(review).length === 0
  );
}

export function renderTeamCompletionDataQuality(review = state.teamWorkCompletion) {
  if (!elements.teamCompletionDataQuality) {
    return;
  }
  const dataQuality = review?.dataQuality || review?.dataQualitySummary || {};
  const notes = Array.isArray(dataQuality.notes) ? dataQuality.notes.slice(0, 4) : [];
  const issueCount = dataQualityIssueCount(dataQuality);
  elements.teamCompletionDataQuality.classList.toggle('is-clean', !issueCount);
  elements.teamCompletionDataQuality.classList.toggle('is-warning', Boolean(issueCount));
  if (!issueCount) {
    if (isFranchiseAuditEmptyReview(review)) {
      elements.teamCompletionDataQuality.innerHTML = `
        <span>加盟口径核查</span>
        <strong>0 项</strong>
        <small>若这里出现项目，请核对原始表单的组别、负责人或店态字段是否误填。</small>
      `;
      return;
    }
    elements.teamCompletionDataQuality.innerHTML = `
      <span>数据核对</span>
      <strong>0 条</strong>
      <small>${dataQualitySummary(dataQuality, notes)}</small>
    `;
    return;
  }
  elements.teamCompletionDataQuality.innerHTML = `
    <span>数据待核对</span>
    <strong>${issueCount} 条</strong>
    <small>${dataQualitySummary(dataQuality, notes)}</small>
  `;
}

export function renderTeamWorkCompletionLoading(owner = '') {
  if (!elements.teamWorkCompletionModule) {
    return;
  }
  hideLegacyTeamLoadModule();
  elements.teamWorkCompletionModule.hidden = false;
  setTeamCompletionContentVisible(false);
  syncTeamCompletionControls();
  elements.teamCompletionHeroStats.innerHTML = renderEmptyState({
    title: owner ? `正在读取 ${owner} 的完成情况` : '正在读取团队完成情况',
    compact: true,
  });
  clearTeamCompletionPanels();
}

export function renderTeamWorkCompletionError(message = state.teamWorkCompletionError) {
  if (!elements.teamWorkCompletionModule) {
    return;
  }
  hideLegacyTeamLoadModule();
  elements.teamWorkCompletionModule.hidden = false;
  setTeamCompletionContentVisible(false);
  elements.teamCompletionHeroStats.innerHTML = renderEmptyState({
    title: '团队工作完成情况加载失败',
    description: message || '请稍后刷新重试。',
    compact: true,
  });
  clearTeamCompletionPanels();
}

function currentTeamWorkCompletionOwner() {
  return resolveTeamOwner() || state.selectedTeamOwner || state.teamWorkCompletion?.owner || '';
}

function shouldBlockStaleTeamWorkCompletionReview(review = null) {
  if (currentPageId() !== 'teams' || !review?.owner) {
    return false;
  }
  const owner = currentTeamWorkCompletionOwner();
  return Boolean(owner && !teamWorkCompletionReviewMatchesOwner(review, owner));
}

export function renderTeamWorkCompletionDashboard(review = state.teamWorkCompletion) {
  if (!elements.teamWorkCompletionModule) {
    return;
  }
  hideLegacyTeamLoadModule();
  if (shouldBlockStaleTeamWorkCompletionReview(review)) {
    const owner = currentTeamWorkCompletionOwner();
    if (state.teamWorkCompletion === review) {
      state.teamWorkCompletion = null;
      state.teamWorkCompletionLoading = true;
      state.teamWorkCompletionError = '';
      state.teamWorkCompletionRefreshStatus = 'switching';
      state.teamWorkCompletionRefreshError = '';
      state.teamWorkCompletionSwitchTarget = owner;
    }
    renderTeamWorkCompletionLoading(owner);
    return;
  }
  if (state.teamWorkCompletionLoading && !review) {
    renderTeamWorkCompletionLoading(state.selectedTeamOwner);
    return;
  }
  if (state.teamWorkCompletionError && !review) {
    renderTeamWorkCompletionError();
    return;
  }
  if (!review?.owner) {
    elements.teamWorkCompletionModule.hidden = false;
    setTeamCompletionContentVisible(false);
    syncTeamCompletionControls();
    elements.teamCompletionHeroStats.innerHTML = renderEmptyState({
      title: '暂无团队完成数据',
      description: '请选择负责人后查看团队、小组和成员完成情况。',
      compact: true,
    });
    clearTeamCompletionPanels();
    return;
  }

  elements.teamWorkCompletionModule.hidden = false;
  setTeamCompletionContentVisible(true);
  syncTeamCompletionControls(review);
  if (state.teamWorkCompletionRefreshStatus === 'switching' && state.teamWorkCompletionSwitchTarget) {
    elements.teamWorkCompletionModule.dataset.switchingOwner = state.teamWorkCompletionSwitchTarget;
  } else {
    delete elements.teamWorkCompletionModule.dataset.switchingOwner;
  }
  renderTeamCompletionHeroStats(review);
  renderTeamCompletionProcessingQueues(review);
  renderTeamCompletionScopeNote(review, state.teamMetrics);
  renderTeamCompletionMonthlyChart(review.monthly?.months || []);
  renderTeamCompletionGroups(review);
  renderTeamCompletionMembers(review);
  renderTeamCompletionDataQuality(review);
  bindDashboardTooltips(elements.teamWorkCompletionModule);
}
