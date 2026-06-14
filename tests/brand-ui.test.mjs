import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const publicDir = join(root, 'public');

async function readStylesBundle() {
  const stylesDir = join(publicDir, 'styles');
  const entryPath = join(stylesDir, 'app.css');
  if (existsSync(entryPath)) {
    const seen = new Set();

    async function readCss(filePath) {
      const normalizedPath = resolve(filePath);
      if (seen.has(normalizedPath)) {
        return '';
      }
      seen.add(normalizedPath);

      const source = await readFile(filePath, 'utf8');
      const chunks = [];
      const importPattern = /@import\s+url\(['"]?(.+?)['"]?\);/g;
      let cursor = 0;

      for (const match of source.matchAll(importPattern)) {
        chunks.push(source.slice(cursor, match.index));
        const importPath = match[1];
        if (!importPath.startsWith('/')) {
          chunks.push(await readCss(join(dirname(filePath), importPath)));
        }
        cursor = match.index + match[0].length;
      }

      chunks.push(source.slice(cursor));
      return chunks.join('\n');
    }

    return readCss(entryPath);
  }
  return readFile(join(publicDir, 'styles.css'), 'utf8');
}

async function readFrontendJsBundle() {
  const { readdir } = await import('node:fs/promises');
  const files = new Set(['app.js']);

  async function walk(relDir) {
    const dir = join(publicDir, relDir);
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(rel);
      } else if (entry.name.endsWith('.mjs')) {
        files.add(rel.replace(/\\/g, '/'));
      }
    }
  }

  for (const dirName of ['lib', 'domain', 'components', 'pages', 'dashboard']) {
    await walk(dirName);
  }

  const chunks = await Promise.all([...files].map((rel) => readFile(join(publicDir, rel), 'utf8')));
  return chunks.join('\n');
}

function extractFunctionSource(js, functionName) {
  const signature = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
  const match = signature.exec(js);
  if (!match) {
    return '';
  }
  let index = match.index + match[0].length;
  let parenDepth = 1;
  while (index < js.length && parenDepth > 0) {
    const char = js[index];
    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
    }
    index += 1;
  }
  const braceStart = js.indexOf('{', index);
  if (braceStart < 0) {
    return '';
  }
  let depth = 0;
  for (let cursor = braceStart; cursor < js.length; cursor += 1) {
    if (js[cursor] === '{') {
      depth += 1;
    } else if (js[cursor] === '}') {
      depth -= 1;
      if (depth === 0) {
        return js.slice(match.index, cursor + 1);
      }
    }
  }
  return '';
}

test('frontend uses Yeswood logo and brand palette', async () => {
  const [html, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readStylesBundle(),
  ]);

  assert.match(html, /<img[^>]+class="brand-logo"[^>]+src="\/assets\/yeswood-logo\.png"/);
  assert.match(html, /源氏木语门店项目一览/);
  assert.match(css, /--brand-green:\s*#104020;/);
  assert.match(css, /--page:\s*#F7F3EC;/);
  assert.match(css, /\.sidebar-brand\b/);
  assert.match(html, /class="brand-logo"/);
  assert.match(css, /\.nav-group-label/);
  assert.match(css, /\.nav-item-icon/);
  assert.match(html, /nav-group-label/);
  assert.ok(existsSync(join(publicDir, 'assets', 'yeswood-logo.png')));
});

test('frontend removes placeholder filter options from selects', async () => {
  const js = await readFrontendJsBundle();

  assert.match(js, /HIDDEN_FILTER_VALUES/);
  assert.match(js, /未填写/);
  assert.match(js, /未填入/);
  assert.match(js, /values\.filter/);
});

test('overview command center owns sync and full-page refresh actions', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.doesNotMatch(html, /class="topbar-title"[^>]*>\s*源氏木语门店项目一览\s*</);
  assert.doesNotMatch(html, /<header class="topbar">/);
  assert.match(html, /id="overviewCommandCenter"[\s\S]+class="sync-state overview-sync-state"/);
  assert.match(html, /id="syncButton"/);
  assert.match(html, /aria-label="同步项目数据"/);
  assert.match(html, /id="pageRefreshButton"/);
  assert.match(html, /aria-label="整页刷新总览"/);
  assert.match(html, />\s*刷新\s*<\/button>/);
  assert.match(js, /pageRefreshButton/);
  assert.match(js, /async function refreshCurrentPage/);
  assert.doesNotMatch(js, /window\.location\.reload\(\)/);
  assert.doesNotMatch(js, /fallback=compute/);
  assert.match(css, /\.overview-sync-state/);
  assert.match(css, /\.page-refresh-button/);
  assert.doesNotMatch(html, /id="analysisAgentButton"|运行分析 Agent|分析小组/);
  assert.doesNotMatch(js, /analysisAgentButton|currentAnalysisAgentLabel|runAnalysisAgent/);
  assert.doesNotMatch(css, /\.agent-button/);
});

test('frontend avoids readonly-dashboard sidebar wording', async () => {
  const html = await readFile(join(publicDir, 'index.html'), 'utf8');

  assert.doesNotMatch(html, /只读展示/);
  assert.doesNotMatch(html, /本地主数据/);
  assert.doesNotMatch(html, /readonly-note/);
  assert.doesNotMatch(html, /钉钉/);
});

test('frontend copy does not mention DingTalk in user-facing strings', async () => {
  const [html, js] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
  ]);

  assert.doesNotMatch(html, /钉钉/);
  assert.doesNotMatch(js, /钉钉/);
});

test('frontend does not expose a standalone personnel board', async () => {
  const [html, js] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
  ]);

  assert.doesNotMatch(html, /href="#personnel"[^>]+data-page="personnel"/);
  assert.doesNotMatch(html, /id="personnel"[^>]+data-page="personnel"/);
  assert.doesNotMatch(html, /id="personnel(?:Total|Summary|Roles)"/);
  assert.doesNotMatch(js, /renderPersonnel/);
  assert.doesNotMatch(js, /personnelRoleLabel/);
  assert.doesNotMatch(js, /personnel-intro/);
  assert.doesNotMatch(js, /架构总表|负责人团队框架|编辑架构|personnel-command-bar/);
  assert.doesNotMatch(js, /owner-team-grid/);
  assert.doesNotMatch(js, /handlePersonnelClick/);
  assert.doesNotMatch(js, /ownerHierarchy|负责人责任架构|按同项目协作关系/);
});

test('frontend exposes team dashboard section with owner switcher', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.match(html, /data-page="teams"[^>]*>[\s\S]*?小组情况/);
  assert.match(html, /class="dashboard-page team-dashboard"/);
  assert.match(html, /id="teamHero"/);
  assert.match(html, /id="teamHeadline"/);
  assert.match(html, /id="teamOwnerSelect"/);
  assert.match(html, /id="teamKpiGrid"/);
  assert.doesNotMatch(html, /CD \/ VM|团队结构|团队内组长负载/);
  assert.doesNotMatch(html, /id="teamStatus(?:Total|Insight|Chart)"/);
  assert.doesNotMatch(js, /teamStatus(?:Total|Insight|Chart)/);
  assert.doesNotMatch(html, /id="teamRisk(?:Total|Insight|List)"/);
  assert.doesNotMatch(html, /id="teamYear(?:Insight|Summary)"/);
  assert.doesNotMatch(html, /团队延期 \/ 风险项目|年度汇总/);
  assert.doesNotMatch(js, /teamRisk(?:Total|Insight|List)|teamYear(?:Insight|Summary)|renderSharedRiskList|renderTeamYearSummary/);
  assert.doesNotMatch(html, /状态与协作|协作人负载排行|项目责任列 · 排班建议/);
  assert.doesNotMatch(html, /id="teamLeadLoad(?:Insight)?"/);
  assert.match(js, /renderTeamDashboard/);
  assert.doesNotMatch(js, /renderTeamLeadLoad|renderTeamLoadCompactRows|renderTeamLoadBriefAdvice|renderTeamLoadSummaryStrip|renderTeamLoadRecommendationCard/);
  assert.match(js, /\/api\/team-metrics/);
  assert.match(js, /dashboard\/chart-column\.mjs/);
  assert.match(js, /dashboard\/tooltip\.mjs/);
  assert.match(js, /profileHasRenderableSummary/);
  assert.match(js, /initTooltipSystem/);
  assert.match(html, /id="teamTierKpiBoard"/);
  assert.doesNotMatch(html, /id="teamMonthlyOpsBoard"/);
  assert.doesNotMatch(html, /id="teamDataHealthSection"/);
  assert.match(html, /团队项目数量/);
  assert.doesNotMatch(html, /负责人压力排行/);
  assert.doesNotMatch(js, /延 \$\{owner\.delayedCount\} \/ 急 \$\{owner\.urgentCount\}/);
  assert.doesNotMatch(js, /延期 \$\{owner\.delayedCount\} · 紧急 \$\{owner\.urgentCount\}/);
  assert.doesNotMatch(html, /今日调度动作/);
  assert.match(js, /renderOwnerMonthlyTierBoard/);
  assert.doesNotMatch(js, /renderTeamDataHealth/);
  assert.match(js, /riskDutyHeadline/);
  assert.doesNotMatch(js, /renderRiskActionTabs/);
  assert.doesNotMatch(js, /data-risk-queue-toggle/);
  assert.doesNotMatch(js, /data-drill-title="负责人相关项目明细"/);
  assert.doesNotMatch(js, /<h4>处置分诊<\/h4>/);
  assert.doesNotMatch(js, /今日值班建议/);
  assert.match(js, /metricDefinitions/);
  assert.match(js, /navigateToDetailsDrill/);
  assert.match(js, /sourceDisplayLabel/);
  assert.match(js, /总盘/);
  assert.doesNotMatch(js, /tier-kpi-table-head/);
  assert.doesNotMatch(js, /tier-kpi-metric-head/);
  assert.match(js, /分类明细/);
  assert.match(css, /\.tier-kpi-details/);
  assert.match(css, /\.data-health-panel/);
  assert.doesNotMatch(css, /\.team-collaboration-grid|\.team-load-summary-strip|\.team-load-advice-stack|\.team-load-advice-card|\.team-load-workload/);
  const ownerTierMetricOrder = js.match(/const OWNER_TIER_METRIC_ORDER = \[[\s\S]*?\];/)?.[0] || '';
  assert.doesNotMatch(ownerTierMetricOrder, /schemeDelayedYtd|completedYtd|totalProjects|delayedProjects/);
  assert.doesNotMatch(js, /teamStructure/);
  assert.match(css, /\.tier-kpi-board/);
  assert.doesNotMatch(css, /\.monthly-ops-board/);
  assert.match(css, /\.team-hero/);
  assert.match(css, /\.insight-card/);
  assert.match(css, /\.chart-tooltip/);
});

test('frontend exposes team work completion module inside team dashboard', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.doesNotMatch(html, /href="#owner-review"[^>]+data-page="owner-review"/);
  assert.doesNotMatch(html, /data-page="owner-review"/);
  assert.doesNotMatch(html, /负责人复盘/);
  assert.doesNotMatch(html, /class="dashboard-page owner-review-dashboard"/);
  assert.doesNotMatch(html, /执行端设计负载台/);

  const teamSection =
    html.match(/<section class="dashboard-page team-dashboard" id="teams"[\s\S]*?<section class="dashboard-page" id="details"/)?.[0] || '';
  assert.match(teamSection, /class="team-section team-work-completion-module team-top-module"/);
  assert.match(teamSection, /id="teamWorkCompletionModule"[\s\S]*团队工作完成情况/);
  assert.match(
    teamSection,
    /class="[^"]*team-completion-overview-module[^"]*"[\s\S]*id="teamCompletionHeroStats"[\s\S]*id="teamCompletionMonthlyChart"/
  );
  assert.doesNotMatch(teamSection, /id="teamCompletionInProgress"/);
  assert.match(js, /loadTeamCompletionECharts/);
  assert.match(js, /buildTeamCompletionMonthlyChartOption/);
  assert.doesNotMatch(teamSection, /<h4>团队整体完成情况<\/h4>/);
  const teamCompletionGroupsBlock =
    teamSection.match(/<section class="team-completion-groups-module[\s\S]*?<div class="team-completion-member-modal"/)?.[0] || '';
  assert.match(teamCompletionGroupsBlock, /id="teamCompletionGroupGrid"/);
  assert.doesNotMatch(teamCompletionGroupsBlock, /id="teamCompletionDataQuality"/);
  assert.match(
    teamSection,
    /<\/section>\s*<section class="team-completion-data-quality" id="teamCompletionDataQuality" aria-label="数据质量提示"><\/section>\s*<section class="team-section team-ops-overview-section/
  );
  assert.doesNotMatch(teamSection, /<h4>小组完成情况<\/h4>/);
  assert.doesNotMatch(teamSection, /按组员项目关系聚合/);
  assert.match(teamSection, /id="teamCompletionMonthlyChart"/);
  assert.match(teamSection, /id="teamCompletionGroupGrid"/);
  assert.match(teamSection, /id="teamCompletionMemberGrid"/);
  assert.match(teamSection, /class="team-section team-load-module owner-review-dashboard"/);
  assert.match(teamSection, /id="teamLoadModule"/);
  assert.match(teamSection, /团队负载工作台/);
  assert.match(teamSection, /当前平面方案计入负载，摆场 \/ 历史完成 \/ 关联记录只做统计/);
  assert.match(html, /class="owner-review-headline"/);
  assert.match(html, /class="owner-review-hero-stats"/);
  assert.match(html, /class="owner-review-toolbar"/);
  assert.match(html, /id="ownerReviewHeadline"[\s\S]*class="owner-review-toolbar"[\s\S]*id="ownerReviewHeroStats"/);
  assert.doesNotMatch(html, /id="ownerReviewContextTabs"/);
  assert.doesNotMatch(html, /owner-review-responsibility-section|id="ownerReviewMatrixInsight"|id="ownerReviewResponsibilityMatrix"|硬装 \/ 软装责任矩阵/);
  assert.doesNotMatch(html, /team-hero[^"]*owner-review-hero/);
  assert.doesNotMatch(html, /team-hero-copy[^"]*owner-review/);
  assert.doesNotMatch(html, /team-hero-toolbar[^"]*owner-review/);
  assert.doesNotMatch(html, /id="ownerReviewOwnerSelect"/);
  assert.doesNotMatch(js, /ownerReviewOwnerSelect/);
  assert.doesNotMatch(js, /currentPageId\(\) === 'owner-review'/);
  assert.doesNotMatch(html, /id="ownerReviewMonthSelect"|复盘月份|>月份</);
  assert.match(teamSection, /id="ownerReviewBorrowToggle"/);
  assert.match(teamSection, /id="ownerReviewTeamStructure"/);
  assert.match(teamSection, /id="ownerReviewDecisionSummary"/);
  assert.match(teamSection, /id="ownerReviewLoadWorkbench"/);
  assert.match(teamSection, /id="ownerReviewGroupMatrix"/);
  assert.match(teamSection, /id="ownerReviewLoadToolbar"/);
  assert.match(teamSection, /id="ownerReviewSearchInput"/);
  assert.match(teamSection, /id="ownerReviewLoadFilter"/);
  assert.doesNotMatch(html, /owner-review-quick-actions|data-owner-review-quick-expand/);
  assert.doesNotMatch(html, /owner-review-density-actions|data-owner-review-density/);
  assert.match(teamSection, /id="ownerReviewRulebook"/);
  assert.doesNotMatch(html, /团队平面负载情况一览/);
  assert.doesNotMatch(html, /<h3>人员执行负载<\/h3>/);
  assert.match(teamSection, /id="ownerReviewPersonRows"/);
  assert.doesNotMatch(html, /owner-review-detail-section|id="ownerReviewDetailRows"/);
  assert.match(teamSection, /id="ownerReviewMemberModal"/);
  assert.match(teamSection, /id="ownerReviewMemberModalBody"/);
  assert.match(teamSection, /id="ownerReviewDecisionModal"/);
  assert.match(teamSection, /id="ownerReviewDecisionModalBody"/);
  assert.match(js, /TEAM_RESPONSIBILITY_REVIEW_ENDPOINT/);
  assert.match(js, /\/api\/team-responsibility-review/);
  assert.match(js, /TEAM_WORK_COMPLETION_ENDPOINT/);
  assert.match(js, /\/api\/team-work-completion/);
  assert.match(js, /loadTeamWorkCompletion/);
  assert.match(js, /renderTeamWorkCompletionDashboard/);
  assert.match(js, /loadOwnerResponsibilityReview/);
  assert.match(js, /renderOwnerReviewDashboard/);
  assert.match(js, /OWNER_REVIEW_STATIC_TEAM_STRUCTURE/);
  const ownerReviewStructureBlock =
    js.match(/const OWNER_REVIEW_STATIC_TEAM_STRUCTURE = \{[\s\S]*?\n\};/)?.[0] || '';
  assert.match(ownerReviewStructureBlock, /苏佳蕾/);
  assert.match(ownerReviewStructureBlock, /直营硬装 · CD设计师 · 进行中平面方案/);
  assert.match(ownerReviewStructureBlock, /直营1组[\s\S]*陈菲菲[\s\S]*乔玲玲[\s\S]*陈晶晶[\s\S]*张莹莹[\s\S]*杨雪倩/);
  assert.match(ownerReviewStructureBlock, /直营2组[\s\S]*陶媛媛[\s\S]*梁玉贞[\s\S]*安灵玲[\s\S]*何赛平[\s\S]*古茂琨/);
  assert.doesNotMatch(ownerReviewStructureBlock, /左忠淼/);
  assert.match(ownerReviewStructureBlock, /直营3组[\s\S]*杨晓芸[\s\S]*陈红燕[\s\S]*臧传宝[\s\S]*庞小琪[\s\S]*禹凯鹏[\s\S]*陈梦然[\s\S]*占俊鑫/);
  assert.match(ownerReviewStructureBlock, /直营4组[\s\S]*刘雯蓓[\s\S]*董一凡[\s\S]*郭后冲[\s\S]*杨莉[\s\S]*牛超凡/);
  assert.doesNotMatch(ownerReviewStructureBlock, /李晓倩|席创意|侯喆/);
  assert.doesNotMatch(ownerReviewStructureBlock, /组长|广州|青岛|校招|项目预留格/);
  assert.match(js, /renderOwnerReviewTeamStructure/);
  assert.match(js, /function ownerReviewStructureLoadModel/);
  assert.match(js, /data-owner-review-member/);
  assert.match(js, /未挂载关联项目/);
  assert.match(js, /当前平面负载/);
  assert.match(js, /memberLoads/);
  assert.match(js, /renderOwnerReviewMemberModal/);
  assert.match(js, /openOwnerReviewMemberModal/);
  assert.match(js, /data-owner-review-member-project-id/);
  assert.match(js, /openProjectDetailByReference\(\{ projectId, projectName \}/);
  assert.match(js, /executionScope/);
  assert.match(js, /负责人团队情况/);
  assert.match(js, /团队结构待补充/);
  const ownerReviewControlsBlock = js.match(/function ensureOwnerReviewControls\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(ownerReviewControlsBlock, /data-owner-review-context|全部|加盟|直营/);
  assert.doesNotMatch(js, /静态架构草稿/);
  assert.doesNotMatch(js, /renderOwnerReviewResponsibilityMatrix\(visibleReview\)/);
  assert.match(js, /renderOwnerReviewPersonRows/);
  assert.match(js, /renderOwnerReviewDetailRows/);
  assert.match(js, /ownerReviewLoadLevel/);
  assert.match(js, /renderOwnerReviewDecisionSummary/);
  assert.match(js, /openOwnerReviewDecisionModal/);
  assert.match(js, /renderOwnerReviewGroupMatrix/);
  assert.match(js, /renderOwnerReviewRulebook/);
  assert.match(js, /ownerReviewSearchQuery/);
  assert.match(js, /ownerReviewLoadFilter/);
  assert.match(js, /owner-review-load-filter-select-shell/);
  assert.doesNotMatch(js, /data-owner-review-density/);
  assert.doesNotMatch(js, /data-owner-review-quick-expand/);
  assert.match(js, /ownerReviewCopySummaryText/);
  assert.match(js, /data-owner-review-copy-summary/);
  assert.match(js, /handleOwnerReviewKeydown/);
  assert.match(js, /resetOwnerReviewForTeamOwnerChange/);
  assert.match(js, /loadTeamWorkCompletion\(owner,\s*dashboardContext/);
  const ownerReviewHeroSummary = js.match(/function renderOwnerReviewHeroSummary\(review\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(ownerReviewHeroSummary, /执行负载/);
  assert.doesNotMatch(ownerReviewHeroSummary, /团队项目|责任项|本月完成|延期未闭环/);
  assert.match(js, /enhanceOwnerReviewSelects/);
  assert.match(js, /owner-review-select-shell/);
  assert.doesNotMatch(js, /owner-review-owner-select-shell/);
  assert.doesNotMatch(js, /ownerReviewMonthSelect|owner-review-month-select-shell|params\.set\('month'/);
  assert.match(css, /\.owner-review-dashboard/);
  assert.match(css, /\.team-work-completion-module/);
  assert.match(css, /\.team-completion-overview-module/);
  assert.match(css, /\.team-completion-overview-module\.is-empty[\s\S]*\.team-completion-hero-stats/);
  assert.match(css, /\.team-completion-hero-stats > \.empty-state/);
  assert.match(css, /\.team-completion-groups-module/);
  assert.match(css, /\.team-completion-group-titleline\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.team-completion-group-titleline\s*\{[\s\S]*?align-items:\s*baseline/);
  assert.match(css, /\.team-completion-group-lead\s*\{[\s\S]*?font-weight:\s*950/);
  assert.match(css, /\.team-completion-group-card strong\s*\{[\s\S]*?font-size:\s*16px/);
  assert.match(css, /\.team-completion-group-card small\s*\{[\s\S]*?font-size:\s*13px/);
  assert.match(css, /\.team-completion-metric/);
  assert.match(css, /\.team-completion-member-modal-stats/);
  assert.match(css, /\.team-completion-monthly-chart/);
  assert.match(css, /\.team-completion-chart-host/);
  assert.doesNotMatch(css, /\.team-completion-month-buttons/);
  const completionOverviewRule = css.match(/\.team-completion-overview-module\s*\{[\s\S]*?\}/)?.[0] || '';
  const completionStatsRule = [...css.matchAll(/^\.team-completion-hero-stats\s*\{[\s\S]*?\}/gm)].at(-1)?.[0] || '';
  const completionChartPanelRule = css.match(/\.team-completion-chart-panel\s*\{[\s\S]*?\}/)?.[0] || '';
  const completionMetricRule = css.match(/\.team-completion-metric\s*\{[\s\S]*?\}/)?.[0] || '';
  assert.match(completionOverviewRule, /border:\s*0/);
  assert.match(completionOverviewRule, /background:\s*transparent/);
  assert.match(completionStatsRule, /border:\s*0/);
  assert.match(completionStatsRule, /background:\s*transparent/);
  assert.match(completionChartPanelRule, /border:\s*0/);
  assert.match(completionChartPanelRule, /border-top:\s*1px solid/);
  assert.match(completionChartPanelRule, /background:\s*transparent/);
  assert.match(completionMetricRule, /border-right:\s*1px solid/);
  assert.doesNotMatch(completionMetricRule, /border-left/);
  assert.match(css, /\.team-completion-group-grid/);
  const completionGroupGridRule = css.match(/\.team-completion-group-grid\s*\{[\s\S]*?\}/)?.[0] || '';
  const completionGroupCardRule = css.match(/\.team-completion-group-card\s*\{[\s\S]*?\}/)?.[0] || '';
  const completionGroupMembersRule = css.match(/\.team-completion-group-members\s*\{[\s\S]*?\}/)?.[0] || '';
  const completionScopeMetricsRule = css.match(/\.team-completion-scope-metrics\s*\{[\s\S]*?\}/)?.[0] || '';
  const completionMetricValuesRule = css.match(/\.team-completion-metric-values\s*\{[\s\S]*?\}/)?.[0] || '';
  assert.match(completionGroupGridRule, /align-items:\s*stretch/);
  assert.match(completionGroupCardRule, /grid-template-rows:\s*auto auto 1fr/);
  assert.match(completionGroupCardRule, /height:\s*100%/);
  assert.match(completionGroupMembersRule, /align-content:\s*start/);
  assert.match(completionScopeMetricsRule, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(completionScopeMetricsRule, /align-items:\s*stretch/);
  assert.match(completionMetricValuesRule, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.owner-review-hero/);
  assert.match(css, /\.owner-review-hero-title/);
  assert.match(css, /\.owner-review-headline/);
  assert.match(css, /\.owner-review-hero-stats/);
  assert.match(css, /\.owner-review-team-structure-section/);
  assert.match(css, /\.owner-review-structure-groups/);
  assert.match(css, /\.owner-review-member-load/);
  assert.match(css, /\.owner-review-member-modal/);
  assert.match(css, /\.owner-review-member-summary/);
  assert.match(css, /\.owner-review-member-filterbar/);
  assert.match(css, /\.owner-review-member-project-row/);
  assert.match(css, /\.owner-review-structure-summary/);
  assert.match(css, /\.owner-review-structure-empty/);
  assert.match(css, /\.owner-review-select-shell/);
  assert.doesNotMatch(css, /\.owner-review-owner-select-menu/);
  assert.match(css, /\.owner-review-person-table/);
  assert.match(css, /\.owner-review-decision-summary/);
  assert.match(css, /\.owner-review-workbench/);
  assert.match(css, /\.owner-review-workbench-grid/);
  assert.match(css, /\.owner-review-group-matrix/);
  assert.match(css, /\.owner-review-selected-group/);
  assert.match(css, /\.owner-review-decision-modal/);
  assert.match(css, /\.owner-review-load-toolbar/);
  assert.match(css, /\.owner-review-load-level/);
  assert.match(css, /\.owner-review-filter-chip/);
  assert.match(css, /\.owner-review-rulebook/);
});

test('owner review member modal keeps close button inside the dialog bounds', async () => {
  const css = await readStylesBundle();
  const closeRule = css.match(/\.owner-review-member-dialog\s+\.modal-close-button\s*\{[\s\S]*?\}/)?.[0] || '';

  assert.match(closeRule, /top:\s*12px/);
  assert.match(closeRule, /right:\s*12px/);
});

test('drill project modal keeps the close control stable in the header corner', async () => {
  const css = await readStylesBundle();
  const headerRule = css.match(/\.drill-project-header\s*\{[\s\S]*?\}/)?.[0] || '';
  const actionRule = css.match(/\.drill-project-actions\s*\{[\s\S]*?\}/)?.[0] || '';
  const closeRule = css.match(/\.drill-project-actions\s+\.modal-close-button\s*\{[\s\S]*?\}/)?.[0] || '';

  assert.match(headerRule, /position:\s*relative/);
  assert.match(headerRule, /padding:\s*18px\s+76px\s+14px\s+22px/);
  assert.match(actionRule, /position:\s*absolute/);
  assert.match(actionRule, /top:\s*14px/);
  assert.match(actionRule, /right:\s*18px/);
  assert.match(closeRule, /display:\s*inline-grid/);
  assert.match(closeRule, /place-items:\s*center/);
  assert.match(closeRule, /padding:\s*0/);
  assert.match(closeRule, /flex:\s*0\s+0\s+38px/);
});

test('team dashboard no longer renders legacy collaboration load ranking', async () => {
  const js = await readFrontendJsBundle();

  assert.doesNotMatch(js, /function renderTeamLeadLoad|function teamLoadPersonDrillFilter|teamLeadLoad/);
});

test('frontend exposes franchise and direct profile dashboards', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.match(html, /data-page="franchise"[^>]*>[\s\S]*?加盟看板/);
  assert.match(html, /data-page="direct"[^>]*>[\s\S]*?直营看板/);
  assert.match(html, /id="franchiseKpiGrid"/);
  assert.match(html, /id="directKpiGrid"/);
  assert.match(js, /\/api\/dashboard-metrics/);
  assert.match(js, /renderDashboardProfile/);
  assert.match(js, /adaptProfileDashboardPayload/);
  assert.match(js, /buildScopeProfileInsightItems/);
  assert.match(js, /PROFILE_SCOPE_SEGMENT_METRICS/);
  assert.match(js, /OVERVIEW_KPI_METRICS/);
  assert.match(js, /pausedProjects/);
  assert.match(js, /storeSegments/);
  assert.match(js, /loadProfileMetrics/);
  assert.match(js, /profile=franchise|direct/);
  assert.match(js, /class="overview-dashboard profile-overview-dashboard"/);
  assert.match(js, /class="overview-command-deck profile-command-deck"/);
  assert.match(js, /class="overview-control-grid profile-control-grid"/);
  assert.match(js, /class="overview-lower-grid profile-lower-grid"/);
  assert.doesNotMatch(js, /renderProfileDataNotesMarkup|buildProfileNotes|profile-data-notes/);
  assert.doesNotMatch(js, /dashboard-metrics 接口/);
  assert.match(css, /\.profile-dashboard-header/);
  assert.match(css, /grid-template-columns:\s*minmax\(360px,\s*0\.62fr\)\s+minmax\(0,\s*1\.38fr\)/);
  assert.match(css, /\.overview-command-center\s*\{[\s\S]*border-right:/);
  assert.match(css, /\.overview-signal-strip\s*\{[\s\S]*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.overview-signal-cell small\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(css, /\.profile-overview-dashboard \.profile-risk-panel/);
  assert.doesNotMatch(css, /\.profile-data-notes/);
});

test('overview responsibility matrix does not render month pressure chips', async () => {
  const js = await readFrontendJsBundle();
  const block = extractFunctionSource(js, 'renderOverviewMonthlyOps');

  assert.match(block, /overviewMonthlyOps/);
  assert.doesNotMatch(block, /pressureTimeline/);
  assert.doesNotMatch(block, /overview-pressure-(?:timeline|point)/);
  assert.doesNotMatch(block, /label\.slice\(5\)/);
  assert.doesNotMatch(block, /startCount|dueCount/);
});

test('overview matrices keep compact desktop split column widths', async () => {
  const css = await readStylesBundle();

  assert.match(css, /\.overview-lower-grid\s*{[^}]*grid-template-columns:\s*minmax\(390px,\s*0\.58fr\)\s*minmax\(0,\s*1\.42fr\);/s);
  assert.match(css, /\.overview-matrix-scroll\s*{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/s);
  assert.match(css, /\.overview-lower-grid \.overview-tier-grid\s*{[^}]*grid-template-columns:\s*minmax\(84px,\s*0\.74fr\)\s*repeat\(var\(--overview-tier-columns,\s*5\),\s*minmax\(52px,\s*1fr\)\);/s);
  assert.match(css, /\.overview-lower-grid \.overview-matrix-head\s*{[^}]*white-space:\s*normal;/s);
  assert.match(css, /\.overview-region-grid\s*{[^}]*grid-template-columns:\s*minmax\(92px,\s*0\.82fr\)\s*repeat\(var\(--overview-region-columns,\s*5\),\s*minmax\(70px,\s*1fr\)\);/s);
  assert.match(css, /\.overview-monthly-grid\s*{[^}]*grid-template-columns:\s*minmax\(96px,\s*0\.76fr\)\s*repeat\(var\(--overview-monthly-columns,\s*3\),\s*minmax\(58px,\s*1fr\)\);/s);
});

test('overview region matrix keeps top provinces collapsed with full active audit available', async () => {
  const [js, css] = await Promise.all([
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);
  const block = extractFunctionSource(js, 'renderOverviewRegionMatrix');

  assert.match(block, /overflowRows/);
  assert.match(block, /allRows/);
  assert.match(block, /provinceAudit/);
  assert.match(block, /excludedPausedCount/);
  assert.match(block, /overview-region-details/);
  assert.match(css, /\.overview-region-details/);
  assert.match(css, /\.overview-region-audit/);
});

test('overview stage lane copy explains the mixed date and progress stage basis', async () => {
  const html = await readFile(join(publicDir, 'index.html'), 'utf8');

  assert.match(html, /按节点日期与进度判断/);
  assert.doesNotMatch(html, /按真实进度字段/);
});

test('region matrix cells stay count-only and overview tooltip splits direct versus franchise', async () => {
  const js = await readFrontendJsBundle();
  const overviewBlock = extractFunctionSource(js, 'renderOverviewRegionMatrix');
  const profileBlock = extractFunctionSource(js, 'renderProfileRegionMatrixMarkup');

  assert.match(overviewBlock, /label:\s*'\u76f4\u8425'[\s\S]*cell\.direct/);
  assert.match(overviewBlock, /label:\s*'\u52a0\u76df'[\s\S]*cell\.franchise/);
  assert.doesNotMatch(overviewBlock, /cell\.delayRate/);
  assert.doesNotMatch(overviewBlock, /cell\.tone/);
  assert.doesNotMatch(overviewBlock, /--cell-heat/);
  assert.doesNotMatch(overviewBlock, /cell\.urgent/);
  assert.doesNotMatch(overviewBlock, /<small>\$\{cell\.delayRate\}%<\/small>/);

  assert.doesNotMatch(profileBlock, /tooltipDataAttr/);
  assert.doesNotMatch(profileBlock, /cell\.delayRate/);
  assert.doesNotMatch(profileBlock, /cell\.tone/);
  assert.doesNotMatch(profileBlock, /--cell-heat/);
  assert.doesNotMatch(profileBlock, /<small>\$\{cell\.delayRate\}%<\/small>/);
});

test('team owner switcher derives owners from personnel metrics not architecture teams', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);
  const block = js.match(/function teamOwnerOptions\(\)[\s\S]*?(?=\nfunction )/)?.[0] || '';

  assert.match(block, /fullMetrics\?\.personnel\?\.roles/);
  assert.match(block, /cdOwner/);
  assert.match(block, /vmOwner/);
  assert.match(js, /formatTeamOwnerDisplay/);
  assert.match(js, /enhanceTeamOwnerSelect/);
  assert.match(js, /SOLE_DUAL_DISCIPLINE_OWNER_NAME/);
  assert.match(js, /CREATIVE_OWNER_CATEGORY_LABEL/);
  assert.match(html, /team-owner-select-shell|team-owner-picker/);
  assert.match(css, /\.team-hero-toolbar/);
  assert.doesNotMatch(html, /id="teamHeroAvatar"/);
  assert.doesNotMatch(js, /teamHeroAvatar/);
});

test('team dashboard preloads owner metrics and switches from local cache', async () => {
  const [js, css] = await Promise.all([
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);
  const stateBlock = extractFunctionSource(js, 'createAppState');
  const loadBlock = extractFunctionSource(js, 'loadTeamMetrics');

  assert.match(js, /TEAM_METRICS_BATCH_ENDPOINT/);
  assert.match(stateBlock, /teamMetricsByOwner/);
  assert.match(js, /async function loadTeamMetricsBatch/);
  assert.match(js, /function scheduleTeamMetricsPreload/);
  assert.match(loadBlock, /cachedMetrics/);
  assert.match(loadBlock, /state\.teamMetricsByOwner\?\.\[owner\]/);
  assert.match(loadBlock, /loadTeamMetricsBatch\(dashboardContext,\s*\[owner\]/);
  assert.match(loadBlock, /scheduleTeamMetricsPreload\(dashboardContext,\s*canonicalOwner\)/);
  assert.match(js, /renderOwnerReviewRefreshBadge/);
  assert.match(css, /\.team-refresh-chip\.is-warning/);
  assert.match(js, /\/api\/team-metrics-batch/);
});

test('team top modules share annual entry structure surface language', async () => {
  const [html, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readStylesBundle(),
  ]);
  const latestRule = (pattern) => [...css.matchAll(pattern)].at(-1)?.[0] || '';
  const ruleContaining = (pattern, text) => [...css.matchAll(pattern)].map((match) => match[0]).find((rule) => rule.includes(text)) || '';
  const topModuleRule = latestRule(/\.team-top-module\s*\{[\s\S]*?\}/g);
  const heroRule = ruleContaining(/\.team-dashboard \.team-hero\s*\{[\s\S]*?\}/g, 'minmax(260px, 0.34fr)');
  const opsRule = latestRule(/\.team-ops-overview-section\s*\{[\s\S]*?\}/g);
  const tierBoardRule = latestRule(/\.tier-kpi-board\s*\{[\s\S]*?\}/g);
  const tierRowLabelRule = latestRule(/\.tier-kpi-row-label\s*\{[\s\S]*?\}/g);
  const alertCellRule = latestRule(/\.tier-kpi-row \.insight-card\.is-alert\s*\{[\s\S]*?\}/g);

  assert.match(html, /class="team-hero team-top-module"/);
  assert.match(html, /class="team-section team-ops-overview-section team-top-module"/);
  assert.match(html, /负责人项目运营情况/);
  assert.match(html, /id="teamCompletionScopeNote"/);
  assert.doesNotMatch(html, /运营概览/);
  assert.match(topModuleRule, /border-top:\s*3px\s+solid\s+rgba\(16,\s*64,\s*32,\s*0\.72\)/);
  assert.match(topModuleRule, /border-radius:\s*var\(--ov-radius,\s*6px\)/);
  assert.match(heroRule, /grid-template-columns:\s*minmax\(260px,\s*0\.34fr\)\s+minmax\(0,\s*1fr\)\s+minmax\(320px,\s*0\.34fr\)/);
  assert.match(opsRule, /padding:\s*16px\s+18px\s+18px/);
  assert.match(tierBoardRule, /border:\s*0/);
  assert.match(tierBoardRule, /background:\s*transparent/);
  assert.match(tierBoardRule, /box-shadow:\s*none/);
  assert.doesNotMatch(tierRowLabelRule, /justify-content:\s*center/);
  assert.match(alertCellRule, /background:\s*transparent/);
  assert.doesNotMatch(alertCellRule, /255,\s*250,\s*243|255,\s*247,\s*234|#fff7/i);
});

test('entry rhythm board renders monthly difficulty and department agent advice', async () => {
  const [js, css] = await Promise.all([
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.match(js, /difficultyByMonth/);
  assert.match(js, /pressureByMonth/);
  assert.match(js, /rhythmAdvice/);
  assert.match(js, /departmentOperations/);
  assert.match(js, /Agent 月度研判/);
  assert.match(js, /entryPressureScore/);
  assert.match(js, /ENTRY_PRESSURE_WATCH_THRESHOLD/);
  assert.match(js, /ENTRY_PRESSURE_CRITICAL_THRESHOLD/);
  assert.match(js, /entryPressurePolyline/);
  assert.match(js, /entry-rhythm-advice-headline/);
  assert.match(js, /entry-rhythm-agent/);
  assert.match(css, /\.entry-pressure-layer/);
  assert.match(css, /\.entry-pressure-line/);
  assert.match(css, /\.entry-pressure-threshold/);
  assert.match(css, /\.entry-combo-axis/);
  assert.match(css, /\.entry-rhythm-advice-headline/);
  assert.match(css, /\.entry-rhythm-agent/);
  assert.doesNotMatch(js, /entry-difficulty-band/);
  assert.doesNotMatch(css, /\.entry-difficulty-band/);
});

test('assignment alert first version only surfaces projects missing both leader and designer', async () => {
  const js = await readFrontendJsBundle();

  assert.match(js, /firstVersionAssignmentGap/);
  assert.match(js, /missingAllCoreAssignments/);
  assert.match(js, /组长和设计师均未填写/);
  assert.doesNotMatch(js, /filter\(\(project\) => projectAssignmentGap\(project\)\.missingAny\)/);
  assert.doesNotMatch(js, /缺组长或设计师/);
});

test('sidebar navigation switches independent dashboard pages instead of scrolling anchors', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  for (const page of ['overview', 'franchise', 'direct', 'teams', 'details', 'developer-docs']) {
    assert.match(html, new RegExp(`href="#${page}"[^>]+data-page="${page}"`));
    assert.match(html, new RegExp(`class="dashboard-page[^\"]*" id="${page}"`));
  }
  assert.doesNotMatch(html, /href="#rules"[^>]+data-page="rules"|id="rules" data-page="rules"/);
  assert.doesNotMatch(html, /href="#personnel"[^>]+data-page="personnel"|id="personnel" data-page="personnel"/);
  assert.doesNotMatch(html, /href="#risk"[^>]+data-page="risk"|id="risk" data-page="risk"/);

  assert.match(js, /function showPage/);
  assert.match(js, /hashchange/);
  assert.match(css, /\.dashboard-page\s*{[^}]*display:\s*none/s);
  assert.match(css, /\.dashboard-page\.is-active\s*{[^}]*display:\s*block/s);
});

test('developer docs page keeps merged operational rules content', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.match(html, /nav-group-label">开发文档/);
  assert.match(html, /class="dashboard-page developer-docs-dashboard" id="developer-docs" data-page="developer-docs"/);
  assert.match(html, /id="dev-doc-rules-stages"/);
  assert.match(html, /id="dev-doc-rules-responsibility"/);
  assert.match(html, /id="dev-doc-rules-team-queue"/);
  assert.match(html, /延期提醒规则/);
  assert.match(html, /硬装 \/ 软装 \/ 摆场/);
  assert.match(html, /复尺时间 Y/);
  assert.match(html, /超时启动/);
  assert.match(html, /Y \+ X/);
  assert.match(html, /Y\+N 表示第 N 个中国工作日/);
  assert.match(html, /法定双休和节假日不计入 Y\+N/);
  assert.match(html, /表单填写优先/);
  assert.match(html, /表单为空再兜底/);
  assert.match(html, /提醒仍按规则/);
  assert.match(html, /延期完成但效率OK/);
  assert.match(html, /KPI 单独记录效率 OK/);
  assert.match(html, /面积与店态 Deadline 矩阵/);
  assert.match(html, /紧急 \/ 非紧急待处理 Top5/);
  assert.match(html, /teamWorkCompletionReview\.mjs/);
  assert.match(html, /日期待核对靠后/);
  assert.doesNotMatch(html, /不再使用紧急判定|不再使用紧急程度判定/);
  assert.match(html, /mini店：≤300㎡/);
  assert.match(html, /中小店：300～450㎡/);
  assert.match(html, /超体店：1500～2000㎡/);
  assert.match(html, /超体店：2000㎡以上（暂按1500～2000㎡）/);
  assert.doesNotMatch(html, /2000㎡以上暂不在本矩阵内/);
  assert.doesNotMatch(html, /<span role="columnheader">项目判断<\/span>/);
  assert.match(html, /id="rulesDeadlineInfoDialog"/);
  assert.match(html, /data-rules-info-open/);
  assert.match(html, /aria-label="查看硬装 Deadline 规则说明"/);
  assert.doesNotMatch(html, /onclick="document\.getElementById\('rulesDeadlineInfoDialog'\)\.showModal\(\)"/);
  assert.match(js, /rulesInfoOpen:\s*document\.querySelector\('\[data-rules-info-open\]'\)/);
  assert.match(js, /rulesInfoDialog:\s*document\.querySelector\('#rulesDeadlineInfoDialog'\)/);
  assert.match(js, /function openRulesInfoDialog\(\)/);
  assert.match(js, /dialog\.showModal\(\)/);
  assert.match(js, /elements\.rulesInfoOpen\.addEventListener\('click',\s*openRulesInfoDialog\)/);
  assert.doesNotMatch(html, /<section class="rules-board">/);
  assert.doesNotMatch(html, /<div class="rules-deadline-principles"/);
  assert.match(html, /方案快截止了/);
  assert.match(html, /Y\+31/);
  assert.match(html, /施工图终审/);
  assert.match(css, /\.developer-docs-dashboard/);
  assert.match(css, /\.rules-deadline-table/);
  assert.match(css, /\.rules-info-button/);
  assert.match(css, /\.rules-info-dialog/);
  assert.match(css, /\.rules-info-close\s*{[^}]*position:\s*static;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.rules-info-timeline/);
  assert.match(css, /\.dev-prd-rule-list/);
  assert.match(css, /\.rules-timeline/);
});

test('frontend keeps rules and developer docs in a development-only documentation area', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.match(html, /<section class="nav-group" data-development-only/);
  assert.match(html, /href="#developer-docs"[^>]+data-page="developer-docs"[\s\S]*?开发文档/);
  assert.match(html, /class="dashboard-page developer-docs-dashboard" id="developer-docs" data-page="developer-docs" data-development-only/);
  assert.match(html, /class="dev-prd-shell"/);
  assert.match(html, /class="dev-prd-toc"/);
  assert.match(html, /id="dev-doc-frontend-layers"/);
  assert.match(html, /id="dev-doc-loading"/);
  assert.match(html, /id="dev-doc-handover"/);
  assert.match(html, /系统框架与交接说明/);

  assert.match(js, /DEVELOPMENT_ONLY_PAGES/);
  assert.match(js, /function isDevelopmentDocumentationVisible/);
  assert.match(js, /function applyDevelopmentDocumentationVisibility/);
  assert.match(js, /initDeveloperDocsPage/);
  assert.match(css, /\[data-development-only\]\s*{\s*display:\s*none;/s);
  assert.match(css, /body\.is-development-dashboard \.nav-group\[data-development-only\]/);
  assert.match(css, /body\.is-development-dashboard \.dashboard-page\[data-development-only\]\.is-active/);
  assert.match(css, /\.developer-docs-dashboard/);
  assert.match(css, /\.dev-prd-shell/);
});

test('developer docs use the operational dashboard visual system while preserving the document toc', async () => {
  const [html, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readStylesBundle(),
  ]);

  assert.match(html, /class="dev-prd-shell"/);
  assert.match(html, /class="dev-prd-workbench"/);
  assert.match(html, /class="dev-prd-toc"/);
  assert.match(html, /data-dev-doc-target="home"/);
  assert.match(html, /data-dev-doc-target="overview"/);
  assert.match(html, /data-dev-doc-target="rules"/);
  assert.match(html, /class="dev-prd-page is-active"[^>]+data-dev-doc-page="home"/);
  assert.match(html, /data-dev-doc-page="overview"/);
  assert.match(html, /data-dev-doc-page="rules"/);
  assert.match(html, /class="dev-prd-page-canvas"/);
  assert.doesNotMatch(html, /class="dev-prd-section-grid"/);
  assert.doesNotMatch(html, /data-dev-doc-section=/);
  assert.match(html, /class="rules-deadline-table-wrap"/);
  assert.match(html, /class="dev-prd-toc-main"/);
  assert.match(html, /class="dev-prd-toc-subline"/);
  assert.match(html, /data-dev-doc-target="home"[\s\S]*?class="dev-prd-toc-subline"[\s\S]*?data-dev-doc-target="overview"/);
  assert.match(html, /data-dev-doc-target="rules"[\s\S]*?class="dev-prd-toc-subline"[\s\S]*?data-dev-doc-target="metrics"/);
  assert.match(css, /\.dev-prd-workbench\s*{[^}]*grid-template-columns:\s*320px\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.dev-prd-content\s*{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s);
  assert.match(css, /\.dev-prd-page-canvas\s*{/);
  assert.match(css, /\.dev-prd-page-canvas\s*{[^}]*min-height:\s*calc\(100vh - 96px\)/s);
  assert.match(css, /\.dev-prd-page-meta\s*{/);
  assert.match(css, /\.dev-prd-copy-section\s*{/);
  assert.match(css, /\.dev-prd-copy-section\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(180px,\s*240px\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.dev-prd-summary-band\s*{/);
  assert.match(css, /\.rules-deadline-table-wrap\s*{[^}]*overflow-x:\s*auto/s);
});

test('project filters remain scoped after removing the standalone personnel board', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.match(html, /id="projectFilterBar"/);
  assert.match(html, /data-filter-pages="details"/);
  assert.doesNotMatch(html, /id="detailFilterPanel"|id="detailSearchInput"/);
  assert.match(js, /FILTERABLE_PAGES/);
  assert.match(js, /projectFilterBar\.hidden/);
  assert.match(js, /fullMetrics/);
  assert.doesNotMatch(js, /renderPersonnel\(fullMetrics\.personnel\)/);
  assert.match(css, /\[hidden\]\s*{[^}]*display:\s*none\s*!important/s);
});

test('project filters use custom polished dropdown controls over native selects', async () => {
  const [js, css] = await Promise.all([
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.match(js, /enhanceProjectFilters/);
  assert.match(js, /renderFilterSelect/);
  assert.match(js, /handleFilterSelectClick/);
  assert.match(js, /native-filter-select/);
  assert.match(js, /filter-select-button/);
  assert.match(js, /filter-select-option/);
  assert.match(css, /\.filter-select-shell/);
  assert.match(css, /\.filter-select-menu/);
  assert.match(css, /\.filter-select-option/);
  assert.match(css, /\.filter-clear-button/);
});

test('project details page uses a scan-first workbench with shared top filters and a modal detail layer', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.match(html, /id="detailsWorkbench"/);
  assert.match(html, /id="detailsViewTabs"/);
  assert.match(html, /data-details-view="progress"/);
  assert.doesNotMatch(html, /data-details-view="people"|data-drill-view="people"/);
  assert.match(html, /id="pausedProjectToggle"[^>]*>[\s\S]*?查看暂停\/取消项目/);
  assert.match(html, /id="pausedProjectFilterField"/);
  assert.doesNotMatch(html, /data-details-view="paused"/);
  assert.doesNotMatch(html, /id="detailFilterPanel"|id="detailSearchInput"/);
  assert.match(html, /id="projectAssignmentAlert"/);
  assert.match(html, /id="projectWorkbenchRows"/);
  assert.match(html, /id="projectDetailModal"/);
  assert.doesNotMatch(html, /id="rawFieldPanel"|原始字段|原表/);
  assert.match(js, /PROJECT_DETAIL_FIELD_GROUPS|buildProjectDetailFieldGroups/);
  assert.match(js, /DETAILS_WORKBENCH_VIEWS/);
  assert.match(js, /readActiveProjectFilters/);
  assert.match(js, /resolveProjectKeyDate/);
  assert.match(js, /readWorkflowStage/);
  assert.match(js, /isPausedProject/);
  assert.match(js, /showPausedProjects/);
  assert.match(js, /setPausedProjectFilter/);
  assert.match(js, /暂无暂停\/取消项目/);
  assert.match(js, /WORKFLOW_STAGE_DATE_RULES/);
  assert.match(js, /readEffectiveWorkflowStage/);
  assert.match(js, /projectStageDisplayItems/);
  assert.match(js, /点位\/软装进度/);
  assert.match(js, /projectKeyDateCell/);
  assert.match(js, /renderProjectWorkbench/);
  assert.doesNotMatch(js, /projectDifficultyScoreCell/);
  assert.doesNotMatch(js, /renderProjectDifficultyInfoModal/);
  assert.doesNotMatch(js, /renderProjectDifficultyFormulaModal/);
  assert.doesNotMatch(js, /handleDifficultyInfoClick/);
  assert.doesNotMatch(js, /data-difficulty-formula-info/);
  assert.doesNotMatch(js, /data-project-difficulty-info/);
  assert.doesNotMatch(js, /findDifficultyProjectFromTrigger/);
  assert.doesNotMatch(js, /#difficulty\?projectId=|function renderProjectDifficultyPage|function navigateToProjectDifficulty/);
  assert.doesNotMatch(js, /项目综合负荷计算公式/);
  assert.doesNotMatch(js, /综合负荷 = round\(硬装折算人天 \+ 软装折算人天\)/);
  assert.doesNotMatch(js, /采购不计入当前负荷/);
  assert.match(js, /columns: \['项目', '负责人', '组长', '设计师', '门店 \/ 阶段', '下一提醒'\]/);
  assert.doesNotMatch(js, /columns: \['项目', '负责人', '组长', '设计师', '门店 \/ 阶段', '下一提醒', '负荷 \/ 风险'\]/);
  assert.match(js, /renderProjectOwnersCell/);
  assert.match(js, /renderProjectTeamCell/);
  assert.match(js, /renderProjectDesignersCell/);
  assert.match(js, /projectAssignmentGap/);
  assert.match(js, /projectAssignmentReminderText/);
  assert.match(js, /renderProjectAssignmentAlert/);
  assert.match(js, /openProjectDetailById\(assignmentProject\.dataset\.assignmentProjectId \|\| ''\)/);
  assert.match(js, /showIncompleteAssignments/);
  assert.doesNotMatch(js, /focusProjectWorkbenchRow|scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
  assert.match(js, /dateOnly = String\(value\)\.trim\(\)\.match/);
  assert.match(js, /timeZone:\s*'Asia\/Shanghai'/);
  assert.match(js, /人员配置待补全/);
  assert.match(js, /只看待补全/);
  assert.match(js, /未填写/);
  assert.doesNotMatch(js, /renderProjectLoadRiskCell/);
  assert.doesNotMatch(js, /projectRiskPill/);
  assert.doesNotMatch(js, /gridClass: 'is-people-view'/);
  assert.doesNotMatch(js, /资料摘要|readProjectAssetsSummary/);
  assert.match(js, /columns: \['项目', '硬装进度', '点位\/软装进度', '方案情况', '上会 \/ 点位', '下一提醒'\]/);
  assert.doesNotMatch(js, /columns: \['项目', '硬装进度', '点位\/软装进度', '方案情况', '上会 \/ 点位', '风险'\]/);
  assert.match(js, /PROJECT_NODE_FIELD_ALIASES/);
  assert.match(js, /meetingStatus:\s*\['上会情况'\]/);
  assert.match(js, /measureStatus:\s*\['复尺情况'\]/);
  assert.match(js, /function progressFallbackStage/);
  assert.match(js, /project-stage-reminder-rules\.mjs/);
  assert.match(js, /resolveProjectStageReminder/);
  assert.match(js, /PROJECT_STAGE_FIELD_ALIASES/);
  assert.match(js, /function isProjectMeetingStageComplete/);
  assert.match(js, /function isProjectMeasureStageComplete/);
  assert.match(js, /躺平内部审核结束时间/);
  assert.match(js, /施工图完成审核时间（施工图终稿完成时间\/商场审核完成时间）/);
  assert.match(js, /待平面开始/);
  assert.match(js, /待平面结束/);
  assert.match(js, /待施工图审核/);
  assert.match(js, /resolveProjectKeyDateReminders/);
  assert.doesNotMatch(js, /label:\s*'启动'/);
  assert.doesNotMatch(js, /label:\s*'开业'/);
  assert.match(js, /renderProjectDetailModal/);
  assert.match(js, /handleProjectDetailsClick/);
  assert.match(js, /handleProjectDetailsKeydown/);
  assert.match(js, /role="button" tabindex="0" data-project-id/);
  assert.match(js, /handleDetailsViewTabClick/);
  assert.match(js, /FILTERABLE_PAGES = new Set\(\['details'\]\)/);
  assert.match(css, /\.details-workbench/);
  assert.match(css, /\.details-view-tabs/);
  assert.match(css, /\.project-assignment-alert/);
  assert.match(css, /\.assignment-alert-list/);
  assert.match(css, /\.project-assignment-missing/);
  assert.doesNotMatch(css, /\.project-workbench-head\.is-people-view/);
  assert.match(css, /\.filter-toggle-button/);
  assert.match(css, /\.filter-bar\.has-details-action/);
  assert.match(css, /\.project-detail-modal/);
  assert.match(css, /\.project-detail-modal\s*\{[\s\S]*?z-index:\s*64/);
  assert.match(css, /\.project-detail-assignment-reminder/);
  assert.match(css, /\.project-detail-section\.is-people\s+\.detail-kv-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.project-detail-stage-stream\.is-hard\s+\.project-detail-stage-row\s+em\s*\{[\s\S]*?font-size:\s*14px[\s\S]*?font-weight:\s*980/);
  assert.doesNotMatch(css, /\.difficulty-info-button/);
  assert.doesNotMatch(css, /\.difficulty-info-modal/);
  assert.doesNotMatch(css, /\.difficulty-info-card/);
  assert.doesNotMatch(css, /\.difficulty-score/);
  assert.match(css, /\.project-workbench-head,\s*\.project-workbench-row\s*{[\s\S]*?minmax\(236px,\s*2\.15fr\)[\s\S]*?minmax\(220px,\s*1\.65fr\);[\s\S]*?column-gap:\s*14px;/);
  assert.match(css, /\.project-stage-stack/);
  assert.match(css, /\.project-key-date-stack/);
  assert.doesNotMatch(css, /\.project-load-risk-cell/);
  assert.doesNotMatch(css, /\.project-difficulty-hero|\.project-difficulty-layout/);
  assert.match(css, /\.topbar-title/);
  assert.doesNotMatch(css, /\.raw-field-panel/);
});

test('details workbench defaults to workflow order and pushes closed projects to the bottom', async () => {
  const js = await readFrontendJsBundle();
  const sortBlock = extractFunctionSource(js, 'sortProjectWorkbenchProjects');

  assert.match(js, /PROJECT_WORKBENCH_STAGE_ORDER/);
  assert.match(js, /'上会'[\s\S]*'复尺'[\s\S]*'平面开始'[\s\S]*'施工图审核'[\s\S]*'软装方案'[\s\S]*'采购情况'[\s\S]*'整改'[\s\S]*'摆场'/);
  assert.match(sortBlock, /isProjectWorkflowClosed/);
  assert.match(sortBlock, /return a\.closed \? 1 : -1/);
  assert.match(sortBlock, /return b\.closedAt - a\.closedAt/);
  assert.match(sortBlock, /return a\.stageRank - b\.stageRank/);
  assert.match(js, /sortProjectWorkbenchProjects\(visibleProjects\)/);
  assert.match(js, /sortProjectWorkbenchProjects\(projects\)/);
});

test('project key date delegates business stage reminders to the unified stage table', async () => {
  const js = await readFrontendJsBundle();
  const keyDateBlock = extractFunctionSource(js, 'resolvePrimaryProjectKeyDate');

  assert.match(keyDateBlock, /resolveProjectStageReminder\(project\)\.primaryReminder/);
  assert.match(js, /displayStart:\s*\['摆场开始时间', '摆场时间', '现场摆场时间'\]/);
  assert.match(js, /displayFileSent:\s*\['摆场文件发出时间\(项目群）', '摆场文件发出时间（项目群）'\]/);
  assert.match(js, /等待摆场结束/);
  assert.match(js, /项目待闭环/);
});

test('project detail surfaces omit load values and risk judgment', async () => {
  const js = await readFrontendJsBundle();
  const detailGroupsBlock = js.match(/const PROJECT_DETAIL_FIELD_GROUPS = \[[\s\S]*?\n\];/)?.[0] || '';
  const detailModalBlock = js.match(/function renderProjectDetailModal\(project\)[\s\S]*?\n}\n\nfunction closeProjectDetailModal/)?.[0] || '';

  assert.doesNotMatch(detailGroupsBlock, /综合负荷|综合人月/);
  assert.doesNotMatch(detailModalBlock, /project-detail-status|projectRiskClass|projectRiskLabel/);
  assert.doesNotMatch(js, /function projectRiskLabel|function projectRiskClass/);
});

test('details drill links preserve hidden route filters in project queries', async () => {
  const js = await readFrontendJsBundle();

  assert.match(js, /function readDetailsRouteFilters/);
  assert.match(js, /owner:\s*hash\.owner/);
  assert.match(js, /metric:\s*hash\.metric/);
  assert.match(js, /storeNature:\s*hash\.storeNature/);
  assert.match(js, /dashboardContext:\s*hash\.dashboardContext/);
  assert.match(js, /params\.set\('context', dashboardContext\)/);
  assert.match(js, /dashboardContext:\s*metrics\.dashboardContext/);
  assert.match(js, /detailsRouteFiltersChanged/);
});

test('details drill navigation clears stale project counts before async refresh resolves', async () => {
  const js = await readFrontendJsBundle();

  assert.match(js, /pendingDetailsDrill/);
  assert.match(js, /function readDrillTargetCount/);
  assert.match(js, /function renderPendingDetailsDrill/);
  assert.match(js, /正在加载匹配项目/);
  assert.match(js, /function navigateToDetailsDrill/);
});

test('dashboard drill cards open an in-page project list modal instead of navigating to details', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.match(html, /id="drillProjectModal"/);
  assert.match(html, /id="drillProjectRows"/);
  assert.match(html, /data-drill-project-close/);
  assert.match(js, /function openDrillProjectModal/);
  assert.match(js, /resolveDrillProjects/);
  assert.match(js, /fields=ids/);
  assert.match(js, /openDrillProjectModal\(filter,\s*\{/);
  assert.doesNotMatch(js, /navigateToDetailsDrill\(filter,\s*\{\s*targetCount:\s*readDrillTargetCount\(card\)/);
  assert.match(css, /\.drill-project-modal/);
  assert.match(css, /\.drill-project-shell/);
  assert.match(css, /\.drill-project-table/);
});

test('team entry area reuses the annual entry structure module instead of loose column panels', async () => {
  const [html, js, css] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFrontendJsBundle(),
    readStylesBundle(),
  ]);

  assert.match(html, /id="teamEntryTrendBoard"/);
  assert.match(html, /class="team-section team-ops-section team-entry-structure-section"/);
  assert.match(
    html,
    /<section class="team-section team-ops-section team-entry-structure-section">\s*<section class="ops-entry-board" id="teamEntryTrendBoard"><\/section>\s*<\/section>/
  );
  assert.match(css, /\.team-entry-structure-section\s*\{[\s\S]*--ov-border/);
  assert.match(css, /\.team-entry-structure-section\s*\{[\s\S]*--ov-radius/);
  assert.match(css, /\.team-entry-structure-section\s*\{[\s\S]*--ov-shadow/);
  assert.match(html, /\u5e74\u5ea6\u8fdb\u5e97\u7ed3\u6784/);
  assert.doesNotMatch(html, /\u8fdb\u5e97\u538b\u529b\u770b\u76d8/);
  assert.match(js, /function renderTeamEntryTrendBoard/);
  assert.match(js, /function loadTeamAnnualEntryStructure/);
  assert.match(js, /mountAnnualEntryStructure/);
  assert.match(
    js,
    /mountAnnualEntryStructure\(elements\.teamEntryTrendBoard,\s*\{[\s\S]*showStoreAgeTrendPointLabels:\s*false[\s\S]*showStoreAgeTrendSideLegend:\s*true/
  );
  assert.match(js, /teamAnnualEntryStructureController/);
  assert.match(js, /function renderTeamDifficultyBoard/);
  assert.match(js, /function renderTeamDifficultyMatrix/);
  assert.match(js, /function buildEntryStoreTierContext/);
  assert.match(js, /function renderEntryStoreTierFocus/);
  assert.match(js, /difficultySummary/);
  assert.doesNotMatch(js, /weightedLeadLoad/);
  assert.match(js, /function renderEntryRhythmBoard/);
  assert.match(js, /function renderEntryComboChart/);
  assert.match(js, /entry-pressure-line/);
  assert.match(js, /entry-pressure-threshold/);
  assert.match(js, /entry-tier-source/);
  assert.match(js, /function renderTierPressureCard/);
  assert.match(js, /function renderTierDifficultyStrip/);
  assert.match(js, /function renderOpsTrendBars/);
  assert.match(js, /entry-combo-chart/);
  assert.match(js, /entry-combo-plot/);
  assert.match(js, /entry-rhythm-analysis/);
  assert.match(js, /entry-tier-stack/);
  assert.match(js, /entry-store-focus/);
  assert.doesNotMatch(js, /'\?\?\?\?'|`\?\?\$\{tierParts\.length\}\?`|`\?\?\?\?\/\?\?\?\?\?\?\?\?\? 0-100/);
  assert.match(js, /Agent 月度研判/);
  assert.doesNotMatch(js, /调度提醒/);
  assert.match(js, /高压店态/);
  assert.match(js, /team-difficulty-matrix/);
  assert.doesNotMatch(js, /结构判断|entry-mix-panel|renderEntryMixPanel|双底带|压力值条|年度解读/);
  assert.match(css, /\.ops-entry-board/);
  assert.match(css, /\.team-difficulty-board/);
  assert.match(css, /\.team-difficulty-matrix/);
  assert.match(css, /\.team-difficulty-cell/);
  assert.match(css, /\.entry-rhythm-board/);
  assert.match(css, /\.entry-combo-chart/);
  assert.match(css, /\.entry-pressure-layer/);
  assert.match(css, /\.entry-pressure-line/);
  assert.match(css, /\.entry-pressure-threshold/);
  assert.match(css, /\.entry-rhythm-analysis/);
  assert.match(css, /\.entry-tier-stack/);
  assert.match(css, /\.entry-tier-source/);
  assert.match(css, /\.entry-store-focus/);
  assert.match(css, /\.tier-pressure-card/);
  assert.match(css, /\.tier-difficulty-strip/);
  assert.match(css, /\.ops-trend-bars/);
  assert.doesNotMatch(html, /id="teamNewStoreChart"|id="teamOldStoreChart"/);
});

test('annual entry structure carries panel border fallbacks outside overview dashboard', async () => {
  const css = await readStylesBundle();
  const wrapperRule = css.match(/\.overview-entry-structure\s*\{[\s\S]*?\}/)?.[0] || '';
  const panelRule = css.match(/\.overview-entry-structure-panel\s*\{[\s\S]*?\}/)?.[0] || '';
  const chartRule = css.match(/\.entry-structure-chart-panel\s*\{[\s\S]*?\}/)?.[0] || '';

  assert.match(wrapperRule, /margin-top:\s*var\(--ov-gap-md,\s*12px\)/);
  assert.match(panelRule, /border:\s*1px\s+solid\s+var\(--ov-border,\s*rgba\(32,\s*48,\s*38,\s*0\.14\)\)/);
  assert.match(panelRule, /border-radius:\s*var\(--ov-radius,\s*6px\)/);
  assert.match(panelRule, /box-shadow:\s*var\(--ov-shadow,\s*0\s+10px\s+24px\s+rgba\(44,\s*52,\s*40,\s*0\.06\)\)/);
  assert.match(chartRule, /border:\s*1px\s+solid\s+var\(--ov-border,\s*rgba\(32,\s*48,\s*38,\s*0\.14\)\)/);
});

test('entry pressure SVG line is constrained to the pressure plot layer', async () => {
  const css = await readStylesBundle();
  const lineRule = css.match(/\.entry-pressure-line\s*{(?<body>[^}]*)}/s)?.groups?.body || '';

  assert.match(lineRule, /position:\s*absolute;/);
  assert.match(lineRule, /inset:\s*0;/);
  assert.match(lineRule, /display:\s*block;/);
  assert.match(lineRule, /width:\s*100%;/);
  assert.match(lineRule, /height:\s*100%;/);
});

test('team monthly ops board and reserved monthly LLM analysis are removed', async () => {
  const js = await readFrontendJsBundle();
  const css = await readStylesBundle();

  assert.doesNotMatch(js, /teamMonthlyOpsBoard/);
  assert.doesNotMatch(js, /renderOwnerMonthlyOpsBoard/);
  assert.doesNotMatch(js, /renderMonthlyOpsAgentPanel/);
  assert.doesNotMatch(js, /monthlyOpsAgentAnalysis/);
  assert.doesNotMatch(js, /本月公司阶段运转概览/);
  assert.doesNotMatch(css, /\.monthly-ops-board/);
  assert.doesNotMatch(css, /\.monthly-ops-agent/);
});
