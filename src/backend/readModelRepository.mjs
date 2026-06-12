import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { paths } from './config.mjs';
import { mergeTeamWorkCompletionDetailPayload } from './teamWorkCompletionPayload.mjs';

export const READ_MODEL_SCHEMA_VERSION = 10;
const CURRENT_READ_MODEL_SCHEMA_VERSIONS = new Set([READ_MODEL_SCHEMA_VERSION]);
export const DASHBOARD_SESSION_READ_MODEL_FEATURE = 'dashboard-session';
export const PROJECT_CATALOG_SUMMARY_READ_MODEL_FEATURE = 'project-catalog-summary';
export const PROJECT_DETAIL_READ_MODEL_FEATURE = 'project-detail';
export const PROFILE_DASHBOARD_READ_MODEL_FEATURE = 'profile-dashboard';
export const TEAM_METRICS_READ_MODEL_FEATURE = 'team-metrics';
export const TEAM_WORK_COMPLETION_READ_MODEL_FEATURE = 'team-work-completion';
export const TEAM_WORK_COMPLETION_SUMMARY_READ_MODEL_FEATURE = 'team-work-completion-summary';
export const TEAM_WORK_COMPLETION_DETAIL_READ_MODEL_FEATURE = 'team-work-completion-detail';
export const TEAM_RESPONSIBILITY_REVIEW_READ_MODEL_FEATURE = 'team-responsibility-review';

const MIN_DASHBOARD_SESSION_SCHEMA_VERSION = 5;

export const REQUIRED_READ_MODEL_FEATURES = [
  DASHBOARD_SESSION_READ_MODEL_FEATURE,
  PROJECT_CATALOG_SUMMARY_READ_MODEL_FEATURE,
  PROJECT_DETAIL_READ_MODEL_FEATURE,
  PROFILE_DASHBOARD_READ_MODEL_FEATURE,
  TEAM_METRICS_READ_MODEL_FEATURE,
  TEAM_WORK_COMPLETION_READ_MODEL_FEATURE,
  TEAM_WORK_COMPLETION_SUMMARY_READ_MODEL_FEATURE,
  TEAM_WORK_COMPLETION_DETAIL_READ_MODEL_FEATURE,
  TEAM_RESPONSIBILITY_REVIEW_READ_MODEL_FEATURE,
];
const DASHBOARD_SESSION_REQUIRED_READ_MODEL_FEATURES = REQUIRED_READ_MODEL_FEATURES.filter(
  (feature) => feature !== PROJECT_DETAIL_READ_MODEL_FEATURE
);

export function readModelBaseDir(config = {}) {
  if (config.readModelDir) {
    return path.resolve(config.readModelDir);
  }
  if (config.dataDir) {
    return path.resolve(config.dataDir, 'read-model');
  }
  if (config.precomputeDir) {
    return path.resolve(path.dirname(config.precomputeDir), 'read-model');
  }
  return path.resolve(paths.dataDir, 'read-model');
}

export function currentReadModelDir(config = {}) {
  return path.join(readModelBaseDir(config), 'current');
}

function lastKnownGoodReadModelDir(config = {}) {
  return path.join(readModelBaseDir(config), 'last-known-good');
}

export function hashToken(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 16);
}

function safeSegment(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+$/, '_')
    .slice(0, 80);
}

function teamWorkCompletionFileName({ owner, dashboardContext, year }) {
  return `${hashToken(owner)}__${safeSegment(dashboardContext || 'all')}__${safeSegment(year)}.json`;
}

function projectDetailFileName(projectId = '') {
  return `${hashToken(projectId)}.json`;
}

function teamResponsibilityReviewFileName({ owner, dashboardContext }) {
  return `${hashToken(owner)}__${safeSegment(dashboardContext || 'all')}.json`;
}

function teamMetricsFileName(dashboardContext = 'all') {
  return `${safeSegment(dashboardContext || 'all')}.json`;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
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

async function cleanupReadModelTempDirs(baseDir, { maxAgeMs = 60 * 60 * 1000, now = Date.now() } = {}) {
  let entries;
  try {
    entries = await fsp.readdir(baseDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('current.tmp-')) {
      continue;
    }
    const tempDir = path.join(baseDir, entry.name);
    let stat;
    try {
      stat = await fsp.stat(tempDir);
    } catch {
      continue;
    }
    if (now - stat.mtimeMs < maxAgeMs) {
      continue;
    }
    await removePathWithRetry(tempDir).catch(() => {});
  }
}

function currentSchemaVersion(version) {
  return CURRENT_READ_MODEL_SCHEMA_VERSIONS.has(version);
}

function dashboardSessionSchemaVersion(version) {
  const numeric = Number(version);
  return Number.isInteger(numeric) && numeric >= MIN_DASHBOARD_SESSION_SCHEMA_VERSION && numeric <= READ_MODEL_SCHEMA_VERSION;
}

function manifestIsComplete(
  manifest,
  {
    requiredFeatures = REQUIRED_READ_MODEL_FEATURES,
    acceptsSchemaVersion = currentSchemaVersion,
  } = {}
) {
  return (
    acceptsSchemaVersion(manifest?.schemaVersion) &&
    manifest.readModel === true &&
    requiredFeatures.every((feature) => manifest.features?.includes(feature))
  );
}

function readManifest(dir) {
  const manifest = readJsonFile(path.join(dir, 'manifest.json'));
  if (!manifest) {
    return null;
  }
  return manifest;
}

function readProfileDashboards(dir, payload = {}) {
  const profiles = { ...(payload.profileDashboards || {}) };
  for (const profile of ['department', 'direct', 'franchise']) {
    if (profiles[profile]) {
      continue;
    }
    const profilePayload = readJsonFile(path.join(dir, 'profile-dashboard', `${profile}.json`));
    if (profilePayload) {
      profiles[profile] = profilePayload;
    }
  }
  return profiles;
}

function readProjectCatalog(dir, payload = {}) {
  return payload.projectCatalog || readJsonFile(path.join(dir, 'project-catalog', 'summary.json')) || null;
}

const PROJECT_BOARD_REQUIRED_FIELDS = [
  'currentYearEntryTotal',
  'currentYearEntryDirect',
  'currentYearEntryFranchise',
  'pausedOrCanceled',
  'pausedProjectTotal',
  'canceledProjectTotal',
  'closedProjectTotal',
  'closedProjectDirect',
  'closedProjectFranchise',
  'previousYearUnclosedTotal',
  'previousYearUnclosedDirect',
  'previousYearUnclosedFranchise',
];

const PROJECT_CATALOG_REQUIRED_SUMMARY_FIELDS = [
  'franchiseScope',
  'hardProgressStage',
  'softProgressStage',
  'stageReminder',
  'workflowFacts',
];

function hasProjectBoardMetrics(metrics = null) {
  const board = metrics?.projectBoard;
  return Boolean(
    board &&
      typeof board === 'object' &&
      PROJECT_BOARD_REQUIRED_FIELDS.every((field) => Number.isFinite(Number(board[field])))
  );
}

function hasDashboardProjectBoard(payload = {}, profileDashboards = {}) {
  return (
    hasProjectBoardMetrics(payload.departmentMetrics) ||
    hasProjectBoardMetrics(profileDashboards?.department?.metrics || profileDashboards?.department)
  );
}

function hasRequiredProjectCatalogSummaryFields(projectCatalog = null) {
  if (!projectCatalog || !Array.isArray(projectCatalog.items)) {
    return false;
  }
  if (projectCatalog.items.length === 0) {
    return true;
  }
  return projectCatalog.items.every((project) => {
    if (!PROJECT_CATALOG_REQUIRED_SUMMARY_FIELDS.every((field) => Object.hasOwn(project || {}, field))) {
      return false;
    }
    return Boolean(
      project?.stageReminder?.currentStage?.key &&
        project?.stageReminder?.primaryReminder &&
        Number.isFinite(Number(project?.stageReminder?.dataGapCount)) &&
        typeof project?.workflowFacts?.lifecycleClosed === 'boolean'
    );
  });
}

function readProjectDetailIndex(dir) {
  return readJsonFile(path.join(dir, PROJECT_DETAIL_READ_MODEL_FEATURE, 'index.json'));
}

function readTeamPayloads(dir, { owner, dashboardContext, year }) {
  if (!owner) {
    return { metrics: null, workCompletion: null, responsibilityReview: null };
  }
  const metricsPayload = readJsonFile(path.join(dir, 'team-metrics', teamMetricsFileName(dashboardContext)));
  const metrics = metricsPayload?.metricsByOwner?.[owner] || null;
  const workCompletion = readJsonFile(
    path.join(dir, 'team-work-completion-summary', teamWorkCompletionFileName({ owner, dashboardContext, year }))
  );
  const workCompletionDetail = readJsonFile(
    path.join(dir, 'team-work-completion-detail', teamWorkCompletionFileName({ owner, dashboardContext, year }))
  );
  const responsibilityReview = readJsonFile(
    path.join(dir, 'team-responsibility-review', teamResponsibilityReviewFileName({ owner, dashboardContext }))
  );
  return { metrics, workCompletion, workCompletionDetail, responsibilityReview };
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

function ownerFromManifest(manifest, owner) {
  const requestedOwner = String(owner || '').trim();
  const owners = Array.isArray(manifest?.owners) ? manifest.owners : [];
  if (requestedOwner) {
    const matchedOwner = owners.find((entry) => {
      if (!entry) {
        return false;
      }
      if (entry.owner === requestedOwner || entry.key === requestedOwner) {
        return true;
      }
      return Array.isArray(entry.aliases) && entry.aliases.includes(requestedOwner);
    });
    return matchedOwner?.owner || requestedOwner;
  }
  const firstOwner = owners[0] || null;
  return firstOwner?.owner || '';
}

function withRuntimeSnapshotFlags(snapshot = {}, config = {}) {
  return {
    ...snapshot,
    dashboardSyncEnabled: Boolean(config.dashboardSyncEnabled),
    dashboardAutoUpdateEnabled: config.dashboardAutoUpdateEnabled !== false,
    developerDocumentationVisible: Boolean(config.devReloadEnabled),
    dashboardDisplayMode: config.devReloadEnabled ? 'development' : 'intranet',
  };
}

function buildReadModelResult(dir, params = {}, { stale = false, currentUnavailableReason = '' } = {}) {
  const manifest = readManifest(dir);
  if (!manifest) {
    return { status: 'missing', payload: null, reason: 'read model manifest is missing' };
  }
  if (
    !manifestIsComplete(manifest, {
      requiredFeatures: DASHBOARD_SESSION_REQUIRED_READ_MODEL_FEATURES,
      acceptsSchemaVersion: dashboardSessionSchemaVersion,
    })
  ) {
    return { status: 'incomplete', payload: null, reason: 'read model manifest is incomplete' };
  }

  const payload = readJsonFile(path.join(dir, 'dashboard-session', 'core.json'));
  if (
    !payload ||
    !dashboardSessionSchemaVersion(payload.schemaVersion) ||
    payload.snapshotHash !== manifest.snapshotHash
  ) {
    return { status: 'incomplete', payload: null, reason: 'dashboard session read model is missing' };
  }

  const owner = ownerFromManifest(manifest, params.owner || payload.team?.owner || '');
  const dashboardContext = params.dashboardContext || payload.team?.dashboardContext || 'all';
  const year = Number(params.year || payload.team?.year || new Date().getFullYear());
  const profileDashboards = readProfileDashboards(dir, payload);
  const projectCatalog = readProjectCatalog(dir, payload);
  if (!projectCatalog) {
    return { status: 'incomplete', payload: null, reason: 'project catalog summary read model is missing' };
  }
  if (!profileDashboards.direct || !profileDashboards.franchise || !profileDashboards.department) {
    return { status: 'incomplete', payload: null, reason: 'profile dashboard read model is missing' };
  }
  if (!hasDashboardProjectBoard(payload, profileDashboards)) {
    return { status: 'incomplete', payload: null, reason: 'dashboard session project board metrics are missing' };
  }
  if (!hasRequiredProjectCatalogSummaryFields(projectCatalog)) {
    return { status: 'incomplete', payload: null, reason: 'project catalog summary workflow fields are missing' };
  }

  const team = readTeamPayloads(dir, { owner, dashboardContext, year });
  if (owner && !team.metrics) {
    return { status: 'incomplete', payload: null, reason: 'team metrics read model is missing' };
  }
  if (owner && !team.workCompletion) {
    return { status: 'incomplete', payload: null, reason: 'team work completion read model is missing' };
  }
  if (owner && !team.workCompletionDetail) {
    return { status: 'incomplete', payload: null, reason: 'team work completion detail read model is missing' };
  }
  if (owner && !team.responsibilityReview) {
    return { status: 'incomplete', payload: null, reason: 'team responsibility review read model is missing' };
  }
  const workCompletion = mergeTeamWorkCompletionDetailPayload(team.workCompletion, team.workCompletionDetail);

  return {
    status: stale ? 'stale' : 'ready',
    payload: {
      ...payload,
      readModel: true,
      stale,
      currentUnavailableReason: currentUnavailableReason || undefined,
      snapshot: withRuntimeSnapshotFlags(payload.snapshot || {}, params.config || {}),
      generatedAt: manifest.generatedAt || manifest.createdAt || payload.generatedAt || '',
      features: manifest.features || [],
      profileDashboards,
      projectCatalog,
      team: {
        owner,
        dashboardContext,
        year,
        metrics: team.metrics,
        workCompletion,
        responsibilityReview: team.responsibilityReview,
      },
    },
  };
}

function buildTeamWorkCompletionDetailReadModelResult(
  dir,
  params = {},
  { stale = false, currentUnavailableReason = '' } = {}
) {
  const manifest = readManifest(dir);
  if (!manifest) {
    return { status: 'missing', payload: null, reason: 'read model manifest is missing' };
  }
  if (!manifestIsComplete(manifest)) {
    return { status: 'incomplete', payload: null, reason: 'read model manifest is incomplete' };
  }

  const owner = ownerFromManifest(manifest, params.owner || '');
  const dashboardContext = params.dashboardContext || 'all';
  const year = Number(params.year || new Date().getFullYear());
  const team = readTeamPayloads(dir, { owner, dashboardContext, year });
  if (!owner || !team.workCompletionDetail) {
    return { status: 'incomplete', payload: null, reason: 'team work completion detail read model is missing' };
  }
  const payload = mergeTeamWorkCompletionDetailPayload(team.workCompletion || {}, team.workCompletionDetail);
  if (!teamWorkCompletionHasProcessingQueues(payload)) {
    return { status: 'incomplete', payload: null, reason: 'team work completion processing queues are missing' };
  }
  return {
    status: stale ? 'stale' : 'ready',
    payload:
      params.requestedOwner && payload?.requestedOwner !== params.requestedOwner
        ? { ...payload, requestedOwner: params.requestedOwner }
        : payload,
    reason: currentUnavailableReason || undefined,
  };
}

function buildProjectDetailReadModelResult(
  dir,
  params = {},
  { stale = false, currentUnavailableReason = '' } = {}
) {
  const manifest = readManifest(dir);
  if (!manifest) {
    return { status: 'missing', payload: null, reason: 'read model manifest is missing' };
  }
  if (!manifestIsComplete(manifest)) {
    return { status: 'incomplete', payload: null, reason: 'read model manifest is incomplete' };
  }

  const projectId = String(params.projectId || '').trim();
  if (!projectId) {
    return { status: 'missing', payload: null, reason: 'project id is required' };
  }
  const index = readProjectDetailIndex(dir);
  if (!index || !Array.isArray(index.projectIds)) {
    return { status: 'incomplete', payload: null, reason: 'project detail read model index is missing' };
  }
  if (!index.projectIds.includes(projectId)) {
    return { status: 'not_found', payload: null, reason: 'project detail read model is not indexed' };
  }

  const payload = readJsonFile(path.join(dir, PROJECT_DETAIL_READ_MODEL_FEATURE, projectDetailFileName(projectId)));
  if (!payload) {
    return { status: 'incomplete', payload: null, reason: 'project detail read model file is missing' };
  }
  return {
    status: stale ? 'stale' : 'ready',
    payload,
    reason: currentUnavailableReason || undefined,
  };
}

export function readDashboardSessionReadModel(config = {}, params = {}) {
  const readParams = { ...params, config };
  return buildReadModelResult(currentReadModelDir(config), readParams);
}

export function readTeamWorkCompletionDetailReadModel(config = {}, params = {}) {
  const readParams = { ...params, config };
  const current = buildTeamWorkCompletionDetailReadModelResult(currentReadModelDir(config), readParams);
  if (current.status === 'ready') {
    return current;
  }

  const stale = buildTeamWorkCompletionDetailReadModelResult(lastKnownGoodReadModelDir(config), readParams, {
    stale: true,
    currentUnavailableReason: current.reason || current.status,
  });
  if (stale.status === 'stale') {
    return stale;
  }
  return current;
}

export function readProjectDetailReadModel(config = {}, params = {}) {
  const readParams = { ...params, config };
  const current = buildProjectDetailReadModelResult(currentReadModelDir(config), readParams);
  if (current.status === 'ready' || current.status === 'not_found') {
    return current;
  }

  const stale = buildProjectDetailReadModelResult(lastKnownGoodReadModelDir(config), readParams, {
    stale: true,
    currentUnavailableReason: current.reason || current.status,
  });
  if (stale.status === 'stale' || stale.status === 'not_found') {
    return stale;
  }
  return current;
}

export async function publishReadModelDirectory(config = {}, sourceDir) {
  const baseDir = readModelBaseDir(config);
  await fsp.mkdir(baseDir, { recursive: true });
  await cleanupReadModelTempDirs(baseDir);
  const currentDir = currentReadModelDir(config);
  const lastKnownGoodDir = lastKnownGoodReadModelDir(config);
  const tmpDir = await fsp.mkdtemp(path.join(baseDir, 'current.tmp-'));
  await fsp.cp(sourceDir, tmpDir, { recursive: true });
  if (fs.existsSync(currentDir)) {
    await replaceDirectory(currentDir, lastKnownGoodDir);
  }
  await replaceDirectory(tmpDir, currentDir);
  return currentDir;
}
