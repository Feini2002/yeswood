import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createServer } from '../src/backend/server.mjs';
import { precomputeSnapshotHash, precomputeTeamDashboards } from '../src/backend/precomputeTeamDashboards.mjs';

function raw(display) {
  return { display };
}

const personnelArchitecture = {
  people: {
    苏佳蕾: { name: '苏佳蕾', displayName: '苏佳蕾' },
    陈菲菲: { name: '陈菲菲', displayName: '陈菲菲', aliases: ['菲菲'] },
    乔玲玲: { name: '乔玲玲', displayName: '乔玲玲' },
    李晓倩: { name: '李晓倩', displayName: '李晓倩' },
  },
  teams: [
    {
      owner: '苏佳蕾',
      groups: [{ name: '直营1组', lead: '陈菲菲', members: ['陈菲菲', '乔玲玲', '李晓倩'] }],
    },
  ],
  hiddenPeople: ['李晓倩'],
};

function record(recordId, overrides = {}) {
  const rawFields = {
    项目名称: raw(overrides.name || recordId),
    省份: raw('浙江'),
    业态: raw('旗舰店'),
    店态: raw('新店'),
    负责人: raw('苏佳蕾'),
    启动时间: raw('2026-01-01'),
    计划开业时间: raw('2026-08-01'),
    项目状态: raw('推进中'),
    组别: raw('直营新店'),
    CD设计师: raw('陈菲菲'),
    硬装项目进度: raw('闭环'),
    软装项目进度: raw('闭环'),
    项目闭环时间: raw('2026-06-15'),
    ...Object.fromEntries(Object.entries(overrides.fields || {}).map(([key, value]) => [key, raw(value)])),
  };
  return {
    id: recordId,
    name: overrides.name || recordId,
    province: '浙江',
    businessType: '旗舰店',
    storeStatus: '新店',
    status: '推进中',
    owner: '苏佳蕾',
    cdOwner: '苏佳蕾',
    vmOwner: '',
    progress: 100,
    startDate: '2026-01-01',
    dueDate: '2026-08-01',
    updatedAt: '2026-06-30T00:00:00.000Z',
    riskLevel: '低',
    rawFields,
  };
}

async function withTestServer(run, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-work-completion-api-'));
  const cacheFile = path.join(tempDir, 'dashboard-cache.json');
  const personnelArchitectureFile = path.join(tempDir, 'personnel-architecture.json');
  await fs.writeFile(personnelArchitectureFile, JSON.stringify(personnelArchitecture), 'utf8');
  const snapshotPayload = {
    version: 1,
    source: 'test',
    syncedAt: '2026-06-10T00:00:00.000Z',
    sourceRecords: 3,
    totalRecords: 3,
    ignoredRecords: 0,
    projects: [
      record('direct-2026'),
      record('franchise-2026', { fields: { 组别: '加盟新店', 项目闭环时间: '2026-06-16' } }),
      record('direct-2025', { fields: { 项目闭环时间: '2025-06-15' } }),
    ],
  };
  await fs.writeFile(
    cacheFile,
    JSON.stringify(snapshotPayload),
    'utf8'
  );

  const config = {
    port: 0,
    mode: 'empty',
    cacheFile,
    precomputeDir: path.join(tempDir, 'precomputed'),
    personnelArchitectureFile,
    syncApiKey: 'server-only-secret',
    syncMinIntervalMs: 0,
    dashboardSyncEnabled: false,
    databaseFile: '',
    dingtalk: {
      fieldMap: {},
      pageSize: 100,
      maxPages: 1,
    },
  };
  await options.beforeListen?.({ config, tempDir, cacheFile, snapshot: snapshotPayload });

  const server = createServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await run(port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${pathname}`, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, body: JSON.parse(body) });
          } catch {
            resolve({ status: response.statusCode, body });
          }
        });
      })
      .on('error', reject);
  });
}

test('/api/team-work-completion validates query parameters', async () => {
  await withTestServer(async (port) => {
    const missingOwner = await getJson(port, '/api/team-work-completion');
    assert.equal(missingOwner.status, 400);
    assert.match(missingOwner.body.error, /owner/i);

    const invalidContext = await getJson(
      port,
      `/api/team-work-completion?owner=${encodeURIComponent('苏佳蕾')}&context=unknown`
    );
    assert.equal(invalidContext.status, 400);
    assert.match(invalidContext.body.error, /context/);

    const invalidYear = await getJson(
      port,
      `/api/team-work-completion?owner=${encodeURIComponent('苏佳蕾')}&year=next`
    );
    assert.equal(invalidYear.status, 400);
    assert.match(invalidYear.body.error, /year/i);
  });
});

test('/api/team-work-completion prefers matching precomputed payloads', async () => {
  await withTestServer(
    async (port) => {
      const payload = await getJson(
        port,
        `/api/team-work-completion?owner=${encodeURIComponent('苏佳蕾')}&context=direct&year=2026`
      );

      assert.equal(payload.status, 200);
      assert.equal(payload.body.precomputedHit, true);
      assert.ok(Object.keys(payload.body.projectsById || {}).length > 0);
    },
    {
      beforeListen: async ({ config, snapshot: sourceSnapshot }) => {
        const precomputeSnapshot = {
          ...sourceSnapshot,
          personnelArchitecture,
        };
        await precomputeTeamDashboards(precomputeSnapshot, {
          config,
          contexts: ['direct'],
          years: [2026],
          now: new Date('2026-06-11T00:00:00.000Z'),
        });

        const snapshotHash = precomputeSnapshotHash(precomputeSnapshot, personnelArchitecture);
        const teamDir = path.join(config.precomputeDir, snapshotHash, 'team-work-completion');
        const [fileName] = await fs.readdir(teamDir);
        const filePath = path.join(teamDir, fileName);
        const precomputed = JSON.parse(await fs.readFile(filePath, 'utf8'));
        await fs.writeFile(filePath, `${JSON.stringify({ ...precomputed, precomputedHit: true })}\n`, 'utf8');
      },
    }
  );
});

test('/api/team-work-completion returns the clean work completion payload without breaking legacy review', async () => {
  await withTestServer(async (port) => {
    const payload = await getJson(
      port,
      `/api/team-work-completion?owner=${encodeURIComponent('苏佳蕾')}&context=direct&year=2026`
    );

    assert.equal(payload.status, 200);
    assert.equal(payload.body.readOnly, true);
    assert.equal(payload.body.owner, '苏佳蕾');
    assert.equal(payload.body.requestedOwner, '苏佳蕾');
    assert.equal(payload.body.dashboardContext, 'direct');
    assert.equal(payload.body.year, 2026);
    assert.equal(payload.body.summary.lifecycle.completedCount, 2);
    assert.equal(payload.body.monthly.months.length, 12);
    assert.deepEqual(payload.body.monthly.months[5].projectIds.lifecycle, []);
    assert.equal(payload.body.groups[0].leadDisplay, '陈菲菲');
    assert.deepEqual(payload.body.groups[0].memberNames, ['陈菲菲', '乔玲玲']);
    assert.ok(payload.body.members.some((member) => member.name === '陈菲菲'));
    assert.equal(payload.body.members.some((member) => member.name === '李晓倩'), false);

    const legacy = await getJson(port, `/api/team-responsibility-review?owner=${encodeURIComponent('苏佳蕾')}`);
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.owner, '苏佳蕾');

    const repeat = await getJson(
      port,
      `/api/team-work-completion?owner=${encodeURIComponent('苏佳蕾')}&context=direct&year=2026`
    );
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body.summary.lifecycle.completedCount, 2);
  });
});
