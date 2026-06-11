import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { paths } from './config.mjs';
import { composeDashboardMetrics } from './metrics/composeDashboard.mjs';
import { DASHBOARD_CONTEXTS, resolveCanonicalOwner } from './metrics/projectScopes.mjs';
import { readProjectOwnerNames, splitPersonnelNames } from './personnelNames.mjs';
import { createFilterOptions } from './projectData.mjs';
import { buildTeamMetricsPayload, resolveTeamForOwner } from './teamMetricsPayload.mjs';
import { buildTeamOwnerRates } from './teamInsights.mjs';
import { buildTeamResponsibilityReview } from './teamResponsibilityReview.mjs';
import { buildTeamWorkCompletionReview } from './teamWorkCompletionReview.mjs';

export const DASHBOARD_SESSION_PRECOMPUTE_FEATURE = 'dashboard-session';
export const TEAM_RESPONSIBILITY_REVIEW_PRECOMPUTE_FEATURE = 'team-responsibility-review';
export const TEAM_WORK_COMPLETION_PRECOMPUTE_FEATURE = 'team-work-completion';
export const TEAM_METRICS_PRECOMPUTE_FEATURE = 'team-metrics';
const PRECOMPUTE_SCHEMA_VERSION = 1;
const DEFAULT_RETAINED_PRECOMPUTE_VERSIONS = 3;
const COMPLETE_PRECOMPUTE_FEATURES = [
  DASHBOARD_SESSION_PRECOMPUTE_FEATURE,
  TEAM_RESPONSIBILITY_REVIEW_PRECOMPUTE_FEATURE,
  TEAM_WORK_COMPLETION_PRECOMPUTE_FEATURE,
  TEAM_METRICS_PRECOMPUTE_FEATURE,
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

function teamWorkCompletionFilePath(config = {}, snapshotHash, params = {}) {
  return path.join(
    precomputeDirForHash(config, snapshotHash),
    TEAM_WORK_COMPLETION_PRECOMPUTE_FEATURE,
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
    return cached;
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

export function hasCompletePrecompute(snapshot = {}, config = {}) {
  const architecture = snapshot.personnelArchitecture || {};
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const manifest = readManifest(config, snapshotHash);
  return manifestHasFeatures(manifest, COMPLETE_PRECOMPUTE_FEATURES) ? manifest : null;
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
  metrics = null,
  workCompletion = null,
  responsibilityReview = null,
} = {}) {
  return {
    schemaVersion: PRECOMPUTE_SCHEMA_VERSION,
    readOnly: true,
    snapshotHash,
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
  await fsp.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
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

async function publishPrecomputeDirectory(config, snapshotHash, tmpDir) {
  const baseDir = precomputeBaseDir(config);
  const finalDir = precomputeDirForHash(config, snapshotHash);
  const existingManifest = readManifest(config, snapshotHash);
  if (existingManifest && manifestHasFeatures(existingManifest, COMPLETE_PRECOMPUTE_FEATURES)) {
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
  const baseDir = precomputeBaseDir(config);
  await fsp.mkdir(baseDir, { recursive: true });
  await cleanupStalePrecomputeTempDirs(config);
  const tmpDir = path.join(baseDir, `${snapshotHash}.tmp-${process.pid}-${Date.now()}`);
  const contexts = normalizeContexts(options.contexts);
  const years = normalizeYears(options.years, options.now);
  const owners = ownersFromSnapshot(snapshot, architecture);
  const manifest = {
    schemaVersion: PRECOMPUTE_SCHEMA_VERSION,
    snapshotHash,
    syncedAt: snapshot.syncedAt || '',
    createdAt: (options.now || new Date()).toISOString(),
    source: snapshot.source || '',
    storage: snapshot.storage || '',
    totalRecords: Number(snapshot.totalRecords || 0),
    features: COMPLETE_PRECOMPUTE_FEATURES,
    owners: owners.map((owner) => ({ owner, key: hashToken(owner) })),
    contexts,
    years,
  };

  await fsp.mkdir(path.join(tmpDir, DASHBOARD_SESSION_PRECOMPUTE_FEATURE), { recursive: true });
  await fsp.mkdir(path.join(tmpDir, TEAM_RESPONSIBILITY_REVIEW_PRECOMPUTE_FEATURE), { recursive: true });
  await fsp.mkdir(path.join(tmpDir, TEAM_WORK_COMPLETION_PRECOMPUTE_FEATURE), { recursive: true });
  await fsp.mkdir(path.join(tmpDir, TEAM_METRICS_PRECOMPUTE_FEATURE), { recursive: true });
  try {
    const metricsByContext = new Map();
    const workCompletionByKey = new Map();
    const responsibilityByKey = new Map();

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
          });
          workCompletionByKey.set(`${owner}\0${dashboardContext}\0${year}`, payload);
          await writeJson(
            path.join(
              tmpDir,
              TEAM_WORK_COMPLETION_PRECOMPUTE_FEATURE,
              teamWorkCompletionFileName({ owner, dashboardContext, year })
            ),
            payload
          );
        }
      }
    }

    const defaultOwner = owners[0] || '';
    const defaultContext = contexts.includes('all') ? 'all' : contexts[0] || 'all';
    const defaultYear = years[0] || new Date().getFullYear();
    await writeJson(
      path.join(tmpDir, DASHBOARD_SESSION_PRECOMPUTE_FEATURE, 'core.json'),
      buildDashboardSessionPayload({
        config,
        snapshot,
        snapshotHash,
        architecture,
        owner: defaultOwner,
        dashboardContext: defaultContext,
        year: defaultYear,
        metrics: metricsByContext.get(defaultContext)?.[defaultOwner] || null,
        workCompletion: workCompletionByKey.get(`${defaultOwner}\0${defaultContext}\0${defaultYear}`) || null,
        responsibilityReview: responsibilityByKey.get(`${defaultOwner}\0${defaultContext}`) || null,
      })
    );

    await writeJson(path.join(tmpDir, 'manifest.json'), manifest);
    await publishPrecomputeDirectory(config, snapshotHash, tmpDir);
    config.precomputeIndex = null;
    await cleanupOldPrecomputeDirectories(config, snapshotHash);
    return manifest;
  } catch (error) {
    await removeDirectoryInside(baseDir, tmpDir).catch(() => {});
    throw error;
  }
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
  return readJsonFile(teamResponsibilityReviewFilePath(config, snapshotHash, params));
}

export function readPrecomputedTeamWorkCompletion(config = {}, snapshot = {}, architecture = {}, params = {}) {
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const manifest = readManifest(config, snapshotHash);
  if (!manifestHasFeature(manifest, TEAM_WORK_COMPLETION_PRECOMPUTE_FEATURE)) {
    return null;
  }

  const payload = readJsonFile(teamWorkCompletionFilePath(config, snapshotHash, params));
  if (!payload) {
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
  const workCompletion = readPrecomputedTeamWorkCompletion(config, snapshot, architecture, {
    owner,
    requestedOwner: params.requestedOwner || owner,
    dashboardContext,
    year,
  });
  const responsibilityReview = readPrecomputedTeamResponsibilityReview(config, snapshot, architecture, {
    owner,
    dashboardContext,
  });
  if (!metrics || !workCompletion || !responsibilityReview) {
    return null;
  }

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
