export const DASHBOARD_UPDATE_CHECK_INTERVAL_MS = 30_000;

const SIGNATURE_KEYS = ['source', 'syncedAt', 'sourceRecords', 'totalRecords', 'ignoredRecords', 'fieldCount'];

export function snapshotSignature(snapshot) {
  if (!snapshot) {
    return '';
  }

  return SIGNATURE_KEYS.map((key) => String(snapshot[key] ?? '')).join('|');
}

export function shouldReloadDashboard(currentSnapshot, nextSnapshot) {
  if (!nextSnapshot) {
    return false;
  }

  if (!currentSnapshot) {
    return true;
  }

  return snapshotSignature(currentSnapshot) !== snapshotSignature(nextSnapshot);
}

export function startDevReload({
  EventSourceImpl = globalThis.EventSource,
  locationRef = globalThis.location,
  setTimeoutImpl = globalThis.setTimeout,
} = {}) {
  if (!EventSourceImpl || !locationRef?.reload) {
    return null;
  }

  const source = new EventSourceImpl('/api/dev-events');
  let reloadScheduled = false;
  const scheduleReload = () => {
    if (reloadScheduled) {
      return;
    }
    reloadScheduled = true;
    setTimeoutImpl(() => {
      locationRef.reload();
    }, 800);
  };

  source.addEventListener('reload', () => {
    scheduleReload();
  });
  source.addEventListener('error', () => {
    source.close?.();
  });
  return source;
}
