export function reserveSyncGate(config) {
  const syncState = config.syncState || { lastSyncAt: 0, inFlight: false };
  config.syncState = syncState;
  const now = Date.now();
  const minIntervalMs = Number(config.syncMinIntervalMs || 0);

  if (syncState.inFlight) {
    return { allowed: false, status: 429, message: 'Sync is already running' };
  }
  if (minIntervalMs > 0 && now - Number(syncState.lastSyncAt || 0) < minIntervalMs) {
    return { allowed: false, status: 429, message: 'Sync is rate limited' };
  }

  syncState.inFlight = true;
  let released = false;
  return {
    allowed: true,
    commit() {
      if (released) {
        return;
      }
      syncState.lastSyncAt = Date.now();
      syncState.inFlight = false;
      released = true;
    },
    release() {
      if (released) {
        return;
      }
      syncState.inFlight = false;
      released = true;
    },
  };
}
