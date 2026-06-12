import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readSource(...segments) {
  return readFile(path.join(rootDir, ...segments), 'utf8');
}

test('AGENTS documents dashboard load performance regression guards', async () => {
  const agents = await readSource('AGENTS.md');
  assert.match(agents, /## 看板加载性能防复发规则/);
  assert.match(agents, /loadCoreDashboard/);
  assert.match(agents, /softRefresh/);
  assert.match(agents, /fields=ids/);
  assert.match(agents, /frontendLoadPerformancePolicy\.test\.mjs/);
});

test('core dashboard loader avoids duplicate metrics and default full project fetch', async () => {
  const source = await readSource('public', 'lib', 'dashboard-loader.mjs');
  assert.match(source, /DASHBOARD_SESSION_ENDPOINT/);
  assert.match(source, /export async function loadDashboardSession/);
  assert.match(source, /export async function loadCoreDashboard/);
  assert.match(source, /fetchJson\('\/api\/metrics'\)/);
  assert.doesNotMatch(source, /fetchJson\(`\/api\/metrics\$\{query\}`\)/);
  assert.equal((source.match(/fetchJson\('\/api\/metrics'\)/g) || []).length, 1);
  const loadDashboardBody = source.slice(
    source.indexOf('export async function loadDashboard(options'),
    source.indexOf('export async function softRefresh')
  );
  assert.match(loadDashboardBody, /loadDashboardSession\(options\)/);
  assert.doesNotMatch(loadDashboardBody, /loadCoreDashboard/);
  assert.match(source, /export async function loadProjectCatalog/);
  assert.match(source, /view: 'summary'/);
  assert.match(source, /export async function softRefresh/);
  assert.match(source, /export async function hardRefresh/);
  assert.match(source, /invalidateProjectCaches/);
  assert.match(source, /loadTeamPageModules[\s\S]*loadProjectCatalog/);
  assert.doesNotMatch(source, /Promise\.allSettled\(\[[\s\S]*loadProjectCatalog[\s\S]*loadTeamMetrics/);
});

test('router and app wire soft refresh instead of hard reload for filter hash', async () => {
  const [router, app] = await Promise.all([
    readSource('public', 'lib', 'router.mjs'),
    readSource('public', 'app.js'),
  ]);
  assert.match(router, /routerHooks\.refresh/);
  assert.doesNotMatch(router, /routerHooks\.refresh\?\.\(\)[\s\S]*loadDashboard/);
  assert.match(app, /refresh: softRefresh/);
  assert.match(app, /debouncedSoftRefresh/);
  assert.match(app, /softRefresh\(\)/);
  assert.doesNotMatch(app, /addEventListener\('change', refresh\)/);
});

test('project catalog owns summary cache, drill ids path, and invalidation', async () => {
  const source = await readSource('public', 'domain', 'project-catalog.mjs');
  assert.match(source, /projectsCatalogSignature/);
  assert.match(source, /export function invalidateProjectCaches/);
  assert.match(source, /export async function resolveDrillProjects/);
  assert.match(source, /params\.set\('fields', 'ids'\)/);
  assert.match(source, /export function peekDrillProjectsCache/);
  assert.match(source, /export async function fetchProjectDetail/);
  assert.match(source, /view=full/);
  assert.doesNotMatch(source, /fetchJson\(`\/api\/projects\$\{toQuery\(filters\)\}`\)/);
});

test('team completion session cache requires ready detail and quick read-model fallback', async () => {
  const [loader, completionPage, completionStore] = await Promise.all([
    readSource('public', 'lib', 'dashboard-loader.mjs'),
    readSource('public', 'pages', 'team-work-completion.mjs'),
    readSource('public', 'domain', 'team-work-completion-store.mjs'),
  ]);

  assert.match(loader, /teamWorkCompletionHasDetail\(workCompletion\)[\s\S]*workCompletion\?\.detailStatus === 'ready'/);
  assert.match(completionPage, /timeoutMs: allowCompute \? 30_000 : 2_000/);
  assert.match(completionPage, /const mergedHasDetail = teamWorkCompletionHasDetail\(merged\)/);
  assert.match(completionPage, /reason: 'modal-retry'[\s\S]*force: true/);
  assert.match(completionStore, /review\.detailReady !== true/);
  assert.doesNotMatch(completionStore, /review\?\.detailReady \|\| hasProjectsById \|\| hasSourceProjects/);
});

test('drill modal uses cached drill projects before network resolve', async () => {
  const source = await readSource('public', 'components', 'drill-modal.mjs');
  assert.match(source, /peekDrillProjectsCache/);
  assert.match(source, /resolveDrillProjects/);
  assert.doesNotMatch(source, /fetchJson\(`\/api\/projects/);
});

test('backend projects API supports summary, ids-only drill, and cache invalidation', async () => {
  const [server, syncService, presentation] = await Promise.all([
    readSource('src', 'backend', 'server.mjs'),
    readSource('src', 'backend', 'syncService.mjs'),
    readSource('src', 'backend', 'projectPresentation.mjs'),
  ]);
  assert.match(server, /summarizeProjects/);
  assert.match(server, /fields === 'ids'/);
  assert.match(server, /projectsIdsCacheForConfig/);
  assert.doesNotMatch(server, /gzipSync/);
  assert.match(syncService, /projectsIdsCache/);
  assert.match(syncService, /teamWorkCompletionCache/);
  assert.match(syncService, /precomputeTeamDashboards/);
  assert.match(presentation, /export function summarizeProject/);
  assert.match(server, /resolveTeamWorkCompletionReview/);
  assert.match(server, /readPrecomputedTeamWorkCompletion/);
  assert.match(server, /gzipAsync/);
  assert.match(
    await readSource('src', 'backend', 'teamWorkCompletionReview.mjs'),
    /projectsById,/
  );
  assert.doesNotMatch(server, /projects: snapshot\.projects/);
});

test('dashboard launch schedules warmup without blocking development browser open', async () => {
  const [server, syncService, devLauncher, intranetLauncher] = await Promise.all([
    readSource('src', 'backend', 'server.mjs'),
    readSource('src', 'backend', 'syncService.mjs'),
    readSource('scripts', 'launch-dev-dashboard.ps1'),
    readSource('scripts', 'launch-intranet-dashboard.ps1'),
  ]);

  assert.match(server, /\/api\/dashboard-session/);
  assert.match(server, /readPrecomputedDashboardSession/);
  assert.match(server, /readPrecomputedTeamResponsibilityReview/);
  assert.match(server, /\/api\/dashboard-warmup/);
  assert.match(server, /ensureDashboardPrecompute/);
  assert.match(server, /sendJson\(response, 503/);
  assert.match(syncService, /ensureDashboardPrecompute/);
  assert.match(syncService, /readCurrentSnapshot[\s\S]*scheduleDashboardPrecompute\(snapshot, config\)/);
  assert.match(syncService, /normalizeSnapshot[\s\S]*scheduleDashboardPrecompute\(normalizedSnapshot, config\)/);
  assert.match(devLauncher, /api\/dashboard-warmup/);
  assert.match(devLauncher, /Start-DashboardWarmup/);
  assert.match(devLauncher, /dashboard data is warming in the background/);
  assert.match(devLauncher, /\$snapshot\.warmed -ne \$true/);
  assert.doesNotMatch(devLauncher, /opening browser anyway/);
  assert.match(intranetLauncher, /api\/dashboard-warmup/);
  assert.match(intranetLauncher, /\$env:DATA_DIR=\$SNAPSHOT_DATA/);
  assert.match(intranetLauncher, /\$env:PRECOMPUTE_DIR=\(Join-Path \$SNAPSHOT_DATA 'precomputed'\)/);
  assert.match(intranetLauncher, /\$snapshot\.warmed -ne \$true/);
  assert.ok(devLauncher.indexOf('Start-DashboardWarmup') < devLauncher.indexOf('Start-Process "http://localhost:$Port/"'));
});

test('renderAll only repaints active page shell', async () => {
  const source = await readSource('public', 'lib', 'dashboard-loader.mjs');
  assert.match(source, /if \(pageId === 'overview'\)/);
  assert.match(source, /else if \(pageId === 'details'\)/);
  assert.match(source, /else if \(pageId === 'teams'\)/);
});
