#!/usr/bin/env node
/**
 * 钉钉个人盘 fixture 对账（warn-only，非阻塞 CI/合并）。
 * 与立法口径 diff 时打印 DingTalk KPI diffs，退出码恒为 0（数据缺失除外）。
 * 立法契约见 docs/contracts/dashboard-metrics.md；范嘉瑞截图为个人参考，非系统立法。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareBenchmark, formatCalibrationReport } from '../src/backend/metrics/calibrate.mjs';
import { getConfig } from '../src/backend/config.mjs';
import { openInitializedDatabase } from '../src/backend/database.mjs';
import { readConfiguredPersonnelArchitecture } from '../src/backend/syncService.mjs';
import { databaseHasProjects, readSnapshotFromDatabase } from '../src/backend/projectRepository.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const benchmarksDir = path.join(__dirname, '../tests/fixtures/benchmarks');
const legacyFixture = path.join(__dirname, '../tests/fixtures/dingtalk-benchmark-fanjiaRui.json');

async function loadBenchmarkFiles() {
  const files = [];
  try {
    const names = await fs.readdir(benchmarksDir);
    for (const name of names.filter((item) => item.endsWith('.json'))) {
      files.push(path.join(benchmarksDir, name));
    }
  } catch {
    // ignore
  }
  if (!files.length) {
    files.push(legacyFixture);
  }
  return files;
}

async function loadProjects(config) {
  if (config.databaseFile) {
    const database = openInitializedDatabase(config.databaseFile);
    try {
      if (databaseHasProjects(database)) {
        const architecture = await readConfiguredPersonnelArchitecture(config);
        const snapshot = readSnapshotFromDatabase(database, { personnelArchitecture: architecture });
        return { projects: snapshot.projects || [], personnelArchitecture: architecture };
      }
    } finally {
      database.close();
    }
  }

  const { readSnapshot } = await import('../src/backend/storage.mjs');
  const snapshot = await readSnapshot(config.cacheFile);
  return {
    projects: snapshot?.projects || [],
    personnelArchitecture: snapshot?.personnelArchitecture || {},
  };
}

async function main() {
  const config = getConfig();
  const benchmarkFiles = await loadBenchmarkFiles();
  const { projects, personnelArchitecture } = await loadProjects(config);

  if (!projects.length) {
    console.error('No projects found. Run sync first.');
    process.exit(1);
  }

  for (const file of benchmarkFiles) {
    const benchmark = JSON.parse(await fs.readFile(file, 'utf8'));
    const result = compareBenchmark(projects, benchmark, { personnelArchitecture });
    console.log(formatCalibrationReport(result));
    console.log(`Fixture: ${path.basename(file)}\n`);
    if (!result.summary.withinTolerance) {
      console.warn(
        `[warn] ${path.basename(file)}: max abs diff ${result.summary.maxAbsDiff} exceeds ±${result.summary.tolerance} (non-blocking; see docs/contracts/dashboard-metrics.md)`
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
