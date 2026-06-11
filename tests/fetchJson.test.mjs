import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchJson } from '../public/lib/api.mjs';

test('fetchJson keeps its timeout active when a caller signal is provided', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const callerController = new AbortController();
  let timeoutDelay = null;

  globalThis.fetch = async (_path, options = {}) =>
    new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  globalThis.setTimeout = (callback, delay) => {
    timeoutDelay = delay;
    queueMicrotask(callback);
    return 1;
  };
  globalThis.clearTimeout = () => {};

  try {
    const result = await Promise.race([
      fetchJson('/slow', { signal: callerController.signal, timeoutMs: 50 }).then(
        () => 'resolved',
        (error) => error
      ),
      new Promise((resolve) => originalSetTimeout(() => resolve('hung'), 20)),
    ]);

    assert.notEqual(result, 'hung');
    assert.match(result.message, /\/slow timed out after 50ms/);
    assert.equal(result.status, 504);
    assert.equal(timeoutDelay, 50);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
