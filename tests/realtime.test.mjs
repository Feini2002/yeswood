import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldReloadDashboard, snapshotSignature, startDevReload } from '../public/realtime.js';

test('snapshotSignature keeps stable snapshots from triggering full dashboard reloads', () => {
  const snapshot = {
    source: 'dingtalk',
    syncedAt: '2026-05-26T10:00:00.000Z',
    sourceRecords: 120,
    totalRecords: 118,
    ignoredRecords: 2,
    fieldCount: 24,
  };

  assert.equal(snapshotSignature(snapshot), snapshotSignature({ ...snapshot }));
  assert.equal(shouldReloadDashboard(snapshot, { ...snapshot }), false);
});

test('snapshotSignature changes when content hash or data revision changes', () => {
  const snapshot = {
    source: 'dingtalk',
    syncedAt: '2026-05-26T10:00:00.000Z',
    sourceRecords: 120,
    totalRecords: 118,
    ignoredRecords: 2,
    fieldCount: 24,
    contentHash: 'content-a',
    dataRevision: 'revision-a',
  };

  assert.notEqual(snapshotSignature(snapshot), snapshotSignature({ ...snapshot, contentHash: 'content-b' }));
  assert.notEqual(snapshotSignature(snapshot), snapshotSignature({ ...snapshot, dataRevision: 'revision-b' }));
});

test('shouldReloadDashboard reloads when the backend snapshot changes', () => {
  const currentSnapshot = {
    source: 'dingtalk',
    syncedAt: '2026-05-26T10:00:00.000Z',
    sourceRecords: 120,
    totalRecords: 118,
    ignoredRecords: 2,
    fieldCount: 24,
  };
  const nextSnapshot = {
    ...currentSnapshot,
    syncedAt: '2026-05-26T10:00:30.000Z',
    totalRecords: 119,
  };

  assert.equal(shouldReloadDashboard(currentSnapshot, nextSnapshot), true);
});

test('shouldReloadDashboard ignores missing update checks', () => {
  assert.equal(shouldReloadDashboard({ syncedAt: '2026-05-26T10:00:00.000Z' }, null), false);
  assert.equal(shouldReloadDashboard(null, { syncedAt: '2026-05-26T10:00:00.000Z' }), true);
});

test('startDevReload persists runtime state before browser reload', () => {
  let reloadCount = 0;
  const callOrder = [];
  const listeners = {};
  const timers = [];

  class FakeEventSource {
    constructor(url) {
      this.url = url;
    }

    addEventListener(type, listener) {
      listeners[type] = listener;
    }
  }

  const source = startDevReload({
    EventSourceImpl: FakeEventSource,
    locationRef: {
      reload: () => {
        callOrder.push('reload');
        reloadCount += 1;
      },
    },
    beforeReload: () => {
      callOrder.push('persist');
    },
    setTimeoutImpl: (callback) => {
      timers.push(callback);
      return timers.length;
    },
  });

  assert.equal(source.url, '/api/dev-events');
  listeners.reload();
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(reloadCount, 1);
  assert.deepEqual(callOrder, ['persist', 'reload']);
});

test('startDevReload reconnects after the development event stream disconnects', () => {
  let reloadCount = 0;
  const sources = [];
  const timers = [];
  let closeCount = 0;

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      sources.push(this);
    }

    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }

    close() {
      closeCount += 1;
    }
  }

  startDevReload({
    EventSourceImpl: FakeEventSource,
    locationRef: { reload: () => { reloadCount += 1; } },
    setTimeoutImpl: (callback) => {
      timers.push(callback);
      return timers.length;
    },
  });

  assert.equal(sources.length, 1);
  sources[0].listeners.error();
  assert.equal(reloadCount, 0);
  assert.equal(closeCount, 1);
  assert.equal(timers.length, 1);

  timers[0]();
  assert.equal(sources.length, 2);
  sources[1].listeners.reload();
  assert.equal(timers.length, 2);
  timers[1]();
  assert.equal(reloadCount, 1);
});
