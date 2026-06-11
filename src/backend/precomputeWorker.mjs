import { parentPort, workerData } from 'node:worker_threads';

import { precomputeTeamDashboards } from './precomputeTeamDashboards.mjs';

try {
  const manifest = await precomputeTeamDashboards(workerData.snapshot, {
    config: workerData.config || {},
  });
  parentPort?.postMessage({
    ok: true,
    snapshotHash: manifest.snapshotHash,
    features: manifest.features,
  });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    message: error?.message || String(error),
  });
  process.exitCode = 1;
}
