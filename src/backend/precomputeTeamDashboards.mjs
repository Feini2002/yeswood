import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';

import { paths } from './config.mjs';
import { composeDashboardMetrics } from './metrics/composeDashboard.mjs';
import { readFranchiseScope, readWorkflowStage } from './metrics/fieldSemantics.mjs';
import {
  compactProjectStageReminder,
  compactProjectWorkflowFacts,
  resolveProjectStageReminder,
} from '../../public/domain/project-stage-reminder-rules.mjs';
import { DASHBOARD_CONTEXTS, resolveCanonicalOwner } from './metrics/projectScopes.mjs';
import { readProjectOwnerNames, splitPersonnelNames } from './personnelNames.mjs';
import { createFilterOptions, filterProjects } from './projectData.mjs';
import { compactProjectForDetailReadModel } from './projectDetailPayload.mjs';
import {
  buildDashboardSessionShellPayload,
  currentReadModelDir,
  publishReadModelDirectory,
} from './readModelRepository.mjs';
import { mergeTeamWorkCompletionDetailPayload } from './teamWorkCompletionPayload.mjs';
import { buildTeamMetricsPayload, resolveTeamForOwner } from './teamMetricsPayload.mjs';
import { buildTeamOwnerRates } from './teamInsights.mjs';
import { buildTeamResponsibilityReview } from './teamResponsibilityReview.mjs';
import { buildTeamWorkCompletionReview } from './teamWorkCompletionReview.mjs';

const gzipAsync = promisify(zlib.gzip);

export const DASHBOARD_SESSION_PRECOMPUTE_FEATURE = 'dashboard-session';
export const TEAM_RESPONSIBILITY_REVIEW_PRECOMPUTE_FEATURE = 'team-responsibility-review';
export const TEAM_WORK_COMPLETION_PRECOMPUTE_FEATURE = 'team-work-completion';
export const TEAM_WORK_COMPLETION_SUMMARY_PRECOMPUTE_FEATURE = 'team-work-completion-summary';
export const TEAM_WORK_COMPLETION_DETAIL_PRECOMPUTE_FEATURE = 'team-work-completion-detail';
export const TEAM_METRICS_PRECOMPUTE_FEATURE = 'team-metrics';
export const PROJECT_CATALOG_SUMMARY_PRECOMPUTE_FEATURE = 'project-catalog-summary';
export const PROJECT_DETAIL_PRECOMPUTE_FEATURE = 'project-detail';
export const PROFILE_DASHBOARD_PRECOMPUTE_FEATURE = 'profile-dashboard';
const PRECOMPUTE_SCHEMA_VERSION = 11;
const DEFAULT_RETAINED_PRECOMPUTE_VERSIONS = 3;
const DEFAULT_PRECOMPUTE_YEAR_LOOKBACK = 2;
const DEFAULT_PRECOMPUTE_YEAR_LOOKAHEAD = 1;
const COMPLETE_PRECOMPUTE_FEATURES = [
  DASHBOARD_SESSION_PRECOMPUTE_FEATURE,
  PROJECT_CATALOG_SUMMARY_PRECOMPUTE_FEATURE,
  PROFILE_DASHBOARD_PRECOMPUTE_FEATURE,
  TEAM_RESPONSIBILITY_REVIEW_PRECOMPUTE_FEATURE,
  TEAM_WORK_COMPLETION_PRECOMPUTE_FEATURE,
  TEAM_WORK_COMPLETION_SUMMARY_PRECOMPUTE_FEATURE,
  TEAM_WORK_COMPLETION_DETAIL_PRECOMPUTE_FEATURE,
  TEAM_METRICS_PRECOMPUTE_FEATURE,
  PROJECT_DETAIL_PRECOMPUTE_FEATURE,
];

export function precomputeSnapshotHash(snapshot = {}, architecture = snapshot.personnelArchitecture || {}) {
  const people = architecture?.people || {};
  const peopleRevision = Array.isArray(people) ? people.length : Object.keys(people).length;
  return crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        source: snapshot.source || '',
        storage: snapshot.storage || '',
        syncedAt: snapshot.syncedAt || '',
        contentHash: snapshot.contentHash ?? '',
        dataRevision: snapshot.dataRevision ?? '',
        totalRecords: snapshot.totalRecords || 0,
        ignoredRecords: snapshot.ignoredRecords || 0,
        peopleRevision,
        teamsRevision: Array.isArray(architecture?.teams) ? architecture.teams.length : 0,
      })
    )
    .digest('hex');
}

function hashToken(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16);
}

function safeSegment(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+$/, '_')
    .slice(0, 80);
}

function precomputeBaseDir(config = {}) {
  return path.resolve(config.precomputeDir || path.join(config.dataDir || paths.dataDir, 'precomputed'));
}

function precomputeDirForHash(config = {}, snapshotHash) {
  return path.join(precomputeBaseDir(config), snapshotHash);
}

function manifestPath(config = {}, snapshotHash) {
  return path.join(precomputeDirForHash(config, snapshotHash), 'manifest.json');
}

function teamWorkCompletionFileName({ owner, dashboardContext, year }) {
  return `${hashToken(owner)}__${safeSegment(dashboardContext || 'all')}__${safeSegment(year)}.json`;
}

function teamWorkCompletionSummaryFilePath(config = {}, snapshotHash, params = {}) {
  return path.join(
    precomputeDirForHash(config, snapshotHash),
    TEAM_WORK_COMPLETION_SUMMARY_PRECOMPUTE_FEATURE,
    teamWorkCompletionFileName(params)
  );
}

function teamWorkCompletionDetailFilePath(config = {}, snapshotHash, params = {}) {
  return path.join(
    precomputeDirForHash(config, snapshotHash),
    TEAM_WORK_COMPLETION_DETAIL_PRECOMPUTE_FEATURE,
    teamWorkCompletionFileName(params)
  );
}

function teamMetricsFileName(dashboardContext = 'all') {
  return `${safeSegment(dashboardContext || 'all')}.json`;
}

function teamMetricsFilePath(config = {}, snapshotHash, dashboardContext = 'all') {
  return path.join(
    precomputeDirForHash(config, snapshotHash),
    TEAM_METRICS_PRECOMPUTE_FEATURE,
    teamMetricsFileName(dashboardContext)
  );
}

function teamResponsibilityReviewFileName({ owner, dashboardContext }) {
  return `${hashToken(owner)}__${safeSegment(dashboardContext || 'all')}.json`;
}

function teamResponsibilityReviewFilePath(config = {}, snapshotHash, params = {}) {
  return path.join(
    precomputeDirForHash(config, snapshotHash),
    TEAM_RESPONSIBILITY_REVIEW_PRECOMPUTE_FEATURE,
    teamResponsibilityReviewFileName(params)
  );
}

function dashboardSessionFilePath(config = {}, snapshotHash) {
  return path.join(precomputeDirForHash(config, snapshotHash), DASHBOARD_SESSION_PRECOMPUTE_FEATURE, 'core.json');
}

function projectCatalogSummaryFilePath(baseDir) {
  return path.join(baseDir, 'project-catalog', 'summary.json');
}

function projectDetailFilePath(baseDir, projectId = '') {
  return path.join(baseDir, PROJECT_DETAIL_PRECOMPUTE_FEATURE, `${hashToken(projectId)}.json`);
}

function projectDetailIndexFilePath(baseDir) {
  return path.join(baseDir, PROJECT_DETAIL_PRECOMPUTE_FEATURE, 'index.json');
}

function profileDashboardFilePath(baseDir, profile) {
  return path.join(baseDir, PROFILE_DASHBOARD_PRECOMPUTE_FEATURE, `${safeSegment(profile)}.json`);
}

function isPathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function removeDirectoryInside(parent, target) {
  if (!isPathInside(parent, target)) {
    throw new Error(`Refusing to remove precompute path outside base directory: ${target}`);
  }
  await fsp.rm(target, { recursive: true, force: true });
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readManifest(config = {}, snapshotHash) {
  const cached = config.precomputeIndex?.get?.(snapshotHash);
  if (cached) {
    if (cached.schemaVersion === PRECOMPUTE_SCHEMA_VERSION && cached.snapshotHash === snapshotHash) {
      return cached;
    }
    config.precomputeIndex?.delete?.(snapshotHash);
  }
  const manifest = readJsonFile(manifestPath(config, snapshotHash));
  if (!manifest || manifest.schemaVersion !== PRECOMPUTE_SCHEMA_VERSION || manifest.snapshotHash !== snapshotHash) {
    return null;
  }
  if (!config.precomputeIndex) {
    config.precomputeIndex = new Map();
  }
  config.precomputeIndex.set(snapshotHash, manifest);
  return manifest;
}

function manifestHasFeature(manifest, feature) {
  return Array.isArray(manifest?.features) && manifest.features.includes(feature);
}

function manifestHasFeatures(manifest, features = []) {
  return features.every((feature) => manifestHasFeature(manifest, feature));
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readJsonFileSync(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function processingQueuePayloadIsComplete(queue = null) {
  if (!queue || typeof queue !== 'object' || !Array.isArray(queue.topProjects)) {
    return false;
  }
  const totalCount = Number(queue.totalCount ?? queue.topProjects.length);
  return Number.isFinite(totalCount);
}

function teamWorkCompletionHasProcessingQueues(payload = null) {
  const queues = payload?.processingQueues;
  return (
    Boolean(queues && typeof queues === 'object') &&
    processingQueuePayloadIsComplete(queues.urgent) &&
    processingQueuePayloadIsComplete(queues.normal)
  );
}

function teamWorkCompletionMatchesAsOfDate(payload = null, params = {}) {
  if (!params.today && !params.asOfDate) {
    return true;
  }
  const expected = resolvePrecomputeAsOfDate({ today: params.today || params.asOfDate });
  return Boolean(expected && payload?.asOfDate === expected);
}

function sameScopeValue(actual, expected) {
  return String(actual ?? '').trim() === String(expected ?? '').trim();
}

function teamWorkCompletionMatchesScope(payload = null, params = {}) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const expectedOwner = String(params.owner || '').trim();
  const expectedContext = String(params.dashboardContext || 'all').trim();
  const expectedYear = Number(params.year || new Date().getFullYear());
  return (
    (!expectedOwner || sameScopeValue(payload.owner, expectedOwner)) &&
    sameScopeValue(payload.dashboardContext || 'all', expectedContext) &&
    Number(payload.year) === expectedYear
  );
}

function teamResponsibilityReviewMatchesScope(payload = null, params = {}) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const expectedOwner = String(params.owner || '').trim();
  const expectedContext = String(params.dashboardContext || 'all').trim();
  return (
    (!expectedOwner || sameScopeValue(payload.owner, expectedOwner)) &&
    sameScopeValue(payload.dashboardContext || 'all', expectedContext)
  );
}

function projectDetailFilesComplete(baseDir) {
  const index = readJsonFileSync(projectDetailIndexFilePath(baseDir));
  if (!index || !Array.isArray(index.projectIds)) {
    return false;
  }
  const projectIds = Array.from(new Set(index.projectIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (Number(index.total || 0) > 0 && !projectIds.length) {
    return false;
  }
  for (const projectId of projectIds) {
    if (!fileExists(projectDetailFilePath(baseDir, projectId))) {
      return false;
    }
  }
  return true;
}

function precomputeFilesComplete(config = {}, snapshotHash, manifest = {}) {
  const baseDir = precomputeDirForHash(config, snapshotHash);
  if (
    !fileExists(dashboardSessionFilePath(config, snapshotHash)) ||
    !fileExists(projectCatalogSummaryFilePath(baseDir)) ||
    !fileExists(projectDetailIndexFilePath(baseDir)) ||
    !fileExists(profileDashboardFilePath(baseDir, 'department')) ||
    !fileExists(profileDashboardFilePath(baseDir, 'direct')) ||
    !fileExists(profileDashboardFilePath(baseDir, 'franchise'))
  ) {
    return false;
  }
  if (!projectDetailFilesComplete(baseDir)) {
    return false;
  }

  const contexts = Array.isArray(manifest.contexts) && manifest.contexts.length ? manifest.contexts : ['all'];
  const years = Array.isArray(manifest.years) && manifest.years.length ? manifest.years : [new Date().getFullYear()];
  const detailYears = normalizeManifestDetailYears(manifest, years);
  const detailYearSet = new Set(detailYears.map((year) => Number(year)));
  const owners = (Array.isArray(manifest.owners) ? manifest.owners : [])
    .map((owner) => owner?.owner || owner)
    .filter(Boolean);

  for (const dashboardContext of contexts) {
    if (!fileExists(teamMetricsFilePath(config, snapshotHash, dashboardContext))) {
      return false;
    }
  }
  for (const owner of owners) {
    for (const dashboardContext of contexts) {
      if (!fileExists(teamResponsibilityReviewFilePath(config, snapshotHash, { owner, dashboardContext }))) {
        return false;
      }
      if (
        !teamResponsibilityReviewMatchesScope(
          readJsonFileSync(teamResponsibilityReviewFilePath(config, snapshotHash, { owner, dashboardContext })),
          { owner, dashboardContext }
        )
      ) {
        return false;
      }
      for (const year of years) {
        const params = { owner, dashboardContext, year };
        const summaryPath = teamWorkCompletionSummaryFilePath(config, snapshotHash, params);
        const summaryPayload = readJsonFileSync(summaryPath);
        if (
          !fileExists(summaryPath) ||
          !teamWorkCompletionMatchesScope(summaryPayload, params) ||
          !teamWorkCompletionHasProcessingQueues(summaryPayload)
        ) {
          return false;
        }
        if (detailYearSet.has(Number(year))) {
          const detailPath = teamWorkCompletionDetailFilePath(config, snapshotHash, params);
          const detailPayload = readJsonFileSync(detailPath);
          if (
            !fileExists(detailPath) ||
            !teamWorkCompletionMatchesScope(detailPayload, params) ||
            !teamWorkCompletionHasProcessingQueues(detailPayload)
          ) {
            return false;
          }
        }
      }
    }
  }
  return true;
}

function readModelCurrentComplete(config = {}, manifest = {}) {
  if (!manifest?.snapshotHash) {
    return false;
  }
  const readModelDir = currentReadModelDir(config);
  const readModelManifest = readJsonFile(path.join(readModelDir, 'manifest.json'));
  if (
    !readModelManifest ||
    readModelManifest.schemaVersion !== manifest.schemaVersion ||
    readModelManifest.snapshotHash !== manifest.snapshotHash ||
    JSON.stringify(readModelManifest.years || []) !== JSON.stringify(manifest.years || []) ||
    JSON.stringify(readModelManifest.detailYears || []) !== JSON.stringify(manifest.detailYears || []) ||
    JSON.stringify(readModelManifest.excludedYears || []) !== JSON.stringify(manifest.excludedYears || []) ||
    !manifestHasFeatures(readModelManifest, COMPLETE_PRECOMPUTE_FEATURES)
  ) {
    return false;
  }
  const corePath = path.join(readModelDir, DASHBOARD_SESSION_PRECOMPUTE_FEATURE, 'core.json');
  return fileExists(corePath) && fileExists(`${corePath}.gz`);
}

export function hasCompletePrecompute(snapshot = {}, config = {}) {
  const architecture = snapshot.personnelArchitecture || {};
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const manifest = readManifest(config, snapshotHash);
  if (!manifestHasFeatures(manifest, COMPLETE_PRECOMPUTE_FEATURES)) {
    return null;
  }
  return precomputeFilesComplete(config, snapshotHash, manifest) ? manifest : null;
}

export function hasPrecomputedTeamBundle(snapshot = {}, config = {}, params = {}) {
  const architecture = snapshot.personnelArchitecture || {};
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const manifest = readManifest(config, snapshotHash);
  if (!manifestHasFeatures(manifest, COMPLETE_PRECOMPUTE_FEATURES)) {
    return null;
  }
  const owner = params.owner || manifest?.owners?.[0]?.owner || '';
  const dashboardContext = params.dashboardContext || 'all';
  const year = Number(params.year || new Date().getFullYear());
  if (!owner) {
    return fileExists(dashboardSessionFilePath(config, snapshotHash)) ? manifest : null;
  }
  if (
    !fileExists(teamMetricsFilePath(config, snapshotHash, dashboardContext)) ||
    !fileExists(teamWorkCompletionSummaryFilePath(config, snapshotHash, { owner, dashboardContext, year })) ||
    !fileExists(teamWorkCompletionDetailFilePath(config, snapshotHash, { owner, dashboardContext, year })) ||
    !fileExists(teamResponsibilityReviewFilePath(config, snapshotHash, { owner, dashboardContext }))
  ) {
    return null;
  }
  return readPrecomputedDashboardSession(config, snapshot, architecture, {
    owner,
    requestedOwner: owner,
    dashboardContext,
    year,
  })
    ? manifest
    : null;
}

function publicSnapshotMeta(snapshot = {}, config = {}) {
  return {
    source: snapshot.source,
    syncedAt: snapshot.syncedAt,
    sourceRecords: snapshot.sourceRecords,
    totalRecords: snapshot.totalRecords,
    ignoredRecords: snapshot.ignoredRecords || 0,
    fieldCount: Array.isArray(snapshot.fieldCatalog) ? snapshot.fieldCatalog.length : 0,
    storage: snapshot.storage || 'json',
    databaseReady: Boolean(snapshot.databaseReady),
    dashboardSyncEnabled: Boolean(config.dashboardSyncEnabled),
    dashboardAutoUpdateEnabled: config.dashboardAutoUpdateEnabled !== false,
    developerDocumentationVisible: Boolean(config.devReloadEnabled),
    dashboardDisplayMode: config.devReloadEnabled ? 'development' : 'intranet',
    personnelArchitecture: snapshot.personnelArchitecture || null,
    readOnly: true,
  };
}

function buildDashboardSessionPayload({
  config = {},
  snapshot = {},
  snapshotHash = '',
  architecture = snapshot.personnelArchitecture || {},
  owner = '',
  dashboardContext = 'all',
  year = new Date().getFullYear(),
  generatedAt = '',
  features = COMPLETE_PRECOMPUTE_FEATURES,
  metrics = null,
  workCompletion = null,
  responsibilityReview = null,
} = {}) {
  return {
    schemaVersion: PRECOMPUTE_SCHEMA_VERSION,
    readOnly: true,
    readModel: true,
    snapshotHash,
    generatedAt,
    features,
    snapshot: publicSnapshotMeta(snapshot, config),
    filters: snapshot.filters || createFilterOptions(snapshot.projects || []),
    metrics: snapshot.metrics || {},
    departmentMetrics: composeDashboardMetrics(snapshot.projects || [], 'department', {
      dashboardContext: 'all',
      personnelArchitecture: architecture,
    }),
    team: {
      owner,
      dashboardContext,
      year,
      metrics,
      workCompletion,
      responsibilityReview,
    },
  };
}

function normalizeContexts(contexts) {
  const defaults = Array.from(DASHBOARD_CONTEXTS);
  return (Array.isArray(contexts) && contexts.length ? contexts : defaults).filter((context) =>
    DASHBOARD_CONTEXTS.has(context)
  );
}

function normalizeYears(years, now = new Date()) {
  const fallback = now.getFullYear();
  const normalized = (Array.isArray(years) && years.length ? years : [fallback])
    .map((year) => Number(year))
    .filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100);
  return normalized.length ? Array.from(new Set(normalized)) : [fallback];
}

function formatChinaDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function resolvePrecomputeAsOfDate(options = {}) {
  if (options.today) {
    return formatChinaDate(options.today) || String(options.today).slice(0, 10);
  }
  return formatChinaDate(options.now || new Date());
}

const READ_MODEL_PROJECT_FIELDS = [
  'id',
  'name',
  'province',
  'businessType',
  'storeStatus',
  'status',
  'owner',
  'ownerDisplay',
  'cdOwner',
  'vmOwner',
  'progress',
  'hardProgressStage',
  'softProgressStage',
  'franchiseScope',
  'startDate',
  'dueDate',
  'updatedAt',
  'isDelayed',
  'scheduleStatus',
  'riskLevel',
  'riskNotes',
  'localNotes',
  'source',
  'difficultyScore',
  'difficultyLevel',
  'difficultyWeight',
  'difficultyWorkdays',
  'primaryReminder',
];

function compactProjectForReadModel(project = {}) {
  if (!project || typeof project !== 'object') {
    return project;
  }
  const summary = {};
  for (const key of READ_MODEL_PROJECT_FIELDS) {
    if (project[key] !== undefined) {
      summary[key] = project[key];
    }
  }
  summary.hardProgressStage = summary.hardProgressStage || readWorkflowStage(project, { discipline: 'hard' });
  summary.softProgressStage = summary.softProgressStage || readWorkflowStage(project, { discipline: 'soft' });
  summary.franchiseScope = summary.franchiseScope || project.franchiseScope || readFranchiseScope(project);
  const stageReminder = resolveProjectStageReminder(project);
  summary.stageReminder = compactProjectStageReminder(stageReminder);
  summary.workflowFacts = compactProjectWorkflowFacts(stageReminder.facts);
  if (project.recordMeta) {
    summary.recordMeta = {
      id: project.recordMeta.id,
      lastModifiedTime: project.recordMeta.lastModifiedTime,
    };
  }
  return summary;
}

function compactProjectsForReadModel(projects = []) {
  return Array.isArray(projects) ? projects.map(compactProjectForReadModel) : [];
}

function projectDetailReadModelIds(project = {}) {
  return Array.from(
    new Set([project?.id, project?.recordMeta?.id].map((id) => String(id || '').trim()).filter(Boolean))
  );
}

async function writeProjectDetailReadModels(baseDir, projects = []) {
  const projectIds = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    const ids = projectDetailReadModelIds(project);
    if (!ids.length) {
      continue;
    }
    const detail = compactProjectForDetailReadModel(project);
    for (const projectId of ids) {
      projectIds.push(projectId);
      await writeJson(projectDetailFilePath(baseDir, projectId), detail);
    }
  }
  await writeJson(projectDetailIndexFilePath(baseDir), {
    projectIds,
    total: projectIds.length,
    readOnly: true,
  });
}

function findProjectForDetailReadModel(projects = [], projectId = '') {
  const expected = String(projectId || '').trim();
  if (!expected) {
    return null;
  }
  return (Array.isArray(projects) ? projects : []).find((project) => projectDetailReadModelIds(project).includes(expected)) || null;
}

function projectDetailIndexIncludes(baseDir, projectId = '') {
  const index = readJsonFile(path.join(baseDir, PROJECT_DETAIL_PRECOMPUTE_FEATURE, 'index.json'));
  return Boolean(index && Array.isArray(index.projectIds) && index.projectIds.includes(projectId));
}

function collectYearFromValue(value, years) {
  const text = String(value ?? '').trim();
  if (!text) {
    return;
  }
  const match = text.match(/\b(20\d{2}|2100)\b/);
  if (!match) {
    return;
  }
  const year = Number(match[1]);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) {
    years.add(year);
  }
}

function yearsFromProjects(projects = []) {
  const years = new Set();
  const dateLikeRawField = /(日期|时间|date|time|开业|启动|闭环|完成|复尺|上会)/i;
  const topLevelDateFields = [
    'startDate',
    'dueDate',
    'updatedAt',
    'syncedAt',
    'createdAt',
    'completedAt',
    'actualStart',
    'actualFinish',
  ];
  for (const project of projects || []) {
    for (const fieldName of topLevelDateFields) {
      collectYearFromValue(project?.[fieldName], years);
    }
    for (const [fieldName, cell] of Object.entries(project?.rawFields || {})) {
      if (cell?.kind === 'date' || dateLikeRawField.test(fieldName)) {
        collectYearFromValue(cell?.display ?? cell, years);
      }
    }
    for (const value of Object.values(project?.hardDeadline || {})) {
      if (typeof value === 'string') {
        collectYearFromValue(value, years);
      } else if (value && typeof value === 'object') {
        for (const nestedValue of Object.values(value)) {
          collectYearFromValue(nestedValue, years);
        }
      }
    }
  }
  return Array.from(years).sort((a, b) => a - b);
}

function normalizeYearWindowBound(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : fallback;
}

function normalizePrecomputeYearPlan(snapshot = {}, options = {}) {
  if (Array.isArray(options.years) && options.years.length) {
    return {
      years: normalizeYears(options.years, options.now),
      excludedYears: [],
      yearWindow: null,
    };
  }
  const currentYear = (options.now || new Date()).getFullYear();
  const config = options.config || {};
  const minYear = normalizeYearWindowBound(
    options.minPrecomputeYear ?? config.minPrecomputeYear,
    currentYear - DEFAULT_PRECOMPUTE_YEAR_LOOKBACK
  );
  const maxYear = normalizeYearWindowBound(
    options.maxPrecomputeYear ?? config.maxPrecomputeYear,
    currentYear + DEFAULT_PRECOMPUTE_YEAR_LOOKAHEAD
  );
  const [windowStart, windowEnd] = minYear <= maxYear ? [minYear, maxYear] : [maxYear, minYear];
  const years = new Set([currentYear]);
  const excludedYears = new Set();
  for (const year of yearsFromProjects(snapshot.projects || [])) {
    if (year >= windowStart && year <= windowEnd) {
      years.add(year);
    } else {
      excludedYears.add(year);
    }
  }
  return {
    years: Array.from(years).sort((a, b) => a - b),
    excludedYears: Array.from(excludedYears).sort((a, b) => a - b),
    yearWindow: { min: windowStart, max: windowEnd },
  };
}

function normalizeManifestDetailYears(manifest = {}, years = []) {
  const normalizedYears = normalizeYears(years).sort((a, b) => a - b);
  if (!Array.isArray(manifest.detailYears) || !manifest.detailYears.length) {
    return normalizedYears;
  }
  const yearSet = new Set(normalizedYears);
  const detailYears = normalizeYears(manifest.detailYears)
    .filter((year) => yearSet.has(year))
    .sort((a, b) => a - b);
  return detailYears.length ? detailYears : normalizedYears;
}

function normalizePrecomputeDetailYears(years = [], options = {}) {
  const normalizedYears = normalizeYears(years, options.now).sort((a, b) => a - b);
  if (Array.isArray(options.detailYears) && options.detailYears.length) {
    const yearSet = new Set(normalizedYears);
    const detailYears = normalizeYears(options.detailYears, options.now)
      .filter((year) => yearSet.has(year))
      .sort((a, b) => a - b);
    return detailYears.length ? detailYears : normalizedYears;
  }
  if (Array.isArray(options.years) && options.years.length) {
    return normalizedYears;
  }
  const currentYear = (options.now || new Date()).getFullYear();
  if (normalizedYears.includes(currentYear)) {
    return [currentYear];
  }
  return normalizedYears.length ? [normalizedYears[normalizedYears.length - 1]] : [currentYear];
}

export function ownersFromSnapshot(snapshot = {}, architecture = snapshot.personnelArchitecture || {}) {
  const owners = new Set();
  const roles = snapshot.metrics?.personnel?.roles || [];
  for (const role of roles) {
    if (!['cdOwner', 'vmOwner'].includes(role?.key)) {
      continue;
    }
    for (const person of role.people || []) {
      for (const name of splitPersonnelNames(person?.name)) {
        const owner = resolveCanonicalOwner(name, architecture);
        if (owner) {
          owners.add(owner);
        }
      }
    }
  }

  for (const team of architecture.teams || []) {
    const owner = resolveCanonicalOwner(team?.owner || '', architecture);
    if (owner) {
      owners.add(owner);
    }
  }

  if (!owners.size) {
    for (const project of snapshot.projects || []) {
      for (const name of readProjectOwnerNames(project)) {
        const owner = resolveCanonicalOwner(name, architecture);
        if (owner) {
          owners.add(owner);
        }
      }
    }
  }

  return Array.from(owners);
}

async function writeJson(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const body = `${JSON.stringify(payload)}\n`;
  await Promise.all([fsp.writeFile(filePath, body, 'utf8'), fsp.writeFile(`${filePath}.gz`, await gzipAsync(body))]);
}

async function writeTeamWorkCompletionSidecars(baseDir, params, payload, summaryPayload) {
  await writeJson(
    path.join(baseDir, TEAM_WORK_COMPLETION_SUMMARY_PRECOMPUTE_FEATURE, teamWorkCompletionFileName(params)),
    summaryPayload
  );
  await writeJson(
    path.join(baseDir, TEAM_WORK_COMPLETION_DETAIL_PRECOMPUTE_FEATURE, teamWorkCompletionFileName(params)),
    payload
  );
}

async function ensureManifestIncludesDetailYear(manifestFile, year) {
  const manifest = readJsonFile(manifestFile);
  if (!manifest || typeof manifest !== 'object') {
    return false;
  }
  const numericYear = Number(year);
  const years = Array.isArray(manifest.years) ? manifest.years.map(Number).filter(Number.isInteger) : [];
  if (years.length && !years.includes(numericYear)) {
    return false;
  }
  const detailYears = Array.isArray(manifest.detailYears)
    ? manifest.detailYears.map(Number).filter(Number.isInteger)
    : [];
  if (detailYears.includes(numericYear)) {
    return true;
  }
  const nextDetailYears = Array.from(new Set([...detailYears, numericYear])).sort((a, b) => a - b);
  await writeJson(manifestFile, {
    ...manifest,
    detailYears: nextDetailYears,
  });
  return true;
}

async function removePathWithRetry(target, options = {}) {
  const retries = Number(options.retries) > 0 ? Number(options.retries) : 3;
  const retryDelayMs = Number(options.retryDelayMs) > 0 ? Number(options.retryDelayMs) : 120;
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await fsp.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function replaceDirectory(sourceDir, destinationDir) {
  if (fs.existsSync(destinationDir)) {
    await removePathWithRetry(destinationDir);
  }
  try {
    await fsp.rename(sourceDir, destinationDir);
    return;
  } catch (error) {
    const retriable = ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'EXDEV'];
    if (!retriable.includes(error?.code)) {
      throw error;
    }
  }
  await fsp.cp(sourceDir, destinationDir, { recursive: true });
  await removePathWithRetry(sourceDir);
}

async function cleanupStalePrecomputeTempDirs(config = {}) {
  const baseDir = precomputeBaseDir(config);
  let entries;
  try {
    entries = await fsp.readdir(baseDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.includes('.tmp-')) {
      continue;
    }
    await removePathWithRetry(path.join(baseDir, entry.name)).catch(() => {});
  }
}

function buildProjectCatalogSummary(snapshot = {}) {
  const projects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
  return {
    items: compactProjectsForReadModel(projects),
    total: projects.length,
    view: 'summary',
    fieldCatalog: Array.isArray(snapshot.fieldCatalog) ? snapshot.fieldCatalog : [],
    readOnly: true,
  };
}

function buildProfileDashboard(snapshot = {}, architecture = {}, profile = 'department') {
  const projects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
  const scopedProjects =
    profile === 'department'
      ? []
      : filterProjects(projects, { profile }, { personnelArchitecture: architecture });
  return {
    profile,
    metrics: composeDashboardMetrics(projects, profile, {
      dashboardContext: profile === 'department' ? 'all' : profile,
      personnelArchitecture: architecture,
    }),
    projects: compactProjectsForReadModel(scopedProjects),
    readOnly: true,
  };
}

function completionMetricSummary(metric = {}) {
  return {
    completedCount: Number(metric.completedCount || 0),
    inProgressCount: Number(metric.inProgressCount || 0),
    missingDateCount: Number(metric.missingDateCount || 0),
  };
}

function completionMonthlySummary(month = {}) {
  const { projectIds: _projectIds, ...rest } = month || {};
  return rest;
}

function completionGroupSummary(group = {}) {
  const { projectIds: _projectIds, monthly = {}, summary = {}, ...rest } = group || {};
  return {
    ...rest,
    summary: {
      floorPlan: completionMetricSummary(summary.floorPlan),
      display: completionMetricSummary(summary.display),
      lifecycle: completionMetricSummary(summary.lifecycle),
    },
    monthly: {
      months: Array.isArray(monthly.months) ? monthly.months.map(completionMonthlySummary) : [],
    },
  };
}

function completionMemberSummary(member = {}) {
  const { projectIds: _projectIds, projectRows: _projectRows, summary = {}, ...rest } = member || {};
  return {
    ...rest,
    summary: {
      floorPlan: completionMetricSummary(summary.floorPlan),
      display: completionMetricSummary(summary.display),
      lifecycle: completionMetricSummary(summary.lifecycle),
    },
  };
}

function dataQualitySummary(dataQuality = {}) {
  return {
    unmappedMemberCount: Number(dataQuality.unmappedMemberCount || 0),
    missingDateCompletionCount: Number(dataQuality.missingDateCompletionCount || 0),
    weakProjectKeyCount: Number(dataQuality.weakProjectKeyCount || 0),
    notesCount: Array.isArray(dataQuality.notes) ? dataQuality.notes.length : 0,
  };
}

function buildTeamWorkCompletionSummaryPayload(payload = {}) {
  const {
    projectsById: _projectsById,
    sourceProjects: _sourceProjects,
    projectDetailsById: _projectDetailsById,
    dataQuality,
    summary = {},
    monthly = {},
    groups = [],
    members = [],
    ...rest
  } = payload || {};
  return {
    ...rest,
    summary: {
      floorPlan: completionMetricSummary(summary.floorPlan),
      display: completionMetricSummary(summary.display),
      lifecycle: completionMetricSummary(summary.lifecycle),
    },
    monthly: {
      months: Array.isArray(monthly.months) ? monthly.months.map(completionMonthlySummary) : [],
    },
    groups: Array.isArray(groups) ? groups.map(completionGroupSummary) : [],
    members: Array.isArray(members) ? members.map(completionMemberSummary) : [],
    dataQualitySummary: dataQualitySummary(dataQuality),
    readOnly: true,
  };
}

async function publishPrecomputeDirectory(config, snapshotHash, tmpDir, options = {}) {
  const baseDir = precomputeBaseDir(config);
  const finalDir = precomputeDirForHash(config, snapshotHash);
  const existingManifest = readManifest(config, snapshotHash);
  if (
    options.force !== true &&
    existingManifest &&
    manifestHasFeatures(existingManifest, COMPLETE_PRECOMPUTE_FEATURES) &&
    precomputeFilesComplete(config, snapshotHash, existingManifest)
  ) {
    await removeDirectoryInside(baseDir, tmpDir);
    return finalDir;
  }
  await replaceDirectory(tmpDir, finalDir);
  return finalDir;
}

async function cleanupOldPrecomputeDirectories(config, currentSnapshotHash) {
  const baseDir = precomputeBaseDir(config);
  const retain = Number(config.precomputeRetainedVersions || DEFAULT_RETAINED_PRECOMPUTE_VERSIONS);
  if (!Number.isInteger(retain) || retain < 1) {
    return;
  }
  let entries;
  try {
    entries = await fsp.readdir(baseDir, { withFileTypes: true });
  } catch {
    return;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.includes('.tmp-')) {
      continue;
    }
    const dir = path.join(baseDir, entry.name);
    const manifest = readJsonFile(path.join(dir, 'manifest.json'));
    if (!manifest?.snapshotHash) {
      continue;
    }
    const stat = await fsp.stat(dir);
    candidates.push({ name: entry.name, dir, mtimeMs: stat.mtimeMs });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keep = new Set(candidates.slice(0, retain).map((entry) => entry.name));
  keep.add(currentSnapshotHash);
  for (const entry of candidates) {
    if (!keep.has(entry.name)) {
      await removeDirectoryInside(baseDir, entry.dir);
    }
  }
}

export async function precomputeTeamDashboards(snapshot = {}, options = {}) {
  const config = options.config || {};
  const architecture = snapshot.personnelArchitecture || {};
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  if (options.force !== true) {
    const existingManifest = hasCompletePrecompute(snapshot, config);
    if (existingManifest) {
      if (!readModelCurrentComplete(config, existingManifest)) {
        await publishReadModelDirectory(config, precomputeDirForHash(config, snapshotHash));
      }
      return existingManifest;
    }
  }
  const baseDir = precomputeBaseDir(config);
  await fsp.mkdir(baseDir, { recursive: true });
  await cleanupStalePrecomputeTempDirs(config);
  const tmpDir = path.join(baseDir, `${snapshotHash}.tmp-${process.pid}-${Date.now()}`);
  const contexts = normalizeContexts(options.contexts);
  const yearPlan = normalizePrecomputeYearPlan(snapshot, options);
  const years = yearPlan.years;
  const detailYears = normalizePrecomputeDetailYears(years, options);
  const detailYearSet = new Set(detailYears.map((year) => Number(year)));
  const owners = ownersFromSnapshot(snapshot, architecture);
  const generatedAt = (options.now || new Date()).toISOString();
  const asOfDate = resolvePrecomputeAsOfDate(options);
  const manifest = {
    schemaVersion: PRECOMPUTE_SCHEMA_VERSION,
    readModel: true,
    snapshotHash,
    syncedAt: snapshot.syncedAt || '',
    createdAt: generatedAt,
    generatedAt,
    asOfDate,
    source: snapshot.source || '',
    storage: snapshot.storage || '',
    totalRecords: Number(snapshot.totalRecords || 0),
    features: COMPLETE_PRECOMPUTE_FEATURES,
    owners: owners.map((owner) => ({ owner, key: hashToken(owner) })),
    contexts,
    years,
    detailYears,
    excludedYears: yearPlan.excludedYears,
    yearWindow: yearPlan.yearWindow,
  };

  await fsp.mkdir(path.join(tmpDir, DASHBOARD_SESSION_PRECOMPUTE_FEATURE), { recursive: true });
  await fsp.mkdir(path.join(tmpDir, 'project-catalog'), { recursive: true });
  await fsp.mkdir(path.join(tmpDir, PROJECT_DETAIL_PRECOMPUTE_FEATURE), { recursive: true });
  await fsp.mkdir(path.join(tmpDir, PROFILE_DASHBOARD_PRECOMPUTE_FEATURE), { recursive: true });
  await fsp.mkdir(path.join(tmpDir, TEAM_RESPONSIBILITY_REVIEW_PRECOMPUTE_FEATURE), { recursive: true });
  await fsp.mkdir(path.join(tmpDir, TEAM_WORK_COMPLETION_SUMMARY_PRECOMPUTE_FEATURE), { recursive: true });
  await fsp.mkdir(path.join(tmpDir, TEAM_WORK_COMPLETION_DETAIL_PRECOMPUTE_FEATURE), { recursive: true });
  await fsp.mkdir(path.join(tmpDir, TEAM_METRICS_PRECOMPUTE_FEATURE), { recursive: true });
  try {
    const metricsByContext = new Map();
    const workCompletionByKey = new Map();
    const responsibilityByKey = new Map();
    const projectCatalog = buildProjectCatalogSummary(snapshot);
    const profileDashboards = {
      department: buildProfileDashboard(snapshot, architecture, 'department'),
      direct: buildProfileDashboard(snapshot, architecture, 'direct'),
      franchise: buildProfileDashboard(snapshot, architecture, 'franchise'),
    };
    await writeJson(projectCatalogSummaryFilePath(tmpDir), projectCatalog);
    await writeProjectDetailReadModels(tmpDir, snapshot.projects || []);
    for (const [profile, payload] of Object.entries(profileDashboards)) {
      await writeJson(profileDashboardFilePath(tmpDir, profile), payload);
    }

    for (const dashboardContext of contexts) {
      const ownerRates = buildTeamOwnerRates(snapshot.projects || [], architecture, dashboardContext);
      const metricsByOwner = {};
      for (const owner of owners) {
        metricsByOwner[owner] = buildTeamMetricsPayload(config, snapshot, architecture, owner, dashboardContext, {
          ownerRates,
        });
      }
      metricsByContext.set(dashboardContext, metricsByOwner);
      await writeJson(path.join(tmpDir, TEAM_METRICS_PRECOMPUTE_FEATURE, teamMetricsFileName(dashboardContext)), {
        readOnly: true,
        dashboardContext,
        owners,
        metricsByOwner,
      });
    }

    for (const owner of owners) {
      const team = resolveTeamForOwner(owner, architecture);
      for (const dashboardContext of contexts) {
        const responsibilityReview = buildTeamResponsibilityReview(snapshot.projects || [], team, {
          dashboardContext,
          personnelArchitecture: architecture,
          today: asOfDate,
        });
        responsibilityByKey.set(`${owner}\0${dashboardContext}`, responsibilityReview);
        await writeJson(
          path.join(
            tmpDir,
            TEAM_RESPONSIBILITY_REVIEW_PRECOMPUTE_FEATURE,
            teamResponsibilityReviewFileName({ owner, dashboardContext })
          ),
          responsibilityReview
        );

        for (const year of years) {
          const payload = buildTeamWorkCompletionReview(snapshot.projects || [], team, {
            requestedOwner: owner,
            dashboardContext,
            personnelArchitecture: architecture,
            year,
            today: asOfDate,
          });
          const summaryPayload = buildTeamWorkCompletionSummaryPayload(payload);
          workCompletionByKey.set(`${owner}\0${dashboardContext}\0${year}`, summaryPayload);
          await writeJson(
            path.join(
              tmpDir,
              TEAM_WORK_COMPLETION_SUMMARY_PRECOMPUTE_FEATURE,
              teamWorkCompletionFileName({ owner, dashboardContext, year })
            ),
            summaryPayload
          );
          if (detailYearSet.has(Number(year))) {
            await writeJson(
              path.join(
                tmpDir,
                TEAM_WORK_COMPLETION_DETAIL_PRECOMPUTE_FEATURE,
                teamWorkCompletionFileName({ owner, dashboardContext, year })
              ),
              payload
            );
          }
        }
      }
    }

    const defaultOwner = owners[0] || '';
    const defaultContext = contexts.includes('all') ? 'all' : contexts[0] || 'all';
    const defaultYear = detailYears[0] || years[0] || new Date().getFullYear();
    const dashboardSessionPayload = buildDashboardSessionPayload({
      config,
      snapshot,
      snapshotHash,
      architecture,
      generatedAt,
      features: manifest.features,
      owner: defaultOwner,
      dashboardContext: defaultContext,
      year: defaultYear,
      metrics: metricsByContext.get(defaultContext)?.[defaultOwner] || null,
      workCompletion: workCompletionByKey.get(`${defaultOwner}\0${defaultContext}\0${defaultYear}`) || null,
      responsibilityReview: responsibilityByKey.get(`${defaultOwner}\0${defaultContext}`) || null,
    });
    await writeJson(path.join(tmpDir, DASHBOARD_SESSION_PRECOMPUTE_FEATURE, 'core.json'), dashboardSessionPayload);
    await writeJson(
      path.join(tmpDir, DASHBOARD_SESSION_PRECOMPUTE_FEATURE, 'shell.json'),
      buildDashboardSessionShellPayload(dashboardSessionPayload, manifest, {
        config,
        dashboardContext: defaultContext,
        year: defaultYear,
      })
    );

    await writeJson(path.join(tmpDir, 'manifest.json'), manifest);
    const publishedDir = await publishPrecomputeDirectory(config, snapshotHash, tmpDir, {
      force: options.force === true,
    });
    await publishReadModelDirectory(config, publishedDir);
    config.precomputeIndex = null;
    await cleanupOldPrecomputeDirectories(config, snapshotHash);
    return manifest;
  } catch (error) {
    await removeDirectoryInside(baseDir, tmpDir).catch(() => {});
    throw error;
  }
}

export async function repairTeamWorkCompletionReadModelSidecars(snapshot = {}, options = {}) {
  const config = options.config || {};
  const architecture = snapshot.personnelArchitecture || {};
  const owner = String(options.owner || '').trim();
  if (!owner) {
    return { repaired: false, reason: 'owner is required' };
  }
  const dashboardContext = normalizeContexts([options.dashboardContext])[0] || 'all';
  const year = normalizeYears([options.year], options.now)[0];
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const asOfDate = resolvePrecomputeAsOfDate(options);
  const team = resolveTeamForOwner(owner, architecture);
  const payload = buildTeamWorkCompletionReview(snapshot.projects || [], team, {
    requestedOwner: options.requestedOwner || owner,
    dashboardContext,
    personnelArchitecture: architecture,
    year,
    today: asOfDate,
  });
  const summaryPayload = buildTeamWorkCompletionSummaryPayload(payload);
  const params = { owner, dashboardContext, year };
  const targets = [];

  const precomputeManifest = readManifest(config, snapshotHash);
  if (precomputeManifest?.snapshotHash === snapshotHash) {
    targets.push({
      baseDir: precomputeDirForHash(config, snapshotHash),
      manifestFile: manifestPath(config, snapshotHash),
    });
  }

  const readModelDir = currentReadModelDir(config);
  const readModelManifest = readJsonFile(path.join(readModelDir, 'manifest.json'));
  if (
    readModelManifest?.snapshotHash === snapshotHash &&
    readModelManifest?.schemaVersion === PRECOMPUTE_SCHEMA_VERSION &&
    readModelManifest?.readModel === true
  ) {
    targets.push({
      baseDir: readModelDir,
      manifestFile: path.join(readModelDir, 'manifest.json'),
    });
  }

  if (!targets.length) {
    return { repaired: false, reason: 'matching read model directory is missing', snapshotHash };
  }

  const seen = new Set();
  let repairedTargets = 0;
  for (const target of targets) {
    const resolvedBaseDir = path.resolve(target.baseDir);
    if (seen.has(resolvedBaseDir)) {
      continue;
    }
    seen.add(resolvedBaseDir);
    await writeTeamWorkCompletionSidecars(resolvedBaseDir, params, payload, summaryPayload);
    await ensureManifestIncludesDetailYear(target.manifestFile, year);
    repairedTargets += 1;
  }

  return {
    repaired: repairedTargets > 0,
    snapshotHash,
    owner,
    dashboardContext,
    year,
    targets: repairedTargets,
  };
}

export async function repairProjectDetailReadModelSidecars(snapshot = {}, options = {}) {
  const config = options.config || {};
  const architecture = snapshot.personnelArchitecture || {};
  const projectId = String(options.projectId || '').trim();
  if (!projectId) {
    return { repaired: false, reason: 'project id is required' };
  }
  const project = findProjectForDetailReadModel(snapshot.projects || [], projectId);
  if (!project) {
    return { repaired: false, reason: 'project is missing from current snapshot', projectId };
  }
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const detail = compactProjectForDetailReadModel(project);
  const targets = [];

  const precomputeManifest = readManifest(config, snapshotHash);
  const precomputeDir = precomputeDirForHash(config, snapshotHash);
  if (precomputeManifest?.snapshotHash === snapshotHash && projectDetailIndexIncludes(precomputeDir, projectId)) {
    targets.push(precomputeDir);
  }

  const readModelDir = currentReadModelDir(config);
  const readModelManifest = readJsonFile(path.join(readModelDir, 'manifest.json'));
  if (
    readModelManifest?.snapshotHash === snapshotHash &&
    readModelManifest?.schemaVersion === PRECOMPUTE_SCHEMA_VERSION &&
    readModelManifest?.readModel === true &&
    projectDetailIndexIncludes(readModelDir, projectId)
  ) {
    targets.push(readModelDir);
  }

  if (!targets.length) {
    return { repaired: false, reason: 'matching project detail read model directory is missing', snapshotHash, projectId };
  }

  const seen = new Set();
  let repairedTargets = 0;
  for (const targetDir of targets) {
    const resolvedDir = path.resolve(targetDir);
    if (seen.has(resolvedDir)) {
      continue;
    }
    seen.add(resolvedDir);
    await writeJson(projectDetailFilePath(resolvedDir, projectId), detail);
    repairedTargets += 1;
  }

  return {
    repaired: repairedTargets > 0,
    snapshotHash,
    projectId,
    targets: repairedTargets,
  };
}

export function readPrecomputedTeamResponsibilityReview(config = {}, snapshot = {}, architecture = {}, params = {}) {
  if (params.month) {
    return null;
  }
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const manifest = readManifest(config, snapshotHash);
  if (!manifestHasFeature(manifest, TEAM_RESPONSIBILITY_REVIEW_PRECOMPUTE_FEATURE)) {
    return null;
  }
  const payload = readJsonFile(teamResponsibilityReviewFilePath(config, snapshotHash, params));
  return teamResponsibilityReviewMatchesScope(payload, params) ? payload : null;
}

export function readPrecomputedTeamWorkCompletion(config = {}, snapshot = {}, architecture = {}, params = {}) {
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const manifest = readManifest(config, snapshotHash);
  if (!manifestHasFeature(manifest, TEAM_WORK_COMPLETION_SUMMARY_PRECOMPUTE_FEATURE)) {
    return null;
  }

  const payload = readJsonFile(teamWorkCompletionSummaryFilePath(config, snapshotHash, params));
  if (!teamWorkCompletionMatchesScope(payload, params) || !teamWorkCompletionHasProcessingQueues(payload)) {
    return null;
  }
  if (!teamWorkCompletionMatchesAsOfDate(payload, params)) {
    return null;
  }
  if (params.requestedOwner && payload.requestedOwner !== params.requestedOwner) {
    return {
      ...payload,
      requestedOwner: params.requestedOwner,
    };
  }
  return payload;
}

export function readPrecomputedTeamWorkCompletionDetail(config = {}, snapshot = {}, architecture = {}, params = {}) {
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const manifest = readManifest(config, snapshotHash);
  if (!manifestHasFeature(manifest, TEAM_WORK_COMPLETION_DETAIL_PRECOMPUTE_FEATURE)) {
    return null;
  }

  const payload = readJsonFile(teamWorkCompletionDetailFilePath(config, snapshotHash, params));
  if (!teamWorkCompletionMatchesScope(payload, params) || !teamWorkCompletionHasProcessingQueues(payload)) {
    return null;
  }
  if (!teamWorkCompletionMatchesAsOfDate(payload, params)) {
    return null;
  }
  if (params.requestedOwner && payload.requestedOwner !== params.requestedOwner) {
    return {
      ...payload,
      requestedOwner: params.requestedOwner,
    };
  }
  return payload;
}

export function readPrecomputedTeamMetricsBatch(config = {}, snapshot = {}, architecture = {}, params = {}) {
  const dashboardContext = params.dashboardContext || 'all';
  const owners = Array.isArray(params.owners) ? params.owners.filter(Boolean) : [];
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const manifest = readManifest(config, snapshotHash);
  if (!manifestHasFeature(manifest, TEAM_METRICS_PRECOMPUTE_FEATURE)) {
    return null;
  }

  const payload = readJsonFile(teamMetricsFilePath(config, snapshotHash, dashboardContext));
  if (!payload || payload.dashboardContext !== dashboardContext || !payload.metricsByOwner) {
    return null;
  }

  const metricsByOwner = {};
  for (const owner of owners) {
    const metrics = payload.metricsByOwner[owner];
    if (!metrics) {
      return null;
    }
    metricsByOwner[owner] = metrics;
  }

  return {
    readOnly: true,
    dashboardContext,
    owners,
    metricsByOwner,
  };
}

export function readPrecomputedDashboardSession(config = {}, snapshot = {}, architecture = {}, params = {}) {
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const manifest = readManifest(config, snapshotHash);
  if (!manifestHasFeature(manifest, DASHBOARD_SESSION_PRECOMPUTE_FEATURE)) {
    return null;
  }

  const payload = readJsonFile(dashboardSessionFilePath(config, snapshotHash));
  if (!payload || payload.schemaVersion !== PRECOMPUTE_SCHEMA_VERSION || payload.snapshotHash !== snapshotHash) {
    return null;
  }

  const owner = params.owner || payload.team?.owner || '';
  const dashboardContext = params.dashboardContext || payload.team?.dashboardContext || 'all';
  const year = Number(params.year || payload.team?.year || new Date().getFullYear());
  if (!owner) {
    return payload;
  }

  const metrics = readPrecomputedTeamMetricsBatch(config, snapshot, architecture, {
    owners: [owner],
    dashboardContext,
  });
  const workCompletionSummary = readPrecomputedTeamWorkCompletion(config, snapshot, architecture, {
    owner,
    requestedOwner: params.requestedOwner || owner,
    dashboardContext,
    year,
    today: params.today,
    asOfDate: params.asOfDate,
  });
  const workCompletionDetail = readPrecomputedTeamWorkCompletionDetail(config, snapshot, architecture, {
    owner,
    requestedOwner: params.requestedOwner || owner,
    dashboardContext,
    year,
    today: params.today,
    asOfDate: params.asOfDate,
  });
  const responsibilityReview = readPrecomputedTeamResponsibilityReview(config, snapshot, architecture, {
    owner,
    dashboardContext,
  });
  if (!metrics || !workCompletionSummary || !workCompletionDetail || !responsibilityReview) {
    return null;
  }
  const workCompletion = mergeTeamWorkCompletionDetailPayload(workCompletionSummary, workCompletionDetail);

  return {
    ...payload,
    team: {
      owner,
      dashboardContext,
      year,
      metrics: metrics.metricsByOwner[owner],
      workCompletion,
      responsibilityReview,
    },
  };
}
