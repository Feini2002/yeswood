export const DASHBOARD_SYNC_ENDPOINT = '/api/dashboard-sync';
export const ENTRY_STRUCTURE_ENDPOINT = '/api/entry-structure';
export const TEAM_METRICS_ENDPOINT = '/api/team-metrics';
export const TEAM_METRICS_BATCH_ENDPOINT = '/api/team-metrics-batch';
export const DASHBOARD_METRICS_ENDPOINT = '/api/dashboard-metrics';
export const TEAM_RESPONSIBILITY_REVIEW_ENDPOINT = '/api/team-responsibility-review';

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export async function fetchJson(path, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_FETCH_TIMEOUT_MS;
  const { timeoutMs: _ignored, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(path, {
      ...fetchOptions,
      signal: fetchOptions.signal || controller.signal,
      headers: {
        accept: 'application/json',
        ...(fetchOptions.headers || {}),
      },
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`${path} timed out after ${timeoutMs}ms`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
  if (!response.ok) {
    let message = `${path} ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      // Keep the status-based message when the body is not JSON.
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function normalizeDashboardPayload({
  snapshot = {},
  projects = {},
  metrics = {},
  fullMetrics = {},
  departmentMetrics = null,
} = {}) {
  const safeProjects = isPlainObject(projects) ? projects : {};
  return {
    snapshot: isPlainObject(snapshot) ? snapshot : {},
    projects: Array.isArray(safeProjects.items) ? safeProjects.items : [],
    fieldCatalog: Array.isArray(safeProjects.fieldCatalog) ? safeProjects.fieldCatalog : [],
    metrics: isPlainObject(metrics) ? metrics : {},
    fullMetrics: isPlainObject(fullMetrics) ? fullMetrics : {},
    departmentMetrics: isPlainObject(departmentMetrics) ? departmentMetrics : null,
  };
}
