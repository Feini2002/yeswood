import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { getConfig, paths } from './config.mjs';
import { openInitializedDatabase } from './database.mjs';
import { logger } from './logger.mjs';
import { savePersonnelArchitectureToDatabase } from './personnelRepository.mjs';
import { calculateDashboardMetrics, calculateTeamDashboardMetrics, createFieldCatalog, createFilterOptions, filterProjects } from './projectData.mjs';
import { buildAnnualEntryStructure } from './metrics/buildAnnualEntryStructure.mjs';
import { composeDashboardMetrics } from './metrics/composeDashboard.mjs';
import { DASHBOARD_CONTEXTS, resolveCanonicalOwner } from './metrics/projectScopes.mjs';
import { splitPersonnelNames } from './personnelNames.mjs';
import { buildTeamResponsibilityReview } from './teamResponsibilityReview.mjs';
import { buildTeamOwnerRates, enrichTeamDashboardMetrics } from './teamInsights.mjs';
import { clearSnapshotCache, getSnapshot, readConfiguredPersonnelArchitecture, syncProjects } from './syncService.mjs';
import { reserveSyncGate } from './syncGate.mjs';
import { withAgentChannelOutput } from './agents/agentWorker.mjs';
import { buildRiskHealthAnalysis } from './agents/riskHealthAnalysis.mjs';
import { buildDepartmentOperationsAnalysis } from './agents/departmentOperationsAgent.mjs';
import { readLatestRiskHealthAnalysis, saveRiskHealthAnalysis } from './riskHealthRepository.mjs';

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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
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

function parseDashboardContext(value, { defaultValue = 'all', paramName = 'context' } = {}) {
  const context = String(value || defaultValue).trim() || defaultValue;
  if (!DASHBOARD_CONTEXTS.has(context)) {
    throw new HttpError(400, `${paramName} must be one of ${Array.from(DASHBOARD_CONTEXTS).join(', ')}`);
  }
  return context;
}

function teamMetricsSnapshotHash(snapshot = {}, architecture = {}) {
  return crypto
    .createHash('sha1')
    .update(
      JSON.stringify({
        source: snapshot.source || '',
        storage: snapshot.storage || '',
        syncedAt: snapshot.syncedAt || '',
        totalRecords: snapshot.totalRecords || 0,
        ignoredRecords: snapshot.ignoredRecords || 0,
        projects: snapshot.projects || [],
        personnelArchitecture: architecture || {},
      })
    )
    .digest('hex');
}

function teamMetricsCacheForConfig(config) {
  if (!config.teamMetricsCache) {
    config.teamMetricsCache = new Map();
  }
  return config.teamMetricsCache;
}

function pruneTeamMetricsCache(cache, maxEntries = 9) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

function resolveTeamForOwner(owner, architecture = {}) {
  return (
    (Array.isArray(architecture.teams) ? architecture.teams : []).find((item) => item.owner === owner) || {
      owner,
      cdLeads: [],
      vmLeads: [],
    }
  );
}

function buildTeamMetricsPayload(config, snapshot, architecture, owner, dashboardContext, options = {}) {
  const team = resolveTeamForOwner(owner, architecture);
  const metrics = enrichTeamDashboardMetrics(
    snapshot.projects || [],
    calculateTeamDashboardMetrics(snapshot.projects || [], team, architecture, { dashboardContext }),
    architecture,
    { ownerRates: options.ownerRates }
  );
  const riskHealthAnalysis = resolveRiskHealthAnalysis(config, metrics, { owner, dashboardContext });
  return {
    ...metrics,
    agentWorker: withAgentChannelOutput(metrics.agentWorker, 'riskHealth', riskHealthAnalysis),
    riskHealthAnalysis,
    readOnly: true,
    dashboardContext,
    owner,
  };
}

function compactDepartmentOperationsForOwner(departmentOperations = {}, owner = '') {
  const ownerRecommendation = departmentOperations.ownerRecommendations?.[owner] || null;
  return {
    channel: departmentOperations.channel,
    agentName: departmentOperations.agentName,
    promptVersion: departmentOperations.promptVersion,
    promptHash: departmentOperations.promptHash,
    modelName: departmentOperations.modelName,
    mode: departmentOperations.mode,
    runMode: departmentOperations.runMode,
    analysisScope: departmentOperations.analysisScope,
    inputSnapshotHash: departmentOperations.inputSnapshotHash,
    generatedAt: departmentOperations.generatedAt,
    status: departmentOperations.status,
    context: departmentOperations.context,
    summary: {
      ...(departmentOperations.summary || {}),
      text: ownerRecommendation?.headline || departmentOperations.summary?.text || '',
    },
    facts: departmentOperations.facts || {},
    ownerRecommendation,
    departmentRecommendations: departmentOperations.departmentRecommendations || [],
    limitations: departmentOperations.limitations || [],
  };
}

function attachDepartmentOperations(metrics = {}, departmentOperations = {}) {
  const owner = metrics.owner || '';
  const ownerDepartmentOperations = compactDepartmentOperationsForOwner(departmentOperations, owner);
  return {
    ...metrics,
    departmentOperations: ownerDepartmentOperations,
    agentWorker: withAgentChannelOutput(metrics.agentWorker, 'departmentOperations', ownerDepartmentOperations),
  };
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

function resolveTeamMetricsBatch(config, snapshot, architecture, owners, dashboardContext) {
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
  const departmentOperations = buildDepartmentOperationsAnalysis({
    dashboardContext,
    currentOwner: owners[0] || '',
    metricsByOwner: rawMetricsByOwner,
  });
  const metricsByOwner = Object.fromEntries(
    owners.map((owner) => [owner, attachDepartmentOperations(bucket.metricsByOwner.get(owner), departmentOperations)])
  );

  return {
    owners,
    metricsByOwner,
    departmentOperations,
    dashboardContext,
    readOnly: true,
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

function resolveRiskHealthAnalysis(config, metrics, { owner, dashboardContext }) {
  const generated = buildRiskHealthAnalysis(metrics, { owner, dashboardContext });
  if (!config.databaseFile) {
    return {
      ...generated,
      createdBy: 'live_preview',
      modelName: 'deterministic-js',
    };
  }

  const database = openInitializedDatabase(config.databaseFile);
  try {
    const existing = readLatestRiskHealthAnalysis(database, { owner, dashboardContext });
    if (
      existing &&
      existing.inputSnapshotHash === generated.inputSnapshotHash &&
      existing.promptHash === generated.promptHash
    ) {
      return existing;
    }
    saveRiskHealthAnalysis(database, generated, {
      createdBy: 'manual_agent',
      modelName: 'deterministic-js',
    });
    return readLatestRiskHealthAnalysis(database, { owner, dashboardContext }) || generated;
  } finally {
    database.close();
  }
}

async function handleApi(request, response, url, config) {
  if (url.pathname === '/api/health') {
    if (!['GET', 'HEAD'].includes(request.method)) {
      sendNotAllowed(response, ['GET', 'HEAD']);
      return true;
    }
    sendJson(response, 200, { ok: true, readOnly: true });
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
      sendJson(response, allowed.status, { error: allowed.message });
      return true;
    }

    const body = await readRequestBody(request, { maxBytes: maxJsonBodyBytes(config) });
    const source = body.source || config.mode;
    const gate = reserveSyncGate(config);
    if (!gate.allowed) {
      sendJson(response, gate.status, { error: gate.message });
      return true;
    }

    try {
      const snapshot = await syncProjects({ config, source });
      gate.commit?.();
      logger.info('Dashboard data synced', { source: snapshot.source, totalRecords: snapshot.totalRecords });
      sendJson(response, 200, publicSyncPayload(snapshot));
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
      sendJson(response, allowed.status, { error: allowed.message });
      return true;
    }

    const gate = reserveSyncGate(config);
    if (!gate.allowed) {
      sendJson(response, gate.status, { error: gate.message });
      return true;
    }

    try {
      const snapshot = await syncProjects({ config, source: config.mode });
      gate.commit?.();
      logger.info('Dashboard data synced from browser', { source: snapshot.source, totalRecords: snapshot.totalRecords });
      sendJson(response, 200, publicSyncPayload(snapshot));
      return true;
    } catch (error) {
      gate.release?.();
      throw error;
    }
  }

  if (url.pathname === '/api/personnel/architecture') {
    if (request.method === 'GET') {
      const architecture = await readConfiguredPersonnelArchitecture(config);
      sendJson(response, 200, {
        ...architecture,
        storage: config.databaseFile ? 'sqlite' : 'json',
        editable: Boolean(config.databaseFile),
      });
      return true;
    }

    if (request.method === 'PUT') {
      const gate = assertPersonnelEditAllowed(request, config);
      if (!gate.allowed) {
        sendJson(response, gate.status, { error: gate.message });
        return true;
      }

      const body = await readRequestBody(request, { maxBytes: maxJsonBodyBytes(config) });
      const architecture = body.architecture || body;
      const database = openInitializedDatabase(config.databaseFile);
      try {
        const saved = savePersonnelArchitectureToDatabase(database, architecture);
        clearSnapshotCache(config);
        sendJson(response, 200, {
          ...saved,
          storage: 'sqlite',
          editable: true,
        });
      } catch (error) {
        sendJson(response, 400, { error: error.message || 'Invalid personnel architecture' });
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
    sendJson(response, 200, {
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
      readOnly: true,
    });
    return true;
  }

  if (url.pathname === '/api/filters') {
    const snapshot = await getSnapshot(config);
    sendJson(response, 200, snapshot.filters || createFilterOptions(snapshot.projects || []));
    return true;
  }

  if (url.pathname === '/api/projects') {
    const snapshot = await getSnapshot(config);
    const projects = filterProjects(snapshot.projects || [], apiFiltersFromUrl(url), {
      personnelArchitecture: snapshot.personnelArchitecture,
    });
    sendJson(response, 200, {
      items: projects,
      total: projects.length,
      fieldCatalog: snapshot.fieldCatalog || createFieldCatalog(projects),
      readOnly: true,
    });
    return true;
  }

  if (url.pathname === '/api/metrics') {
    const snapshot = await getSnapshot(config);
    const projects = filterProjects(snapshot.projects || [], apiFiltersFromUrl(url), {
      personnelArchitecture: snapshot.personnelArchitecture,
    });
    sendJson(response, 200, {
      ...calculateDashboardMetrics(projects, { personnelArchitecture: snapshot.personnelArchitecture }),
      total: projects.length,
      readOnly: true,
    });
    return true;
  }

  if (url.pathname === '/api/dashboard-metrics') {
    const profile = url.searchParams.get('profile') || 'department';
    const owner = url.searchParams.get('owner') || '';
    const allowedProfiles = new Set(['department', 'direct', 'franchise', 'ownerMonthly']);

    if (!allowedProfiles.has(profile)) {
      sendJson(response, 400, { error: 'profile must be one of department, direct, franchise, ownerMonthly' });
      return true;
    }

    if (profile === 'ownerMonthly' && !owner.trim()) {
      sendJson(response, 400, { error: 'owner query parameter is required for ownerMonthly profile' });
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
    sendJson(response, 200, {
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
    sendJson(response, 200, {
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

    sendJson(response, 200, resolveTeamMetricsBatch(config, snapshot, architecture, owners, dashboardContext));
    return true;
  }

  if (url.pathname === '/api/team-responsibility-review') {
    const ownerParam = url.searchParams.get('owner') || '';
    if (!ownerParam.trim()) {
      sendJson(response, 400, { error: 'owner query parameter is required' });
      return true;
    }

    const snapshot = await getSnapshot(config);
    const architecture = snapshot.personnelArchitecture || (await readConfiguredPersonnelArchitecture(config));
    const owner = resolveCanonicalOwner(ownerParam, architecture);
    const team = resolveTeamForOwner(owner, architecture);
    const dashboardContext = parseDashboardContext(url.searchParams.get('context'));
    const month = url.searchParams.get('month') || '';
    sendJson(response, 200, {
      ...buildTeamResponsibilityReview(snapshot.projects || [], team, {
        month,
        dashboardContext,
        personnelArchitecture: architecture,
      }),
      requestedOwner: ownerParam !== owner ? ownerParam : undefined,
    });
    return true;
  }

  if (url.pathname === '/api/team-metrics') {
    const ownerParam = url.searchParams.get('owner') || '';
    if (!ownerParam.trim()) {
      sendJson(response, 400, { error: 'owner query parameter is required' });
      return true;
    }

    const snapshot = await getSnapshot(config);
    const architecture = snapshot.personnelArchitecture || (await readConfiguredPersonnelArchitecture(config));
    const owner = resolveCanonicalOwner(ownerParam, architecture);
    const dashboardContext = parseDashboardContext(url.searchParams.get('context'));
    const metrics = resolveTeamMetricsBatch(config, snapshot, architecture, [owner], dashboardContext).metricsByOwner[
      owner
    ];
    sendJson(response, 200, {
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
        sendJson(response, 414, { error: 'Request URL is too long' });
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
        sendJson(response, error.statusCode, { error: error.publicMessage || 'Bad request' });
        return;
      }
      logger.error(error.message);
      sendJson(response, 500, { error: 'Internal server error' });
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
