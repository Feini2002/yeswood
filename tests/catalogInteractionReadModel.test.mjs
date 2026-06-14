import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  READ_MODEL_SCHEMA_VERSION,
  readProjectCatalogSummaryReadModel,
} from '../src/backend/readModelRepository.mjs';

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

test('project catalog summary stays ready when interaction fields are missing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-interaction-read-model-'));
  const currentDir = path.join(tempDir, 'current');
  await writeJson(path.join(currentDir, 'manifest.json'), {
    schemaVersion: READ_MODEL_SCHEMA_VERSION,
    readModel: true,
    snapshotHash: 'catalog-base-only',
    generatedAt: '2026-06-14T00:00:00.000Z',
    features: ['project-catalog-summary'],
  });
  await writeJson(path.join(currentDir, 'project-catalog', 'summary.json'), {
    items: [
      {
        id: 'p1',
        name: 'Base Catalog Project',
        province: 'Zhejiang',
        businessType: 'Retail',
        storeStatus: 'Open',
        status: 'Normal',
        owner: 'Owner A',
      },
    ],
    total: 1,
    view: 'summary',
    fieldCatalog: [],
    readOnly: true,
  });

  const result = readProjectCatalogSummaryReadModel({ readModelDir: tempDir });

  assert.equal(result.status, 'ready');
  assert.equal(result.payload.items[0].name, 'Base Catalog Project');
  assert.equal(result.payload.interactionStatus, 'partial');
});
