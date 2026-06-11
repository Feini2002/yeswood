export const DASHBOARD_SYNC_ENDPOINT = '/api/dashboard-sync';
export const DASHBOARD_SESSION_ENDPOINT = '/api/dashboard-session';
export const ENTRY_STRUCTURE_ENDPOINT = '/api/entry-structure';
export const TEAM_METRICS_ENDPOINT = '/api/team-metrics';
export const TEAM_METRICS_BATCH_ENDPOINT = '/api/team-metrics-batch';
export const DASHBOARD_METRICS_ENDPOINT = '/api/dashboard-metrics';
export const TEAM_RESPONSIBILITY_REVIEW_ENDPOINT = '/api/team-responsibility-review';
export const TEAM_WORK_COMPLETION_ENDPOINT = '/api/team-work-completion';

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

function combinedFetchSignal(timeoutSignal, callerSignal, markAbortSource) {
  if (!callerSignal) {
    return { signal: timeoutSignal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const abortFrom = (source, sourceSignal) => {
    if (controller.signal.aborted) {
      return;
    }
    markAbortSource(source);
    try {
      controller.abort(sourceSignal?.reason);
    } catch {
      controller.abort();
    }
  };
  const abortFromTimeout = () => abortFrom('timeout', timeoutSignal);
  const abortFromCaller = () => abortFrom('caller', callerSignal);
  timeoutSignal.addEventListener('abort', abortFromTimeout, { once: true });
  callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  if (timeoutSignal.aborted) {
    abortFromTimeout();
  } else if (callerSignal.aborted) {
    abortFromCaller();
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      timeoutSignal.removeEventListener('abort', abortFromTimeout);
      callerSignal.removeEventListener('abort', abortFromCaller);
    },
  };
}

export async function fetchJson(path, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_FETCH_TIMEOUT_MS;
  const { timeoutMs: _ignored, signal: callerSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  let abortSource = '';
  const timeoutId = globalThis.setTimeout(() => {
    abortSource = 'timeout';
    controller.abort();
  }, timeoutMs);
  const { signal, cleanup } = combinedFetchSignal(controller.signal, callerSignal, (source) => {
    abortSource = abortSource || source;
  });

  let response;
  try {
    response = await fetch(path, {
      ...fetchOptions,
      signal,
      headers: {
        accept: 'application/json',
        ...(fetchOptions.headers || {}),
      },
    });
  } catch (error) {
    if (error?.name === 'AbortError' && abortSource === 'timeout') {
      const timeoutError = new Error(`${path} timed out after ${timeoutMs}ms`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    cleanup();
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
  fullMetrics = null,
  departmentMetrics = null,
} = {}) {
  const safeProjects = isPlainObject(projects) ? projects : {};
  const safeMetrics = isPlainObject(metrics) ? metrics : {};
  return {
    snapshot: isPlainObject(snapshot) ? snapshot : {},
    projects: Array.isArray(safeProjects.items) ? safeProjects.items : [],
    fieldCatalog: Array.isArray(safeProjects.fieldCatalog) ? safeProjects.fieldCatalog : [],
    metrics: safeMetrics,
    fullMetrics: isPlainObject(fullMetrics) ? fullMetrics : safeMetrics,
    departmentMetrics: isPlainObject(departmentMetrics) ? departmentMetrics : null,
  };
}
