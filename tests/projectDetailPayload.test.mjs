import assert from 'node:assert/strict';
import test from 'node:test';

import { compactProjectForDetailReadModel } from '../src/backend/projectDetailPayload.mjs';

test('compactProjectForDetailReadModel keeps detail fields without volatile attachments', () => {
  const detail = compactProjectForDetailReadModel({
    id: 'p1',
    name: 'Project One',
    province: 'Zhejiang',
    businessType: 'Flagship',
    ignoredHeavyField: 'do not copy',
    rawFields: {
      usefulNote: { display: 'Ready for modal', kind: 'text' },
      emptyField: { display: '   ', kind: 'text' },
      attachmentUrl: {
        display: 'https://example.test/file?Expires=1781147357&Signature=keep-out-of-detail',
        kind: 'url',
      },
    },
    recordMeta: {
      id: 'rec1',
      createdTime: '2026-01-01T00:00:00.000Z',
      lastModifiedTime: '2026-06-01T00:00:00.000Z',
    },
  });

  assert.equal(detail.id, 'p1');
  assert.equal(detail.name, 'Project One');
  assert.equal(detail.province, 'Zhejiang');
  assert.equal(detail.businessType, 'Flagship');
  assert.equal(detail.ignoredHeavyField, undefined);
  assert.equal(detail.rawFields.usefulNote.display, 'Ready for modal');
  assert.equal(detail.rawFields.emptyField, undefined);
  assert.equal(detail.rawFields.attachmentUrl, undefined);
  assert.deepEqual(detail.recordMeta, {
    id: 'rec1',
    lastModifiedTime: '2026-06-01T00:00:00.000Z',
  });
});
