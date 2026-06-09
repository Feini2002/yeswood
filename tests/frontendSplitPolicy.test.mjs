import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeElement } from '../public/test-harness.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function exists(...segments) {
  try {
    await access(path.join(rootDir, ...segments));
    return true;
  } catch {
    return false;
  }
}

test('frontend split keeps third-party frontend libraries out of runtime package deps', async () => {
  const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));

  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.scripts['vendor:frontend'], undefined);
  assert.equal(await exists('public', 'vendor'), false);
});

function installFrontendGlobals() {
  const body = fakeElement();
  const documentRef = {
    querySelector: fakeElement,
    querySelectorAll: () => [],
    createElement: fakeElement,
    addEventListener() {},
    removeEventListener() {},
    body,
  };
  const windowRef = {
    location: { hash: '' },
    history: { replaceState() {}, pushState() {} },
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: documentRef,
  };

  globalThis.window = windowRef;
  globalThis.document = documentRef;
  globalThis.location = windowRef.location;
  globalThis.history = windowRef.history;
  globalThis.localStorage = { getItem: () => '', setItem() {}, removeItem() {} };
  globalThis.URLSearchParams = URLSearchParams;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  globalThis.__PUBLIC_APP_TEST_HARNESS__ = true;
}

test('profile split modules execute store segment and overview model paths', async () => {
  installFrontendGlobals();
  const {
    buildProfileDashboardModel,
    buildProfileSegmentMatrix,
    renderDashboardProfile,
  } = await import('../public/pages/profile-shared.mjs');

  const metrics = {
    scopeCount: 3,
    pausedCount: 0,
    totals: { projectCount: 3, inProgress: 2, notStarted: 1, openDelayed: 1 },
    storeSegments: {
      'newStore-regular': { projectCount: 2, inProgress: 1, openDelayed: 1 },
      'renovated-sinking': { projectCount: 1, inProgress: 1, openDelayed: 0 },
    },
    metricDefinitions: {},
  };

  const matrix = buildProfileSegmentMatrix(metrics);
  assert.equal(matrix.rows.length, 2);
  assert.equal(matrix.columns.length, 2);
  assert.equal(matrix.cells.length, 4);
  assert.equal(matrix.cells.find((cell) => cell.key === 'newStore-regular')?.delayed, 1);

  const model = buildProfileDashboardModel('franchise', metrics, [
    { id: 'p-1', name: '加盟新店', businessType: 'franchise', storeStatus: '常规店', storeNature: '新店' },
  ]);
  assert.equal(typeof model, 'object');

  const grid = fakeElement();
  renderDashboardProfile(metrics, grid, { profile: 'franchise', drillable: true });
  assert.match(grid.innerHTML, /加盟任务总量|项目总数/);
});

test('team tier board render path has all split imports wired', async () => {
  installFrontendGlobals();
  const { elements } = await import('../public/lib/dom.mjs');
  const board = fakeElement();
  elements.teamTierKpiBoard = board;

  const { renderOwnerMonthlyTierBoard } = await import('../public/components/drill-modal.mjs');
  const rendered = renderOwnerMonthlyTierBoard({
    owner: '测试负责人',
    tiers: {
      regular: { projectCount: 2, inProgress: 1, openDelayed: 1 },
    },
    tierOrder: ['regular'],
    tierLabels: { regular: '常规店' },
    metricDefinitions: {},
  });

  assert.equal(rendered, true);
  assert.match(board.innerHTML, /常规店/);
  assert.doesNotMatch(board.innerHTML, /店态\/small/);
});
