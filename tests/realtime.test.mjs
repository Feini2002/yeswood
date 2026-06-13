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

test('startDevReload reloads the browser when the server sends a reload event', () => {
  let reloadCount = 0;
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
    locationRef: { reload: () => { reloadCount += 1; } },
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
});

test('startDevReload leaves the page stable when the development event stream disconnects', () => {
  let reloadCount = 0;
  const listeners = {};
  const timers = [];
  let closed = false;

  class FakeEventSource {
    constructor(url) {
      this.url = url;
    }

    addEventListener(type, listener) {
      listeners[type] = listener;
    }

    close() {
      closed = true;
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

  listeners.error();
  listeners.error();
  assert.equal(timers.length, 0);
  assert.equal(reloadCount, 0);
  assert.equal(closed, true);
});
