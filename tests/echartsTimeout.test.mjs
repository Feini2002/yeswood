import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { fakeElement } from '../public/test-harness.mjs';

function setupFakeDom() {
  const body = fakeElement();
  globalThis.document = {
    querySelector: fakeElement,
    querySelectorAll: () => [],
    createElement: fakeElement,
    addEventListener() {},
    removeEventListener() {},
    body,
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    document: globalThis.document,
  };
  globalThis.__PUBLIC_APP_TEST_HARNESS__ = true;
}

test('annual entry ECharts loader times out when the module import hangs', async () => {
  const { loadECharts } = await import('../public/dashboard/annual-entry-structure.mjs');

  await assert.rejects(
    () =>
      loadECharts({
        timeoutMs: 1,
        importer: () => new Promise(() => {}),
      }),
    /ECharts import timed out after 1ms/
  );
});

test('team completion ECharts loader times out when the module import hangs', async () => {
  setupFakeDom();
  const { loadTeamCompletionECharts } = await import('../public/pages/team-work-completion.mjs');

  await assert.rejects(
    () =>
      loadTeamCompletionECharts({
        timeoutMs: 1,
        importer: () => new Promise(() => {}),
      }),
    /ECharts import timed out after 1ms/
  );
});

test('ECharts loaders apply a default timeout for production imports', async () => {
  const annualSource = await readFile(join(process.cwd(), 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const teamSource = await readFile(join(process.cwd(), 'public', 'pages', 'team-work-completion.mjs'), 'utf8');

  assert.match(annualSource, /DEFAULT_ECHARTS_IMPORT_TIMEOUT_MS = 8000/);
  assert.match(annualSource, /Object\.hasOwn\(options, 'timeoutMs'\) \? options\.timeoutMs : DEFAULT_ECHARTS_IMPORT_TIMEOUT_MS/);
  assert.match(teamSource, /TEAM_COMPLETION_ECHARTS_IMPORT_TIMEOUT_MS = 8000/);
  assert.match(
    teamSource,
    /Object\.hasOwn\(options, 'timeoutMs'\)[\s\S]*TEAM_COMPLETION_ECHARTS_IMPORT_TIMEOUT_MS/
  );
});
