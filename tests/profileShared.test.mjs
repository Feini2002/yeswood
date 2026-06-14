import assert from 'node:assert/strict';
import test from 'node:test';

function installDocumentStub() {
  globalThis.document = {
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
  };
}

test('profile monthly ops markup renders numeric heat cells without overview page globals', async () => {
  installDocumentStub();
  const { renderProfileMonthlyOpsMarkup } = await import(`../public/pages/profile-shared.mjs?profile-monthly=${Date.now()}`);

  const html = renderProfileMonthlyOpsMarkup('direct', {
    monthlyOpsMatrix: {
      columns: [{ key: 'm1', label: '1月' }],
      rows: [
        {
          label: '平面方案',
          values: [{ key: 'floorPlan', tier: '已完成', value: 3, drillFilter: { metric: 'floorPlan' } }],
        },
      ],
    },
  });

  assert.match(html, /overview-monthly-grid/);
  assert.match(html, /--cell-heat:100%/);
});
