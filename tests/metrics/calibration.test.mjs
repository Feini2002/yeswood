import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareBenchmark } from '../../src/backend/metrics/calibrate.mjs';
import { listCoverageCells } from '../../src/backend/metrics/coverageMatrix.mjs';
import { composeDashboardMetrics } from '../../src/backend/metrics/composeDashboard.mjs';
import { getConfig } from '../../src/backend/config.mjs';
import { openInitializedDatabase } from '../../src/backend/database.mjs';
import { readSnapshotFromDatabase } from '../../src/backend/projectRepository.mjs';
import { readConfiguredPersonnelArchitecture } from '../../src/backend/syncService.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('coverage matrix includes profiles, tiers, and responsibility slots', () => {
  const cells = listCoverageCells();
  assert.ok(cells.some((cell) => cell.profileId === 'ownerMonthly' && cell.kpi === 'schemeDoneYtd'));
  assert.ok(cells.some((cell) => cell.slotKey === 'cd_lead'));
});

test('fanjiaRui benchmark structure includes franchise dashboard context', async () => {
  const fixturePath = path.join(__dirname, '../fixtures/benchmarks/fanjiaRui-owner-franchise.json');
  const benchmark = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  assert.equal(benchmark.dashboardContext, 'franchise');
  assert.ok(benchmark.targets.regular.schemeDoneYtd);
});

test('compareBenchmark returns diff summary (tolerance is advisory, not assert-gated)', async () => {
  const fixturePath = path.join(__dirname, '../fixtures/dingtalk-benchmark-fanjiaRui.json');
  const benchmark = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const projects = [
    {
      id: '1',
      owner: benchmark.owner,
      storeStatus: '常规店',
      rawFields: {
        负责人: { display: benchmark.owner },
        组别: { display: '加盟' },
        店态: { display: '常规店' },
        硬装项目进度: { display: '未开始' },
        '硬装方案情况（每周五刷新）': { display: '准时完成' },
      },
    },
  ];
  const result = compareBenchmark(projects, benchmark);
  assert.equal(result.owner, benchmark.owner);
  assert.ok(result.diffs.length > 0);
  assert.equal(typeof result.summary.withinTolerance, 'boolean');
  assert.equal(typeof result.summary.maxAbsDiff, 'number');
});

test('ownerMonthly live DB smoke: composeDashboardMetrics returns tier KPI numbers', async () => {
  const config = getConfig();
  if (!config.databaseFile) {
    return;
  }
  const database = openInitializedDatabase(config.databaseFile);
  try {
    const architecture = await readConfiguredPersonnelArchitecture(config);
    const snapshot = readSnapshotFromDatabase(database, { personnelArchitecture: architecture });
    const projects = snapshot.projects || [];
    if (projects.length < 50) {
      return;
    }
    const metrics = composeDashboardMetrics(projects, 'ownerMonthly', {
      owner: 'Jarvan范嘉瑞',
      dashboardContext: 'franchise',
      personnelArchitecture: architecture,
    });
    assert.ok(metrics.tiers.regular);
    assert.ok(metrics.tiers.sinking);
    for (const tier of ['regular', 'sinking']) {
      assert.equal(typeof metrics.tiers[tier].schemeDoneYtd, 'number');
      assert.equal(typeof metrics.tiers[tier].inProgress, 'number');
    }
  } finally {
    database.close();
  }
});
