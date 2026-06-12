import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readFile } from 'node:fs/promises';
import { createServer } from '../src/backend/server.mjs';

async function withTestServer(configOverrides, run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-browser-sync-'));
  const config = {
    port: 0,
    mode: 'mock',
    cacheFile: path.join(tempDir, 'dashboard-cache.json'),
    precomputeDir: path.join(tempDir, 'precomputed'),
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
    await run(baseUrl, config);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('browser dashboard sync is disabled unless explicitly enabled server-side', async () => {
  await withTestServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/dashboard-sync`, {
      method: 'POST',
      headers: {
        origin: baseUrl,
        'x-dashboard-action': 'sync',
      },
    });

    assert.equal(response.status, 403);
  });
});

test('browser dashboard sync rejects cross-site or form-style requests', async () => {
  await withTestServer({ dashboardSyncEnabled: true }, async (baseUrl) => {
    const missingHeader = await fetch(`${baseUrl}/api/dashboard-sync`, {
      method: 'POST',
      headers: { origin: baseUrl },
    });

    const crossSite = await fetch(`${baseUrl}/api/dashboard-sync`, {
      method: 'POST',
      headers: {
        origin: 'https://example.invalid',
        'x-dashboard-action': 'sync',
      },
    });

    assert.equal(missingHeader.status, 403);
    assert.equal(crossSite.status, 403);
  });
});

test('enabled same-origin dashboard sync refreshes the backend cache without frontend secrets', async () => {
  await withTestServer({ dashboardSyncEnabled: true }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/dashboard-sync`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        origin: baseUrl,
        'x-dashboard-action': 'sync',
      },
    });

    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.source, 'mock');
    assert.equal(payload.readOnly, true);
    assert.ok(payload.totalRecords > 0);
    assert.equal(Object.hasOwn(payload, 'syncApiKey'), false);
  });

  const publicApp = await readFile(path.join(process.cwd(), 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(publicApp, /x-sync-key/i);
  assert.doesNotMatch(publicApp, /SYNC_API_KEY/);
});

test('enabled browser dashboard sync waits for read model warmup before reporting success', async () => {
  await withTestServer(
    {
      dashboardSyncEnabled: true,
      precomputeScheduler: () => {},
    },
    async (baseUrl, config) => {
      const response = await fetch(`${baseUrl}/api/dashboard-sync`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          origin: baseUrl,
          'x-dashboard-action': 'sync',
        },
      });
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.source, 'mock');
      const manifestPath = path.join(path.dirname(config.precomputeDir), 'read-model', 'current', 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      assert.equal(manifest.readModel, true);
      assert.ok(manifest.features.includes('team-work-completion-detail'));
    }
  );
});

test('failed admin sync does not consume the next successful retry rate limit', async () => {
  await withTestServer({ syncMinIntervalMs: 60_000 }, async (baseUrl) => {
    const failed = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-sync-key': 'server-only-secret',
      },
      body: JSON.stringify({ source: 'unsupported-source' }),
    });

    const retry = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-sync-key': 'server-only-secret',
      },
      body: JSON.stringify({ source: 'mock' }),
    });
    const payload = await retry.json();

    assert.equal(failed.status, 500);
    assert.equal(retry.status, 200);
    assert.equal(payload.source, 'mock');
  });
});

test('sync rate limit state is scoped to each server instance', async () => {
  const overrides = { syncMinIntervalMs: 60_000 };

  await withTestServer(overrides, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-sync-key': 'server-only-secret',
      },
      body: JSON.stringify({ source: 'mock' }),
    });

    assert.equal(response.status, 200);
  });

  await withTestServer(overrides, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-sync-key': 'server-only-secret',
      },
      body: JSON.stringify({ source: 'mock' }),
    });

    assert.equal(response.status, 200);
  });
});

test('metrics endpoint merges local personnel architecture attributes', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-personnel-architecture-'));
  const architectureFile = path.join(tempDir, 'personnel-architecture.json');
  await fs.writeFile(
    architectureFile,
    JSON.stringify({
      version: 1,
      roleDisciplines: {
        cdLead: 'hard',
        vmLead: 'soft',
      },
    }),
    'utf8'
  );

  await withTestServer({ personnelArchitectureFile: architectureFile }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/metrics`);
    const metrics = await response.json();
    const cdRole = metrics.personnel.roles.find((role) => role.key === 'cdLead');
    const vmRole = metrics.personnel.roles.find((role) => role.key === 'vmLead');

    assert.equal(cdRole.disciplineLabel, '硬装');
    assert.equal(vmRole.disciplineLabel, '软装');
  });
});

test('personnel architecture endpoint reads and writes the local SQLite master data', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-personnel-api-'));
  const architectureFile = path.join(tempDir, 'personnel.json');
  await fs.writeFile(
    architectureFile,
    JSON.stringify({
      people: [
        { id: 'owner-chen', name: '陈立营', position: 'owner', discipline: 'hard', status: 'active' },
        { id: 'lead-zhang', name: '张宸瑞', position: 'lead', discipline: 'hard', status: 'active' },
        { id: 'lead-qing', name: '张情', position: 'lead', discipline: 'soft', status: 'active' },
      ],
      roleGroups: {
        cdLead: { position: 'lead', discipline: 'hard', people: ['张宸瑞'] },
        vmLead: { position: 'lead', discipline: 'soft', people: ['张情'] },
      },
      teams: [{ id: 'team-chen', owner: '陈立营', cdLeads: ['张宸瑞'], vmLeads: ['张情'] }],
    }),
    'utf8'
  );

  await withTestServer(
    {
      databaseFile: path.join(tempDir, 'app.sqlite'),
      personnelDatabaseFile: architectureFile,
    },
    async (baseUrl) => {
      const readResponse = await fetch(`${baseUrl}/api/personnel/architecture`);
      const architecture = await readResponse.json();

      architecture.people.张情.discipline = 'hard';
      architecture.roleGroups.cdLead.people.push('张情');
      architecture.roleGroups.vmLead.people = [];
      architecture.teams[0].cdLeads.push('张情');
      architecture.teams[0].vmLeads = [];

      const writeResponse = await fetch(`${baseUrl}/api/personnel/architecture`, {
        method: 'PUT',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          origin: baseUrl,
          'x-dashboard-action': 'personnel-save',
        },
        body: JSON.stringify({ architecture }),
      });
      const saved = await writeResponse.json();

      assert.equal(readResponse.status, 200);
      assert.equal(writeResponse.status, 200);
      assert.equal(saved.storage, 'sqlite');
      assert.equal(saved.roleGroups.cdLead.people.includes('张情'), true);
      assert.deepEqual(saved.teams[0].vmLeads, []);
    }
  );
});

test('personnel architecture edits require same-origin save intent', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-personnel-api-gate-'));
  const architectureFile = path.join(tempDir, 'personnel.json');
  await fs.writeFile(
    architectureFile,
    JSON.stringify({
      people: [{ id: 'owner-chen', name: '陈立营', position: 'owner', discipline: 'hard', status: 'active' }],
      teams: [{ id: 'team-chen', owner: '陈立营', cdLeads: [], vmLeads: [] }],
    }),
    'utf8'
  );

  await withTestServer(
    {
      databaseFile: path.join(tempDir, 'app.sqlite'),
      personnelDatabaseFile: architectureFile,
    },
    async (baseUrl) => {
      const missingHeader = await fetch(`${baseUrl}/api/personnel/architecture`, {
        method: 'PUT',
        headers: { origin: baseUrl, 'content-type': 'application/json' },
        body: JSON.stringify({ people: [] }),
      });
      const crossSite = await fetch(`${baseUrl}/api/personnel/architecture`, {
        method: 'PUT',
        headers: {
          origin: 'https://example.invalid',
          'content-type': 'application/json',
          'x-dashboard-action': 'personnel-save',
        },
        body: JSON.stringify({ people: [] }),
      });

      assert.equal(missingHeader.status, 403);
      assert.equal(crossSite.status, 403);
    }
  );
});

test('frontend sync control calls the browser sync endpoint without embedding the admin key', async () => {
  const publicDir = path.join(process.cwd(), 'public');
  const [html, publicApp, dashboardLoader, apiModule] = await Promise.all([
    readFile(path.join(publicDir, 'index.html'), 'utf8'),
    readFile(path.join(publicDir, 'app.js'), 'utf8'),
    readFile(path.join(publicDir, 'lib', 'dashboard-loader.mjs'), 'utf8'),
    readFile(path.join(publicDir, 'lib', 'api.mjs'), 'utf8'),
  ]);
  const frontendBundle = `${publicApp}\n${dashboardLoader}\n${apiModule}`;

  assert.match(html, /id="syncButton"/);
  assert.match(frontendBundle, /\/api\/dashboard-sync/);
  assert.match(frontendBundle, /x-dashboard-action/);
  assert.match(frontendBundle, /syncDingTalk/);
  assert.doesNotMatch(frontendBundle, /x-sync-key/i);
  assert.doesNotMatch(frontendBundle, /SYNC_API_KEY/);
});

test('dev reload endpoint exposes a server-sent event stream for local hot updates', async () => {
  await withTestServer({}, async (baseUrl) => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/dev-events`, {
      signal: controller.signal,
    });

    const text = await response.body.getReader().read().then(({ value }) => Buffer.from(value).toString('utf8'));
    controller.abort();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.match(text, /event: connected/);
  });

  const publicApp = await readFile(path.join(process.cwd(), 'public', 'app.js'), 'utf8');
  assert.match(publicApp, /startDevReload/);
});

test('dev reload endpoint can be disabled for stable intranet displays', async () => {
  await withTestServer({ devReloadEnabled: false }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/dev-events`);

    assert.equal(response.status, 404);
    assert.doesNotMatch(response.headers.get('content-type') || '', /text\/event-stream/);
  });
});

test('snapshot endpoint exposes whether browser auto update checks are enabled', async () => {
  await withTestServer({ dashboardAutoUpdateEnabled: false }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/snapshot`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.dashboardAutoUpdateEnabled, false);
  });
});

test('snapshot endpoint separates developer documentation from intranet display mode', async () => {
  await withTestServer({ devReloadEnabled: true, dashboardAutoUpdateEnabled: true }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/snapshot`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.developerDocumentationVisible, true);
    assert.equal(payload.dashboardDisplayMode, 'development');
  });

  await withTestServer({ devReloadEnabled: false, dashboardAutoUpdateEnabled: false }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/snapshot`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.developerDocumentationVisible, false);
    assert.equal(payload.dashboardDisplayMode, 'intranet');
  });
});

test('static server can serve dashboard files from a configured snapshot public directory', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-public-snapshot-'));
  const publicDir = path.join(tempDir, 'public');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'index.html'), '<main>stable intranet snapshot</main>', 'utf8');

  await withTestServer({ publicDir, devReloadEnabled: false }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /stable intranet snapshot/);
  });
});

test('static server serves dashboard ES modules with javascript mime type', async () => {
  await withTestServer({}, async (baseUrl) => {
    const modules = [
      '/dashboard/tooltip.mjs',
      '/dashboard/chart-bar.mjs',
      '/dashboard/chart-column.mjs',
      '/dashboard/insight-card.mjs',
      '/dashboard/empty-state.mjs',
    ];

    for (const modulePath of modules) {
      const response = await fetch(`${baseUrl}${modulePath}`);
      assert.equal(response.status, 200, modulePath);
      assert.match(response.headers.get('content-type'), /text\/javascript/, modulePath);
    }
  });
});
