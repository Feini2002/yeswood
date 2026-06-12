import fs from 'node:fs';
import { Worker } from 'node:worker_threads';

import { getConfig } from './config.mjs';
import { openInitializedDatabase } from './database.mjs';
import { createDingTalkClient, fetchAllDingTalkRecords } from './dingtalkClient.mjs';
import { readCachedFieldBindings, saveFieldBindings } from './fieldBindingRepository.mjs';
import { resolveFieldMap, scanSourceFieldKeys } from './fieldResolver.mjs';
import { mockDingTalkRecords } from './mockData.mjs';
import {
  calculateDashboardMetrics,
  cleanProjectRecord,
  createFieldCatalog,
  createFilterOptions,
  enrichProjectsForDisplay,
  isValidProjectRecord,
} from './projectData.mjs';
import {
  seedPersonnelDatabase,
} from './personnelRepository.mjs';
import {
  databaseHasProjects,
  importSnapshotToDatabase,
  readSnapshotFromDatabase,
  scheduleSplitOwnerResponsibilityRefresh,
} from './projectRepository.mjs';
import { logger } from './logger.mjs';
import { hasCompletePrecompute, precomputeSnapshotHash, precomputeTeamDashboards } from './precomputeTeamDashboards.mjs';
import { readPersonnelArchitecture } from './personnelArchitecture.mjs';
import { readSnapshot, writeSnapshot } from './storage.mjs';

function fileVersion(filePath) {
  if (!filePath) {
    return '';
  }
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

function snapshotCacheKey(config = getConfig()) {
  return [
    config.mode || '',
    fileVersion(config.databaseFile),
    fileVersion(config.cacheFile),
    fileVersion(config.personnelDatabaseFile || config.personnelArchitectureFile),
  ].join('|');
}

export function clearSnapshotCache(config = getConfig()) {
  config.snapshotCache = null;
  config.snapshotCachePromise = null;
  config.metricsResponseCache = null;
  config.projectsIdsCache = null;
  config.teamMetricsCache = null;
  config.teamWorkCompletionCache = null;
  config.teamResponsibilityReviewCache = null;
  config.precomputeIndex = null;
}

export function createProjectSnapshot({
  source,
  records,
  fieldMap,
  personnelArchitecture = {},
  fieldMapping = null,
  fieldMappingWarnings = null,
}) {
  const validRecords = records.filter((record) => isValidProjectRecord(record, { fieldMap }));
  const projects = validRecords.map((record) => cleanProjectRecord(record, { fieldMap }));

  return {
    version: 1,
    source,
    readOnly: true,
    syncedAt: new Date().toISOString(),
    sourceRecords: records.length,
    totalRecords: projects.length,
    ignoredRecords: records.length - validRecords.length,
    projects,
    personnelArchitecture,
    fieldMapping: fieldMapping || fieldMap,
    fieldMappingWarnings: fieldMappingWarnings || { unresolved: [], ambiguous: [] },
    fieldCatalog: createFieldCatalog(projects),
    metrics: calculateDashboardMetrics(projects, { personnelArchitecture }),
    filters: createFilterOptions(projects),
  };
}

function resolveSyncFieldMap(records, config, database) {
  const sourceFieldKeys = scanSourceFieldKeys(records);
  return resolveFieldMap(sourceFieldKeys, {
    envFieldMap: config.dingtalk.fieldMap,
    cachedBindings: database ? readCachedFieldBindings(database) : [],
  });
}

function resolveSnapshotFieldMap(snapshot, config) {
  if (snapshot?.fieldMapping && Object.keys(snapshot.fieldMapping).length > 0) {
    return snapshot.fieldMapping;
  }

  const sourceFieldKeys = Array.from(
    new Set(
      (snapshot.projects || []).flatMap((project) => [
        ...Object.keys(project.rawFields || {}),
        ...Object.keys(project.fields || {}),
      ])
    )
  );

  let cachedBindings = [];
  if (config.databaseFile) {
    const database = openInitializedDatabase(config.databaseFile);
    try {
      cachedBindings = readCachedFieldBindings(database);
    } finally {
      database.close();
    }
  }

  return resolveFieldMap(sourceFieldKeys, {
    envFieldMap: config.dingtalk.fieldMap,
    cachedBindings,
  }).fieldMap;
}

function normalizeSnapshot(snapshot, config, personnelArchitecture = {}) {
  const cachedProjects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
  const fieldMap = resolveSnapshotFieldMap(snapshot, config);
  const canonicalProjects = cachedProjects.filter((project) => isValidProjectRecord(project, { fieldMap }));
  const projects = enrichProjectsForDisplay(canonicalProjects, personnelArchitecture);
  const newlyIgnoredRecords = cachedProjects.length - projects.length;
  const ignoredRecords = Number(snapshot.ignoredRecords || 0) + newlyIgnoredRecords;
  const sourceRecords = Number.isFinite(Number(snapshot.sourceRecords))
    ? Number(snapshot.sourceRecords)
    : Number.isFinite(Number(snapshot.totalRecords))
      ? Number(snapshot.totalRecords)
      : cachedProjects.length;

  return {
    ...snapshot,
    sourceRecords,
    totalRecords: projects.length,
    ignoredRecords,
    projects,
    personnelArchitecture,
    fieldMapping: fieldMap,
    fieldCatalog: createFieldCatalog(projects),
    metrics: calculateDashboardMetrics(projects, { personnelArchitecture }),
    filters: createFilterOptions(projects),
  };
}

export async function readConfiguredPersonnelArchitecture(config = getConfig()) {
  const jsonArchitecture = await readPersonnelArchitecture(config.personnelDatabaseFile || config.personnelArchitectureFile);
  if (!config.databaseFile) {
    return jsonArchitecture;
  }

  const database = openInitializedDatabase(config.databaseFile);
  try {
    return seedPersonnelDatabase(database, jsonArchitecture);
  } finally {
    database.close();
  }
}

function precomputeWorkerConfig(config = {}) {
  return {
    dataDir: config.dataDir,
    databaseFile: config.databaseFile,
    precomputeDir: config.precomputeDir,
    readModelDir: config.readModelDir,
    precomputeRetainedVersions: config.precomputeRetainedVersions,
  };
}

function createPrecomputeWorker(snapshot, config = {}, snapshotHash = '') {
  const worker = new Worker(new URL('./precomputeWorker.mjs', import.meta.url), {
    workerData: {
      snapshot,
      config: precomputeWorkerConfig(config),
    },
  });
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    worker.once('message', (message) => {
      settled = true;
      if (message?.ok) {
        resolve(message);
        return;
      }
      reject(new Error(message?.message || 'Dashboard precompute failed'));
    });
    worker.once('error', (error) => {
      if (!settled) {
        reject(error);
      }
    });
    worker.once('exit', (code) => {
      if (!settled && code && code !== 0) {
        reject(new Error(`Dashboard precompute worker exited with code ${code}`));
      }
    });
  }).finally(() => {
    config.precomputePromises?.delete?.(snapshotHash);
    config.precomputeScheduledHashes?.delete?.(snapshotHash);
  });
  if (!config.precomputePromises) {
    config.precomputePromises = new Map();
  }
  config.precomputePromises.set(snapshotHash, promise);
  return { worker, promise };
}

function startPrecomputeWorker(snapshot, config = {}, snapshotHash = '') {
  const { worker, promise } = createPrecomputeWorker(snapshot, config, snapshotHash);
  promise
    .then((message) => {
      logger.info('Dashboard precompute finished', {
        snapshotHash: message.snapshotHash,
        features: message.features,
      });
    })
    .catch((error) => {
      logger.warn('Dashboard precompute failed', { message: error?.message || String(error) });
      config.precomputeScheduledHashes?.delete?.(snapshotHash);
    });
  worker.unref?.();
  return worker;
}

function scheduleDashboardPrecompute(snapshot, config = getConfig()) {
  if (config.precomputeEnabled === false) {
    return null;
  }
  const cachedManifest = hasCompletePrecompute(snapshot, config);
  if (cachedManifest) {
    return null;
  }
  const architecture = snapshot.personnelArchitecture || {};
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  if (!config.precomputeScheduledHashes) {
    config.precomputeScheduledHashes = new Set();
  }
  if (config.precomputeScheduledHashes.has(snapshotHash)) {
    return null;
  }
  config.precomputeScheduledHashes.add(snapshotHash);
  const run = async () => {
    try {
      return await precomputeTeamDashboards(snapshot, { config });
    } finally {
      config.precomputeScheduledHashes?.delete?.(snapshotHash);
    }
  };
  if (typeof config.precomputeScheduler === 'function') {
    config.precomputeScheduler(run);
    return null;
  }
  return startPrecomputeWorker(snapshot, config, snapshotHash);
}

export async function ensureDashboardPrecompute(snapshot, config = getConfig()) {
  if (config.precomputeEnabled === false) {
    return null;
  }
  const architecture = snapshot.personnelArchitecture || {};
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const cachedManifest = hasCompletePrecompute(snapshot, config);
  if (cachedManifest) {
    return cachedManifest;
  }
  const existingPromise = config.precomputePromises?.get?.(snapshotHash);
  if (existingPromise) {
    return existingPromise;
  }
  if (typeof config.precomputeScheduler === 'function') {
    return precomputeTeamDashboards(snapshot, { config });
  }
  if (!config.precomputeScheduledHashes) {
    config.precomputeScheduledHashes = new Set();
  }
  config.precomputeScheduledHashes.add(snapshotHash);
  const { promise } = createPrecomputeWorker(snapshot, config, snapshotHash);
  return promise;
}

export async function syncProjects({ config = getConfig(), source = config.mode } = {}) {
  let records;

  if (source === 'mock') {
    records = mockDingTalkRecords;
  } else if (source === 'dingtalk') {
    const client = createDingTalkClient(config.dingtalk);
    records = await fetchAllDingTalkRecords({
      listRecords: client.listRecords,
      pageSize: config.dingtalk.pageSize,
      maxPages: config.dingtalk.maxPages,
    });
  } else {
    throw new Error(`Unsupported sync source: ${source}`);
  }

  const personnelArchitecture = await readConfiguredPersonnelArchitecture(config);
  const database = config.databaseFile ? openInitializedDatabase(config.databaseFile) : null;

  try {
    const fieldResolution = resolveSyncFieldMap(records, config, database);
    const snapshot = createProjectSnapshot({
      source,
      records,
      fieldMap: fieldResolution.fieldMap,
      fieldMapping: fieldResolution.fieldMap,
      fieldMappingWarnings: fieldResolution.fieldMappingWarnings,
      personnelArchitecture,
    });

    if (database) {
      importSnapshotToDatabase(database, snapshot);
      saveFieldBindings(database, fieldResolution.bindings);
      const refreshedPersonnelArchitecture = seedPersonnelDatabase(database, personnelArchitecture);
      const refreshedSnapshot = {
        ...readSnapshotFromDatabase(database, { personnelArchitecture: refreshedPersonnelArchitecture }),
        fieldMapping: fieldResolution.fieldMap,
        fieldMappingWarnings: fieldResolution.fieldMappingWarnings,
      };
      const writtenSnapshot = await writeSnapshot(config.cacheFile, refreshedSnapshot);
      clearSnapshotCache(config);
      scheduleDashboardPrecompute(writtenSnapshot, config);
      return writtenSnapshot;
    }

    const writtenSnapshot = await writeSnapshot(config.cacheFile, snapshot);
    clearSnapshotCache(config);
    scheduleDashboardPrecompute(writtenSnapshot, config);
    return writtenSnapshot;
  } finally {
    database?.close();
  }
}

async function readCurrentSnapshot(config = getConfig()) {
  const personnelArchitecture = await readConfiguredPersonnelArchitecture(config);
  if (config.databaseFile) {
    const database = openInitializedDatabase(config.databaseFile);
    try {
      if (databaseHasProjects(database)) {
        const snapshot = readSnapshotFromDatabase(database, { personnelArchitecture });
        scheduleSplitOwnerResponsibilityRefresh(config, snapshot.projects);
        scheduleDashboardPrecompute(snapshot, config);
        return snapshot;
      }
    } finally {
      database.close();
    }
  }

  const snapshot = await readSnapshot(config.cacheFile);
  if (snapshot) {
    const normalizedSnapshot = normalizeSnapshot(snapshot, config, personnelArchitecture);
    scheduleDashboardPrecompute(normalizedSnapshot, config);
    return normalizedSnapshot;
  }

  if (config.mode === 'mock') {
    return syncProjects({ config, source: 'mock' });
  }

  return {
    version: 1,
    source: 'empty',
    readOnly: true,
    syncedAt: '',
    sourceRecords: 0,
    totalRecords: 0,
    ignoredRecords: 0,
    projects: [],
    personnelArchitecture,
    fieldCatalog: [],
    metrics: calculateDashboardMetrics([], { personnelArchitecture }),
    filters: createFilterOptions([]),
  };
}

export async function getSnapshot(config = getConfig()) {
  const cacheKey = snapshotCacheKey(config);
  if (config.snapshotCache?.key === cacheKey) {
    return config.snapshotCache.snapshot;
  }
  if (config.snapshotCachePromise?.key === cacheKey) {
    return config.snapshotCachePromise.promise;
  }

  const promise = readCurrentSnapshot(config).then((snapshot) => {
    config.snapshotCache = { key: snapshotCacheKey(config), snapshot };
    return snapshot;
  });
  config.snapshotCachePromise = { key: cacheKey, promise };

  try {
    return await promise;
  } finally {
    if (config.snapshotCachePromise?.promise === promise) {
      config.snapshotCachePromise = null;
    }
  }
}
