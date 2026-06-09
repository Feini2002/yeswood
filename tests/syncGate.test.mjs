import test from 'node:test';
import assert from 'node:assert/strict';

import { reserveSyncGate } from '../src/backend/syncGate.mjs';

test('reserveSyncGate rejects a second sync while the first is in flight', () => {
  const config = { syncMinIntervalMs: 60_000, syncState: { lastSyncAt: 0 } };

  const first = reserveSyncGate(config);
  const second = reserveSyncGate(config);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.status, 429);
  assert.equal(second.message, 'Sync is already running');

  first.release();

  const retry = reserveSyncGate(config);
  assert.equal(retry.allowed, true);
  retry.release();
});

test('reserveSyncGate rate limits only after a committed sync', () => {
  const config = { syncMinIntervalMs: 60_000, syncState: { lastSyncAt: 0 } };

  const first = reserveSyncGate(config);
  assert.equal(first.allowed, true);
  first.commit();

  const second = reserveSyncGate(config);
  assert.equal(second.allowed, false);
  assert.equal(second.status, 429);
  assert.equal(second.message, 'Sync is rate limited');
});
