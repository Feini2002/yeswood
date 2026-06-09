import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { redactSecrets } from '../src/backend/logger.mjs';
import { createServer } from '../src/backend/server.mjs';

async function withTestServer(configOverrides, run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-security-'));
  const config = {
    port: 0,
    mode: 'mock',
    cacheFile: path.join(tempDir, 'dashboard-cache.json'),
    syncApiKey: 'server-only-secret',
    syncMinIntervalMs: 0,
    dashboardSyncEnabled: false,
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
    ...configOverrides,
  };

  const server = createServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('redactSecrets masks token and secret values in logs', () => {
  const message = redactSecrets(
    'accessToken=abc123 AppSecret=my-secret token: xyz789 Authorization: Bearer live-token'
  );

  assert.equal(message.includes('abc123'), false);
  assert.equal(message.includes('my-secret'), false);
  assert.equal(message.includes('xyz789'), false);
  assert.equal(message.includes('live-token'), false);
  assert.match(message, /\[REDACTED\]/);
});

test('redactSecrets masks JSON-style API keys in log metadata', () => {
  const message = redactSecrets({
    syncApiKey: 'server-only-secret',
    nested: { api_key: 'local-key', xSyncKey: 'browser-key' },
  });

  assert.equal(message.includes('server-only-secret'), false);
  assert.equal(message.includes('local-key'), false);
  assert.equal(message.includes('browser-key'), false);
  assert.match(message, /\[REDACTED\]/);
});

test('server responses include baseline browser security headers', async () => {
  await withTestServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.match(response.headers.get('permissions-policy') || '', /geolocation=\(\)/);
  });
});

test('JSON write endpoints reject malformed, oversized, and non-json bodies', async () => {
  await withTestServer({ maxJsonBodyBytes: 32 }, async (baseUrl) => {
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-sync-key': 'server-only-secret',
    };

    const malformed = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers,
      body: '{"source":',
    });
    const oversized = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'mock', pad: 'x'.repeat(100) }),
    });
    const nonJson = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'text/plain',
        'x-sync-key': 'server-only-secret',
      },
      body: 'source=mock',
    });

    assert.equal(malformed.status, 400);
    assert.equal(oversized.status, 413);
    assert.equal(nonJson.status, 415);
  });
});

test('static server rejects malformed URL paths without a 500', async () => {
  await withTestServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/%E0%A4%A`);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /Invalid URL path/);
  });
});
