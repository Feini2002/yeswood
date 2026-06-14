const TEAM_SCOPE_MODULES = ['metrics', 'completion', 'ownerReview'];
const TEAM_SCOPE_STATUSES = new Set(['idle', 'ready', 'preparing', 'partial', 'error']);

function normalizeStatus(status) {
  return TEAM_SCOPE_STATUSES.has(status) ? status : 'idle';
}

function scopeKey({ owner = '', dashboardContext = 'all', year = '' } = {}) {
  return [String(owner || '').trim(), String(dashboardContext || 'all').trim(), String(year || '').trim()].join('\0');
}

function emptyModules(status = 'idle') {
  return Object.fromEntries(
    TEAM_SCOPE_MODULES.map((moduleName) => [
      moduleName,
      {
        status,
        reason: '',
        updatedAt: '',
      },
    ])
  );
}

export function createTeamScopeCoordinator() {
  let currentScopeKey = '';
  let currentScope = {};
  let modules = emptyModules();

  function prepareScope(scope = {}, status = 'preparing') {
    currentScope = { ...scope };
    currentScopeKey = scopeKey(scope);
    modules = emptyModules(normalizeStatus(status));
    return snapshot();
  }

  function setModuleStatus(moduleName, status, detail = {}) {
    if (!TEAM_SCOPE_MODULES.includes(moduleName)) {
      return snapshot();
    }
    modules = {
      ...modules,
      [moduleName]: {
        status: normalizeStatus(status),
        reason: detail.reason || '',
        updatedAt: new Date().toISOString(),
      },
    };
    return snapshot();
  }

  function applyResults(results = []) {
    const [metrics, completion, ownerReview] = results;
    setModuleStatus('metrics', metrics?.status === 'fulfilled' ? 'ready' : 'error', {
      reason: metrics?.reason?.message || '',
    });
    setModuleStatus('completion', completion?.status === 'fulfilled' ? 'ready' : 'error', {
      reason: completion?.reason?.message || '',
    });
    setModuleStatus('ownerReview', ownerReview?.status === 'fulfilled' ? 'ready' : 'error', {
      reason: ownerReview?.reason?.message || '',
    });
    return snapshot();
  }

  function snapshot() {
    const statuses = TEAM_SCOPE_MODULES.map((moduleName) => modules[moduleName]?.status || 'idle');
    const status = statuses.every((value) => value === 'ready')
      ? 'ready'
      : statuses.some((value) => value === 'error')
        ? 'partial'
        : statuses.some((value) => value === 'preparing')
          ? 'preparing'
          : 'idle';
    return {
      key: currentScopeKey,
      scope: { ...currentScope },
      status,
      modules: { ...modules },
    };
  }

  return {
    prepareScope,
    setModuleStatus,
    applyResults,
    snapshot,
  };
}

export const teamScopeCoordinator = createTeamScopeCoordinator();
