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

test('annual entry structure chart dependency is vendored as a public asset only', async () => {
  const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));

  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies?.echarts, '^6.1.0');
  assert.equal(await exists('public', 'assets', 'echarts', 'echarts.esm.min.mjs'), true);
});

test('router data loading remains decoupled from ordinary page switching', async () => {
  const [agents, app, router, dashboardLoader, teams, profileShared, publicBehaviorTests] = await Promise.all([
    readFile(path.join(rootDir, 'AGENTS.md'), 'utf8'),
    readFile(path.join(rootDir, 'public', 'app.js'), 'utf8'),
    readFile(path.join(rootDir, 'public', 'lib', 'router.mjs'), 'utf8'),
    readFile(path.join(rootDir, 'public', 'lib', 'dashboard-loader.mjs'), 'utf8'),
    readFile(path.join(rootDir, 'public', 'pages', 'teams.mjs'), 'utf8'),
    readFile(path.join(rootDir, 'public', 'pages', 'profile-shared.mjs'), 'utf8'),
    readFile(path.join(rootDir, 'tests', 'publicAppBehavior.test.mjs'), 'utf8'),
  ]);

  assert.match(agents, /## 路由与数据加载解耦防复发规则/);
  assert.match(agents, /showPage.*只负责页面外壳切换/);
  assert.match(agents, /loadDashboard.*唯一首屏/);
  assert.match(agents, /hashchange.*showPage/);
  assert.match(agents, /forceRefresh/);
  assert.match(agents, /保留当前可见内容/);
  assert.match(agents, /tests\/publicAppBehavior\.test\.mjs/);
  assert.match(agents, /## 看板加载性能防复发规则/);
  assert.match(agents, /frontendLoadPerformancePolicy\.test\.mjs/);
  assert.match(agents, /必须先完成 team metrics/);
  assert.match(agents, /team-work-completion/);

  assert.match(app, /showPage\(currentPageId\(\), \{ skipPageDataLoad: true \}\)/);
  assert.match(router, /const skipPageDataLoad = Boolean\(options\.skipPageDataLoad\)/);
  assert.match(router, /if \(!skipPageDataLoad && pageChanged && pageId === 'teams'\)/);
  assert.match(router, /if \(!skipPageDataLoad && pageChanged && \(pageId === 'franchise' \|\| pageId === 'direct'\)\)/);
  assert.match(dashboardLoader, /const forceRefresh = Boolean\(options\.forceRefresh\)/);
  assert.match(dashboardLoader, /loadTeamPageModules/);
  assert.match(dashboardLoader, /softRefresh/);
  assert.match(dashboardLoader, /invalidateProjectCaches/);
  assert.match(app, /refresh: softRefresh/);
  assert.match(app, /ensurePageProjects/);
  assert.match(teams, /teamMetricsCacheGeneration/);
  assert.match(teams, /cachedTeamWorkCompletion\(owner, dashboardContext, normalizedYear\)/);
  assert.match(teams, /cachedOwnerReview\(owner, dashboardContext\)/);
  assert.match(profileShared, /profileDashboardLoaded/);

  assert.match(publicBehaviorTests, /initial teams route loads dashboard session without page fanout/);
  assert.match(publicBehaviorTests, /hashchange handler keeps same-page teams query changes local without data reload/);
  assert.match(publicBehaviorTests, /team metrics owner switch keeps current operations overview visible while uncached owner loads/);
  assert.match(publicBehaviorTests, /team metrics batch ignores stale responses after dashboard context changes/);
  assert.match(publicBehaviorTests, /profile dashboard uses cached results by default and force refreshes explicitly/);
  assert.match(publicBehaviorTests, /drill project modal resolves team drill via fields=ids and cached catalog/);
  assert.match(publicBehaviorTests, /loadCoreDashboard fetches metrics once and skips project catalog/);
  assert.match(publicBehaviorTests, /softRefresh on details keeps local catalog without project API/);
  assert.match(publicBehaviorTests, /loadTeamPageModules preloads summary catalog for team drills/);
  assert.match(publicBehaviorTests, /repeat drill modal uses cached projects without second fields=ids request/);

  const [projectCatalog, drillModal] = await Promise.all([
    readFile(path.join(rootDir, 'public', 'domain', 'project-catalog.mjs'), 'utf8'),
    readFile(path.join(rootDir, 'public', 'components', 'drill-modal.mjs'), 'utf8'),
  ]);
  assert.match(projectCatalog, /resolveDrillProjects/);
  assert.match(projectCatalog, /fields=ids/);
  assert.match(projectCatalog, /invalidateProjectCaches/);
  assert.match(drillModal, /peekDrillProjectsCache/);

  const performancePolicy = await readFile(path.join(rootDir, 'tests', 'frontendLoadPerformancePolicy.test.mjs'), 'utf8');
  assert.match(performancePolicy, /core dashboard loader avoids duplicate metrics and default full project fetch/);
});

test('annual entry structure uses ECharts instead of self-built chart components', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');

  assert.match(source, /loadECharts/);
  assert.match(source, /entry-structure-chart-host/);
  assert.doesNotMatch(source, /chart-bar\.mjs/);
  assert.doesNotMatch(source, /renderBarChart/);
  assert.doesNotMatch(source, /entry-structure-bar-stack/);
});

test('annual entry structure keeps quadrant analysis out of the main view and opens project details as a modal', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');

  assert.match(source, /entry-structure-project-modal/);
  assert.match(source, /monthFromMainChartClickParams/);
  assert.doesNotMatch(source, /contextMode:\s*'month'/);
  assert.doesNotMatch(source, /entry-structure-project-drawer/);
  assert.doesNotMatch(source, /entry-structure-drawer-/);
  assert.doesNotMatch(source, /renderProjectDrawer/);
  assert.doesNotMatch(source, /entry-structure-quadrants-panel/);
  assert.doesNotMatch(source, /entry-structure-quadrant-digest/);
  assert.doesNotMatch(source, /renderQuadrantDigest/);
  assert.doesNotMatch(source, /renderQuadrants/);
});

test('annual entry structure renders V3 status strip and scope switch instead of explanation layers', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');

  assert.doesNotMatch(source, /function buildEntryStructureViewModel/);
  assert.match(source, /function renderEntryStatusStrip/);
  assert.match(source, /function renderScopeSwitch/);
  assert.match(source, /entry-structure-status-strip/);
  assert.match(source, /entry-structure-scope-switch/);
  assert.match(source, /entryAxisMonth/);
  assert.match(source, /entryAxisDirect/);
  assert.match(source, /entryAxisFranchise/);
  assert.doesNotMatch(source, /function renderEntryDecisionBand/);
  assert.doesNotMatch(source, /function renderContextInspector/);
  assert.doesNotMatch(source, /function renderMonthOptions/);
  assert.doesNotMatch(source, /entry-structure-decision-band/);
  assert.doesNotMatch(source, /entry-structure-inspector-primary/);
  assert.doesNotMatch(source, /data-entry-month-select/);
  assert.doesNotMatch(source, /entry-structure-inspector-action/);
  assert.doesNotMatch(source, /data-entry-open-projects/);
});

test('annual entry structure main chart keeps direct and franchise as two monthly bar groups', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const mainChartBlock = source.match(/function buildMainChartOption[\s\S]*?\nfunction getStoreStatusRows/)?.[0] || '';

  assert.match(mainChartBlock, /stack:\s*'direct'/);
  assert.match(mainChartBlock, /stack:\s*'franchise'/);
  assert.doesNotMatch(mainChartBlock, /stack:\s*'entry'/);
  assert.match(mainChartBlock, /monthChannelTotals/);
  assert.match(mainChartBlock, /barGap:\s*'18%'/);
});

test('annual entry structure main chart overlays low-emphasis store-age trend lines with point detail', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const mainChartBlock = source.match(/function buildMainChartOption[\s\S]*?\nfunction getStoreStatusRows/)?.[0] || '';

  assert.match(mainChartBlock, /trendSeriesConfig/);
  assert.match(mainChartBlock, /label:\s*'新店趋势'/);
  assert.match(mainChartBlock, /label:\s*'老店趋势'/);
  assert.match(mainChartBlock, /storeAgeLabel:\s*'新店'/);
  assert.match(mainChartBlock, /storeAgeLabel:\s*'老店'/);
  assert.match(mainChartBlock, /type:\s*'line'/);
  assert.match(mainChartBlock, /symbol:\s*'circle'/);
  assert.match(mainChartBlock, /symbolSize:\s*10/);
  assert.match(mainChartBlock, /lineType:\s*'dashed'/);
  assert.match(mainChartBlock, /lineType:\s*'dotted'/);
  assert.match(mainChartBlock, /lineStyle:\s*{[\s\S]*?color:\s*config\.color[\s\S]*?type:\s*config\.lineType[\s\S]*?opacity:\s*0\.72/);
  assert.match(mainChartBlock, /connectNulls:\s*false/);
  assert.match(mainChartBlock, /const trendValue = safeNumber\(totals\.total\)/);
  assert.match(mainChartBlock, /value:\s*trendValue > 0 \? trendValue : null/);
  assert.match(mainChartBlock, /const showStoreAgeTrendPointLabels = state\.showStoreAgeTrendPointLabels !== false/);
  assert.match(mainChartBlock, /show:\s*showStoreAgeTrendPointLabels/);
  assert.match(
    mainChartBlock,
    /showLabel:\s*[\s\S]*showStoreAgeTrendPointLabels[\s\S]*trendValue > 0[\s\S]*shouldShowStoreAgeTrendLabel/
  );
  assert.match(mainChartBlock, /storeAgeSideLegendMarkPoint/);
  assert.match(mainChartBlock, /emphasis:\s*{[\s\S]*?scale:\s*1\.25/);
  assert.match(mainChartBlock, /formatStoreAgeTrendTooltip/);
  assert.match(mainChartBlock, /较上月/);
  assert.match(mainChartBlock, /legendItems/);
  assert.match(mainChartBlock, /trendLegendIcon\s*=\s*'path:\/\//);
});

test('annual entry structure main chart exposes a horizontal month data zoom viewport', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const mainChartBlock = source.match(/function buildMainChartOption[\s\S]*?\nfunction getStoreStatusRows/)?.[0] || '';

  assert.match(mainChartBlock, /mainChartViewportRange/);
  assert.match(mainChartBlock, /dataZoom:\s*\[/);
  assert.match(mainChartBlock, /type:\s*'slider'/);
  assert.match(mainChartBlock, /type:\s*'inside'/);
  assert.match(mainChartBlock, /xAxisIndex:\s*0/);
  assert.match(mainChartBlock, /startValue:\s*viewport\.startLabel/);
  assert.match(mainChartBlock, /endValue:\s*viewport\.endLabel/);
  assert.match(mainChartBlock, /labelFormatter\(value,\s*valueLabel\)/);
  assert.match(mainChartBlock, /type:\s*'inside'[\s\S]*?zoomOnMouseWheel:\s*false/);
  assert.match(mainChartBlock, /type:\s*'inside'[\s\S]*?zoomLock:\s*true/);
  assert.match(mainChartBlock, /type:\s*'inside'[\s\S]*?moveOnMouseWheel:\s*true/);
});

test('annual entry structure scope buttons drive the main chart viewport without month mode', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const scopeClickBlock =
    source.match(/container\.querySelectorAll\('\[data-entry-range\]'\)\.forEach\(\(button\) => \{[\s\S]*?\n\s*renderCharts/)?.[0] || '';
  const updateBlock = source.match(/update\(payload\)\s*{[\s\S]*?destroy\(\)/)?.[0] || '';
  const viewportRangeBlock = source.match(/function mainChartViewportRange[\s\S]*?\n}\n\nexport function dataZoomMonthLabel/)?.[0] || '';

  assert.match(source, /function mainChartViewportRange/);
  assert.doesNotMatch(viewportRangeBlock, /contextMode === 'month'/);
  assert.doesNotMatch(viewportRangeBlock, /selectedMonth/);
  assert.match(scopeClickBlock, /state\.chartViewport = mainChartViewportRange\(state\)/);
  assert.match(scopeClickBlock, /range === 'all'[\s\S]*?state\.chartViewport = mainChartViewportRange\(state\)/);
  assert.match(scopeClickBlock, /state\.selectedQuarter = range[\s\S]*?state\.chartViewport = mainChartViewportRange\(state\)/);
  assert.match(updateBlock, /state\.selectedQuarter = 'all'[\s\S]*?state\.chartViewport = mainChartViewportRange\(state\)/);
  assert.match(source, /chartViewport:\s*mainChartViewportRange\(\{ contextMode:\s*'year'/);
});

test('annual entry structure data zoom range drives ranking context', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const chartRuntimeBlock = source.match(/async function renderCharts[\s\S]*?\nfunction paintAnnualEntryStructure/)?.[0] || '';
  const viewportContextBlock = source.match(/export function applyChartViewportContext[\s\S]*?\nfunction monthRangeLabel/)?.[0] || '';
  const buildContextBlock = source.match(/export function buildContext[\s\S]*?\n}\n\nexport function getProjectModalContext/)?.[0] || '';
  const dataZoomBlock = chartRuntimeBlock.match(/chart\.on\('dataZoom'[\s\S]*?\n\s*\}\);/)?.[0] || '';

  assert.match(source, /export function buildContext/);
  assert.doesNotMatch(buildContextBlock, /contextMode === 'month'/);
  assert.doesNotMatch(buildContextBlock, /selectedMonth/);
  assert.match(source, /function chartViewportFromDataZoom/);
  assert.match(chartRuntimeBlock, /chart\.on\('dataZoom'/);
  assert.match(viewportContextBlock, /function isFullYearViewport/);
  assert.match(viewportContextBlock, /state\.contextMode = fullYearViewport \? 'year' : 'range'/);
  assert.match(viewportContextBlock, /state\.chartViewport = nextViewport/);
  assert.match(dataZoomBlock, /applyChartViewportContext\(state,\s*nextViewport\)/);
  assert.match(dataZoomBlock, /refreshEntryStructureContext\(container,\s*state,\s*payload,\s*echarts\)/);
  assert.doesNotMatch(dataZoomBlock, /paintAnnualEntryStructure\(container,\s*state\)/);
});

test('annual entry structure main chart uses V3 full-width dense rhythm', async () => {
  const [source, css] = await Promise.all([
    readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8'),
    readFile(path.join(rootDir, 'public', 'styles', 'pages', 'details.css'), 'utf8'),
  ]);
  const mainChartBlock = source.match(/function buildMainChartOption[\s\S]*?\nfunction getStoreStatusRows/)?.[0] || '';
  const analysisRule = css.match(/\.entry-structure-analysis-grid\s*{(?<body>[^}]*)}/s)?.groups?.body || '';
  const panelRule = css.match(/\.entry-structure-chart-panel\.is-main\s*{(?<body>[^}]*)}/s)?.groups?.body || '';
  const hostRule = css.match(/\.entry-structure-chart-host\s*{(?<body>[^}]*)}/s)?.groups?.body || '';
  const subheaderTitleRule = css.match(/\.entry-structure-subheader h3\s*{(?<body>[^}]*)}/s)?.groups?.body || '';
  const subheaderMetaRule = css.match(/\.entry-structure-subheader > div > span\s*{(?<body>[^}]*)}/s)?.groups?.body || '';

  assert.match(analysisRule, /grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(panelRule, /grid-template-rows:\s*auto\s+380px;/);
  assert.match(panelRule, /align-content:\s*start;/);
  assert.match(hostRule, /height:\s*380px;/);
  assert.match(subheaderTitleRule, /font-size:\s*17px;/);
  assert.match(subheaderMetaRule, /font-size:\s*14px;/);
  assert.match(mainChartBlock, /grid:\s*{\s*left:\s*showStoreAgeTrendSideLegend \? 66 : 46,\s*right:\s*22,\s*top:\s*38,\s*bottom:\s*128\s*}/);
  assert.match(source, /const CHART_FONT_FAMILY =/);
  assert.doesNotMatch(mainChartBlock, /fontFamily:\s*'inherit'/);
  assert.match(mainChartBlock, /textStyle:\s*chartTextStyle\(16,\s*600\)/);
  assert.match(mainChartBlock, /itemWidth:\s*22/);
  assert.match(mainChartBlock, /itemHeight:\s*12/);
  assert.match(mainChartBlock, /itemGap:\s*18/);
  assert.match(mainChartBlock, /margin:\s*10,/);
  assert.match(mainChartBlock, /entryAxisMonth:\s*{[\s\S]*?height:\s*30,[\s\S]*?width:\s*58,[\s\S]*?fontSize:\s*14,[\s\S]*?fontWeight:\s*600,/);
  assert.match(mainChartBlock, /entryAxisDirect:\s*{[\s\S]*?height:\s*22,[\s\S]*?width:\s*58,[\s\S]*?fontSize:\s*14,[\s\S]*?fontWeight:\s*600,/);
  assert.match(mainChartBlock, /entryAxisFranchise:\s*{[\s\S]*?height:\s*22,[\s\S]*?width:\s*58,[\s\S]*?fontSize:\s*14,[\s\S]*?fontWeight:\s*600,/);
  assert.match(mainChartBlock, /const visibleChannels = visibleEntryChannels\(payload\)/);
  assert.match(mainChartBlock, /const singleChannelMode = visibleChannels\.length === 1/);
  assert.match(mainChartBlock, /label:\s*singleChannelMode \? storeAgeLabelFromQuadrantKey\(item\.key\) \|\| item\.label : item\.label/);
  assert.match(mainChartBlock, /const axisStoreAgeLine = \(storeAgeKey,\s*totals\) =>/);
  assert.match(mainChartBlock, /\? \['newStore', 'oldStore'\]\.map\(\(storeAgeKey\) => axisStoreAgeLine\(storeAgeKey,\s*monthStoreAgeTotals\(month\)\)\)/);
  assert.match(mainChartBlock, /: visibleChannels\.map\(\(channel\) => axisChannelLine\(channel,\s*channelTotals\)\)/);
  assert.match(mainChartBlock, /return \[`\{[$][{]monthStyle[}]\|\$[{]value[}]}`, \.\.\.channelLines\]\.join\('\\n'\)/);
  assert.match(mainChartBlock, /barWidth:\s*22/);
  assert.match(mainChartBlock, /label:\s*{\s*show:\s*false\s*}/);
  assert.match(mainChartBlock, /extraCssText/);
  assert.match(mainChartBlock, /scale:\s*1\.02/);
});

test('annual entry structure mount carries optional trend label settings into chart state', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const mountBlock = source.match(/export function mountAnnualEntryStructure[\s\S]*?\n  if \(!shouldSkipChartRuntime/)?.[0] || '';

  assert.match(mountBlock, /showStoreAgeTrendPointLabels:\s*options\.showStoreAgeTrendPointLabels !== false/);
  assert.match(mountBlock, /showStoreAgeTrendSideLegend:\s*Boolean\(options\.showStoreAgeTrendSideLegend\)/);
});

test('annual entry structure uses clickable x-axis month labels instead of a duplicate month rail', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const mainChartBlock = source.match(/function buildMainChartOption[\s\S]*?\nfunction getStoreStatusRows/)?.[0] || '';
  const mainChartRuntimeBlock = source.match(/chart\.setOption\(buildMainChartOption[\s\S]*?registerChart\(state,\s*chart\);/)?.[0] || '';
  const chartClickBlock = mainChartRuntimeBlock.match(/chart\.on\('click'[\s\S]*?\n\s*\}\);/)?.[0] || '';

  assert.match(mainChartBlock, /triggerEvent:\s*true/);
  assert.match(mainChartBlock, /formatter\(value,\s*index\)/);
  assert.match(chartClickBlock, /monthFromMainChartClickParams\(params,\s*payload\)/);
  assert.doesNotMatch(chartClickBlock, /params\.componentType === 'xAxis'/);
  assert.doesNotMatch(source, /function renderMonthDrillStrip/);
  assert.doesNotMatch(source, /data-entry-month-drill/);
  assert.doesNotMatch(source, /entry-structure-month-rail/);
});

test('annual entry structure opens month modal and filters lower modules without shrinking main viewport', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const mainChartRuntimeBlock = source.match(/chart\.setOption\(buildMainChartOption[\s\S]*?registerChart\(state,\s*chart\);/)?.[0] || '';
  const chartClickBlock = mainChartRuntimeBlock.match(/chart\.on\('click'[\s\S]*?\n\s*\}\);/)?.[0] || '';
  const focusMonthBlock = source.match(/export function focusEntryStructureMonth[\s\S]*?export function applyChartViewportContext/)?.[0] || '';

  assert.match(source, /export function focusEntryStructureMonth/);
  assert.match(chartClickBlock, /focusEntryStructureMonth\(state,\s*month\)/);
  assert.doesNotMatch(focusMonthBlock, /state\.contextMode\s*=/);
  assert.doesNotMatch(focusMonthBlock, /state\.selectedMonth\s*=/);
  assert.doesNotMatch(focusMonthBlock, /state\.selectedQuarter\s*=/);
  assert.doesNotMatch(focusMonthBlock, /state\.chartViewport\s*=/);
  assert.match(focusMonthBlock, /state\.modal = \{ open: true, filter: 'all', storeStatus: '', month: normalizedMonth \}/);
  assert.doesNotMatch(focusMonthBlock, /startMonth:\s*normalizedMonth/);
  assert.doesNotMatch(chartClickBlock, /params\.componentType === 'xAxis'/);
  assert.doesNotMatch(chartClickBlock, /toggleEntryStructureMonthViewport/);
  assert.doesNotMatch(source, /querySelectorAll\('\[data-entry-open-projects\]'/);
});

test('annual entry structure plot-area clicks use the same month modal path', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const mainChartRuntimeBlock = source.match(/chart\.setOption\(buildMainChartOption[\s\S]*?registerChart\(state,\s*chart\);/)?.[0] || '';
  const chartClickBlock = mainChartRuntimeBlock.match(/chart\.on\('click'[\s\S]*?\n\s*\}\);/)?.[0] || '';
  const zrenderClickBlock = mainChartRuntimeBlock.match(/chart\.getZr[\s\S]*?\n\s*\}\);/)?.[0] || '';
  const mainChartBlock = source.match(/function buildMainChartOption[\s\S]*?\nfunction getStoreStatusRows/)?.[0] || '';
  const legendItemsBlock = mainChartBlock.match(/const legendItems = \[[\s\S]*?\n\s*\];/)?.[0] || '';

  assert.doesNotMatch(source, /toggleEntryStructureMonthViewport/);
  assert.match(mainChartBlock, /function renderMonthHitArea/);
  assert.match(mainChartBlock, /name:\s*'月份点击层'/);
  assert.match(mainChartBlock, /type:\s*'custom'/);
  assert.match(mainChartBlock, /renderItem:\s*renderMonthHitArea/);
  assert.match(mainChartBlock, /cursor:\s*'pointer'/);
  assert.match(mainChartBlock, /silent:\s*false/);
  assert.match(mainChartBlock, /legendHoverLink:\s*false/);
  assert.match(mainChartBlock, /emphasis:\s*\{\s*disabled:\s*true\s*\}/);
  assert.match(mainChartBlock, /itemStyle:\s*\{\s*opacity:\s*0\s*\}/);
  assert.match(mainChartBlock, /tooltip:\s*\{\s*show:\s*false\s*\}/);
  assert.doesNotMatch(legendItemsBlock, /月份点击层/);
  assert.match(chartClickBlock, /const month = monthFromMainChartClickParams\(params,\s*payload\)/);
  assert.match(chartClickBlock, /lastHandledMainChartClickAt = Date\.now\(\)/);
  assert.match(chartClickBlock, /focusEntryStructureMonth\(state,\s*month\)/);
  assert.doesNotMatch(chartClickBlock, /params\.componentType === 'xAxis'/);
  assert.doesNotMatch(chartClickBlock, /toggleEntryStructureMonthViewport/);
  assert.match(zrenderClickBlock, /mainChartPointerPointFromEvent\(event\)/);
  assert.match(zrenderClickBlock, /window\.setTimeout/);
  assert.match(zrenderClickBlock, /Date\.now\(\) - lastHandledMainChartClickAt < 80/);
  assert.match(zrenderClickBlock, /chartGridMonthFromPoint\(chart,\s*payload/);
  assert.doesNotMatch(zrenderClickBlock, /if \(event\.target\)[\s\S]*?return/);
  assert.match(zrenderClickBlock, /focusEntryStructureMonth\(state,\s*month\)/);
  assert.doesNotMatch(zrenderClickBlock, /toggleEntryStructureMonthViewport/);
});

test('annual entry structure lower charts show the active month or range context', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const css = await readFile(path.join(rootDir, 'public', 'styles', 'pages', 'details.css'), 'utf8');
  const rankingShellBlock = source.match(/function renderRankingShell[\s\S]*?function getQuadrantConfig/)?.[0] || '';

  assert.match(rankingShellBlock, /function renderRankingContextMeta/);
  assert.match(rankingShellBlock, /data-entry-context-meta/);
  assert.doesNotMatch(rankingShellBlock, /data-entry-context-note/);
  assert.match(rankingShellBlock, /当前口径/);
  assert.match(rankingShellBlock, /const label = context\.label/);
  assert.match(rankingShellBlock, /const caption = context\.caption/);
  assert.match(rankingShellBlock, /escapeHtml\(label\)/);
  assert.match(rankingShellBlock, /escapeHtml\(caption\)/);
  assert.match(rankingShellBlock, /<h3>店态分布<\/h3>[\s\S]*?renderRankingContextMeta\(context\)/);
  assert.match(rankingShellBlock, /<h3>省份贡献<\/h3>[\s\S]*?renderRankingContextMeta\(context\)/);
  assert.match(rankingShellBlock, /entry-structure-context-divider/);
  assert.doesNotMatch(source, /未填写店态不展示为分类/);
  assert.match(css, /\.entry-structure-context-meta\s*{/);
  assert.match(css, /\.entry-structure-context-divider\s*{/);
  assert.match(css, /width:\s*1px;/);
  assert.doesNotMatch(css, /\.entry-structure-context-note\s*{/);
});

test('annual entry structure store status distribution opens project details with store status filter', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const statusChartBlock = source.match(/if \(statusHost\) \{[\s\S]*?\n\s*if \(provinceHost\)/)?.[0] || '';
  const statusOptionBlock = source.match(/function buildStatusChartOption[\s\S]*?\nfunction buildProvinceChartOption/)?.[0] || '';

  assert.match(source, /<h3>店态分布<\/h3>/);
  assert.doesNotMatch(source, /未填写店态不展示为分类/);
  assert.doesNotMatch(source, /店态贡献 Top 8/);
  assert.match(statusOptionBlock, /getStoreStatusRows\(context\)/);
  assert.doesNotMatch(statusOptionBlock, /slice\(0,\s*9\)/);
  assert.match(statusChartBlock, /chart\.on\('click'/);
  assert.match(statusChartBlock, /state\.modal = \{ open: true, filter: 'all', storeStatus, month: 0 \}/);
});

test('annual entry structure province contribution opens project details for the whole province row', async () => {
  const source = await readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8');
  const provinceChartBlock =
    source.match(/if \(provinceHost\) \{[\s\S]*?function refreshEntryStructureContext/)?.[0] || '';
  const provinceOptionBlock = source.match(/function getProvinceRows[\s\S]*?\nfunction renderNoDataChart/)?.[0] || '';

  assert.match(source, /<h3>省份贡献<\/h3>/);
  assert.match(provinceOptionBlock, /function getProvinceRows/);
  assert.match(provinceOptionBlock, /const rows = getProvinceRows\(context\)/);
  assert.match(provinceChartBlock, /chart\.on\('click'/);
  assert.match(provinceChartBlock, /const province = String\(row\?\.key/);
  assert.doesNotMatch(provinceChartBlock, /params\?\.seriesName/);
  assert.doesNotMatch(provinceChartBlock, /storeAge/);
  assert.match(provinceChartBlock, /state\.modal = \{ open: true, filter: 'all', storeStatus: '', province, month: 0 \}/);
});

test('annual entry structure modal filters update only modal content', async () => {
  const [source, css] = await Promise.all([
    readFile(path.join(rootDir, 'public', 'dashboard', 'annual-entry-structure.mjs'), 'utf8'),
    readFile(path.join(rootDir, 'public', 'styles', 'pages', 'details.css'), 'utf8'),
  ]);
  const modalFilterBlock =
    source.match(/function bindProjectModalFilterEvents[\s\S]*?\nfunction renderNoDataChart/)?.[0] || '';
  const modalRule = css.match(/\.entry-structure-project-modal\s*{(?<body>[^}]*)}/s)?.groups?.body || '';

  assert.match(source, /function updateProjectModalContent/);
  assert.match(source, /data-entry-modal-rows/);
  assert.match(modalFilterBlock, /updateProjectModalContent/);
  assert.doesNotMatch(modalFilterBlock, /paintAnnualEntryStructure/);
  assert.match(modalRule, /height:\s*min\(760px,\s*calc\(100vh\s*-\s*96px\)\);/);
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

test('team tier board renders hard owner top form metrics without tier split', async () => {
  installFrontendGlobals();
  const { elements } = await import('../public/lib/dom.mjs');
  const board = fakeElement();
  elements.teamTierKpiBoard = board;

  const { renderOwnerMonthlyTierBoard } = await import('../public/components/drill-modal.mjs');
  const rendered = renderOwnerMonthlyTierBoard({
    owner: '杨锦帆（硬装）',
    dashboardContext: 'all',
    hardOwnerMetrics: {
      items: [
        { key: 'notStarted', label: '未开始', value: 14, tone: 'amber' },
        { key: 'hardStageInProgress', label: '硬装阶段进行中', value: 23, tone: 'teal' },
        { key: 'projectClosed', label: '项目闭环', value: 67, tone: 'green' },
      ],
      rows: [
        {
          key: 'regular',
          label: '常规店',
          storeStatus: '常规店',
          values: { notStarted: 2, hardStageInProgress: 3, projectClosed: 5 },
          items: [
            { key: 'notStarted', label: '未开始', value: 2, tone: 'amber' },
            { key: 'hardStageInProgress', label: '硬装阶段进行中', value: 3, tone: 'teal' },
            { key: 'projectClosed', label: '项目闭环', value: 5, tone: 'green' },
          ],
        },
      ],
    },
  });

  assert.equal(rendered, true);
  assert.match(board.innerHTML, /硬装阶段进行中/);
  assert.match(board.innerHTML, /项目闭环/);
  assert.match(board.innerHTML, /tier-kpi-details/);
  assert.match(board.innerHTML, /常规店/);
  assert.match(board.innerHTML, /data-tier="regular"/);
  assert.match(board.innerHTML, /&quot;storeStatus&quot;:&quot;常规店&quot;/);
  assert.match(board.innerHTML, /hardStageInProgress/);
});
