import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const gzipAsync = promisify(zlib.gzip);

import { getConfig, paths } from './config.mjs';
import { openInitializedDatabase } from './database.mjs';
import { logger } from './logger.mjs';
import { savePersonnelArchitectureToDatabase } from './personnelRepository.mjs';
import { calculateDashboardMetrics, createFieldCatalog, createFilterOptions, filterProjects } from './projectData.mjs';
import { buildAnnualEntryStructure } from './metrics/buildAnnualEntryStructure.mjs';
import { composeDashboardMetrics } from './metrics/composeDashboard.mjs';
import { DASHBOARD_CONTEXTS, resolveCanonicalOwner } from './metrics/projectScopes.mjs';
import { splitPersonnelNames } from './personnelNames.mjs';
import { buildTeamResponsibilityReview } from './teamResponsibilityReview.mjs';
import { buildTeamWorkCompletionReview } from './teamWorkCompletionReview.mjs';
import { buildTeamOwnerRates } from './teamInsights.mjs';
import {
  clearSnapshotCache,
  ensureDashboardPrecompute,
  getSnapshot,
  readConfiguredPersonnelArchitecture,
  syncProjects,
} from './syncService.mjs';
import { reserveSyncGate } from './syncGate.mjs';
import { buildDepartmentOperationsAnalysis } from './agents/departmentOperationsAgent.mjs';
import { findProjectInSnapshot, summarizeProject, summarizeProjects } from './projectPresentation.mjs';
import {
  precomputeSnapshotHash,
  readPrecomputedDashboardSession,
  readPrecomputedTeamMetricsBatch,
  readPrecomputedTeamResponsibilityReview,
  readPrecomputedTeamWorkCompletion,
  readPrecomputedTeamWorkCompletionDetail,
} from './precomputeTeamDashboards.mjs';
import {
  REQUIRED_READ_MODEL_FEATURES,
  readDashboardSessionReadModel,
  readTeamWorkCompletionDetailReadModel,
} from './readModelRepository.mjs';
import { attachDepartmentOperations, buildTeamMetricsPayload, resolveTeamForOwner } from './teamMetricsPayload.mjs';

let activeApiRequest = null;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const DEFAULT_MAX_JSON_BODY_BYTES = 256 * 1024;
const MAX_REQUEST_URL_LENGTH = 4096;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.publicMessage = message;
  }
}

function isHttpError(error) {
  return Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600;
}

function applySecurityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-permitted-cross-domain-policies', 'none');
  response.setHeader('cross-origin-opener-policy', 'same-origin');
  response.setHeader('cross-origin-resource-policy', 'same-origin');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'content-security-policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
}

function createDevReloadHub() {
  const clients = new Set();

  const send = (response, event, payload = {}) => {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  return {
    add(request, response) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      response.write(': connected\n\n');
      send(response, 'connected', { ok: true });
      clients.add(response);
      request.on('close', () => {
        clients.delete(response);
      });
    },
    broadcast(payload = {}) {
      for (const response of clients) {
        send(response, 'reload', payload);
      }
    },
  };
}

function watchPublicDirForReload(publicDir, hub) {
  try {
    return fs.watch(publicDir, { recursive: true }, (eventType, filename) => {
      if (!filename) {
        return;
      }
      hub.broadcast({ eventType, file: String(filename).replaceAll('\\', '/') });
    });
  } catch (error) {
    logger.warn?.(`Dev reload watcher disabled: ${error.message}`);
    return null;
  }
}

function resolvePublicDir(config = {}) {
  return path.resolve(config.publicDir || paths.publicDir);
}

function elapsedMs(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function precomputeActive(config = {}) {
  return Boolean(config.precomputeScheduledHashes?.size || config.precomputePromises?.size);
}

function logApiPerformance(perf = {}, { jsonStringifyMs = 0, gzipMs = 0, payloadKb = 0 } = {}) {
  if (!perf.route) {
    return;
  }
  logger.info('Dashboard API performance', {
    route: perf.route,
    owner: perf.owner || '',
    context: perf.dashboardContext || perf.context || '',
    year: perf.year || '',
    totalMs: Number.isFinite(perf.startedAt) ? elapsedMs(perf.startedAt) : perf.totalMs,
    snapshotMs: perf.snapshotMs ?? 0,
    readModelHit: Boolean(perf.readModelHit),
    precomputedFileHit: Boolean(perf.precomputedFileHit),
    fallbackComputed: Boolean(perf.fallbackComputed),
    payloadKb,
    jsonStringifyMs,
    gzipMs,
    precomputeActive: Boolean(perf.precomputeActive),
  });
}

async function sendJson(response, statusCode, payload, perf = {}) {
  const stringifyStart = Date.now();
  const body = JSON.stringify(payload);
  const jsonStringifyMs = elapsedMs(stringifyStart);
  const payloadKb = Math.round((Buffer.byteLength(body) / 1024) * 10) / 10;
  const request = response.__dashboardRequest || activeApiRequest;
  const acceptEncoding = String(request?.headers['accept-encoding'] || '');
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };

  if (body.length > 1024 && acceptEncoding.includes('gzip')) {
    headers['content-encoding'] = 'gzip';
    headers.vary = 'Accept-Encoding';
    response.writeHead(statusCode, headers);
    const gzipStart = Date.now();
    response.end(await gzipAsync(body));
    logApiPerformance(perf, { jsonStringifyMs, gzipMs: elapsedMs(gzipStart), payloadKb });
    return;
  }

  response.writeHead(statusCode, headers);
  response.end(body);
  logApiPerformance(perf, { jsonStringifyMs, gzipMs: 0, payloadKb });
}

function sendNotAllowed(response, allowedMethods = ['GET', 'POST', 'PUT']) {
  response.writeHead(405, { allow: allowedMethods.join(', ') });
  response.end();
}

function publicSyncPayload(snapshot) {
  return {
    source: snapshot.source,
    syncedAt: snapshot.syncedAt,
    sourceRecords: snapshot.sourceRecords,
    totalRecords: snapshot.totalRecords,
    ignoredRecords: snapshot.ignoredRecords || 0,
    fieldCount: Array.isArray(snapshot.fieldCatalog) ? snapshot.fieldCatalog.length : 0,
    readOnly: true,
  };
}

async function ensureSyncedDashboardReadModel(snapshot, config = {}) {
  const manifest = await ensureDashboardPrecompute(snapshot, config);
  if (config.precomputeEnabled === false) {
    return manifest;
  }
  if (!manifest || !REQUIRED_READ_MODEL_FEATURES.every((feature) => manifest.features?.includes(feature))) {
    throw new Error('Dashboard read model warmup did not publish a complete manifest');
  }
  return manifest;
}

function publicSnapshotPayload(snapshot, config = {}) {
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
    dashboardAutoUpdateEnabled: Boolean(config.dashboardAutoUpdateEnabled),
    developerDocumentationVisible: Boolean(config.devReloadEnabled),
    dashboardDisplayMode: config.devReloadEnabled ? 'development' : 'intranet',
    personnelArchitecture: snapshot.personnelArchitecture || null,
    readOnly: true,
  };
}

function parseDashboardContext(value, { defaultValue = 'all', paramName = 'context' } = {}) {
  const context = String(value || defaultValue).trim() || defaultValue;
  if (!DASHBOARD_CONTEXTS.has(context)) {
    throw new HttpError(400, `${paramName} must be one of ${Array.from(DASHBOARD_CONTEXTS).join(', ')}`);
  }
  return context;
}

function parseCompletionYear(value, { defaultValue = new Date().getFullYear(), paramName = 'year' } = {}) {
  const raw = String(value || '').trim();
  if (!raw) {
    return defaultValue;
  }
  if (!/^\d{4}$/.test(raw)) {
    throw new HttpError(400, `${paramName} must be a four-digit year`);
  }
  const year = Number(raw);
  if (year < 2000 || year > 2100) {
    throw new HttpError(400, `${paramName} must be between 2000 and 2100`);
  }
  return year;
}

function teamMetricsSnapshotHash(snapshot = {}, architecture = {}) {
  return precomputeSnapshotHash(snapshot, architecture);
}

function teamMetricsCacheForConfig(config) {
  if (!config.teamMetricsCache) {
    config.teamMetricsCache = new Map();
  }
  return config.teamMetricsCache;
}

function teamWorkCompletionCacheForConfig(config) {
  if (!config.teamWorkCompletionCache) {
    config.teamWorkCompletionCache = new Map();
  }
  return config.teamWorkCompletionCache;
}

function teamResponsibilityReviewCacheForConfig(config) {
  if (!config.teamResponsibilityReviewCache) {
    config.teamResponsibilityReviewCache = new Map();
  }
  return config.teamResponsibilityReviewCache;
}

function pruneKeyedResponseCache(cache, maxEntries = 24) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

function resolveTeamWorkCompletionReview(config, snapshot, architecture, team, options = {}) {
  const owner = team?.owner || options.requestedOwner || '';
  const dashboardContext = options.dashboardContext || 'all';
  const year = Number(options.year) || new Date().getFullYear();
  const skipPrecomputed = options.forceRefresh === true || options.skipPrecomputed === true;
  const cache = teamWorkCompletionCacheForConfig(config);
  const cacheKey = `${teamMetricsSnapshotHash(snapshot, architecture)}:${dashboardContext}:${year}:${owner}`;
  if (!skipPrecomputed && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const payload =
    (skipPrecomputed
      ? null
      : readPrecomputedTeamWorkCompletion(config, snapshot, architecture, {
          owner,
          requestedOwner: options.requestedOwner,
          dashboardContext,
          year,
        })) ||
    buildTeamWorkCompletionReview(snapshot.projects || [], team, {
      ...options,
      dashboardContext,
      year,
    });
  if (!skipPrecomputed) {
    cache.set(cacheKey, payload);
    pruneKeyedResponseCache(cache, 36);
  }
  return payload;
}

function readTeamWorkCompletionReadModel(config, snapshot, architecture, params = {}) {
  const reader = params.view === 'detail' ? readPrecomputedTeamWorkCompletionDetail : readPrecomputedTeamWorkCompletion;
  return reader(config, snapshot, architecture, params);
}

function triggerDashboardPrecompute(snapshot, config = {}, route = '') {
  if (config.precomputeEnabled === false) {
    return false;
  }
  void ensureDashboardPrecompute(snapshot, config).catch((error) => {
    logger.warn('Dashboard background precompute failed', {
      route,
      message: error?.message || String(error),
    });
  });
  return true;
}

function triggerDashboardPrecomputeFromCurrentSnapshot(config = {}, route = '') {
  if (config.precomputeEnabled === false) {
    return false;
  }
  void getSnapshot(config)
    .then((snapshot) => ensureDashboardPrecompute(snapshot, config))
    .catch((error) => {
      logger.warn('Dashboard background precompute failed', {
        route,
        message: error?.message || String(error),
      });
    });
  return true;
}

function resolveTeamResponsibilityReview(config, snapshot, architecture, team, options = {}) {
  const owner = team?.owner || '';
  const dashboardContext = options.dashboardContext || 'all';
  const month = options.month || '';
  const cache = teamResponsibilityReviewCacheForConfig(config);
  const cacheKey = `${teamMetricsSnapshotHash(snapshot, architecture)}:${dashboardContext}:${month}:${owner}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const payload =
    readPrecomputedTeamResponsibilityReview(config, snapshot, architecture, {
      owner,
      dashboardContext,
      month,
    }) ||
    buildTeamResponsibilityReview(snapshot.projects || [], team, {
      month,
      dashboardContext,
      personnelArchitecture: architecture,
    });
  cache.set(cacheKey, payload);
  pruneKeyedResponseCache(cache, 36);
  return payload;
}

function metricsResponseCacheForConfig(config) {
  if (!config.metricsResponseCache) {
    config.metricsResponseCache = new Map();
  }
  return config.metricsResponseCache;
}

function projectsIdsCacheForConfig(config) {
  if (!config.projectsIdsCache) {
    config.projectsIdsCache = new Map();
  }
  return config.projectsIdsCache;
}

function snapshotMetricsCacheKey(snapshot = {}, filters = {}) {
  return crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        syncedAt: snapshot.syncedAt || '',
        totalRecords: snapshot.totalRecords || 0,
        filters,
      })
    )
    .digest('hex');
}

function pruneMetricsResponseCache(cache, maxEntries = 24) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

function resolveDashboardMetrics(config, snapshot, filters = {}) {
  const cache = metricsResponseCacheForConfig(config);
  const cacheKey = snapshotMetricsCacheKey(snapshot, filters);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const projects = filterProjects(snapshot.projects || [], filters, {
    personnelArchitecture: snapshot.personnelArchitecture,
  });
  const metrics = calculateDashboardMetrics(projects, { personnelArchitecture: snapshot.personnelArchitecture });
  cache.set(cacheKey, metrics);
  pruneMetricsResponseCache(cache);
  return metrics;
}

function pruneTeamMetricsCache(cache, maxEntries = 9) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

function ownersFromPersonnelMetrics(snapshot = {}, architecture = {}) {
  const owners = new Set();
  const roles = snapshot.metrics?.personnel?.roles || [];
  for (const role of roles) {
    if (!['cdOwner', 'vmOwner'].includes(role.key)) {
      continue;
    }
    for (const person of role.people || []) {
      if (person?.name) {
        owners.add(resolveCanonicalOwner(person.name, architecture));
      }
    }
  }

  if (!owners.size) {
    for (const team of architecture.teams || []) {
      if (team?.owner) {
        owners.add(resolveCanonicalOwner(team.owner, architecture));
      }
    }
  }

  return Array.from(owners);
}

function requestedTeamOwners(url, snapshot, architecture) {
  const rawOwners = [
    ...url.searchParams.getAll('owner'),
    ...url.searchParams.getAll('owners').flatMap((value) => splitPersonnelNames(value)),
  ];
  const sourceOwners = rawOwners.length ? rawOwners : ownersFromPersonnelMetrics(snapshot, architecture);
  const owners = [];
  const seen = new Set();

  for (const rawOwner of sourceOwners) {
    const owner = resolveCanonicalOwner(rawOwner, architecture);
    if (!owner || seen.has(owner)) {
      continue;
    }
    seen.add(owner);
    owners.push(owner);
  }

  return owners;
}

function buildTeamMetricsBatchResponse(owners, rawMetricsByOwner, dashboardContext) {
  const departmentOperations = buildDepartmentOperationsAnalysis({
    dashboardContext,
    currentOwner: owners[0] || '',
    metricsByOwner: rawMetricsByOwner,
  });
  const metricsByOwner = Object.fromEntries(
    owners.map((owner) => [owner, attachDepartmentOperations(rawMetricsByOwner[owner], departmentOperations)])
  );

  return {
    owners,
    metricsByOwner,
    departmentOperations,
    dashboardContext,
    readOnly: true,
  };
}

function resolveTeamMetricsBatch(config, snapshot, architecture, owners, dashboardContext) {
  const precomputed = readPrecomputedTeamMetricsBatch(config, snapshot, architecture, {
    owners,
    dashboardContext,
  });
  if (precomputed) {
    return buildTeamMetricsBatchResponse(owners, precomputed.metricsByOwner, dashboardContext);
  }

  const cache = teamMetricsCacheForConfig(config);
  const snapshotHash = teamMetricsSnapshotHash(snapshot, architecture);
  const cacheKey = `${snapshotHash}:${dashboardContext}`;
  let bucket = cache.get(cacheKey);
  if (!bucket) {
    bucket = { metricsByOwner: new Map(), ownerRates: null };
    cache.set(cacheKey, bucket);
    pruneTeamMetricsCache(cache);
  }

  if (!bucket.ownerRates) {
    bucket.ownerRates = buildTeamOwnerRates(snapshot.projects || [], architecture, dashboardContext);
  }

  for (const owner of owners) {
    if (!bucket.metricsByOwner.has(owner)) {
      bucket.metricsByOwner.set(
        owner,
        buildTeamMetricsPayload(config, snapshot, architecture, owner, dashboardContext, { ownerRates: bucket.ownerRates })
      );
    }
  }

  const rawMetricsByOwner = Object.fromEntries(owners.map((owner) => [owner, bucket.metricsByOwner.get(owner)]));
  return buildTeamMetricsBatchResponse(owners, rawMetricsByOwner, dashboardContext);
}

function resolveDashboardSession(config, snapshot, architecture, owner, dashboardContext, year) {
  const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
  const team = owner ? resolveTeamForOwner(owner, architecture) : null;
  const precomputed = readPrecomputedDashboardSession(config, snapshot, architecture, {
    owner,
    requestedOwner: owner,
    dashboardContext,
    year,
  });
  const metricsBatch = owner ? resolveTeamMetricsBatch(config, snapshot, architecture, [owner], dashboardContext) : null;

  if (precomputed) {
    return {
      ...precomputed,
      snapshot: {
        ...precomputed.snapshot,
        ...publicSnapshotPayload(snapshot, config),
      },
      team: {
        ...precomputed.team,
        metrics: metricsBatch?.metricsByOwner?.[owner] || precomputed.team.metrics || null,
      },
    };
  }

  const workCompletion = owner
    ? resolveTeamWorkCompletionReview(config, snapshot, architecture, team, {
        requestedOwner: owner,
        dashboardContext,
        personnelArchitecture: architecture,
        year,
      })
    : null;
  const responsibilityReview = owner
    ? resolveTeamResponsibilityReview(config, snapshot, architecture, team, {
        dashboardContext,
        personnelArchitecture: architecture,
      })
    : null;

  return {
    schemaVersion: 1,
    readOnly: true,
    snapshotHash,
    snapshot: publicSnapshotPayload(snapshot, config),
    filters: snapshot.filters || createFilterOptions(snapshot.projects || []),
    metrics: resolveDashboardMetrics(config, snapshot, {}),
    departmentMetrics: composeDashboardMetrics(snapshot.projects || [], 'department', {
      dashboardContext: 'all',
      personnelArchitecture: architecture,
    }),
    team: {
      owner,
      dashboardContext,
      year,
      metrics: metricsBatch?.metricsByOwner?.[owner] || null,
      workCompletion,
      responsibilityReview,
    },
  };
}

function apiFiltersFromUrl(url) {
  const dashboardContext = url.searchParams.get('dashboardContext') || '';
  return {
    search: url.searchParams.get('search') || '',
    province: url.searchParams.get('province') || '',
    businessType: url.searchParams.get('businessType') || '',
    storeStatus: url.searchParams.get('storeStatus') || '',
    status: url.searchParams.get('status') || '',
    riskLevel: url.searchParams.get('riskLevel') || '',
    owner: url.searchParams.get('owner') || '',
    teamProjectOwner: url.searchParams.get('teamProjectOwner') || url.searchParams.get('ownerPressurePerson') || '',
    collaborator: url.searchParams.get('collaborator') || '',
    collaborationDiscipline: url.searchParams.get('collaborationDiscipline') || '',
    tier: url.searchParams.get('tier') || '',
    metric: url.searchParams.get('metric') || '',
    lifecycleStage: url.searchParams.get('lifecycleStage') || '',
    delayed: url.searchParams.get('delayed') || '',
    storeNature: url.searchParams.get('storeNature') || '',
    excludePaused: url.searchParams.get('excludePaused') || '',
    activeResponsibility: url.searchParams.get('activeResponsibility') || '',
    profile: url.searchParams.get('profile') || '',
    dashboardContext: dashboardContext ? parseDashboardContext(dashboardContext, { paramName: 'dashboardContext' }) : '',
  };
}

function maxJsonBodyBytes(config = {}) {
  const configured = Number(config.maxJsonBodyBytes || DEFAULT_MAX_JSON_BODY_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_JSON_BODY_BYTES;
}

async function readRequestBody(request, { maxBytes = DEFAULT_MAX_JSON_BODY_BYTES } = {}) {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  const hasJsonContentType = !contentType || contentType.includes('application/json');
  const contentLength = Number(request.headers['content-length'] || 0);

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HttpError(413, 'Request body is too large');
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new HttpError(413, 'Request body is too large');
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) {
    return {};
  }

  if (!hasJsonContentType) {
    throw new HttpError(415, 'Request content type must be application/json');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

function assertSyncAllowed(request, config) {
  if (!config.syncApiKey) {
    return { allowed: false, status: 503, message: 'Sync API key is not configured' };
  }

  if (request.headers['x-sync-key'] !== config.syncApiKey) {
    return { allowed: false, status: 401, message: 'Unauthorized' };
  }

  return { allowed: true };
}

function requestOrigin(request) {
  const host = request.headers.host;
  if (!host) {
    return '';
  }

  const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return `${forwardedProto || 'http'}://${host}`;
}

function isSameOriginDashboardRequest(request) {
  const origin = request.headers.origin;
  return Boolean(origin && origin === requestOrigin(request));
}

function assertDashboardSyncAllowed(request, config) {
  if (!config.dashboardSyncEnabled) {
    return { allowed: false, status: 403, message: 'Dashboard sync is disabled' };
  }

  if (!isSameOriginDashboardRequest(request)) {
    return { allowed: false, status: 403, message: 'Cross-origin dashboard sync is not allowed' };
  }

  if (request.headers['x-dashboard-action'] !== 'sync') {
    return { allowed: false, status: 403, message: 'Dashboard sync header is required' };
  }

  return { allowed: true };
}

function assertPersonnelEditAllowed(request, config) {
  if (!config.databaseFile) {
    return { allowed: false, status: 503, message: 'Local database is not configured' };
  }

  if (!isSameOriginDashboardRequest(request)) {
    return { allowed: false, status: 403, message: 'Cross-origin personnel edits are not allowed' };
  }

  if (request.headers['x-dashboard-action'] !== 'personnel-save') {
    return { allowed: false, status: 403, message: 'Personnel edit header is required' };
  }

  return { allowed: true };
}

async function handleApi(request, response, url, config) {
  activeApiRequest = request;
  response.__dashboardRequest = request;
  try {
    return await handleApiRequest(request, response, url, config);
  } finally {
    if (response.__dashboardRequest === request) {
      response.__dashboardRequest = null;
    }
    activeApiRequest = null;
  }
}

async function handleApiRequest(request, response, url, config) {
  if (url.pathname === '/api/health') {
    if (!['GET', 'HEAD'].includes(request.method)) {
      sendNotAllowed(response, ['GET', 'HEAD']);
      return true;
    }
    await sendJson(response, 200, { ok: true, readOnly: true });
    return true;
  }

  if (url.pathname === '/api/dev-events') {
    if (!config.devReloadEnabled) {
      return false;
    }

    if (request.method !== 'GET') {
      sendNotAllowed(response, ['GET']);
      return true;
    }
    config.devReloadHub.add(request, response);
    return true;
  }

  if (url.pathname === '/api/sync') {
    if (request.method !== 'POST') {
      sendNotAllowed(response, ['POST']);
      return true;
    }

    const allowed = assertSyncAllowed(request, config);
    if (!allowed.allowed) {
      await sendJson(response, allowed.status, { error: allowed.message });
      return true;
    }

    const body = await readRequestBody(request, { maxBytes: maxJsonBodyBytes(config) });
    const source = body.source || config.mode;
    const gate = reserveSyncGate(config);
    if (!gate.allowed) {
      await sendJson(response, gate.status, { error: gate.message });
      return true;
    }

    try {
      const snapshot = await syncProjects({ config, source });
      const warmup = await ensureSyncedDashboardReadModel(snapshot, config);
      gate.commit?.();
      logger.info('Dashboard data synced', { source: snapshot.source, totalRecords: snapshot.totalRecords });
      await sendJson(response, 200, {
        ...publicSyncPayload(snapshot),
        warmed: Boolean(warmup),
        features: warmup?.features || [],
      });
      return true;
    } catch (error) {
      gate.release?.();
      throw error;
    }
  }

  if (url.pathname === '/api/dashboard-sync') {
    if (request.method !== 'POST') {
      sendNotAllowed(response, ['POST']);
      return true;
    }

    const allowed = assertDashboardSyncAllowed(request, config);
    if (!allowed.allowed) {
      await sendJson(response, allowed.status, { error: allowed.message });
      return true;
    }

    const gate = reserveSyncGate(config);
    if (!gate.allowed) {
      await sendJson(response, gate.status, { error: gate.message });
      return true;
    }

    try {
      const snapshot = await syncProjects({ config, source: config.mode });
      const warmup = await ensureSyncedDashboardReadModel(snapshot, config);
      gate.commit?.();
      logger.info('Dashboard data synced from browser', { source: snapshot.source, totalRecords: snapshot.totalRecords });
      await sendJson(response, 200, {
        ...publicSyncPayload(snapshot),
        warmed: Boolean(warmup),
        features: warmup?.features || [],
      });
      return true;
    } catch (error) {
      gate.release?.();
      throw error;
    }
  }

  if (url.pathname === '/api/personnel/architecture') {
    if (request.method === 'GET') {
      const architecture = await readConfiguredPersonnelArchitecture(config);
      await sendJson(response, 200, {
        ...architecture,
        storage: config.databaseFile ? 'sqlite' : 'json',
        editable: Boolean(config.databaseFile),
      });
      return true;
    }

    if (request.method === 'PUT') {
      const gate = assertPersonnelEditAllowed(request, config);
      if (!gate.allowed) {
        await sendJson(response, gate.status, { error: gate.message });
        return true;
      }

      const body = await readRequestBody(request, { maxBytes: maxJsonBodyBytes(config) });
      const architecture = body.architecture || body;
      const database = openInitializedDatabase(config.databaseFile);
      try {
        const saved = savePersonnelArchitectureToDatabase(database, architecture);
        clearSnapshotCache(config);
        await sendJson(response, 200, {
          ...saved,
          storage: 'sqlite',
          editable: true,
        });
      } catch (error) {
        await sendJson(response, 400, { error: error.message || 'Invalid personnel architecture' });
      } finally {
        database.close();
      }
      return true;
    }

    sendNotAllowed(response, ['GET', 'PUT']);
    return true;
  }

  if (!['GET', 'HEAD'].includes(request.method)) {
    sendNotAllowed(response, ['GET', 'HEAD']);
    return true;
  }

  if (url.pathname === '/api/snapshot') {
    const snapshot = await getSnapshot(config);
    await sendJson(response, 200, publicSnapshotPayload(snapshot, config));
    return true;
  }

  if (url.pathname === '/api/dashboard-session') {
    const startedAt = Date.now();
    const dashboardContext = parseDashboardContext(
      url.searchParams.get('context') || url.searchParams.get('dashboardContext')
    );
    const year = parseCompletionYear(url.searchParams.get('year'));
    const rawOwner =
      url.searchParams.getAll('owner')[0] ||
      url.searchParams.getAll('owners').flatMap((value) => splitPersonnelNames(value))[0] ||
      '';
    const readModel = readDashboardSessionReadModel(config, {
      owner: rawOwner,
      dashboardContext,
      year,
    });
    const perf = {
      route: '/api/dashboard-session',
      owner: rawOwner,
      dashboardContext,
      year,
      startedAt,
      snapshotMs: 0,
      readModelHit: readModel.status === 'ready' || readModel.status === 'stale',
      precomputedFileHit: readModel.status === 'ready' || readModel.status === 'stale',
      fallbackComputed: false,
      precomputeActive: precomputeActive(config),
    };
    if (readModel.status === 'ready' || readModel.status === 'stale') {
      await sendJson(response, 200, readModel.payload, perf);
      return true;
    }
    triggerDashboardPrecomputeFromCurrentSnapshot(config, '/api/dashboard-session');
    await sendJson(
      response,
      202,
      {
        ok: false,
        status: 'preparing',
        readModel: true,
        reason: readModel.reason || readModel.status,
      },
      { ...perf, precomputeActive: precomputeActive(config) }
    );
    return true;
  }

  if (url.pathname === '/api/dashboard-warmup') {
    if (!['GET', 'HEAD'].includes(request.method)) {
      sendNotAllowed(response, ['GET', 'HEAD']);
      return true;
    }
    const snapshot = await getSnapshot(config);
    const architecture = snapshot.personnelArchitecture || {};
    const snapshotHash = precomputeSnapshotHash(snapshot, architecture);
    try {
      const result = await ensureDashboardPrecompute(snapshot, config);
      const features = result?.features || [];
      const complete = REQUIRED_READ_MODEL_FEATURES.every((feature) => features.includes(feature));
      if (!result || !complete) {
        throw new Error('Dashboard read model warmup did not publish a complete manifest');
      }
      await sendJson(response, 200, {
        ok: true,
        warmed: true,
        readOnly: true,
        source: snapshot.source,
        syncedAt: snapshot.syncedAt,
        totalRecords: snapshot.totalRecords,
        snapshotHash: result?.snapshotHash || snapshotHash,
        features,
      });
    } catch (error) {
      logger.warn('Dashboard warmup precompute failed', { message: error?.message || String(error) });
      await sendJson(response, 503, {
        ok: false,
        warmed: false,
        readOnly: true,
        source: snapshot.source,
        syncedAt: snapshot.syncedAt,
        totalRecords: snapshot.totalRecords,
        snapshotHash,
        features: [],
        error: error?.message || String(error),
      });
    }
    return true;
  }

  if (url.pathname === '/api/filters') {
    const snapshot = await getSnapshot(config);
    await sendJson(response, 200, snapshot.filters || createFilterOptions(snapshot.projects || []));
    return true;
  }

  if (url.pathname === '/api/projects') {
    const snapshot = await getSnapshot(config);
    const projectId = String(url.searchParams.get('id') || '').trim();
    const view = String(url.searchParams.get('view') || 'summary').trim().toLowerCase();

    if (projectId) {
      const project = findProjectInSnapshot(snapshot.projects || [], projectId);
      if (!project) {
        await sendJson(response, 404, { error: 'Project not found' });
        return true;
      }
      await sendJson(response, 200, {
        item: view === 'summary' ? summarizeProject(project) : project,
        readOnly: true,
      });
      return true;
    }

    const projects = filterProjects(snapshot.projects || [], apiFiltersFromUrl(url), {
      personnelArchitecture: snapshot.personnelArchitecture,
    });
    const fields = String(url.searchParams.get('fields') || 'items').trim().toLowerCase();
    if (fields === 'ids') {
      const filters = apiFiltersFromUrl(url);
      const cache = projectsIdsCacheForConfig(config);
      const cacheKey = snapshotMetricsCacheKey(snapshot, filters);
      if (cache.has(cacheKey)) {
        await sendJson(response, 200, cache.get(cacheKey));
        return true;
      }
      const payload = {
        ids: projects.map((project) => project.id),
        total: projects.length,
        readOnly: true,
      };
      cache.set(cacheKey, payload);
      pruneMetricsResponseCache(cache, 48);
      await sendJson(response, 200, payload);
      return true;
    }

    const items = view === 'full' ? projects : summarizeProjects(projects);
    await sendJson(response, 200, {
      items,
      total: items.length,
      view: view === 'full' ? 'full' : 'summary',
      fieldCatalog: snapshot.fieldCatalog || createFieldCatalog(projects),
      readOnly: true,
    });
    return true;
  }

  if (url.pathname === '/api/metrics') {
    const snapshot = await getSnapshot(config);
    const filters = apiFiltersFromUrl(url);
    await sendJson(response, 200, {
      ...resolveDashboardMetrics(config, snapshot, filters),
      total: filterProjects(snapshot.projects || [], filters, {
        personnelArchitecture: snapshot.personnelArchitecture,
      }).length,
      readOnly: true,
    });
    return true;
  }

  if (url.pathname === '/api/dashboard-metrics') {
    const profile = url.searchParams.get('profile') || 'department';
    const owner = url.searchParams.get('owner') || '';
    const allowedProfiles = new Set(['department', 'direct', 'franchise', 'ownerMonthly']);

    if (!allowedProfiles.has(profile)) {
      await sendJson(response, 400, { error: 'profile must be one of department, direct, franchise, ownerMonthly' });
      return true;
    }

    if (profile === 'ownerMonthly' && !owner.trim()) {
      await sendJson(response, 400, { error: 'owner query parameter is required for ownerMonthly profile' });
      return true;
    }

    const snapshot = await getSnapshot(config);
    const architecture = snapshot.personnelArchitecture || (await readConfiguredPersonnelArchitecture(config));
    const resolvedOwner = profile === 'ownerMonthly' ? resolveCanonicalOwner(owner, architecture) : owner;
    const team =
      profile === 'ownerMonthly'
        ? (Array.isArray(architecture.teams) ? architecture.teams : []).find((item) => item.owner === resolvedOwner) || {
            owner: resolvedOwner,
            cdLeads: [],
            vmLeads: [],
          }
        : undefined;

    const dashboardContext = parseDashboardContext(url.searchParams.get('context'));
    const yearParam = url.searchParams.get('year');
    const year = yearParam ? Number(yearParam) : undefined;
    await sendJson(response, 200, {
      ...composeDashboardMetrics(snapshot.projects || [], profile, {
        owner: resolvedOwner,
        team,
        dashboardContext,
        personnelArchitecture: architecture,
        year: Number.isFinite(year) ? year : undefined,
      }),
      readOnly: true,
    });
    return true;
  }

  if (url.pathname === '/api/entry-structure') {
    const snapshot = await getSnapshot(config);
    const yearParam = url.searchParams.get('year');
    const year = yearParam ? Number(yearParam) : undefined;
    await sendJson(response, 200, {
      ...buildAnnualEntryStructure(snapshot.projects || [], {
        year: Number.isFinite(year) ? year : undefined,
      }),
      readOnly: true,
    });
    return true;
  }

  if (url.pathname === '/api/team-metrics-batch') {
    const dashboardContext = parseDashboardContext(url.searchParams.get('context'));
    const snapshot = await getSnapshot(config);
    const architecture = snapshot.personnelArchitecture || (await readConfiguredPersonnelArchitecture(config));
    const owners = requestedTeamOwners(url, snapshot, architecture);

    await sendJson(response, 200, resolveTeamMetricsBatch(config, snapshot, architecture, owners, dashboardContext));
    return true;
  }

  if (url.pathname === '/api/team-responsibility-review') {
    const ownerParam = url.searchParams.get('owner') || '';
    if (!ownerParam.trim()) {
      await sendJson(response, 400, { error: 'owner query parameter is required' });
      return true;
    }

    const snapshot = await getSnapshot(config);
    const architecture = snapshot.personnelArchitecture || (await readConfiguredPersonnelArchitecture(config));
    const owner = resolveCanonicalOwner(ownerParam, architecture);
    const team = resolveTeamForOwner(owner, architecture);
    const dashboardContext = parseDashboardContext(url.searchParams.get('context'));
    const month = url.searchParams.get('month') || '';
    await sendJson(response, 200, {
      ...resolveTeamResponsibilityReview(config, snapshot, architecture, team, {
        month,
        dashboardContext,
        personnelArchitecture: architecture,
      }),
      requestedOwner: ownerParam !== owner ? ownerParam : undefined,
    });
    return true;
  }

  if (url.pathname === '/api/team-work-completion') {
    const startedAt = Date.now();
    const ownerParam = url.searchParams.get('owner') || '';
    if (!ownerParam.trim()) {
      await sendJson(response, 400, { error: 'owner query parameter is required' });
      return true;
    }

    const dashboardContext = parseDashboardContext(url.searchParams.get('context'));
    const year = parseCompletionYear(url.searchParams.get('year'));
    const view = String(url.searchParams.get('view') || 'summary').trim().toLowerCase();
    if (!['summary', 'detail'].includes(view)) {
      await sendJson(response, 400, { error: 'view must be one of summary, detail' });
      return true;
    }
    const forceRefresh = ['1', 'true', 'yes', 'on'].includes(
      String(url.searchParams.get('forceRefresh') || '').trim().toLowerCase()
    );
    const fallbackMode = String(url.searchParams.get('fallback') || '').trim().toLowerCase();
    const shouldComputeMissingDetail = view === 'detail' && fallbackMode === 'compute';
    if (!forceRefresh && view === 'detail' && fallbackMode === 'readmodel') {
      const readModel = readTeamWorkCompletionDetailReadModel(config, {
        owner: ownerParam,
        requestedOwner: ownerParam,
        dashboardContext,
        year,
      });
      const readModelHit = readModel.status === 'ready' || readModel.status === 'stale';
      const perf = {
        route: '/api/team-work-completion',
        owner: ownerParam,
        dashboardContext,
        year,
        startedAt,
        snapshotMs: 0,
        readModelHit,
        precomputedFileHit: readModelHit,
        fallbackComputed: false,
        precomputeActive: precomputeActive(config),
      };
      if (readModelHit) {
        await sendJson(response, 200, readModel.payload, perf);
        return true;
      }

      triggerDashboardPrecomputeFromCurrentSnapshot(config, '/api/team-work-completion');
      await sendJson(
        response,
        202,
        {
          ok: false,
          status: 'preparing',
          readModel: true,
          view,
          owner: ownerParam,
          dashboardContext,
          year,
          reason: readModel.reason || `${view} team work completion read model is missing`,
        },
        { ...perf, precomputeActive: precomputeActive(config) }
      );
      return true;
    }
    const snapshotStart = Date.now();
    const snapshot = await getSnapshot(config);
    const snapshotMs = elapsedMs(snapshotStart);
    const architecture = snapshot.personnelArchitecture || (await readConfiguredPersonnelArchitecture(config));
    const owner = resolveCanonicalOwner(ownerParam, architecture);
    const team = resolveTeamForOwner(owner, architecture);
    const perf = {
      route: '/api/team-work-completion',
      owner,
      dashboardContext,
      year,
      startedAt,
      snapshotMs,
      readModelHit: false,
      precomputedFileHit: false,
      fallbackComputed: false,
      precomputeActive: precomputeActive(config),
    };
    const precomputed = forceRefresh
      ? null
      : readTeamWorkCompletionReadModel(config, snapshot, architecture, {
          owner,
          requestedOwner: ownerParam,
          dashboardContext,
          year,
          view,
        });
    if (precomputed) {
      await sendJson(response, 200, precomputed, {
        ...perf,
        readModelHit: true,
        precomputedFileHit: true,
        precomputeActive: precomputeActive(config),
      });
      return true;
    }

    if (!forceRefresh && !shouldComputeMissingDetail) {
      triggerDashboardPrecompute(snapshot, config, '/api/team-work-completion');
      await sendJson(
        response,
        202,
        {
          ok: false,
          status: 'preparing',
          readModel: true,
          view,
          owner,
          requestedOwner: ownerParam !== owner ? ownerParam : undefined,
          dashboardContext,
          year,
          reason: `${view} team work completion read model is missing`,
        },
        { ...perf, precomputeActive: precomputeActive(config) }
      );
      return true;
    }
    if (shouldComputeMissingDetail) {
      triggerDashboardPrecompute(snapshot, config, '/api/team-work-completion');
    }

    await sendJson(
      response,
      200,
      resolveTeamWorkCompletionReview(config, snapshot, architecture, team, {
        requestedOwner: ownerParam,
        dashboardContext,
        personnelArchitecture: architecture,
        year,
        forceRefresh,
        skipPrecomputed: shouldComputeMissingDetail,
      }),
      { ...perf, fallbackComputed: true, precomputeActive: precomputeActive(config) }
    );
    return true;
  }

  if (url.pathname === '/api/team-metrics') {
    const ownerParam = url.searchParams.get('owner') || '';
    if (!ownerParam.trim()) {
      await sendJson(response, 400, { error: 'owner query parameter is required' });
      return true;
    }

    const snapshot = await getSnapshot(config);
    const architecture = snapshot.personnelArchitecture || (await readConfiguredPersonnelArchitecture(config));
    const owner = resolveCanonicalOwner(ownerParam, architecture);
    const dashboardContext = parseDashboardContext(url.searchParams.get('context'));
    const metrics = resolveTeamMetricsBatch(config, snapshot, architecture, [owner], dashboardContext).metricsByOwner[
      owner
    ];
    await sendJson(response, 200, {
      ...metrics,
      requestedOwner: ownerParam !== owner ? ownerParam : undefined,
    });
    return true;
  }

  return false;
}

async function serveStatic(request, response, url, publicDir = paths.publicDir) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    sendNotAllowed(response, ['GET', 'HEAD']);
    return;
  }

  let requestedPath;
  try {
    requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Invalid URL path');
  }

  const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const resolvedPublicDir = path.resolve(publicDir);
  const absolutePath = path.resolve(resolvedPublicDir, `.${normalizedPath}`);

  if (absolutePath !== resolvedPublicDir && !absolutePath.startsWith(`${resolvedPublicDir}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const content = await fsp.readFile(absolutePath);
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(absolutePath)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    if (request.method !== 'HEAD') {
      response.end(content);
    } else {
      response.end();
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    throw error;
  }
}

export function createServer(config = getConfig()) {
  const devReloadHub = config.devReloadHub || createDevReloadHub();
  const serverConfig = {
    ...config,
    publicDir: resolvePublicDir(config),
    devReloadEnabled: config.devReloadEnabled !== false,
    dashboardAutoUpdateEnabled: config.dashboardAutoUpdateEnabled !== false,
    devReloadHub,
    syncState: config.syncState || { lastSyncAt: 0 },
  };
  const server = http.createServer(async (request, response) => {
    try {
      applySecurityHeaders(response);
      response.setHeader('x-dashboard-mode', 'readonly');
      if (String(request.url || '').length > MAX_REQUEST_URL_LENGTH) {
        await sendJson(response, 414, { error: 'Request URL is too long' });
        return;
      }
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const handled = url.pathname.startsWith('/api/') && (await handleApi(request, response, url, serverConfig));
      if (handled) {
        return;
      }

      await serveStatic(request, response, url, serverConfig.publicDir);
    } catch (error) {
      if (isHttpError(error)) {
        await sendJson(response, error.statusCode, { error: error.publicMessage || 'Bad request' });
        return;
      }
      logger.error(error.message);
      await sendJson(response, 500, { error: 'Internal server error' });
    }
  });

  const watcher =
    serverConfig.devReloadEnabled && config.devReloadWatcher === undefined
      ? watchPublicDirForReload(serverConfig.publicDir, devReloadHub)
      : null;
  server.on('close', () => {
    watcher?.close();
  });
  return server;
}

export function startServer(config = getConfig()) {
  const server = createServer(config);
  const host = config.host || undefined;
  server.listen(config.port, host, () => {
    const displayHost = host && !['0.0.0.0', '::'].includes(host) ? host : 'localhost';
    logger.info(`Readonly dashboard listening on http://${displayHost}:${config.port}`);
  });
  return server;
}

if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
