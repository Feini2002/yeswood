import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fakeElement, loadPublicAppHarness } from '../public/test-harness.mjs';

const publicDir = join(process.cwd(), 'public');

function emptyEntryMonth(month) {
  return {
    month,
    label: `${month}m`,
    total: 0,
    newStore: { total: 0, direct: 0, franchise: 0 },
    oldStore: { total: 0, direct: 0, franchise: 0 },
    quadrants: {
      directNew: { total: 0, storeStatuses: [], provinces: [], projects: [] },
      directOld: { total: 0, storeStatuses: [], provinces: [], projects: [] },
      franchiseNew: { total: 0, storeStatuses: [], provinces: [], projects: [] },
      franchiseOld: { total: 0, storeStatuses: [], provinces: [], projects: [] },
    },
    storeStatuses: [],
    provinces: [],
    projects: [],
  };
}

function sampleAnnualEntryStructure(year = 2026) {
  const months = Array.from({ length: 12 }, (_, index) => emptyEntryMonth(index + 1));
  months[2] = {
    ...months[2],
    total: 1,
    newStore: { total: 1, direct: 1, franchise: 0 },
    quadrants: {
      ...months[2].quadrants,
      directNew: {
        total: 1,
        storeStatuses: [{ key: 'regular', label: '\u5e38\u89c4\u5e97', total: 1, newStore: 1, oldStore: 0, direct: 1, franchise: 0 }],
        provinces: [{ key: 'zhejiang', label: '\u6d59\u6c5f', total: 1, newStore: 1, oldStore: 0, direct: 1, franchise: 0 }],
        projects: [],
      },
    },
    storeStatuses: [{ key: 'regular', label: '\u5e38\u89c4\u5e97', total: 1, newStore: 1, oldStore: 0, direct: 1, franchise: 0 }],
    provinces: [{ key: 'zhejiang', label: '\u6d59\u6c5f', total: 1, newStore: 1, oldStore: 0, direct: 1, franchise: 0 }],
    projects: [
      {
        id: 'owner-entry',
        name: 'Owner scoped entry',
        startDate: `${year}-03-05`,
        month: 3,
        storeAge: 'newStore',
        quadrantKey: 'directNew',
        quadrantLabel: 'Direct new',
        storeStatus: '\u5e38\u89c4\u5e97',
        province: '\u6d59\u6c5f',
        owner: 'Owner A',
      },
    ],
  };

  return {
    year,
    defaultMonth: 3,
    totals: { entry: 1, newStore: 1, oldStore: 0, direct: 1, franchise: 0 },
    dataQuality: {},
    fieldCoverage: {},
    months,
    readOnly: true,
  };
}

function sampleDashboardSession({ owner = 'Owner A', dashboardContext = 'direct', year = 2026 } = {}) {
  return {
    schemaVersion: 1,
    readOnly: true,
    snapshotHash: 'session-hash',
    snapshot: {
      source: 'mock',
      syncedAt: '2026-06-09T00:00:00.000Z',
      totalRecords: 1,
      ignoredRecords: 0,
      dashboardAutoUpdateEnabled: false,
      personnelArchitecture: {},
      readOnly: true,
    },
    filters: {
      provinces: [],
      businessTypes: [],
      storeStatuses: [],
      statuses: [],
    },
    metrics: {
      summary: { totalProjects: 1, delayedProjects: 0 },
      statusCounts: [],
      monthlyTrend: [],
      personnel: {
        roles: [{ key: 'cdOwner', people: [{ name: owner, displayName: owner }] }],
      },
    },
    departmentMetrics: {
      profile: 'department',
      annualEntryStructure: sampleAnnualEntryStructure(year),
    },
    team: {
      owner,
      dashboardContext,
      year,
      metrics: {
        owner,
        dashboardContext,
        summary: { totalProjects: 1 },
        benchmark: {},
        insights: { modules: {} },
      },
      workCompletion: {
        owner,
        requestedOwner: owner,
        dashboardContext,
        year,
        team: { owner, groupCount: 1, memberCount: 1 },
        summary: {
          floorPlan: { completedCount: 1, inProgressCount: 0, missingDateCount: 0 },
          display: { completedCount: 0, inProgressCount: 0, missingDateCount: 0 },
          lifecycle: { completedCount: 0, inProgressCount: 0, missingDateCount: 0 },
        },
        monthly: { months: [] },
        groups: [],
        members: [],
        projectsById: {},
        dataQuality: { notes: [], unmappedMemberCount: 0, missingDateCompletionCount: 0, weakProjectKeyCount: 0 },
        readOnly: true,
      },
      responsibilityReview: {
        owner,
        dashboardContext,
        team: { owner, groups: [] },
        executionScope: { description: 'session route test' },
        summary: { peopleCount: 1, externalSupportCount: 0, borrowedOutCount: 0 },
        memberLoads: [],
        people: [],
        disciplines: [],
        readOnly: true,
      },
    },
  };
}

function trackableClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    toggle(name, force) {
      if (force === true) {
        classes.add(name);
        return true;
      }
      if (force === false) {
        classes.delete(name);
        return false;
      }
      if (classes.has(name)) {
        classes.delete(name);
        return false;
      }
      classes.add(name);
      return true;
    },
    contains(name) {
      return classes.has(name);
    },
  };
}

function attachTeamCompletionSectionShells(app) {
  const overviewModule = fakeElement();
  const mainGrid = fakeElement();
  const groupsModule = fakeElement();
  overviewModule.classList = trackableClassList();
  app.elements.teamCompletionHeroStats.closest = (selector) =>
    selector === '.team-completion-overview-module' ? overviewModule : null;
  app.elements.teamCompletionMonthlyChart.closest = (selector) =>
    selector === '.team-completion-main-grid' ? mainGrid : null;
  app.elements.teamCompletionGroupGrid.closest = (selector) =>
    selector === '.team-completion-groups-module' ? groupsModule : null;
  return { overviewModule, mainGrid, groupsModule };
}

test('page hash routing keeps the full page id and query string', async () => {
  const app = await loadPublicAppHarness();
  app.elements.pageSections = [
    { dataset: { page: 'overview' } },
    { dataset: { page: 'teams' } },
    { dataset: { page: 'details' } },
  ];

  app.window.location.hash = '#teams';
  assert.equal(app.currentPageId(), 'teams');

  app.window.location.hash = '#details?search=苏佳蕾&metric=openDelayed';
  assert.deepEqual(
    {
      pageId: app.parsePageHash().pageId,
      search: app.parsePageHash().search,
      metric: app.parsePageHash().metric,
    },
    {
      pageId: 'details',
      search: '苏佳蕾',
      metric: 'openDelayed',
    }
  );

  app.window.location.hash = '#owner-review?owner=苏佳蕾&dashboardContext=direct';
  assert.deepEqual(
    {
      pageId: app.parsePageHash().pageId,
      owner: app.parsePageHash().owner,
      dashboardContext: app.parsePageHash().dashboardContext,
    },
    {
      pageId: 'teams',
      owner: '苏佳蕾',
      dashboardContext: 'direct',
    }
  );

  app.window.location.hash = '#owner-review?ownerPressurePerson=苏佳蕾';
  assert.deepEqual(
    {
      pageId: app.parsePageHash().pageId,
      owner: app.parsePageHash().owner,
      teamProjectOwner: app.parsePageHash().teamProjectOwner,
    },
    {
      pageId: 'teams',
      owner: '苏佳蕾',
      teamProjectOwner: '苏佳蕾',
    }
  );

  app.window.location.hash = '#details?ownerPressurePerson=苏佳蕾';
  assert.deepEqual(
    {
      pageId: app.parsePageHash().pageId,
      owner: app.parsePageHash().owner,
      teamProjectOwner: app.parsePageHash().teamProjectOwner,
    },
    {
      pageId: 'details',
      owner: '',
      teamProjectOwner: '苏佳蕾',
    }
  );
});

test('team hero focuses on owner project status and store tier distribution', async () => {
  const app = await loadPublicAppHarness();
  const teamsPage = await import('../public/pages/teams.mjs');
  const metrics = {
    owner: '苏佳蕾',
    summary: {
      totalProjects: 140,
      activeProjects: 125,
      notStarted: 14,
      pausedProjects: 1,
    },
    totals: {
      inProgress: 125,
      notStarted: 14,
    },
    pausedCount: 1,
    difficultySummary: {
      responsibleWeightedWorkload: 181,
    },
    benchmark: {
      teamDelayedRate: 0,
      teamShareOfDepartment: 27,
      rankAmongOwners: 4,
    },
    tierOrder: ['regular', 'super', 'flagship', 'sinking', 'premium'],
    tierLabels: {
      regular: '常规店',
      super: '超一线',
      flagship: '旗舰店',
      sinking: '下沉店',
      premium: '高标店',
    },
    tiers: {
      regular: { projectCount: 72 },
      super: { projectCount: 54 },
      flagship: { projectCount: 11 },
      sinking: { projectCount: 2 },
      premium: { projectCount: 1 },
    },
  };

  assert.deepEqual(
    teamsPage.teamHeroSummaryParts(metrics).map(({ label, amount, unit }) => [label, amount, unit]),
    [
      ['总项目', '140', '项'],
      ['进行中', '125', '项'],
      ['暂停', '1', '家'],
    ]
  );

  teamsPage.renderTeamHero(metrics);

  assert.equal(app.elements.teamDashboardTitle.textContent, '负责人项目盘面');
  assert.match(app.elements.teamHeadline.innerHTML, /总项目[\s\S]*140/);
  assert.match(app.elements.teamHeadline.innerHTML, /进行中[\s\S]*125/);
  assert.match(app.elements.teamHeadline.innerHTML, /暂停[\s\S]*1/);
  assert.doesNotMatch(app.elements.teamHeadline.innerHTML, /未开始|责任负荷|人月/);

  assert.match(app.elements.teamHeroStats.innerHTML, /店态分布/);
  assert.match(app.elements.teamHeroStats.innerHTML, /常规店[\s\S]*72/);
  assert.match(app.elements.teamHeroStats.innerHTML, /超一线[\s\S]*54/);
  assert.match(app.elements.teamHeroStats.innerHTML, /旗舰店[\s\S]*11/);
  assert.match(app.elements.teamHeroStats.innerHTML, /下沉店[\s\S]*2/);
  assert.match(app.elements.teamHeroStats.innerHTML, /高标店[\s\S]*1/);
  assert.doesNotMatch(app.elements.teamHeroStats.innerHTML, /延期率|占部门比|延期排名|27%|第 4/);
});

test('owner monthly tier board explains scoped projects outside active buckets', async () => {
  const app = await loadPublicAppHarness();
  const teamsPage = await import('../public/pages/teams.mjs');
  const metrics = {
    owner: 'Owner',
    summary: {
      totalProjects: 3,
      activeProjects: 1,
      notStarted: 1,
      pausedProjects: 1,
    },
    totals: {
      inProgress: 1,
      notStarted: 1,
      projectCount: 3,
    },
    scopeBreakdown: {
      closedInScope: 1,
      unbucketedInScope: 0,
    },
    pausedCount: 1,
    tierOrder: ['regular'],
    tierLabels: {
      regular: '常规店',
    },
    tiers: {
      regular: { projectCount: 3, inProgress: 1, notStarted: 1 },
    },
  };

  teamsPage.renderTeamKpis(metrics);

  assert.match(app.elements.teamTierKpiBoard.innerHTML, /data-scope-breakdown="owner-bucket-remainder"/);
  assert.match(app.elements.teamTierKpiBoard.innerHTML, /1 项已闭环仍在负责人范围/);
});

test('team hard owner operations overview lists store status detail rows', async () => {
  const app = await loadPublicAppHarness();
  const teamsPage = await import('../public/pages/teams.mjs');

  teamsPage.renderTeamKpis({
    owner: 'Hard Owner',
    dashboardContext: 'all',
    summary: { totalProjects: 8, activeProjects: 6 },
    hardOwnerMetrics: {
      items: [
        { key: 'notStarted', label: '未开始', value: 4, tone: 'amber' },
        { key: 'hardStageInProgress', label: '硬装阶段进行中', value: 6, tone: 'teal' },
        { key: 'projectClosed', label: '项目闭环', value: 2, tone: 'green' },
      ],
      rows: [
        {
          key: 'regular',
          label: '常规店',
          storeStatus: '常规店',
          values: { notStarted: 1, hardStageInProgress: 3, projectClosed: 1 },
          items: [
            { key: 'notStarted', label: '未开始', value: 1, tone: 'amber' },
            { key: 'hardStageInProgress', label: '硬装阶段进行中', value: 3, tone: 'teal' },
            { key: 'projectClosed', label: '项目闭环', value: 1, tone: 'green' },
          ],
        },
        {
          key: 'sinking',
          label: '下沉店',
          storeStatus: '下沉店',
          values: { notStarted: 3, hardStageInProgress: 3, projectClosed: 1 },
        },
      ],
    },
  });

  assert.match(app.elements.teamTierKpiBoard.innerHTML, /硬装负责人/);
  assert.match(app.elements.teamTierKpiBoard.innerHTML, /店态明细/);
  assert.match(app.elements.teamTierKpiBoard.innerHTML, /常规店/);
  assert.match(app.elements.teamTierKpiBoard.innerHTML, /下沉店/);
  assert.match(app.elements.teamTierKpiBoard.innerHTML, /&quot;storeStatus&quot;:&quot;常规店&quot;/);
});

test('development-only documentation routes are hidden from intranet mode', async () => {
  const app = await loadPublicAppHarness();
  app.elements.pageSections = [
    { dataset: { page: 'overview' }, hidden: false, classList: fakeElement().classList },
    { dataset: { page: 'rules' }, hidden: false, classList: fakeElement().classList },
    { dataset: { page: 'developer-docs' }, hidden: false, classList: fakeElement().classList },
  ];
  app.elements.navItems = [
    { dataset: { page: 'overview' }, hidden: false, classList: fakeElement().classList, setAttribute() {} },
    { dataset: { page: 'rules' }, hidden: false, classList: fakeElement().classList, setAttribute() {} },
    { dataset: { page: 'developer-docs' }, hidden: false, classList: fakeElement().classList, setAttribute() {} },
  ];

  app.state.snapshot = { developerDocumentationVisible: false };
  app.window.location.hash = '#developer-docs';

  assert.equal(app.isDevelopmentDocumentationVisible(), false);
  assert.equal(app.currentPageId(), 'overview');
  app.applyDevelopmentDocumentationVisibility();
  assert.equal(app.elements.navItems[1].hidden, true);
  assert.equal(app.elements.navItems[2].hidden, true);

  app.state.snapshot = { developerDocumentationVisible: true };

  assert.equal(app.isDevelopmentDocumentationVisible(), true);
  assert.equal(app.currentPageId(), 'developer-docs');
  app.applyDevelopmentDocumentationVisibility();
  assert.equal(app.elements.navItems[1].hidden, false);
  assert.equal(app.elements.navItems[2].hidden, false);
});

test('owner responsibility review borrow toggle derives a consistent visible model', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.ownerReviewVisibleReview, 'function');

  const baseState = { completedThisMonth: false, delayedCompletedThisMonth: false, openDelayed: false, missingCompletionDate: false };
  app.state.ownerReviewShowBorrowing = false;
  app.state.ownerReview = {
    owner: '负责人',
    month: '2026-06',
    dashboardContext: 'all',
    readOnly: true,
    team: { owner: '负责人' },
    summary: { projectCount: 3, responsibilityItemCount: 4, peopleCount: 3, externalSupportCount: 1, borrowedOutCount: 1 },
    disciplines: [],
    people: [
      {
        name: '负责人',
        displayName: '负责人',
        supportType: 'team',
        items: [
          {
            projectId: 'team-1',
            direction: 'teamScope',
            discipline: 'hard',
            roleKey: 'cdOwner',
            slotKey: 'cd_owner',
            roleLabel: '硬装负责人',
            deliveryKey: 'hardScheme',
            deliveryLabel: '硬装方案',
            state: { ...baseState, completedThisMonth: true },
          },
        ],
      },
      {
        name: '混合成员',
        supportType: 'mixed',
        items: [
          {
            projectId: 'team-2',
            direction: 'teamScope',
            discipline: 'soft',
            roleKey: 'vmLead',
            slotKey: 'vm_lead',
            roleLabel: '软装组长',
            deliveryKey: 'point',
            deliveryLabel: '点位设计',
            state: baseState,
          },
          {
            projectId: 'borrowed-1',
            direction: 'borrowedOut',
            discipline: 'soft',
            roleKey: 'vmLead',
            slotKey: 'vm_lead',
            roleLabel: '软装组长',
            deliveryKey: 'softScheme',
            deliveryLabel: '方案设计',
            state: { ...baseState, openDelayed: true },
          },
        ],
      },
      {
        name: '外部支援',
        supportType: 'externalSupport',
        items: [
          {
            projectId: 'team-3',
            direction: 'externalIn',
            discipline: 'hard',
            roleKey: 'cdDesigner',
            slotKey: 'cd_designer',
            roleLabel: '硬装设计师',
            deliveryKey: 'hardScheme',
            deliveryLabel: '硬装方案',
            state: baseState,
          },
        ],
      },
    ],
  };

  const visible = app.ownerReviewVisibleReview();
  assert.equal(visible.summary.projectCount, 2);
  assert.equal(visible.summary.responsibilityItemCount, 2);
  assert.equal(visible.summary.peopleCount, 2);
  assert.equal(visible.summary.externalSupportCount, 0);
  assert.equal(visible.summary.borrowedOutCount, 0);
  assert.deepEqual(
    visible.people.map((item) => [item.name, item.supportType, item.responsibilityItemCount]),
    [
      ['负责人', 'team', 1],
      ['混合成员', 'team', 1],
    ]
  );
  assert.equal(visible.disciplines.find((item) => item.key === 'hard')?.itemCount, 1);
  assert.equal(visible.disciplines.find((item) => item.key === 'soft')?.itemCount, 1);
});

test('team work completion module is the clean primary teams surface', async () => {
  const [html, teamsSource, workCompletionSource] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFile(join(publicDir, 'pages/teams.mjs'), 'utf8'),
    readFile(join(publicDir, 'pages/team-work-completion.mjs'), 'utf8'),
  ]);
  const sectionMatch = html.match(
    /<section class="dashboard-page team-dashboard" id="teams"[\s\S]*?<section class="dashboard-page" id="details"/
  );
  assert.ok(sectionMatch, 'team dashboard section should exist in index.html');
  const teamSection = sectionMatch[0];

  assert.match(teamSection, /id="teamWorkCompletionModule"[\s\S]*团队工作完成情况/);
  assert.match(
    teamSection,
    /class="[^"]*team-completion-overview-module[^"]*"[\s\S]*id="teamCompletionHeroStats"[\s\S]*id="teamCompletionMonthlyChart"/
  );
  assert.doesNotMatch(teamSection, /id="teamCompletionInProgress"/);
  assert.match(workCompletionSource, /loadTeamCompletionECharts/);
  assert.match(workCompletionSource, /dataZoom/);
  assert.match(workCompletionSource, /legend/);
  assert.match(workCompletionSource, /openTeamCompletionMonthModal/);
  assert.doesNotMatch(teamSection, /<h4>团队整体完成情况<\/h4>/);
  assert.match(
    teamSection,
    /class="[^"]*team-completion-groups-module[^"]*"[\s\S]*小组完成情况[\s\S]*id="teamCompletionGroupGrid"[\s\S]*id="teamCompletionDataQuality"/
  );
  assert.match(teamSection, /id="teamCompletionMonthlyChart"/);
  assert.match(teamSection, /id="teamCompletionGroupGrid"/);
  assert.match(teamSection, /id="teamLoadModule"[^>]*hidden/);
  assert.match(teamsSource, /loadTeamWorkCompletion/);
  assert.match(workCompletionSource, /team-completion-/);
  assert.doesNotMatch(workCompletionSource, /owner-review-|team-load-/);
});

test('owner responsibility review is embedded under teams without month or owner selector controls', async () => {
  const [html, appSource, ownerReviewSource] = await Promise.all([
    readFile(join(publicDir, 'index.html'), 'utf8'),
    readFile(join(publicDir, 'app.js'), 'utf8'),
    readFile(join(publicDir, 'pages/owner-review.mjs'), 'utf8'),
  ]);
  const sectionMatch = html.match(
    /<section class="dashboard-page team-dashboard" id="teams"[\s\S]*?<section class="dashboard-page" id="details"/
  );
  assert.ok(sectionMatch, 'team dashboard section should exist in index.html');
  const teamSection = sectionMatch[0];

  assert.match(teamSection, /id="teamLoadModule"[\s\S]*团队负载工作台/);
  assert.match(teamSection, /id="ownerReviewTeamStructure"/);
  assert.doesNotMatch(teamSection, /ownerReviewOwnerSelect/);
  assert.doesNotMatch(teamSection, /ownerReviewMonthSelect|复盘月份|月份/);
  assert.doesNotMatch(appSource, /ownerReviewMonthSelect/);
  assert.doesNotMatch(appSource, /params\.set\('month'/);
  assert.doesNotMatch(appSource, /monthLabel\(review\.month\).*执行端设计负载/);
  assert.doesNotMatch(appSource, /当前执行端设计负载/);
  assert.match(ownerReviewSource, /团队负载情况/);
});

test('owner review legacy navigation targets the teams route', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.navigateToOwnerReview, 'function');

  app.window.location.hash = '#owner-review?owner=苏佳蕾&dashboardContext=direct';
  app.navigateToOwnerReview('苏佳蕾', 'direct');

  assert.equal(app.window.location.hash, '#teams?owner=%E8%8B%8F%E4%BD%B3%E8%95%BE&dashboardContext=direct');
});

test('team work completion renders in the teams context with explicit owner, context and year', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      requested.push(String(url));
      return {
        ok: true,
        json: async () => ({
          owner: '苏佳蕾',
          requestedOwner: '苏佳蕾',
          dashboardContext: 'direct',
          year: 2026,
          team: {
            owner: '苏佳蕾',
            groupCount: 1,
            memberCount: 1,
            groups: [{ id: 'group-1', name: '直营1组', leadDisplay: '组长未配置', memberNames: ['陈晶晶'] }],
            members: [{ name: '陈晶晶', displayName: '陈晶晶', groupId: 'group-1', groupName: '直营1组' }],
          },
          summary: {
            floorPlan: { completedCount: 4, inProgressCount: 1, missingDateCount: 0 },
            display: { completedCount: 2, inProgressCount: 3, missingDateCount: 0 },
            lifecycle: { completedCount: 1, inProgressCount: 5, missingDateCount: 0 },
          },
          monthly: {
            months: Array.from({ length: 12 }, (_, index) => ({
              month: index + 1,
              label: `${index + 1}月`,
              floorPlanCompleted: index === 5 ? 2 : 0,
              displayCompleted: index === 5 ? 1 : 0,
              lifecycleCompleted: index === 5 ? 1 : 0,
              projectIds: { floorPlan: [], display: [], lifecycle: [] },
            })),
          },
          groups: [
            {
              id: 'group-1',
              name: '直营1组',
              leadDisplay: '组长未配置',
              memberNames: ['陈晶晶'],
              summary: {
                floorPlan: { completedCount: 4, inProgressCount: 1, missingDateCount: 0 },
                display: { completedCount: 2, inProgressCount: 3, missingDateCount: 0 },
                lifecycle: { completedCount: 1, inProgressCount: 5, missingDateCount: 0 },
              },
              monthly: { months: [] },
            },
          ],
          members: [
            {
              name: '陈晶晶',
              displayName: '陈晶晶',
              groupName: '直营1组',
              projectCount: 3,
              summary: {
                floorPlan: { completedCount: 4, inProgressCount: 1, missingDateCount: 1 },
                display: { completedCount: 2, inProgressCount: 3, missingDateCount: 0 },
                lifecycle: { completedCount: 1, inProgressCount: 5, missingDateCount: 0 },
              },
            },
          ],
          dataQuality: {
            notes: [{ type: 'weakProjectKey', message: '项目缺少稳定 id，已用名称生成临时 key。' }],
            unmappedMemberCount: 0,
            missingDateCompletionCount: 0,
            weakProjectKeyCount: 1,
          },
          readOnly: true,
        }),
      };
    },
  });
  app.elements.pageSections = [
    { dataset: { page: 'overview' } },
    { dataset: { page: 'teams' } },
    { dataset: { page: 'details' } },
  ];
  app.window.location.hash = '#teams?owner=苏佳蕾&dashboardContext=direct';
  const sectionShells = attachTeamCompletionSectionShells(app);
  assert.equal(typeof app.loadTeamWorkCompletion, 'function');

  await app.loadTeamWorkCompletion('苏佳蕾', 'direct', 2026);

  assert.match(requested[0], /\/api\/team-work-completion\?owner=%E8%8B%8F%E4%BD%B3%E8%95%BE&context=direct&year=2026/);
  assert.equal(sectionShells.mainGrid.hidden, false);
  assert.equal(sectionShells.groupsModule.hidden, false);
  assert.equal(sectionShells.overviewModule.classList.contains('is-empty'), false);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /data-team-completion-filter="floorPlan:inProgress"/);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /平面方案躺平进行中[\s\S]*1/);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /data-team-completion-filter="floorPlan:completed"/);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /平面方案躺平完成量[\s\S]*4/);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /data-team-completion-filter="display:inProgress"/);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /方案摆场进行中[\s\S]*3/);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /data-team-completion-filter="display:completed"/);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /方案摆场完成量[\s\S]*2/);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /data-team-completion-filter="lifecycle:inProgress"/);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /项目未闭环进行中[\s\S]*5/);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /data-team-completion-filter="lifecycle:completed"/);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /项目总闭环情况[\s\S]*1/);
  assert.match(app.elements.teamCompletionMonthlyChart.innerHTML, /data-team-completion-chart-host/);
  assert.doesNotMatch(app.elements.teamCompletionMonthlyChart.innerHTML, /team-completion-month-buttons/);
  assert.doesNotMatch(app.elements.teamCompletionMonthlyChart.innerHTML, /data-team-completion-month=/);
  assert.match(app.elements.teamCompletionGroupGrid.innerHTML, /直营1组/);
  assert.match(app.elements.teamCompletionGroupGrid.innerHTML, /team-completion-group-titleline/);
  assert.match(app.elements.teamCompletionGroupGrid.innerHTML, /team-completion-group-lead/);
  assert.match(app.elements.teamCompletionGroupGrid.innerHTML, /组长[\s\S]*陈菲菲/);
  assert.match(app.elements.teamCompletionGroupGrid.innerHTML, /data-team-completion-member="陈晶晶"/);
  assert.match(app.elements.teamCompletionGroupGrid.innerHTML, /缺1/);
  assert.equal(app.elements.teamCompletionMemberGrid.innerHTML, '');
  assert.match(app.elements.teamCompletionDataQuality.innerHTML, /1 条/);
  assert.match(app.elements.teamCompletionDataQuality.innerHTML, /稳定 id/);
});

test('team work completion scope note explains owner responsibility closed-loop gap', async () => {
  const { buildTeamCompletionScopeNoteText } = await import('../public/pages/team-work-completion.mjs');
  const note = buildTeamCompletionScopeNoteText(
    { summary: { lifecycle: { completedCount: 61 } } },
    { hardOwnerMetrics: { values: { projectClosed: 67 } } }
  );
  assert.match(note, /花名册成员参与/);
  assert.match(note, /负责人项目运营情况/);
  assert.match(note, /67 项/);
  assert.match(note, /61 项口径不同/);
});

test('team work completion monthly chart uses entry-style month axis and two completed bars', async () => {
  await loadPublicAppHarness();
  const { buildTeamCompletionMonthlyChartOption } = await import(
    `../public/pages/team-work-completion.mjs?chart-option=${Date.now()}`
  );
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    label: `${index + 1}月`,
    floorPlanCompleted: index === 0 ? 2 : 0,
    floorPlanInProgress: index === 0 ? 1 : 0,
    displayCompleted: index === 0 ? 3 : 0,
    displayInProgress: index === 0 ? 4 : 0,
    lifecycleCompleted: index === 0 ? 5 : 0,
    lifecycleInProgress: index === 0 ? 6 : 0,
    projectIds: {
      floorPlan: [],
      floorPlanInProgress: [],
      display: [],
      displayInProgress: [],
      lifecycle: [],
      lifecycleInProgress: [],
    },
  }));

  const option = buildTeamCompletionMonthlyChartOption(months, { year: 2026 });
  const barSeries = option.series.filter((series) => series.type === 'bar');
  const totalLine = option.series.find((series) => series.name === '完成合计');
  const firstAxisLabel = option.xAxis.axisLabel.formatter('1月', 0);
  const emptyAxisLabel = option.xAxis.axisLabel.formatter('7月', 6);

  assert.deepEqual(
    barSeries.map((series) => series.name),
    ['平面方案完成', '方案摆场完成']
  );
  assert.equal(option.xAxis.axisLabel.interval, 0);
  assert.match(firstAxisLabel, /1月/);
  assert.doesNotMatch(firstAxisLabel, /平\s*成|摆\s*成|闭\s*成|进\s*\d/);
  assert.match(emptyAxisLabel, /7月/);
  assert.doesNotMatch(emptyAxisLabel, /—|平|摆|闭/);
  assert.equal(totalLine.connectNulls, false);
  assert.equal(totalLine.data[0].value, 5);
  assert.equal(totalLine.data[6].value, null);
  assert.equal(barSeries[0].label.show, true);
  assert.equal(barSeries[0].label.position, 'top');
  assert.equal(barSeries[0].label.align, 'center');
  assert.equal(barSeries[0].label.color, '#104020');
  assert.equal(barSeries[1].label.color, '#B7791F');
  assert.equal(barSeries[0].label.formatter({ value: 2 }), '2');
  assert.equal(barSeries[0].label.formatter({ value: 0 }), '');
});

test('team work completion month button opens the existing project modal filtered to that month', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.openTeamCompletionMonthModal, 'function');

  app.state.teamWorkCompletion = {
    owner: '苏佳蕾',
    requestedOwner: '苏佳蕾',
    dashboardContext: 'direct',
    year: 2026,
    summary: {
      floorPlan: { completedCount: 2, inProgressCount: 0, missingDateCount: 0, completedProjectIds: ['project-a', 'project-b'] },
      display: { completedCount: 1, inProgressCount: 0, missingDateCount: 0, completedProjectIds: ['project-c'] },
      lifecycle: { completedCount: 1, inProgressCount: 0, missingDateCount: 0, completedProjectIds: ['project-a'] },
    },
    monthly: {
      months: [
        {
          month: 6,
          label: '6月',
          floorPlanCompleted: 2,
          displayCompleted: 1,
          lifecycleCompleted: 1,
          projectIds: {
            floorPlan: ['project-a', 'project-b'],
            display: ['project-c'],
            lifecycle: ['project-a'],
          },
        },
      ],
    },
    projectsById: {
      'project-a': {
        id: 'project-a',
        name: '宁波完成店',
        status: '已完成',
        groupNames: ['直营1组'],
        roleLabelsByMember: { 陈晶晶: ['硬装设计师'] },
        metrics: { floorPlan: { completed: true, completedAt: '2026-06-10' } },
      },
      'project-b': {
        id: 'project-b',
        name: '杭州完成店',
        status: '已完成',
        groupNames: ['直营2组'],
        roleLabelsByMember: { 陶媛媛: ['硬装组长'] },
        metrics: { floorPlan: { completed: true, completedAt: '2026-06-12' } },
      },
      'project-c': { id: 'project-c', name: '绍兴摆场店', status: '已完成', metrics: { display: { completed: true, completedAt: '2026-06-16' } } },
    },
  };

  app.openTeamCompletionMonthModal(6, 'floorPlan');

  assert.equal(app.elements.teamCompletionMemberModal.hidden, false);
  assert.equal(app.state.teamCompletionModalScopeType, 'month');
  assert.equal(app.state.selectedTeamCompletionMonth, 6);
  assert.equal(app.state.teamCompletionModalFilter, 'floorPlan:completed');
  assert.match(app.elements.teamCompletionMemberModalBody.innerHTML, /2026年 6月完成 · 2项/);
  assert.match(app.elements.teamCompletionMemberModalBody.innerHTML, /宁波完成店/);
  assert.match(app.elements.teamCompletionMemberModalBody.innerHTML, /杭州完成店/);
  assert.match(app.elements.teamCompletionMemberModalBody.innerHTML, /陈晶晶[\s\S]*硬装设计师/);
  assert.match(app.elements.teamCompletionMemberModalBody.innerHTML, /陶媛媛[\s\S]*硬装组长/);
  assert.doesNotMatch(app.elements.teamCompletionMemberModalBody.innerHTML, /绍兴摆场店/);
});

test('team work completion shows member name buttons in group cards and opens member project modal', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.openTeamCompletionMemberModal, 'function');

  app.state.teamWorkCompletion = {
    owner: '苏佳蕾',
    requestedOwner: '苏佳蕾',
    dashboardContext: 'direct',
    year: 2026,
    team: {
      owner: '苏佳蕾',
      groupCount: 1,
      memberCount: 1,
      groups: [{ id: 'group-1', name: '直营1组', leadDisplay: '组长未配置', memberNames: ['陈晶晶'] }],
      members: [{ name: '陈晶晶', displayName: '陈晶晶', groupId: 'group-1', groupName: '直营1组' }],
    },
    summary: {
      floorPlan: {
        completedCount: 1,
        inProgressCount: 1,
        missingDateCount: 0,
        completedProjectIds: ['project-a'],
        inProgressProjectIds: ['project-b'],
      },
      display: {
        completedCount: 0,
        inProgressCount: 1,
        missingDateCount: 0,
        completedProjectIds: [],
        inProgressProjectIds: ['project-a'],
      },
      lifecycle: {
        completedCount: 0,
        inProgressCount: 2,
        missingDateCount: 0,
        completedProjectIds: [],
        inProgressProjectIds: ['project-a', 'project-b'],
      },
    },
    monthly: { months: [] },
    groups: [
      {
        id: 'group-1',
        name: '直营1组',
        leadDisplay: '组长未配置',
        memberNames: ['陈晶晶'],
        projectCount: 2,
        summary: {
          floorPlan: {
            completedCount: 1,
            inProgressCount: 1,
            missingDateCount: 0,
            completedProjectIds: ['project-a'],
            inProgressProjectIds: ['project-b'],
          },
          display: {
            completedCount: 0,
            inProgressCount: 1,
            missingDateCount: 0,
            completedProjectIds: [],
            inProgressProjectIds: ['project-a'],
          },
          lifecycle: {
            completedCount: 0,
            inProgressCount: 2,
            missingDateCount: 0,
            completedProjectIds: [],
            inProgressProjectIds: ['project-a', 'project-b'],
          },
        },
        monthly: { months: [] },
      },
    ],
    members: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        projectCount: 2,
        projectIds: ['project-a', 'project-b'],
        summary: {
          floorPlan: {
            completedCount: 1,
            inProgressCount: 1,
            missingDateCount: 0,
            completedProjectIds: ['project-a'],
            inProgressProjectIds: ['project-b'],
          },
          display: {
            completedCount: 0,
            inProgressCount: 1,
            missingDateCount: 0,
            completedProjectIds: [],
            inProgressProjectIds: ['project-a'],
          },
          lifecycle: {
            completedCount: 0,
            inProgressCount: 2,
            missingDateCount: 0,
            completedProjectIds: [],
            inProgressProjectIds: ['project-a', 'project-b'],
          },
        },
      },
    ],
    projectsById: {
      'project-a': {
        id: 'project-a',
        name: '宁波完成店',
        status: '推进中',
        storeStatus: '常规店',
        groupNames: ['直营1组'],
        roleLabelsByMember: { 陈晶晶: ['硬装设计师'] },
        metrics: {
          floorPlan: { completed: true, inProgress: false, completedAt: '2026-05-01', status: '已完成' },
          display: { completed: false, inProgress: true, status: '软装方案' },
          lifecycle: { completed: false, inProgress: true, status: '硬装推进 / 软装方案' },
        },
      },
      'project-b': {
        id: 'project-b',
        name: '杭州进行店',
        status: '施工中',
        storeStatus: '高标店',
        groupNames: ['直营1组'],
        roleLabelsByMember: { 陈晶晶: ['点位设计师'] },
        metrics: {
          floorPlan: { completed: false, inProgress: true, status: '审核中' },
          display: { completed: false, inProgress: false, status: '' },
          lifecycle: { completed: false, inProgress: true, status: '施工中' },
        },
      },
    },
    dataQuality: { notes: [], unmappedMemberCount: 0, missingDateCompletionCount: 0, weakProjectKeyCount: 0 },
  };

  app.renderTeamWorkCompletionDashboard(app.state.teamWorkCompletion);
  assert.match(app.elements.teamCompletionGroupGrid.innerHTML, /data-team-completion-member="陈晶晶"/);
  assert.match(app.elements.teamCompletionGroupGrid.innerHTML, /<b>2<\/b>/);
  assert.equal(typeof app.handleTeamCompletionFilterClick, 'function');

  app.handleTeamCompletionFilterClick({
    target: {
      closest: (selector) =>
        selector === '[data-team-completion-filter]'
          ? { dataset: { teamCompletionFilter: 'display:inProgress' } }
          : null,
    },
  });
  assert.equal(app.elements.teamCompletionMemberModal.hidden, false);
  assert.equal(app.state.teamCompletionModalScopeType, 'team');
  assert.equal(app.state.teamCompletionModalFilter, 'display:inProgress');
  assert.match(app.elements.teamCompletionMemberModalBody.innerHTML, /团队整体 · 2项/);
  assert.match(app.elements.teamCompletionMemberModalBody.innerHTML, /is-active[^"]*"[\s\S]*方案摆场进行中/);
  assert.match(app.elements.teamCompletionMemberModalBody.innerHTML, /宁波完成店/);
  assert.match(app.elements.teamCompletionMemberModalBody.innerHTML, /陈晶晶[\s\S]*硬装设计师/);
  assert.doesNotMatch(app.elements.teamCompletionMemberModalBody.innerHTML, /杭州进行店/);
  app.closeTeamCompletionMemberModal();

  app.openTeamCompletionMemberModal('陈晶晶');
  assert.equal(app.elements.teamCompletionMemberModal.hidden, false);
  const html = app.elements.teamCompletionMemberModalBody.innerHTML;
  assert.match(html, /陈晶晶 · 2项/);
  assert.match(html, /data-team-completion-filter="floorPlan:inProgress"/);
  assert.match(html, /平面方案躺平进行中[\s\S]*1/);
  assert.match(html, /data-team-completion-filter="floorPlan:completed"/);
  assert.match(html, /平面方案躺平完成量[\s\S]*1/);
  assert.doesNotMatch(html, /平面方案完成[\s\S]*平面方案进行/);
  assert.doesNotMatch(html, /方案摆场完成[\s\S]*方案摆场进行/);
  assert.match(html, /team-completion-member-modal-shell/);
  assert.match(html, /杭州进行店/);
  assert.doesNotMatch(html, /宁波完成店/);
  assert.match(html, /点位设计师/);

  app.handleTeamCompletionMemberModalClick({
    target: {
      closest: (selector) =>
        selector === '[data-team-completion-filter]'
          ? { dataset: { teamCompletionFilter: 'floorPlan:completed' } }
          : null,
    },
  });
  const filteredHtml = app.elements.teamCompletionMemberModalBody.innerHTML;
  assert.match(filteredHtml, /team-completion-member-modal-shell/);
  assert.match(filteredHtml, /is-active[^"]*"[\s\S]*平面方案躺平完成量/);
  assert.match(filteredHtml, /宁波完成店/);
  assert.match(filteredHtml, /2026-05-01/);
  assert.match(filteredHtml, /硬装设计师/);
  assert.doesNotMatch(filteredHtml, /杭州进行店/);

  app.handleTeamCompletionMemberModalClick({
    target: {
      closest: (selector) =>
        selector === '[data-team-completion-project-id], [data-team-completion-project-name]'
          ? { dataset: { teamCompletionProjectId: 'project-a', teamCompletionProjectName: '宁波完成店' } }
          : null,
    },
  });
  assert.equal(app.state.selectedProjectId, 'project-a');
  assert.equal(app.state.projectDetailContext?.reason, '团队工作完成情况');

  app.handleTeamCompletionMemberModalClick({ target: app.elements.teamCompletionMemberModal });
  assert.equal(app.elements.teamCompletionMemberModal.hidden, true);
});

test('team work completion controls switch context year and render transient states', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      requested.push(String(url));
      return {
        ok: true,
        json: async () => ({
          owner: '苏佳蕾',
          requestedOwner: '苏佳蕾',
          displayName: '苏佳蕾',
          dashboardContext: String(url).includes('context=franchise') ? 'franchise' : 'direct',
          year: Number(new URL(`http://local${url}`).searchParams.get('year') || 2026),
          team: { owner: '苏佳蕾', groupCount: 1, memberCount: 1 },
          summary: {
            floorPlan: { completedCount: 1, inProgressCount: 0, missingDateCount: 0 },
            display: { completedCount: 0, inProgressCount: 0, missingDateCount: 0 },
            lifecycle: { completedCount: 0, inProgressCount: 0, missingDateCount: 0 },
          },
          monthly: { months: [] },
          groups: [],
          members: [],
          projectsById: {},
          dataQuality: { notes: [], unmappedMemberCount: 0, missingDateCompletionCount: 0, weakProjectKeyCount: 0 },
          readOnly: true,
        }),
      };
    },
  });
  app.elements.pageSections = [{ dataset: { page: 'teams' } }];
  app.state.selectedTeamOwner = '苏佳蕾';
  app.state.teamWorkCompletionYear = 2026;
  app.window.location.hash = '#teams?owner=苏佳蕾&dashboardContext=direct&year=2026';
  const sectionShells = attachTeamCompletionSectionShells(app);
  const completionContextTabs = ['all', 'direct', 'franchise'].map((context) => {
    const classes = new Set();
    const button = fakeElement();
    button.dataset.teamCompletionContext = context;
    button.classList = {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      toggle(name, force) {
        if (force === true) {
          classes.add(name);
          return;
        }
        if (force === false) {
          classes.delete(name);
          return;
        }
        if (classes.has(name)) {
          classes.delete(name);
        } else {
          classes.add(name);
        }
      },
      contains(name) {
        return classes.has(name);
      },
    };
    return button;
  });
  app.elements.teamCompletionContextTabs = {
    querySelectorAll: (selector) =>
      selector === '[data-team-completion-context]' ? completionContextTabs : [],
    querySelector: (selector) =>
      completionContextTabs.find((button) => selector === `[data-team-completion-context="${button.dataset.teamCompletionContext}"]`) ||
      null,
  };

  await app.handleTeamWorkCompletionContextClick({
    target: {
      closest: () => ({ dataset: { teamCompletionContext: 'franchise' } }),
    },
    preventDefault() {},
  });
  const franchiseTab = app.elements.teamCompletionContextTabs.querySelector('[data-team-completion-context="franchise"]');
  assert.equal(franchiseTab.classList.contains('is-active'), true);
  app.elements.teamCompletionYearSelect.value = '2025';
  await app.handleTeamWorkCompletionYearChange();

  const completionRequests = requested.filter((url) => String(url).startsWith('/api/team-work-completion'));
  assert.match(completionRequests[0], /\/api\/team-work-completion\?owner=%E8%8B%8F%E4%BD%B3%E8%95%BE&context=franchise&year=2026/);
  assert.match(completionRequests[1], /\/api\/team-work-completion\?owner=%E8%8B%8F%E4%BD%B3%E8%95%BE&context=franchise&year=2025/);

  app.state.teamWorkCompletion = null;
  app.state.teamWorkCompletionLoading = true;
  app.renderTeamWorkCompletionDashboard();
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /正在读取 苏佳蕾 的完成情况/);
  assert.equal(app.elements.teamLoadModule.hidden, true);
  assert.equal(sectionShells.mainGrid.hidden, true);
  assert.equal(sectionShells.groupsModule.hidden, true);
  assert.equal(sectionShells.overviewModule.classList.contains('is-empty'), true);

  app.state.teamWorkCompletionLoading = false;
  app.state.teamWorkCompletionError = 'network failed';
  app.renderTeamWorkCompletionDashboard();
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /团队工作完成情况加载失败/);

  assert.equal(sectionShells.mainGrid.hidden, true);
  assert.equal(sectionShells.groupsModule.hidden, true);
  assert.equal(sectionShells.overviewModule.classList.contains('is-empty'), true);

  app.state.teamWorkCompletionError = '';
  app.renderTeamWorkCompletionDashboard(null);
  assert.match(app.elements.teamCompletionHeroStats.innerHTML, /暂无团队完成数据/);
  assert.equal(app.elements.teamCompletionMonthlyChart.innerHTML, '');
  assert.equal(sectionShells.mainGrid.hidden, true);
  assert.equal(sectionShells.groupsModule.hidden, true);
  assert.equal(sectionShells.overviewModule.classList.contains('is-empty'), true);
});

test('team work completion franchise context is kept as a data-audit empty state', async () => {
  const app = await loadPublicAppHarness();
  attachTeamCompletionSectionShells(app);
  app.state.teamWorkCompletion = {
    owner: '苏佳蕾',
    requestedOwner: '苏佳蕾',
    displayName: '苏佳蕾',
    dashboardContext: 'franchise',
    year: 2026,
    projectCount: 0,
    summary: {
      floorPlan: { completedCount: 0, inProgressCount: 0, missingDateCount: 0, completedProjectIds: [], inProgressProjectIds: [] },
      display: { completedCount: 0, inProgressCount: 0, missingDateCount: 0, completedProjectIds: [], inProgressProjectIds: [] },
      lifecycle: { completedCount: 0, inProgressCount: 0, missingDateCount: 0, completedProjectIds: [], inProgressProjectIds: [] },
    },
    monthly: { months: [] },
    groups: [],
    members: [],
    projectsById: {},
    dataQuality: { notes: [], unmappedMemberCount: 0, missingDateCompletionCount: 0, weakProjectKeyCount: 0 },
  };

  app.renderTeamWorkCompletionDashboard(app.state.teamWorkCompletion);

  assert.match(app.elements.teamCompletionDataQuality.innerHTML, /加盟口径核查/);
  assert.match(app.elements.teamCompletionDataQuality.innerHTML, /若这里出现项目/);
  assert.match(app.elements.teamCompletionDataQuality.innerHTML, /组别|负责人|店态/);
});

test('team work completion waits for owner directory before showing no data', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      requested.push(String(url));
      return { ok: true, json: async () => ({}) };
    },
  });
  app.window.location.hash = '#teams';
  const sectionShells = attachTeamCompletionSectionShells(app);
  app.state.metrics = null;
  app.state.fullMetrics = null;
  app.state.snapshot = null;
  app.state.teamWorkCompletion = null;
  app.state.teamWorkCompletionLoading = false;

  await app.loadTeamWorkCompletion('', 'direct', 2026);

  assert.deepEqual(requested, []);
  assert.equal(app.state.teamWorkCompletion, null);
  assert.equal(app.state.teamWorkCompletionLoading, true);
  assert.equal(app.state.teamWorkCompletionError, '');
  assert.equal(sectionShells.mainGrid.hidden, true);
  assert.equal(sectionShells.groupsModule.hidden, true);
  assert.equal(sectionShells.overviewModule.classList.contains('is-empty'), true);
  assert.doesNotMatch(app.elements.teamCompletionHeroStats.innerHTML, /鏆傛棤|暂无/);
});

test('teams same-page hash updates do not trigger page-level reloads', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.startsWith('/api/team-metrics-batch')) {
        return {
          ok: true,
          json: async () => ({
            owners: ['Owner A'],
            metricsByOwner: {
              'Owner A': {
                owner: 'Owner A',
                dashboardContext: new URL(`http://local${path}`).searchParams.get('context') || 'all',
                summary: { totalProjects: 1, activeProjects: 1 },
                totals: { inProgress: 1 },
                benchmark: {},
                insights: { modules: {} },
              },
            },
          }),
        };
      }
      if (path.startsWith('/api/team-work-completion')) {
        const params = new URL(`http://local${path}`).searchParams;
        return {
          ok: true,
          json: async () => ({
            owner: 'Owner A',
            requestedOwner: 'Owner A',
            dashboardContext: params.get('context') || 'all',
            year: Number(params.get('year') || 2026),
            team: { owner: 'Owner A', groupCount: 0, memberCount: 0, groups: [], members: [] },
            summary: {
              floorPlan: { completedCount: 0, inProgressCount: 0 },
              display: { completedCount: 0, inProgressCount: 0 },
              lifecycle: { completedCount: 0, inProgressCount: 0 },
            },
            monthly: { months: [] },
            groups: [],
            members: [],
            projectsById: {},
            dataQuality: { notes: [], unmappedMemberCount: 0, missingDateCompletionCount: 0, weakProjectKeyCount: 0 },
            readOnly: true,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });
  app.elements.pageSections = [
    { dataset: { page: 'overview' }, classList: fakeElement().classList },
    { dataset: { page: 'teams' }, classList: fakeElement().classList },
  ];
  app.elements.navItems = [
    { dataset: { page: 'overview' }, classList: fakeElement().classList, setAttribute() {} },
    { dataset: { page: 'teams' }, classList: fakeElement().classList, setAttribute() {} },
  ];

  app.window.location.hash = '#teams?owner=Owner%20A&dashboardContext=direct&year=2026';
  app.showPage('teams');
  await new Promise((resolve) => setTimeout(resolve, 0));
  requested.length = 0;

  app.window.location.hash = '#teams?owner=Owner%20A&dashboardContext=franchise&year=2025';
  app.showPage('teams');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    requested.filter((path) => path.startsWith('/api/team-metrics') || path.startsWith('/api/team-work-completion')),
    []
  );
});

test('hashchange handler keeps same-page teams query changes local without data reload', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.startsWith('/api/team-metrics-batch')) {
        return {
          ok: true,
          json: async () => ({
            owners: ['Owner A'],
            metricsByOwner: {
              'Owner A': {
                owner: 'Owner A',
                dashboardContext: new URL(`http://local${path}`).searchParams.get('context') || 'all',
                summary: { totalProjects: 1, activeProjects: 1 },
                totals: { inProgress: 1 },
                benchmark: {},
                insights: { modules: {} },
              },
            },
          }),
        };
      }
      if (path.startsWith('/api/team-work-completion')) {
        const params = new URL(`http://local${path}`).searchParams;
        return {
          ok: true,
          json: async () => ({
            owner: 'Owner A',
            requestedOwner: 'Owner A',
            dashboardContext: params.get('context') || 'all',
            year: Number(params.get('year') || 2026),
            team: { owner: 'Owner A', groupCount: 0, memberCount: 0, groups: [], members: [] },
            summary: {
              floorPlan: { completedCount: 0, inProgressCount: 0 },
              display: { completedCount: 0, inProgressCount: 0 },
              lifecycle: { completedCount: 0, inProgressCount: 0 },
            },
            monthly: { months: [] },
            groups: [],
            members: [],
            projectsById: {},
            dataQuality: { notes: [], unmappedMemberCount: 0, missingDateCompletionCount: 0, weakProjectKeyCount: 0 },
            readOnly: true,
          }),
        };
      }
      if (path.startsWith('/api/team-responsibility-review')) {
        return {
          ok: true,
          json: async () => ({
            owner: 'Owner A',
            dashboardContext: new URL(`http://local${path}`).searchParams.get('context') || 'all',
            team: { owner: 'Owner A', groups: [] },
            executionScope: { description: 'hashchange test' },
            summary: { peopleCount: 0, externalSupportCount: 0, borrowedOutCount: 0 },
            memberLoads: [],
            people: [],
            disciplines: [],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });
  app.elements.pageSections = [
    { dataset: { page: 'overview' }, classList: fakeElement().classList },
    { dataset: { page: 'teams' }, classList: fakeElement().classList },
  ];
  app.elements.navItems = [
    { dataset: { page: 'overview' }, classList: fakeElement().classList, setAttribute() {} },
    { dataset: { page: 'teams' }, classList: fakeElement().classList, setAttribute() {} },
  ];
  let scrollCount = 0;
  app.window.scrollTo = () => {
    scrollCount += 1;
  };

  app.window.location.hash = '#teams?owner=Owner%20A&dashboardContext=direct&year=2026';
  app.showPage('teams');
  await new Promise((resolve) => setTimeout(resolve, 0));
  requested.length = 0;
  scrollCount = 0;

  assert.equal(typeof app.bindEvents, 'function');
  app.bindEvents();
  const hashListeners = app.window.__eventListeners?.hashchange || [];
  assert.equal(hashListeners.length, 1);

  app.window.location.hash = '#teams?owner=Owner%20A&dashboardContext=franchise&year=2025';
  hashListeners[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    requested.filter(
      (path) =>
        path.startsWith('/api/team-metrics') ||
        path.startsWith('/api/team-work-completion') ||
        path.startsWith('/api/team-responsibility-review')
    ),
    []
  );
  assert.equal(scrollCount, 0);
});

test('team owner control uses explicit local loading after same-page routing', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.startsWith('/api/team-metrics-batch')) {
        const owner = new URL(`http://local${path}`).searchParams.get('owner') || '';
        return {
          ok: true,
          json: async () => ({
            owners: [owner],
            metricsByOwner: {
              [owner]: {
                owner,
                dashboardContext: 'direct',
                summary: { totalProjects: 2, activeProjects: 2 },
                totals: { inProgress: 2 },
                benchmark: {},
                insights: { modules: {} },
              },
            },
          }),
        };
      }
      if (path.startsWith('/api/team-work-completion')) {
        const params = new URL(`http://local${path}`).searchParams;
        return {
          ok: true,
          json: async () => ({
            owner: params.get('owner') || '',
            requestedOwner: params.get('owner') || '',
            dashboardContext: params.get('context') || 'all',
            year: Number(params.get('year') || 2026),
            team: { owner: params.get('owner') || '', groupCount: 0, memberCount: 0, groups: [], members: [] },
            summary: {
              floorPlan: { completedCount: 0, inProgressCount: 0 },
              display: { completedCount: 0, inProgressCount: 0 },
              lifecycle: { completedCount: 0, inProgressCount: 0 },
            },
            monthly: { months: [] },
            groups: [],
            members: [],
            projectsById: {},
            dataQuality: { notes: [], unmappedMemberCount: 0, missingDateCompletionCount: 0, weakProjectKeyCount: 0 },
            readOnly: true,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });
  app.window.location.hash = '#teams?owner=Owner%20A&dashboardContext=direct&year=2026';

  assert.equal(typeof app.loadSelectedTeamOwner, 'function');
  await app.loadSelectedTeamOwner('Owner B');

  assert.equal(app.window.location.hash, '#teams?owner=Owner+B&dashboardContext=direct');
  assert.ok(requested.some((path) => path === '/api/team-metrics-batch?context=direct&owner=Owner+B'));
  assert.ok(requested.some((path) => path === '/api/team-work-completion?owner=Owner+B&context=direct&year=2026'));
});

test('team metrics owner switch keeps current operations overview visible while uncached owner loads', async () => {
  let releaseTeamMetrics;
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      assert.match(String(url), /^\/api\/team-metrics-batch\?/);
      return new Promise((resolve) => {
        releaseTeamMetrics = () =>
          resolve({
            ok: true,
            json: async () => ({
              owners: ['Owner B'],
              dashboardContext: 'direct',
              metricsByOwner: {
                'Owner B': {
                  owner: 'Owner B',
                  dashboardContext: 'direct',
                  summary: { totalProjects: 2, activeProjects: 2 },
                  totals: { inProgress: 2 },
                  benchmark: {},
                  insights: { modules: {} },
                },
              },
            }),
          });
      });
    },
  });
  app.window.location.hash = '#teams?owner=Owner%20A&dashboardContext=direct';
  const ownerAMetrics = {
    owner: 'Owner A',
    dashboardContext: 'direct',
    summary: { totalProjects: 1, activeProjects: 1 },
    totals: { inProgress: 1 },
    benchmark: {},
    insights: { modules: {} },
  };
  app.state.teamMetrics = ownerAMetrics;
  app.state.teamMetricsByOwner = { 'Owner A': ownerAMetrics };
  app.state.teamMetricsBatchKey = 'direct';
  app.state.selectedTeamOwner = 'Owner A';
  app.elements.teamEntryTrendBoard.innerHTML = '<section>Owner A operations overview stays visible</section>';
  app.elements.teamTierKpiBoard.innerHTML = '<section>Owner A tier overview stays visible</section>';

  const switchPromise = app.loadTeamMetrics('Owner B', 'direct');
  let entryTrendHtml = '';
  let tierBoardHtml = '';
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    entryTrendHtml = app.elements.teamEntryTrendBoard.innerHTML;
    tierBoardHtml = app.elements.teamTierKpiBoard.innerHTML;
  } finally {
    releaseTeamMetrics?.();
    await switchPromise.catch(() => null);
  }

  assert.match(entryTrendHtml, /Owner A operations overview stays visible/);
  assert.match(tierBoardHtml, /Owner A tier overview stays visible/);
  assert.doesNotMatch(tierBoardHtml, /loading|正在切换|姝ｅ湪鍒囨崲/i);

  assert.equal(app.state.teamMetrics.owner, 'Owner B');
});

test('team work completion keeps current dashboard visible while switching uncached scope', async () => {
  let resolveFetch;
  const fetchPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      if (String(url).startsWith('/api/team-work-completion')) {
        return fetchPromise;
      }
      return { ok: true, json: async () => ({}) };
    },
  });
  app.window.location.hash = '#teams?owner=Owner%20A&dashboardContext=direct&year=2026';
  app.state.selectedTeamOwner = 'Owner A';
  app.state.teamWorkCompletion = {
    owner: 'Owner A',
    dashboardContext: 'direct',
    year: 2026,
    team: { owner: 'Owner A', groupCount: 1, memberCount: 1 },
    summary: {
      floorPlan: { completedCount: 1, inProgressCount: 0, missingDateCount: 0 },
      display: { completedCount: 0, inProgressCount: 0, missingDateCount: 0 },
      lifecycle: { completedCount: 0, inProgressCount: 0, missingDateCount: 0 },
    },
    monthly: { months: [] },
    groups: [{ id: 'old-group', name: 'Current Group', leadDisplay: 'Lead', memberNames: [], projectCount: 1, summary: {} }],
    members: [],
    projectsById: {},
    dataQuality: { notes: [], unmappedMemberCount: 0, missingDateCompletionCount: 0, weakProjectKeyCount: 0 },
  };
  app.renderTeamWorkCompletionDashboard();
  const completionContextTabs = ['all', 'direct', 'franchise'].map((context) => {
    const classes = new Set(context === 'direct' ? ['is-active'] : []);
    const button = fakeElement();
    button.dataset.teamCompletionContext = context;
    button.classList = {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      toggle(name, force) {
        if (force === true) {
          classes.add(name);
          return;
        }
        if (force === false) {
          classes.delete(name);
          return;
        }
        if (classes.has(name)) {
          classes.delete(name);
        } else {
          classes.add(name);
        }
      },
      contains(name) {
        return classes.has(name);
      },
    };
    return button;
  });
  app.elements.teamCompletionContextTabs = {
    querySelectorAll: (selector) =>
      selector === '[data-team-completion-context]' ? completionContextTabs : [],
    querySelector: (selector) =>
      completionContextTabs.find((button) => selector === `[data-team-completion-context="${button.dataset.teamCompletionContext}"]`) ||
      null,
  };

  const switchPromise = app.handleTeamWorkCompletionContextClick({
    target: {
      closest: () => ({ dataset: { teamCompletionContext: 'franchise' } }),
    },
    preventDefault() {},
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pendingGroupHtml = app.elements.teamCompletionGroupGrid.innerHTML;
  const pendingHeroHtml = app.elements.teamCompletionHeroStats.innerHTML;
  const pendingFranchiseTab = app.elements.teamCompletionContextTabs.querySelector('[data-team-completion-context="franchise"]');
  const pendingDirectTab = app.elements.teamCompletionContextTabs.querySelector('[data-team-completion-context="direct"]');

  resolveFetch({
    ok: true,
    json: async () => ({
      owner: 'Owner A',
      requestedOwner: 'Owner A',
      dashboardContext: 'franchise',
      year: 2026,
      team: { owner: 'Owner A', groupCount: 1, memberCount: 1 },
      summary: {
        floorPlan: { completedCount: 2, inProgressCount: 0, missingDateCount: 0 },
        display: { completedCount: 0, inProgressCount: 0, missingDateCount: 0 },
        lifecycle: { completedCount: 0, inProgressCount: 0, missingDateCount: 0 },
      },
      monthly: { months: [] },
      groups: [{ id: 'new-group', name: 'Franchise Group', leadDisplay: 'Lead', memberNames: [], projectCount: 2, summary: {} }],
      members: [],
      projectsById: {},
      dataQuality: { notes: [], unmappedMemberCount: 0, missingDateCompletionCount: 0, weakProjectKeyCount: 0 },
      readOnly: true,
    }),
  });
  await switchPromise;

  assert.match(pendingGroupHtml, /Current Group/);
  assert.doesNotMatch(pendingHeroHtml, /正在读取/);
  assert.equal(pendingFranchiseTab.classList.contains('is-active'), true);
  assert.equal(pendingDirectTab.classList.contains('is-active'), false);
  assert.match(app.elements.teamCompletionGroupGrid.innerHTML, /Franchise Group/);
});

test('team work completion uses cached results by default and force refreshes explicitly', async () => {
  let requestCount = 0;
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      assert.match(String(url), /^\/api\/team-work-completion\?/);
      requestCount += 1;
      return {
        ok: true,
        json: async () => ({
          owner: 'Owner A',
          requestedOwner: 'Owner A',
          dashboardContext: 'direct',
          year: 2026,
          team: { owner: 'Owner A', groupCount: 1, memberCount: 1 },
          summary: {
            floorPlan: { completedCount: requestCount, inProgressCount: 0, missingDateCount: 0 },
            display: { completedCount: 0, inProgressCount: 0, missingDateCount: 0 },
            lifecycle: { completedCount: 0, inProgressCount: 0, missingDateCount: 0 },
          },
          monthly: { months: [] },
          groups: [],
          members: [],
          projectsById: {},
          dataQuality: { notes: [], unmappedMemberCount: 0, missingDateCompletionCount: 0, weakProjectKeyCount: 0 },
          readOnly: true,
        }),
      };
    },
  });
  app.window.location.hash = '#teams?owner=Owner%20A&dashboardContext=direct&year=2026';

  await app.loadTeamWorkCompletion('Owner A', 'direct', 2026);
  const cachedReview = app.state.teamWorkCompletion;
  await app.loadTeamWorkCompletion('Owner A', 'direct', 2026);
  await app.loadTeamWorkCompletion('Owner A', 'direct', 2026, { forceRefresh: true });

  assert.equal(requestCount, 2);
  assert.equal(cachedReview.summary.floorPlan.completedCount, 1);
  assert.equal(app.state.teamWorkCompletion.summary.floorPlan.completedCount, 2);
});

test('initial teams route loads dashboard session without page fanout', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.startsWith('/api/dashboard-session')) {
        return {
          ok: true,
          json: async () => sampleDashboardSession({ owner: 'Owner A', dashboardContext: 'direct', year: 2026 }),
        };
      }
      throw new Error(`initial session load should not fetch ${path}`);
    },
  });
  app.elements.pageSections = [
    { dataset: { page: 'overview' }, classList: fakeElement().classList },
    { dataset: { page: 'teams' }, classList: fakeElement().classList },
  ];
  app.elements.navItems = [
    { dataset: { page: 'overview' }, classList: fakeElement().classList, setAttribute() {} },
    { dataset: { page: 'teams' }, classList: fakeElement().classList, setAttribute() {} },
  ];
  app.window.location.hash = '#teams?owner=Owner%20A&dashboardContext=direct&year=2026';

  assert.equal(typeof app.init, 'function');
  await app.init();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(requested, ['/api/dashboard-session?owner=Owner+A&context=direct&year=2026']);
  assert.equal(app.state.snapshot.source, 'mock');
  assert.equal(app.state.metrics.summary.totalProjects, 1);
  assert.equal(app.state.profileMetrics.department.profile, 'department');
  assert.equal(app.state.teamMetrics.owner, 'Owner A');
  assert.equal(app.state.teamWorkCompletion.owner, 'Owner A');
  assert.equal(app.state.ownerReview.owner, 'Owner A');
});

test('dashboard session clears stale department profile when the bundle omits it', async () => {
  const app = await loadPublicAppHarness({
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  const { applyDashboardSessionPayload } = await import('../public/lib/dashboard-loader.mjs');
  const payload = sampleDashboardSession({ owner: 'Owner A', dashboardContext: 'direct', year: 2026 });
  payload.departmentMetrics = null;
  app.state.profileMetrics.department = { profile: 'stale-department' };
  app.state.annualEntryStructure = { year: 2025 };

  applyDashboardSessionPayload(payload);

  assert.equal(app.state.profileMetrics.department, null);
  assert.equal(app.state.annualEntryStructure, null);
  assert.equal(app.state.metrics.summary.totalProjects, 1);
});

test('profile dashboard uses cached results by default and force refreshes explicitly', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.startsWith('/api/dashboard-metrics')) {
        return {
          ok: true,
          json: async () => ({ scopeCount: 1, summary: { totalProjects: 1 }, totals: {} }),
        };
      }
      if (path.startsWith('/api/projects')) {
        return {
          ok: true,
          json: async () => ({ items: [{ id: `project-${requested.length}`, name: 'Project' }], fieldCatalog: [] }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });

  assert.equal(typeof app.loadProfileDashboard, 'function');
  await app.loadProfileDashboard('direct');
  await app.loadProfileDashboard('direct');
  await app.loadProfileDashboard('direct', { forceRefresh: true });

  assert.equal(requested.filter((path) => path === '/api/dashboard-metrics?profile=direct').length, 2);
  assert.equal(requested.filter((path) => path === '/api/projects?profile=direct&view=summary').length, 2);
});

test('team load review renders in the teams context with explicit owner and context', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      requested.push(String(url));
      return {
        ok: true,
        json: async () => ({
          owner: '苏佳蕾',
          dashboardContext: 'direct',
          team: { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['陈晶晶'] }] },
          executionScope: { description: '直营硬装 · CD设计师 · 进行中平面方案' },
          summary: { peopleCount: 1, externalSupportCount: 0, borrowedOutCount: 0 },
          memberLoads: [
            {
              name: '陈晶晶',
              groupName: '直营1组',
              summary: { floorPlanActiveCount: 1, associatedProjectCount: 1 },
              floorPlan: { active: [], completed: [] },
              display: { active: [], completed: [] },
              associatedProjects: [],
            },
          ],
          people: [],
          disciplines: [],
        }),
      };
    },
  });
  app.elements.pageSections = [
    { dataset: { page: 'overview' } },
    { dataset: { page: 'teams' } },
    { dataset: { page: 'details' } },
  ];
  app.window.location.hash = '#teams?owner=苏佳蕾&dashboardContext=direct';
  assert.equal(typeof app.loadOwnerResponsibilityReview, 'function');

  await app.loadOwnerResponsibilityReview('苏佳蕾', 'direct');

  assert.match(requested[0], /\/api\/team-responsibility-review\?owner=%E8%8B%8F%E4%BD%B3%E8%95%BE&context=direct/);
  assert.match(app.elements.ownerReviewHeadline.innerHTML, /执行负载/);
  assert.match(app.elements.ownerReviewTeamStructure.innerHTML, /直营1组/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /陈晶晶/);
});

test('teams dashboard refresh loads work completion after team owner options resolve', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.startsWith('/api/dashboard-session')) {
        return {
          ok: true,
          json: async () => sampleDashboardSession({ owner: 'Owner A', dashboardContext: 'direct', year: 2026 }),
        };
      }
      if (path.startsWith('/api/snapshot')) {
        return {
          ok: true,
          json: async () => ({ source: 'mock', syncedAt: '2026-06-08T00:00:00.000Z', personnelArchitecture: {} }),
        };
      }
      if (path.startsWith('/api/projects')) {
        return {
          ok: true,
          json: async () => ({ items: [], fieldCatalog: [] }),
        };
      }
      if (path.startsWith('/api/dashboard-metrics')) {
        return {
          ok: true,
          json: async () => ({}),
        };
      }
      if (path.startsWith('/api/metrics')) {
        return {
          ok: true,
          json: async () => ({
            personnel: {
              roles: [
                { key: 'cdOwner', people: [{ name: '苏佳蕾', displayName: '苏佳蕾' }] },
              ],
            },
          }),
        };
      }
      if (path.startsWith('/api/team-metrics-batch')) {
        return {
          ok: true,
          json: async () => ({
            owners: ['苏佳蕾'],
            metricsByOwner: {
              苏佳蕾: {
                owner: '苏佳蕾',
                dashboardContext: 'direct',
                summary: { totalProjects: 1 },
                benchmark: {},
                insights: { modules: {} },
              },
            },
          }),
        };
      }
      if (path.startsWith('/api/team-work-completion')) {
        return {
          ok: true,
          json: async () => ({
            owner: '苏佳蕾',
            requestedOwner: '苏佳蕾',
            dashboardContext: 'direct',
            year: 2026,
            team: { owner: '苏佳蕾', groupCount: 1, memberCount: 1, groups: [], members: [] },
            summary: {
              floorPlan: { completedCount: 1, inProgressCount: 0 },
              display: { completedCount: 0, inProgressCount: 1 },
              lifecycle: { completedCount: 0, inProgressCount: 1 },
            },
            monthly: { months: [] },
            groups: [
              {
                id: 'group-1',
                name: '直营1组',
                leadDisplay: '组长未配置',
                memberNames: ['陈晶晶'],
                projectCount: 1,
                summary: {
                  floorPlan: { completedCount: 1, inProgressCount: 0 },
                  display: { completedCount: 0, inProgressCount: 1 },
                  lifecycle: { completedCount: 0, inProgressCount: 1 },
                },
                monthly: { months: [] },
              },
            ],
            members: [
              {
                name: '陈晶晶',
                displayName: '陈晶晶',
                groupName: '直营1组',
                summary: {
                  floorPlan: { completedCount: 1, inProgressCount: 0 },
                  display: { completedCount: 0, inProgressCount: 1 },
                  lifecycle: { completedCount: 0, inProgressCount: 1 },
                },
              },
            ],
            dataQuality: { notes: [], unmappedMemberCount: 0, missingDateCompletionCount: 0 },
            readOnly: true,
          }),
        };
      }
      if (path.startsWith('/api/team-responsibility-review')) {
        return {
          ok: true,
          json: async () => ({
            owner: '苏佳蕾',
            dashboardContext: 'direct',
            team: { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['陈晶晶'] }] },
            executionScope: { description: '直营硬装 · CD设计师 · 进行中平面方案' },
            summary: { peopleCount: 1, memberFloorPlanActiveCount: 1 },
            memberLoads: [
              {
                name: '陈晶晶',
                displayName: '陈晶晶',
                groupName: '直营1组',
                summary: { floorPlanActiveCount: 1, associatedProjectCount: 1 },
                floorPlan: { active: [], completed: [] },
                display: { active: [], completed: [] },
                associatedProjects: [],
              },
            ],
            people: [],
            disciplines: [],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({}),
      };
    },
  });
  app.elements.pageSections = [
    { dataset: { page: 'overview' }, classList: fakeElement().classList },
    { dataset: { page: 'teams' }, classList: fakeElement().classList },
    { dataset: { page: 'details' }, classList: fakeElement().classList },
  ];
  app.window.location.hash = '#teams?owner=Owner%20A&dashboardContext=direct&year=2026';

  await app.refresh();

  assert.deepEqual(requested, ['/api/dashboard-session?owner=Owner+A&context=direct&year=2026']);
  assert.equal(app.state.teamMetrics?.owner, 'Owner A');
  assert.equal(app.state.teamWorkCompletion?.owner, 'Owner A');
  assert.equal(app.state.ownerReview?.owner, 'Owner A');
});

test('owner load dashboard keeps member load summary when responsibility items are empty', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.renderOwnerReviewDashboard, 'function');

  app.state.ownerReview = {
    owner: '苏佳蕾',
    dashboardContext: 'direct',
    team: {
      owner: '苏佳蕾',
      groups: [{ name: '直营1组', members: ['陈晶晶', '安灵玲'] }],
    },
    executionScope: { description: '直营硬装 · CD设计师 · 进行中平面方案' },
    summary: {
      memberCount: 2,
      memberFloorPlanActiveCount: 1,
      memberFloorPlanActiveProjectCount: 1,
      memberFloorPlanCompletedCount: 3,
      memberDisplayActiveCount: 1,
      memberDisplayCompletedCount: 2,
      memberAssociatedProjectCount: 4,
    },
    memberLoads: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        summary: {
          associatedProjectCount: 2,
          floorPlanActiveCount: 1,
          floorPlanCompletedCount: 2,
          displayActiveCount: 1,
          displayCompletedCount: 1,
        },
        floorPlan: {
          active: [{ projectId: 'floor-active', projectName: '平面推进店', status: '推进中', dueDate: '2026-06-20' }],
          completed: [],
        },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
      {
        name: '安灵玲',
        displayName: '安灵玲',
        groupName: '直营1组',
        summary: {
          associatedProjectCount: 2,
          floorPlanActiveCount: 0,
          floorPlanCompletedCount: 1,
          displayActiveCount: 0,
          displayCompletedCount: 1,
        },
        floorPlan: { active: [], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
    ],
    people: [],
    disciplines: [],
  };

  app.renderOwnerReviewDashboard();

  assert.match(app.elements.ownerReviewHeroStats.innerHTML, /参与人员[\s\S]*2/);
  assert.match(app.elements.ownerReviewTeamStructure.innerHTML, /<b>1<\/b><small>当前平面负载<\/small>/);
  assert.match(app.elements.ownerReviewTeamStructure.innerHTML, /<b>1<\/b><small>平面进行<\/small>/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /平面推进店/);
  assert.doesNotMatch(app.elements.ownerReviewPersonRows.innerHTML, /暂无负责人数据|暂无团队平面负载数据/);
});

test('owner load dashboard collapses no-floor members by default and expands on demand', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.renderOwnerReviewPersonRows, 'function');
  assert.equal(typeof app.handleOwnerReviewPersonClick, 'function');

  app.state.ownerReview = {
    owner: '苏佳蕾',
    dashboardContext: 'direct',
    team: {
      owner: '苏佳蕾',
      groups: [{ name: '直营1组', members: ['陈晶晶', '安灵玲'] }],
    },
    executionScope: { description: '直营硬装 · CD设计师 · 进行中平面方案' },
    summary: { memberCount: 2, memberFloorPlanActiveCount: 1 },
    memberLoads: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 1, floorPlanCompletedCount: 2, associatedProjectCount: 2 },
        floorPlan: { active: [{ projectId: 'floor-active', projectName: '平面推进店', status: '推进中' }], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
      {
        name: '安灵玲',
        displayName: '安灵玲',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 0, floorPlanCompletedCount: 1, associatedProjectCount: 1 },
        floorPlan: { active: [], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
    ],
    people: [],
    disciplines: [],
  };

  app.renderOwnerReviewPersonRows(app.state.ownerReview);

  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /无当前平面成员/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /1 人/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /aria-expanded="false"/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /陈晶晶/);
  assert.doesNotMatch(app.elements.ownerReviewPersonRows.innerHTML, /安灵玲/);

  app.handleOwnerReviewPersonClick({
    preventDefault() {},
    stopPropagation() {},
    target: {
      closest(selector) {
        return selector.includes('[data-owner-review-idle-toggle]')
          ? { dataset: { ownerReviewIdleToggle: '直营1组' } }
          : null;
      },
    },
  });

  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /aria-expanded="true"/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /收起/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /安灵玲/);
});

test('team owner switching clears team load state and closes review modals', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.resetOwnerReviewForTeamOwnerChange, 'function');

  app.state.ownerReviewSearchQuery = '湖滨';
  app.state.ownerReviewLoadFilter = 'idle';
  app.state.ownerReviewSelectedGroup = '直营1组';
  app.state.selectedOwnerReviewPerson = '陈晶晶';
  app.state.selectedOwnerReviewMember = '陈晶晶';
  app.state.ownerReviewMemberFilter = 'active';
  app.state.ownerReviewDecisionModalType = 'urgent';
  app.elements.ownerReviewMemberModal.hidden = false;
  app.elements.ownerReviewDecisionModal.hidden = false;

  app.resetOwnerReviewForTeamOwnerChange();

  assert.equal(app.state.ownerReviewSearchQuery, '');
  assert.equal(app.state.ownerReviewLoadFilter, 'all');
  assert.equal(app.state.ownerReviewSelectedGroup, '');
  assert.equal(app.state.selectedOwnerReviewPerson, '');
  assert.equal(app.state.selectedOwnerReviewMember, '');
  assert.equal(app.state.ownerReviewMemberFilter, 'all');
  assert.equal(app.state.ownerReviewDecisionModalType, '');
  assert.equal(app.elements.ownerReviewMemberModal.hidden, true);
  assert.equal(app.elements.ownerReviewDecisionModal.hidden, true);
});

test('owner responsibility review renders clickable member chips from member load modules', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.renderOwnerReviewTeamStructure, 'function');

  app.state.ownerReview = {
    owner: '苏佳蕾',
    team: { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['陈晶晶'] }] },
    executionScope: { description: '硬装负责人视角 · 团队成员全项目负载' },
    summary: {
      memberFloorPlanActiveCount: 1,
      memberDisplayActiveCount: 1,
      memberAssociatedProjectCount: 3,
      memberCompletedProjectCount: 2,
    },
    memberLoads: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        summary: {
          associatedProjectCount: 3,
          activeProjectCount: 2,
          completedProjectCount: 2,
          floorPlanActiveCount: 1,
          floorPlanCompletedCount: 1,
          displayActiveCount: 1,
          displayCompletedCount: 1,
        },
        floorPlan: { active: [], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
    ],
  };

  app.renderOwnerReviewTeamStructure(app.state.ownerReview);
  const html = app.elements.ownerReviewTeamStructure.innerHTML;
  assert.match(html, /data-owner-review-member="陈晶晶"/);
  assert.match(html, /平面 1/);
  assert.match(html, /平面 1/);
  assert.match(html, /摆场 1\/1/);
  assert.match(html, /关联 3/);
  assert.doesNotMatch(html, /aria-label="[^"]*\?>/);
  assert.doesNotMatch(html, /当前 2/);
});

test('owner responsibility review distinguishes unmaintained team roster from no load risk', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.renderOwnerReviewTeamStructure, 'function');
  assert.equal(typeof app.renderOwnerReviewPersonRows, 'function');

  app.state.ownerReview = {
    owner: '未维护负责人',
    team: { owner: '未维护负责人', groups: [] },
    executionScope: { description: '负责人级项目事实' },
    summary: { peopleCount: 0, projectCount: 3, responsibilityItemCount: 4 },
    people: [],
    memberLoads: [],
  };

  app.renderOwnerReviewTeamStructure(app.state.ownerReview);
  assert.match(app.elements.ownerReviewTeamStructure.innerHTML, /已维护成员 0 人 \/ 团队结构待补充/);
  assert.match(app.elements.ownerReviewTeamStructure.innerHTML, /该负责人暂未维护团队成员/);

  app.renderOwnerReviewPersonRows(app.state.ownerReview);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /暂无团队平面负载数据/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /未维护成员 roster 不代表该负责人没有项目或风险/);
});

test('owner responsibility review derives structure groups from member loads when roster is missing', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.renderOwnerReviewTeamStructure, 'function');
  assert.equal(typeof app.renderOwnerReviewPersonRows, 'function');

  app.state.ownerReview = {
    owner: '新负责人',
    team: { owner: '新负责人', groups: [] },
    executionScope: { description: '负责人团队成员负载' },
    memberLoads: [
      {
        name: '成员甲',
        displayName: '成员甲',
        groupName: '临时1组',
        summary: { floorPlanActiveCount: 1, floorPlanCompletedCount: 0, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 1 },
        floorPlan: { active: [{ projectId: 'load-1', projectName: '当前平面店', status: '推进中' }], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
      {
        name: '成员乙',
        displayName: '成员乙',
        groupName: '临时1组',
        summary: { floorPlanActiveCount: 0, floorPlanCompletedCount: 1, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 1 },
        floorPlan: { active: [], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
    ],
  };

  app.renderOwnerReviewTeamStructure(app.state.ownerReview);
  app.renderOwnerReviewPersonRows(app.state.ownerReview);

  assert.match(app.elements.ownerReviewTeamStructure.innerHTML, /临时1组/);
  assert.match(app.elements.ownerReviewTeamStructure.innerHTML, /成员甲/);
  assert.match(app.elements.ownerReviewTeamStructure.innerHTML, /<b>1<\/b><small>当前平面负载<\/small>/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /当前平面店/);
  assert.doesNotMatch(app.elements.ownerReviewPersonRows.innerHTML, /团队结构待补充|暂无团队平面负载数据/);
});

test('owner responsibility review flattens nested structure groups before rendering', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.renderOwnerReviewTeamStructure, 'function');

  app.state.ownerReview = {
    owner: 'Owner',
    team: {
      owner: 'Owner',
      groups: [
        {
          name: 'Outer',
          members: [
            { name: 'Group A', members: ['Alice'] },
            { name: 'Group B', members: ['Bob'] },
          ],
        },
      ],
    },
    memberLoads: [
      { name: 'Alice', summary: { floorPlanActiveCount: 1, associatedProjectCount: 1 }, associatedProjects: [] },
      { name: 'Bob', summary: { floorPlanActiveCount: 0, associatedProjectCount: 0 }, associatedProjects: [] },
    ],
  };

  app.renderOwnerReviewTeamStructure(app.state.ownerReview);
  const html = app.elements.ownerReviewTeamStructure.innerHTML;
  assert.match(html, /Group A/);
  assert.match(html, /Group B/);
  assert.match(html, /data-owner-review-member="Alice"/);
  assert.match(html, /data-owner-review-member="Bob"/);
  assert.doesNotMatch(html, /aria-label="[^"]*\?>/);
  assert.doesNotMatch(html, /data-owner-review-member="\[object Object\]"/);
});

test('owner responsibility review renders a team floor plan load overview', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.renderOwnerReviewPersonRows, 'function');
  assert.equal(typeof app.renderOwnerReviewDetailRows, 'function');
  assert.equal(typeof app.openOwnerReviewFloorDetailModal, 'function');

  app.state.ownerReview = {
    owner: '苏佳蕾',
    team: {
      owner: '苏佳蕾',
      groups: [
        { name: '直营1组', members: ['安灵玲', '梁玉贞'] },
        { name: '直营2组', members: ['陈晶晶'] },
      ],
    },
    memberLoads: [
      {
        name: '安灵玲',
        displayName: '安灵玲',
        groupName: '直营1组',
        summary: {
          associatedProjectCount: 4,
          floorPlanActiveCount: 1,
          floorPlanCompletedCount: 2,
          displayActiveCount: 1,
          displayCompletedCount: 1,
        },
        floorPlan: {
          active: [{ projectId: 'floor-active', projectName: '平面进行店', owner: '苏佳蕾', status: '推进中' }],
          completed: [{ projectId: 'floor-done', projectName: '平面完成店', owner: '苏佳蕾', status: '已完成', completedAt: '2026-05-01' }],
        },
        display: { active: [{ projectId: 'display-active' }], completed: [{ projectId: 'display-done' }] },
        associatedProjects: [],
      },
      {
        name: '梁玉贞',
        displayName: '梁玉贞',
        groupName: '直营1组',
        summary: {
          associatedProjectCount: 2,
          floorPlanActiveCount: 0,
          floorPlanCompletedCount: 3,
          displayActiveCount: 1,
          displayCompletedCount: 0,
        },
        floorPlan: { active: [], completed: [] },
        display: { active: [{ projectId: 'display-only' }], completed: [] },
        associatedProjects: [],
      },
    ],
  };

  app.renderOwnerReviewTeamStructure(app.state.ownerReview);
  const structureHtml = app.elements.ownerReviewTeamStructure.innerHTML;
  assert.match(structureHtml, /当前平面负载/);
  assert.match(structureHtml, /<b>1<\/b><small>当前平面负载<\/small>/);
  assert.match(structureHtml, /<b>2\/1<\/b><small>摆场进行\/完成<\/small>/);
  assert.doesNotMatch(structureHtml, /<b>2<\/b><small>当前负载<\/small>/);

  app.renderOwnerReviewPersonRows(app.state.ownerReview);
  const overviewHtml = app.elements.ownerReviewPersonRows.innerHTML;
  assert.match(overviewHtml, /owner-review-selected-group/);
  assert.match(overviewHtml, /owner-review-selected-group-kpis/);
  assert.match(overviewHtml, /owner-review-selected-member-list/);
  assert.doesNotMatch(overviewHtml, /owner-review-load-group[^>]*\sopen/);
  assert.match(overviewHtml, /直营1组/);
  assert.match(overviewHtml, /当前 1 项 · 1\/2 人/);
  assert.match(overviewHtml, /owner-review-floor-row/);
  assert.match(overviewHtml, /平面进行店/);
  assert.match(overviewHtml, /当前平面/);
  assert.match(overviewHtml, /摆场 1\/1/);
  assert.match(overviewHtml, /无当前平面/);
  assert.match(overviewHtml, /owner-review-idle-strip/);
  assert.match(overviewHtml, /无当前平面成员/);
  assert.match(overviewHtml, /1 人/);
  assert.ok(
    overviewHtml.indexOf('平面进行店') < overviewHtml.indexOf('owner-review-idle-strip'),
    'current floor tasks should stay above the idle member strip'
  );

  app.state.selectedOwnerReviewPerson = '梁玉贞';
  app.renderOwnerReviewPersonRows(app.state.ownerReview);
  assert.doesNotMatch(app.elements.ownerReviewPersonRows.innerHTML, /owner-review-load-group[^>]*\sopen/);

  app.state.ownerReviewSelectedGroup = '直营2组';
  app.renderOwnerReviewPersonRows(app.state.ownerReview);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /owner-review-selected-group[\s\S]*直营2组/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /暂无当前平面负载/);
  assert.doesNotMatch(app.elements.ownerReviewPersonRows.innerHTML, /owner-review-load-group[^>]*\sopen/);

  app.state.selectedOwnerReviewPerson = '安灵玲';
  app.openOwnerReviewFloorDetailModal(app.state.selectedOwnerReviewPerson);
  assert.equal(app.elements.ownerReviewMemberModal.hidden, false);
  const detailHtml = app.elements.ownerReviewMemberModalBody.innerHTML;
  assert.match(detailHtml, /平面负载来源详情/);
  assert.match(detailHtml, /平面进行店/);
  assert.match(detailHtml, /平面完成店/);
  assert.match(detailHtml, /仅历史完成/);
  assert.match(detailHtml, /仅摆场统计/);
  assert.match(detailHtml, /display-active|display-done/);
});

test('owner responsibility review summarizes load levels decisions and glossary', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.renderOwnerReviewDashboard, 'function');
  assert.equal(typeof app.ownerReviewLoadLevel, 'function');
  assert.equal(typeof app.handleOwnerReviewPersonClick, 'function');

  assert.deepEqual(
    [0, 1, 3, 5].map((value) => app.ownerReviewLoadLevel(value).label),
    ['空闲', '正常', '偏高', '过载']
  );

  app.state.ownerReview = {
    owner: '苏佳蕾',
    summary: { peopleCount: 4, externalSupportCount: 0, borrowedOutCount: 0, responsibilityItemCount: 9, projectCount: 9 },
    team: {
      owner: '苏佳蕾',
      groups: [
        { name: '直营1组', members: ['过载成员', '正常成员'] },
        { name: '直营2组', members: ['空闲成员', '异常成员'] },
      ],
    },
    memberLoads: [
      {
        name: '过载成员',
        displayName: '过载成员',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 5, floorPlanCompletedCount: 1, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 5 },
        floorPlan: {
          active: [
            { projectId: 'hot-1', projectName: '临期平面店', owner: '苏佳蕾', status: '延期中', state: 'active' },
            { projectId: 'hot-2', projectName: '重点平面店', owner: '苏佳蕾', status: '推进中', state: 'active' },
          ],
          completed: [],
        },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
      {
        name: '正常成员',
        displayName: '正常成员',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 1, floorPlanCompletedCount: 2, displayActiveCount: 1, displayCompletedCount: 1, associatedProjectCount: 2 },
        floorPlan: { active: [{ projectId: 'normal-1', projectName: '正常平面店', owner: '苏佳蕾', status: '推进中', state: 'active' }], completed: [] },
        display: { active: [{ projectId: 'display-normal', projectName: '摆场店', state: 'active' }], completed: [] },
        associatedProjects: [],
      },
      {
        name: '空闲成员',
        displayName: '空闲成员',
        groupName: '直营2组',
        summary: { floorPlanActiveCount: 0, floorPlanCompletedCount: 0, displayActiveCount: 1, displayCompletedCount: 0, associatedProjectCount: 1 },
        floorPlan: { active: [], completed: [] },
        display: { active: [{ projectId: 'display-only', projectName: '仅摆场店', state: 'active' }], completed: [] },
        associatedProjects: [{ projectId: 'display-only', projectName: '仅摆场店', owner: '其他负责人', state: 'active', roleLabels: ['摆场设计师'] }],
      },
      {
        name: '异常成员',
        displayName: '异常成员',
        groupName: '直营2组',
        summary: { floorPlanActiveCount: 3, floorPlanCompletedCount: 0, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 1, anomalyCount: 1 },
        anomalies: [{ type: '字段来源未解析', severity: '需要核对', message: '来源字段缺失，建议核对原始表。' }],
        floorPlan: { active: [{ projectId: 'gap-1', projectName: '', owner: '', status: '', state: 'active' }], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
    ],
  };

  app.renderOwnerReviewDashboard();

  const overviewHtml = app.elements.ownerReviewPersonRows.innerHTML;
  assert.match(app.elements.ownerReviewDecisionSummary.innerHTML, /今日决策摘要/);
  assert.match(app.elements.ownerReviewDecisionSummary.innerHTML, /需立即干预/);
  assert.match(app.elements.ownerReviewDecisionSummary.innerHTML, /可调配人手/);
  assert.match(app.elements.ownerReviewDecisionSummary.innerHTML, /高风险组/);
  assert.match(app.elements.ownerReviewDecisionSummary.innerHTML, /数据待核对/);
  assert.equal(typeof app.openOwnerReviewDecisionModal, 'function');
  app.openOwnerReviewDecisionModal('urgent');
  assert.equal(app.elements.ownerReviewDecisionModal.hidden, false);
  assert.match(app.elements.ownerReviewDecisionModalBody.innerHTML, /需立即干预/);
  assert.match(app.elements.ownerReviewDecisionModalBody.innerHTML, /过载成员/);
  assert.match(app.elements.ownerReviewDecisionModalBody.innerHTML, /过载成员/);
  app.openOwnerReviewDecisionModal('available');
  assert.match(app.elements.ownerReviewDecisionModalBody.innerHTML, /可调配人手/);
  assert.match(app.elements.ownerReviewDecisionModalBody.innerHTML, /空闲或正常且无异常/);
  assert.match(app.elements.ownerReviewGroupMatrix.innerHTML, /组间对比/);
  assert.match(app.elements.ownerReviewGroupMatrix.innerHTML, /直营1组/);
  assert.match(app.elements.ownerReviewGroupMatrix.innerHTML, /过载/);
  assert.match(app.elements.ownerReviewGroupMatrix.innerHTML, /owner-review-group-matrix-row[^"]*is-selected/);
  assert.match(app.elements.ownerReviewRulebook.innerHTML, /口径说明/);
  assert.match(app.elements.ownerReviewRulebook.innerHTML, /当前平面计入负载/);
  assert.match(app.elements.ownerReviewRulebook.innerHTML, /摆场[\s\S]*只做统计/);
  assert.match(overviewHtml, /owner-review-load-level is-overloaded/);
  assert.match(overviewHtml, /过载/);
  assert.match(overviewHtml, /偏高/);
  assert.match(overviewHtml, /占用 2\/2/);
  assert.match(overviewHtml, /空载 0/);
  assert.match(overviewHtml, /异常 0/);
  app.state.ownerReviewSelectedGroup = '直营2组';
  app.renderOwnerReviewGroupMatrix(app.state.ownerReview);
  app.renderOwnerReviewPersonRows(app.state.ownerReview);
  assert.match(app.elements.ownerReviewGroupMatrix.innerHTML, /直营2组[\s\S]*is-selected|is-selected[\s\S]*直营2组/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /owner-review-selected-group[\s\S]*直营2组/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /空载 1/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /异常 1/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /无当前平面成员/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /aria-expanded="false"/);
  assert.doesNotMatch(app.elements.ownerReviewPersonRows.innerHTML, /空闲成员/);
  app.handleOwnerReviewPersonClick({
    preventDefault() {},
    stopPropagation() {},
    target: {
      closest(selector) {
        return selector.includes('[data-owner-review-idle-toggle]')
          ? { dataset: { ownerReviewIdleToggle: '直营2组' } }
          : null;
      },
    },
  });
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /aria-expanded="true"/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /空闲/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /数据待核查/);
});

test('owner responsibility review does not call team data health from its module boundary', async () => {
  const app = await loadPublicAppHarness();
  app.elements.pageSections = [
    { dataset: { page: 'overview' } },
    { dataset: { page: 'teams' } },
  ];
  app.window.location.hash = '#teams?owner=苏佳蕾&dashboardContext=direct';
  app.state.teamMetrics = {
    owner: '苏佳蕾',
    riskHealthAnalysis: { riskItems: [] },
  };
  app.state.ownerReview = {
    owner: '苏佳蕾',
    dashboardContext: 'direct',
    team: { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['陈晶晶'] }] },
    executionScope: { description: '边界测试' },
    summary: { peopleCount: 1, responsibilityItemCount: 1, projectCount: 1 },
    memberLoads: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 1, floorPlanCompletedCount: 0, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 1 },
        floorPlan: { active: [{ projectId: 'p-1', projectName: '平面店', state: 'active' }], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
    ],
    people: [],
    disciplines: [],
  };

  assert.doesNotThrow(() => app.renderOwnerReviewDashboard());
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /陈晶晶/);
});

test('owner responsibility review surfaces review-level display assignee data quality anomalies', async () => {
  const app = await loadPublicAppHarness();
  app.state.ownerReview = {
    owner: '苏佳蕾',
    summary: { peopleCount: 1, responsibilityItemCount: 0, projectCount: 1 },
    team: { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['陈晶晶'] }] },
    memberLoads: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 0, floorPlanCompletedCount: 0, displayActiveCount: 1, displayCompletedCount: 0, associatedProjectCount: 1 },
        floorPlan: { active: [], completed: [] },
        display: { active: [{ projectId: 'display-known', projectName: '摆场推进店', state: 'active' }], completed: [] },
        associatedProjects: [],
      },
    ],
    dataQuality: {
      anomalies: [
        {
          type: '摆场责任人待核对',
          severity: '需要核对',
          personName: '临时摆场人',
          projectName: '摆场责任待核店',
          message: '摆场设计师字段填写「临时摆场人」，但未匹配到已维护设计师或项目 CD/VM/点位设计师；未确认前不计入真实负载。',
        },
      ],
    },
  };

  app.renderOwnerReviewDashboard();
  assert.match(app.elements.ownerReviewDecisionSummary.innerHTML, /数据待核对[\s\S]*1/);
  app.openOwnerReviewDecisionModal('audit');
  assert.match(app.elements.ownerReviewDecisionModalBody.innerHTML, /摆场责任人待核对/);
  assert.match(app.elements.ownerReviewDecisionModalBody.innerHTML, /临时摆场人/);
  assert.match(app.elements.ownerReviewDecisionModalBody.innerHTML, /不计入真实负载/);
});

test('owner responsibility review search and custom filter keep selected group panel standard', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.renderOwnerReviewPersonRows, 'function');

  app.state.ownerReview = {
    owner: '苏佳蕾',
    team: {
      owner: '苏佳蕾',
      groups: [
        { name: '直营1组', members: ['安灵玲', '梁玉贞'] },
        { name: '直营2组', members: ['陈晶晶'] },
      ],
    },
    memberLoads: [
      {
        name: '安灵玲',
        displayName: '安灵玲',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 1, floorPlanCompletedCount: 0, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 1 },
        floorPlan: { active: [{ projectId: 'match-1', projectName: '杭州湖滨店', owner: '苏佳蕾', status: '推进中' }], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [{ projectId: 'match-1', projectName: '杭州湖滨店', owner: '苏佳蕾', state: 'active' }],
      },
      {
        name: '梁玉贞',
        displayName: '梁玉贞',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 0, floorPlanCompletedCount: 0, displayActiveCount: 1, displayCompletedCount: 0, associatedProjectCount: 1 },
        floorPlan: { active: [], completed: [] },
        display: { active: [{ projectId: 'display-only' }], completed: [] },
        associatedProjects: [],
      },
    ],
  };

  app.renderOwnerReviewPersonRows(app.state.ownerReview);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /owner-review-selected-group/);
  assert.doesNotMatch(app.elements.ownerReviewPersonRows.innerHTML, /owner-review-load-group[^>]*\sopen/);

  app.state.ownerReviewSearchQuery = '湖滨';
  app.renderOwnerReviewPersonRows(app.state.ownerReview);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /owner-review-selected-group/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /找到 1 个结果/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /<mark>湖滨<\/mark>/);

  app.state.ownerReviewSearchQuery = '';
  app.state.ownerReviewLoadFilter = 'idle';
  app.renderOwnerReviewPersonRows(app.state.ownerReview);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /已筛选/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /空闲成员/);
  assert.doesNotMatch(app.elements.ownerReviewPersonRows.innerHTML, /安灵玲[\s\S]*杭州湖滨店/);

  app.state.ownerReviewLoadFilter = 'loaded';
  app.renderOwnerReviewPersonRows(app.state.ownerReview);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /owner-review-selected-group/);
  assert.doesNotMatch(app.elements.ownerReviewPersonRows.innerHTML, /is-compact-density/);
});

test('owner responsibility review standard density and copy summary are rendered from detail context', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.ownerReviewCopySummaryText, 'function');

  const member = {
    name: '陈晶晶',
    displayName: '陈晶晶',
    groupName: '直营1组',
    summary: {
      floorPlanActiveCount: 5,
      floorPlanCompletedCount: 2,
      displayActiveCount: 1,
      displayCompletedCount: 0,
      associatedProjectCount: 6,
      anomalyCount: 1,
    },
    anomalies: [{ type: '状态冲突', severity: '阻断判断', message: '同一项目同时存在进行中和已完成证据。' }],
    floorPlan: {
      active: [
        { projectId: 'floor-hot', projectName: '临期平面店', owner: '苏佳蕾', status: '延期中', state: 'active' },
      ],
      completed: [],
    },
    display: { active: [], completed: [] },
    associatedProjects: [],
  };

  app.state.ownerReview = {
    owner: '苏佳蕾',
    team: { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['陈晶晶'] }] },
    memberLoads: [member],
  };
  app.renderOwnerReviewPersonRows(app.state.ownerReview);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /owner-review-selected-group/);
  assert.doesNotMatch(app.elements.ownerReviewPersonRows.innerHTML, /is-compact-density/);

  const summary = app.ownerReviewCopySummaryText(member);
  assert.match(summary, /陈晶晶/);
  assert.match(summary, /直营1组/);
  assert.match(summary, /当前平面 5 个/);
  assert.match(summary, /过载/);
  assert.match(summary, /数据待核查 1 条/);
  assert.match(summary, /建议优先支援或拆分承接/);

  app.openOwnerReviewFloorDetailModal('陈晶晶');
  const detailHtml = app.elements.ownerReviewMemberModalBody.innerHTML;
  assert.match(detailHtml, /复制复盘摘要/);
  assert.match(detailHtml, /data-owner-review-copy-summary/);
  assert.match(detailHtml, /状态冲突/);
  assert.match(detailHtml, /计入当前负载/);
});

test('owner responsibility review removes inactive placeholders from visible structure load', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.renderOwnerReviewTeamStructure, 'function');

  app.state.ownerReview = {
    owner: '苏佳蕾',
    team: { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['陈晶晶', '李晓倩'] }] },
    summary: {
      memberFloorPlanActiveCount: 9,
      memberDisplayActiveCount: 0,
      memberAssociatedProjectCount: 9,
      memberCompletedProjectCount: 0,
    },
    memberLoads: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        summary: {
          associatedProjectCount: 1,
          activeProjectCount: 1,
          completedProjectCount: 0,
          floorPlanActiveCount: 1,
          displayActiveCount: 0,
        },
        associatedProjects: [{ projectId: 'active-member-project', state: 'active' }],
      },
      {
        name: '李晓倩',
        displayName: '李晓倩',
        groupName: '直营1组',
        summary: {
          associatedProjectCount: 8,
          activeProjectCount: 8,
          completedProjectCount: 0,
          floorPlanActiveCount: 8,
          displayActiveCount: 0,
        },
        associatedProjects: [{ projectId: 'inactive-member-project', state: 'active' }],
      },
    ],
  };

  app.renderOwnerReviewTeamStructure(app.state.ownerReview);
  const html = app.elements.ownerReviewTeamStructure.innerHTML;

  assert.doesNotMatch(html, /李晓倩/);
  assert.doesNotMatch(html, /暂不在职/);
  assert.match(html, /<span>1 项 · 1\/1 人<\/span>/);
  assert.match(html, /<b>1<\/b><small>当前平面负载<\/small>/);
  assert.match(html, /<b>1<\/b><small>关联记录<\/small>/);
});

test('owner responsibility review member modal groups floor plan display and associated projects', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.openOwnerReviewMemberModal, 'function');

  app.state.ownerReview = {
    owner: '苏佳蕾',
    team: { owner: '苏佳蕾', groups: [{ name: '直营1组', members: ['陈晶晶'] }] },
    memberLoads: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        summary: {
          associatedProjectCount: 3,
          activeProjectCount: 2,
          completedProjectCount: 2,
          floorPlanActiveCount: 1,
          floorPlanCompletedCount: 1,
          displayActiveCount: 1,
          displayCompletedCount: 1,
        },
        floorPlan: {
          active: [{ projectId: 'floor-active', projectName: '平面进行店', owner: '其他负责人', status: '进行中' }],
          completed: [{ projectId: 'floor-done', projectName: '平面完成店', owner: '其他负责人', status: '已完成', completedAt: '2026-04-08' }],
        },
        display: {
          active: [{ projectId: 'display-active', projectName: '摆场进行店', owner: '其他负责人', status: '摆场' }],
          completed: [{ projectId: 'display-done', projectName: '摆场完成店', owner: '其他负责人', status: '闭环' }],
        },
        associatedProjects: [
          {
            projectId: 'floor-active',
            projectName: '平面进行店',
            owner: '其他负责人',
            state: 'active',
            roleLabels: ['硬装设计师'],
          },
          {
            projectId: 'display-done',
            projectName: '摆场完成店',
            owner: '其他负责人',
            state: 'completed',
            roleLabels: ['摆场设计师'],
          },
          {
            projectId: 'associated-only',
            projectName: '仅关联店',
            owner: '其他负责人',
            state: 'associated',
            roleLabels: ['软装设计师'],
          },
        ],
      },
    ],
  };

  app.openOwnerReviewMemberModal('陈晶晶');
  assert.equal(app.elements.ownerReviewMemberModal.hidden, false);
  const html = app.elements.ownerReviewMemberModalBody.innerHTML;
  assert.match(html, /陈晶晶/);
  assert.match(html, /当前平面方案/);
  assert.match(html, /当前摆场/);
  assert.match(html, /data-owner-review-member-filter="active"/);
  assert.match(html, /data-owner-review-member-filter="completed"/);
  assert.match(html, /data-owner-review-member-project-id="floor-active"/);
  assert.match(html, /data-owner-review-member-project-id="display-done"/);
  assert.match(html, /仅关联店/);
});

test('owner responsibility review defaults selection to owner before external support', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.ownerReviewPreferredPersonName, 'function');

  const review = {
    owner: '负责人',
    people: [
      { name: '外部支援', supportType: 'externalSupport', responsibilityItemCount: 9, items: [] },
      { name: '负责人', supportType: 'team', responsibilityItemCount: 1, items: [] },
    ],
  };

  assert.equal(app.ownerReviewPreferredPersonName(review), '负责人');
});

function project(rawFields = {}, overrides = {}) {
  return {
    id: 'p-1',
    name: '测试项目',
    status: '一般',
    riskLevel: '低',
    rawFields: Object.fromEntries(
      Object.entries(rawFields).map(([key, display]) => [key, { display }])
    ),
    ...overrides,
  };
}

test('project key date requires actual meeting and measure dates before advancing hard reminders', async () => {
  const app = await loadPublicAppHarness();

  const measureDelayed = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '未开始',
      软装项目进度: '未开始',
      复尺情况: '延期复尺',
    })
  );
  assert.equal(measureDelayed.label, '上会');
  assert.equal(measureDelayed.message, '待上会');

  const meetingStatusOnly = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '完成上会',
      软装项目进度: '未开始',
      上会情况: '准时完成',
    })
  );
  assert.equal(meetingStatusOnly.label, '上会');
  assert.equal(meetingStatusOnly.message, '待上会');

  const measureStatusOnly = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '完成复尺',
      软装项目进度: '未开始',
      上会日期: '2026-06-01',
      复尺情况: '延期复尺',
    })
  );
  assert.equal(measureStatusOnly.label, '复尺');
  assert.equal(measureStatusOnly.message, '待复尺');
});

test('soft progress does not hide missing hard-node dates in next reminder', async () => {
  const app = await loadPublicAppHarness();

  const reminder = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '未开始',
      软装项目进度: '点位已完成',
      点位完成情况: '已完成',
    })
  );

  assert.equal(reminder.label, '上会');
  assert.equal(reminder.message, '待上会');
});

test('floor plan handoff shows parallel construction drawing and point design work', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.resolveProjectKeyDateReminders, 'function');

  const handoffProject = project({
    硬装项目进度: '平面躺平',
    软装项目进度: '未开始',
    上会日期: '2026-05-20',
    复尺时间: '2026-05-23',
    平面开始时间: '2026-05-26',
    躺平内部审核结束时间: '2026-05-29',
  });

  const stage = app.readProjectStage(handoffProject);
  assert.match(stage, /硬装：施工图/);
  assert.match(stage, /点位：点位设计/);
  assert.doesNotMatch(stage, /软装：未开始/);

  const reminders = app.resolveProjectKeyDateReminders(handoffProject);
  assert.deepEqual(JSON.parse(JSON.stringify(reminders.map((item) => item.label))), ['施工图初稿', '点位完成']);

  const keyDateText = app.readProjectKeyDate(handoffProject);
  assert.match(keyDateText, /待施工图初稿/);
  assert.match(keyDateText, /待点位完成/);

  app.renderProjectDetailModal(handoffProject);
  const html = app.elements.projectDetailModalBody.innerHTML;
  assert.match(html, /硬装：施工图/);
  assert.match(html, /点位：点位设计/);
  assert.match(html, /待施工图初稿/);
  assert.match(html, /待点位完成/);
});

test('system hard deadline reminder drives project next reminder and detail explanation', async () => {
  const app = await loadPublicAppHarness();
  const deadlineProject = project(
    {
      硬装项目进度: '平面方案',
      复尺时间: '2026-06-01',
      面积: '280',
      平面开始时间: '2026-06-02',
      硬装方案情况: '进行中',
    },
    {
      id: 'system-deadline-floor',
      name: '系统规则延期平面店',
      hardDeadline: {
        ruleVersion: 'hard-decoration-deadline-v2026-06-04',
        status: 'calculated',
        measureDate: '2026-06-01',
        area: 280,
        areaBucket: { key: 'lt300', label: 'mini店：≤300㎡' },
        floorPlan: {
          startDueDate: '2026-06-02',
          warnDueDate: '2026-06-05',
          dueDate: '2026-06-09',
          actualStart: '2026-06-02',
          actualFinish: '',
          startStatus: 'on_time_start',
          completionStatus: 'delayed_open',
          efficiencyDueDate: '2026-06-09',
          efficiencyStatus: 'overtime_open',
          efficiencySummary: '按实际启动顺延后仍未完成，效率已超时。',
        },
        reminder: {
          type: 'delayed',
          title: '系统平面 Deadline 已延期',
          action: '确认平面延期原因、预计完成时间和是否需要调度支援。',
          dueDate: '2026-06-09',
          severity: 'P1',
          source: 'system_deadline',
        },
      },
      primaryReminder: {
        reminderId: 'system-deadline-floor:hard:floorPlanDue:overdue',
        projectId: 'system-deadline-floor',
        discipline: 'hard',
        nodeKey: 'floorPlanDue',
        type: 'overdue',
        severity: 'critical',
        priority: 'P1',
        label: '平面超期',
        title: '系统平面 Deadline 已延期',
        message: '确认平面延期原因、预计完成时间和是否需要调度支援。',
        dueDate: '2026-06-09',
        source: 'system_deadline',
        status: 'open',
      },
      reminders: [
        {
          reminderId: 'system-deadline-floor:hard:floorPlanDue:overdue',
          projectId: 'system-deadline-floor',
          discipline: 'hard',
          nodeKey: 'floorPlanDue',
          type: 'overdue',
          severity: 'critical',
          priority: 'P1',
          label: '平面超期',
          title: '系统平面 Deadline 已延期',
          message: '确认平面延期原因、预计完成时间和是否需要调度支援。',
          dueDate: '2026-06-09',
          source: 'system_deadline',
          status: 'open',
        },
      ],
    }
  );

  const reminders = app.resolveProjectKeyDateReminders(deadlineProject);
  assert.equal(reminders[0].label, '平面超期');
  assert.equal(reminders[0].formatted, '06/09');
  assert.match(app.readProjectKeyDate(deadlineProject), /平面超期/);
  assert.match(app.readProjectKeyDate(deadlineProject), /系统平面 Deadline 已延期/);

  app.renderProjectDetailModal(deadlineProject);
  const html = app.elements.projectDetailModalBody.innerHTML;
  assert.doesNotMatch(html, /系统提醒与判断依据/);
  assert.match(html, /平面超期/);
  assert.match(html, /系统平面 Deadline 已延期/);
});

test('deadline exception falls back to workflow next reminder instead of hard deadline copy', async () => {
  const app = await loadPublicAppHarness();
  const reviewProject = project(
    {
      硬装项目进度: '未开始',
      软装项目进度: '未开始',
    },
    {
      id: 'missing-measure',
      name: '缺复尺待复核店',
      hardDeadline: {
        status: 'needs_manual_review',
        reason: 'missing_measure_date',
        missing: ['measureDate'],
      },
      primaryReminder: {
        reminderId: 'missing-measure:hard:ruleBasis:manual_review',
        projectId: 'missing-measure',
        discipline: 'hard',
        nodeKey: 'ruleBasis',
        type: 'manual_review',
        severity: 'warning',
        label: '缺复尺',
        title: '硬装 Deadline 待复核',
        message: '缺少复尺时间，暂不能计算系统 Deadline。',
        source: 'missing_field',
        status: 'open',
      },
    }
  );

  const reminder = app.resolveProjectKeyDate(reviewProject);
  assert.equal(reminder.label, '上会');
  assert.equal(reminder.message, '待上会');
  assert.match(app.readProjectKeyDate(reviewProject), /待上会/);
  assert.doesNotMatch(app.readProjectKeyDate(reviewProject), /硬装 Deadline/);
  assert.doesNotMatch(app.readProjectKeyDate(reviewProject), /暂不能计算/);

  app.renderProjectDetailModal(reviewProject);
  const html = app.elements.projectDetailModalBody.innerHTML;
  assert.doesNotMatch(html, /系统提醒与判断依据/);
  assert.match(html, /待上会/);
});

test('deadline exception workbench view lists hard deadline manual review projects only', async () => {
  const app = await loadPublicAppHarness();
  assert.equal(typeof app.renderProjectWorkbench, 'function');
  const reviewProject = project(
    {
      硬装项目进度: '平面方案',
      复尺时间: '2026-06-01',
    },
    {
      id: 'missing-area',
      name: '缺面积待复核店',
      hardDeadline: {
        status: 'needs_manual_review',
        reason: 'missing_or_invalid_area',
        missing: ['areaBucket'],
      },
      primaryReminder: {
        reminderId: 'missing-area:hard:ruleBasis:manual_review',
        projectId: 'missing-area',
        discipline: 'hard',
        nodeKey: 'ruleBasis',
        type: 'manual_review',
        severity: 'warning',
        label: '缺面积',
        title: '硬装 Deadline 待复核',
        message: '缺少面积，暂不能计算系统 Deadline。',
        source: 'missing_field',
        status: 'open',
      },
      reminders: [
        {
          reminderId: 'missing-area:hard:ruleBasis:manual_review',
          projectId: 'missing-area',
          discipline: 'hard',
          nodeKey: 'ruleBasis',
          type: 'manual_review',
          severity: 'warning',
          label: '缺面积',
          title: '硬装 Deadline 待复核',
          message: '缺少面积，暂不能计算系统 Deadline。',
          source: 'missing_field',
          status: 'open',
        },
      ],
    }
  );
  const normalProject = project(
    {
      硬装项目进度: '平面方案',
    },
    { id: 'normal-project', name: '正常推进店' }
  );

  app.state.projects = [reviewProject, normalProject];
  app.state.detailsWorkbenchView = 'deadlineExceptions';
  app.renderProjectWorkbench(app.state.projects);

  assert.match(app.elements.projectWorkbenchHead.innerHTML, /复核原因/);
  assert.match(app.elements.projectWorkbenchRows.innerHTML, /缺面积待复核店/);
  assert.match(app.elements.projectWorkbenchRows.innerHTML, /硬装 Deadline 待复核/);
  assert.match(app.elements.projectWorkbenchRows.innerHTML, /缺少面积/);
  assert.doesNotMatch(app.elements.projectWorkbenchRows.innerHTML, /正常推进店/);
});

test('project detail people section shows display designer from DingTalk raw field', async () => {
  const app = await loadPublicAppHarness();
  const displayProject = project({
    CD组长: '硬装组长',
    VM组长: '软装组长',
    CD设计师: '硬装设计师',
    VM设计师: '软装设计师',
    摆场设计师: '苏佳蕾',
  });

  app.renderProjectDetailModal(displayProject);
  const html = app.elements.projectDetailModalBody.innerHTML;

  assert.match(html, /人员协作/);
  assert.match(html, /摆场设计师/);
  assert.match(html, /苏佳蕾/);
});

test('updated construction stage starts point design even when floor plan handoff time is missing', async () => {
  const app = await loadPublicAppHarness();

  const stageUpdatedProject = project({
    硬装项目进度: '施工图',
    软装项目进度: '未开始',
    上会日期: '2026-05-20',
    复尺时间: '2026-05-23',
    平面开始时间: '2026-05-26',
  });

  const stage = app.readProjectStage(stageUpdatedProject);
  assert.match(stage, /硬装：施工图/);
  assert.match(stage, /点位：点位设计/);
  assert.doesNotMatch(stage, /软装：未开始/);

  const reminders = app.resolveProjectKeyDateReminders(stageUpdatedProject);
  assert.deepEqual(JSON.parse(JSON.stringify(reminders.map((item) => item.label))), ['施工图初稿', '点位完成']);
  assert.match(app.readProjectKeyDate(stageUpdatedProject), /待点位完成/);
});

test('paused workflow keeps pause as the only project key reminder after handoff', async () => {
  const app = await loadPublicAppHarness();

  const softPaused = project({
    硬装项目进度: '平面躺平',
    软装项目进度: '暂停',
    躺平内部审核结束时间: '2026-05-29',
  });
  assert.match(app.readProjectStage(softPaused), /软装：暂停/);
  assert.doesNotMatch(app.readProjectStage(softPaused), /点位：点位设计/);
  assert.deepEqual(JSON.parse(JSON.stringify(app.resolveProjectKeyDateReminders(softPaused).map((item) => item.label))), ['暂停']);

  const hardPaused = project({
    硬装项目进度: '暂停',
    软装项目进度: '未开始',
    躺平内部审核结束时间: '2026-05-29',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(app.resolveProjectKeyDateReminders(hardPaused).map((item) => item.label))), ['暂停']);
});

test('completed soft point status asks for missing completion time instead of point follow-up', async () => {
  const app = await loadPublicAppHarness();

  const stageReminder = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '闭环',
      软装项目进度: '点位已完成',
    })
  );
  assert.equal(stageReminder.label, '点位完成');
  assert.equal(stageReminder.message, '待点位完成');

  const statusReminder = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '闭环',
      软装项目进度: '点位待跟进',
      点位完成情况: '准时完成',
    })
  );
  assert.equal(statusReminder.label, '点位完成');
  assert.equal(statusReminder.message, '待点位完成');
});

test('field gap reminders track completed stage evidence without changing workflow reminders', async () => {
  const app = await loadPublicAppHarness();

  const gaps = app.projectFieldGapReminders(
    project({
      硬装项目进度: '闭环',
      软装项目进度: '点位已完成',
      点位设计师: '马琳琳',
      硬装方案情况: '延期完成',
      CD设计师: '李雷',
    })
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(gaps.map((item) => ({
      key: item.key,
      title: item.title,
      owner: item.owner,
      fields: item.missingFields,
    })))),
    [
      {
        key: 'hardSchemeCompletionDate',
        title: '硬装方案时间缺失',
        owner: '李雷',
        fields: ['硬装方案完成时间', '躺平内部审核结束时间', '内部审核结束时间'],
      },
      {
        key: 'pointCompletionTime',
        title: '点位完成时间缺失',
        owner: '马琳琳',
        fields: ['点位完成时间'],
      },
    ]
  );

  const html = app.renderProjectFieldGapReminder(
    project({
      硬装项目进度: '闭环',
      软装项目进度: '点位已完成',
      点位设计师: '马琳琳',
    })
  );
  assert.match(html, /字段缺失提醒/);
  assert.match(html, /点位完成时间/);
  assert.match(html, /马琳琳/);
});

test('field gap reminders do not flag incomplete statuses or completed evidence dates', async () => {
  const app = await loadPublicAppHarness();

  assert.deepEqual(
    JSON.parse(JSON.stringify(app.projectFieldGapReminders(
      project({
        硬装方案情况: '未完成',
        点位完成情况: '未开始',
      })
    ))),
    []
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(app.projectFieldGapReminders(
      project({
        硬装方案情况: '准时完成',
        躺平内部审核结束时间: '2026-05-08',
        软装项目进度: '点位已完成',
        点位完成情况: '准时完成',
        点位完成时间: '2026-05-09',
      })
    ))),
    []
  );
});

test('downstream soft stages require missing point evidence without reverting workflow', async () => {
  const app = await loadPublicAppHarness();

  const reminder = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '闭环',
      软装项目进度: '待采购',
    })
  );
  assert.equal(reminder.label, '点位完成');
  assert.equal(reminder.message, '待点位完成');

  assert.deepEqual(
    JSON.parse(JSON.stringify(app.projectFieldGapReminders(
      project({
        硬装项目进度: '闭环',
        软装项目进度: '摆场',
      })
    ).map((item) => ({
      key: item.key,
      title: item.title,
      fields: item.missingFields,
    })))),
    [
      {
        key: 'pointCompletionTime',
        title: '点位完成时间缺失',
        fields: ['点位完成时间'],
      },
    ]
  );
});

test('point completion time without completion status is a data gap', async () => {
  const app = await loadPublicAppHarness();

  const gaps = app.projectFieldGapReminders(
    project({
      硬装项目进度: '闭环',
      软装项目进度: '点位已完成',
      点位完成时间: '2026-05-09',
      点位设计师: '马琳琳',
    })
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(gaps.map((item) => ({
      key: item.key,
      title: item.title,
      owner: item.owner,
      fields: item.missingFields,
    })))),
    [
      {
        key: 'pointCompletionStatus',
        title: '点位完成情况缺失',
        owner: '马琳琳',
        fields: ['点位完成情况'],
      },
    ]
  );
});

test('soft completion status does not short-circuit follow-up reminders', async () => {
  const app = await loadPublicAppHarness();

  const reminder = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '闭环',
      软装项目进度: '待采购',
      点位完成情况: '已完成',
      点位完成时间: '2026-05-01',
      软装方案开始时间: '2026-05-02',
      软装发项目群时间: '2026-05-03',
      软装完成情况: '准时完成',
    })
  );

  assert.equal(reminder.label, '产品清单接收');
  assert.equal(reminder.message, '待产品清单接收');
});

test('design responsibility completion does not close company follow-up reminders', async () => {
  const app = await loadPublicAppHarness();

  const reminder = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '闭环',
      躺平内部审核结束时间: '2026-05-12',
      软装项目进度: '完成',
      软装方案开始时间: '2026-05-02',
      点位完成情况: '已完成',
      点位完成时间: '2026-05-01',
      软装完成情况: '准时完成',
    })
  );

  assert.equal(reminder.label, '产品清单接收');
  assert.equal(reminder.message, '待产品清单接收');
});

test('soft completion reminder does not treat unfinished status as completed', async () => {
  const app = await loadPublicAppHarness();

  const reminder = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '闭环',
      软装项目进度: '软装方案中',
      点位完成情况: '已完成',
      点位完成时间: '2026-05-01',
      软装方案开始时间: '2026-05-02',
      软装发项目群时间: '2026-05-03',
      软装完成情况: '未完成',
    })
  );

  assert.equal(reminder.label, '软装完成情况');
  assert.equal(reminder.message, '待软装完成情况');
});

test('sleep stores stop at hard construction review and skip soft reminders', async () => {
  const app = await loadPublicAppHarness();

  const closedReminder = app.resolveProjectKeyDate(
    project(
      {
        店态: '睡眠店',
        硬装项目进度: '（施工中）施工图完成审核',
        软装项目进度: '点位待跟进',
        软装完成情况: '延期中',
      },
      { storeStatus: '睡眠店' }
    )
  );
  assert.equal(closedReminder.label, '闭环');
  assert.equal(closedReminder.message, '项目已闭环');

  const activeReminder = app.resolveProjectKeyDate(
    project(
      {
        店态: '睡眠店',
        硬装项目进度: '施工图',
        施工图初稿完成时间: '2026-05-12',
        软装项目进度: '点位待跟进',
        软装完成情况: '延期中',
      },
      { storeStatus: '睡眠店' }
    )
  );
  assert.equal(activeReminder.label, '施工图审核');
  assert.equal(activeReminder.message, '待施工图审核');

  const constructionClosedReminder = app.resolveProjectKeyDate(
    project(
      {
        店态: '睡眠店',
        硬装项目进度: '施工闭环',
        软装项目进度: '点位待跟进',
      },
      { storeStatus: '睡眠店' }
    )
  );
  assert.equal(constructionClosedReminder.label, '闭环');
  assert.equal(constructionClosedReminder.message, '项目已闭环');
});

test('sleep store detection accepts exact store status or explicit sleep-store project name only', async () => {
  const app = await loadPublicAppHarness();

  const ambiguousSleepName = project(
    {
      项目名称: '普通睡眠体验项目',
      店态: '家居卖场',
      CD组长: '周俊彬',
      VM组长: '软装组长',
    },
    { storeStatus: '家居卖场', name: '普通睡眠体验项目' }
  );
  assert.match(app.renderProjectTeamCell(ambiguousSleepName), /软装组长/);

  const explicitSleepName = project(
    {
      项目名称: '杭州远洋乐堤港睡眠店',
      店态: '家居卖场',
      CD组长: '周俊彬',
      VM组长: '软装组长',
    },
    { storeStatus: '家居卖场', name: '杭州远洋乐堤港睡眠店' }
  );
  assert.doesNotMatch(app.renderProjectTeamCell(explicitSleepName), /软装组长/);
});

test('sleep store workbench cells render one hard-decoration assignment line without hard-soft labels', async () => {
  const app = await loadPublicAppHarness();
  const sleepProject = project(
    {
      店态: '睡眠店',
      CD负责人: '杨锦帆',
      VM负责人: '误填软装负责人',
      CD组长: '周俊彬',
      VM组长: '误填软装组长',
      CD设计师: '汪卓妍',
      VM设计师: '误填软装设计师',
      硬装项目进度: '施工图',
      软装项目进度: '点位待跟进',
    },
    { storeStatus: '睡眠店', cdOwner: '杨锦帆', vmOwner: '误填软装负责人' }
  );

  const owners = app.renderProjectOwnersCell(sleepProject);
  const teams = app.renderProjectTeamCell(sleepProject);
  const designers = app.renderProjectDesignersCell(sleepProject);
  const stage = app.readProjectStage(sleepProject);

  assert.match(owners, /杨锦帆/);
  assert.match(teams, /周俊彬/);
  assert.match(designers, /汪卓妍/);
  assert.match(`${owners}${teams}${designers}`, /project-single-assignment-cell/);
  assert.match(stage, /硬装：施工图/);
  assert.doesNotMatch(`${owners}${teams}${designers}${stage}`, /误填软装|软装：|<b>硬装|<b>硬组|<b>软装|<b>软组/);

  const genericOwnerProject = project(
    {
      店态: '睡眠店',
      负责人: '杨锦帆',
      硬装项目进度: '施工图',
    },
    { storeStatus: '睡眠店', owner: '杨锦帆' }
  );
  assert.match(app.renderProjectOwnersCell(genericOwnerProject), /杨锦帆/);
});

test('sleep store detail page uses single hard-only responsibility rows and hides soft sections', async () => {
  const app = await loadPublicAppHarness();
  const sleepProject = project(
    {
      店态: '睡眠店',
      CD负责人: '杨锦帆',
      VM负责人: '误填软装负责人',
      CD组长: '周俊彬',
      VM组长: '误填软装组长',
      CD设计师: '汪卓妍',
      VM设计师: '误填软装设计师',
      硬装项目进度: '施工图完成审核',
      软装项目进度: '点位待跟进',
      软装完成情况: '延期中',
      点位完成情况: '未开始',
    },
    { storeStatus: '睡眠店', cdOwner: '杨锦帆', vmOwner: '误填软装负责人' }
  );

  app.renderProjectDetailModal(sleepProject);
  const html = app.elements.projectDetailModalBody.innerHTML;

  assert.match(html, /负责人/);
  assert.match(html, /组长/);
  assert.match(html, /设计师/);
  assert.match(html, /硬装项目进度/);
  assert.match(html, /施工图完成审核时间/);
  assert.doesNotMatch(html, /硬装组长|硬装设计师|软装负责人|软装项目进度|软装组长|软装设计师|点位完成情况|采购完成情况|误填软装/);
});

test('risk queue keeps multiple categories for the same project while preserving one display row', async () => {
  const app = await loadPublicAppHarness();

  const [queueProject] = app.riskQueueProjects({
    urgentStatusProjects: [{ id: 'p-1', name: '同一风险店', status: '紧急' }],
    openDelayedProjects: [{ id: 'p-1', name: '同一风险店' }],
    riskProjects: [{ id: 'p-1', name: '同一风险店', riskLevel: '高' }],
  });
  assert.equal(queueProject.queueCategory, 'priority_status');

  const rows = app.collectRiskProjectQueue([], app.riskQueueProjects({
    urgentStatusProjects: [{ id: 'p-1', name: '同一风险店', status: '紧急' }],
    openDelayedProjects: [{ id: 'p-1', name: '同一风险店' }],
    riskProjects: [{ id: 'p-1', name: '同一风险店', riskLevel: '高' }],
  }));

  assert.equal(rows.length, 1);
  assert.deepEqual(Array.from(rows[0].categories), ['priority_status', 'execution_delay', 'risk_project']);
  assert.deepEqual({ ...app.riskActionRowCounts(rows) }, {
    urgent: 1,
    delayed: 1,
    stateConflict: 0,
    dataMissing: 0,
    startLag: 0,
    highRisk: 1,
  });
});

test('unknown risk level is not styled as low risk', async () => {
  const app = await loadPublicAppHarness();

  assert.equal(app.riskClass('未知'), 'unknown');
});

test('team risk action headline uses direct priority recommendation wording', async () => {
  const app = await loadPublicAppHarness();

  const headline = app.riskDutyHeadline({
    urgentCount: 12,
    openDelayedCount: 12,
    highRiskCount: 0,
    queueCount: 24,
    counts: {},
  });

  assert.match(headline, /^建议优先处理：/);
  assert.match(headline, /12 项紧急点铺/);
  assert.match(headline, /12 项延期未闭环/);
  assert.doesNotMatch(headline, /今天只看/);
  assert.doesNotMatch(headline, /改变推进结果/);
});

test('team risk action headline prefers Agent recommendation over frontend fallback', async () => {
  const app = await loadPublicAppHarness();

  const headline = app.riskDutyHeadline({
    actionRecommendation: 'Agent recommendation for this owner and context.',
    urgentCount: 99,
    openDelayedCount: 99,
    highRiskCount: 0,
    queueCount: 99,
    counts: {},
  });

  assert.equal(headline, 'Agent recommendation for this owner and context.');
});

test('team metrics load accepts canonical owner keys returned for requested aliases', async () => {
  const app = await loadPublicAppHarness({
    fetchImpl: async (path) => {
      assert.match(path, /^\/api\/team-metrics-batch\?/);
      return {
        ok: true,
        json: async () => ({
          owners: ['CanonicalOwner'],
          metricsByOwner: {
            CanonicalOwner: {
              owner: 'CanonicalOwner',
              summary: { totalProjects: 3 },
            },
          },
          dashboardContext: 'all',
          readOnly: true,
        }),
      };
    },
  });

  const metrics = await app.loadTeamMetrics('AliasOwner', 'all');

  assert.equal(metrics.owner, 'CanonicalOwner');
  assert.equal(app.state.teamMetrics.owner, 'CanonicalOwner');
  assert.equal(app.state.teamMetricsError, '');
});

test('team metrics load requests the selected owner before background preloading peers', async () => {
  const requestedOwnerBatches = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (path) => {
      assert.match(path, /^\/api\/team-metrics-batch\?/);
      const query = path.split('?')[1] || '';
      const requestedOwners = new URLSearchParams(query).getAll('owner');
      requestedOwnerBatches.push(requestedOwners);
      return {
        ok: true,
        json: async () => ({
          owners: requestedOwners,
          metricsByOwner: Object.fromEntries(
            requestedOwners.map((owner) => [
              owner,
              {
                owner,
                summary: { totalProjects: 1 },
              },
            ])
          ),
          dashboardContext: 'all',
          readOnly: true,
        }),
      };
    },
  });
  app.state.fullMetrics = {
    personnel: {
      roles: [
        {
          key: 'cdOwner',
          people: [{ name: '苏佳蕾' }, { name: '王吉祥' }],
        },
      ],
    },
  };

  await app.loadTeamMetrics('苏佳蕾', 'all');

  assert.deepEqual(requestedOwnerBatches[0], ['苏佳蕾']);
});

test('team metrics batch ignores stale responses after dashboard context changes', async () => {
  const releases = new Map();
  const app = await loadPublicAppHarness({
    fetchImpl: async (path) => {
      assert.match(path, /^\/api\/team-metrics-batch\?/);
      const params = new URLSearchParams(String(path).split('?')[1] || '');
      const context = params.get('context') || 'all';
      return new Promise((resolve) => {
        releases.set(context, () => {
          resolve({
            ok: true,
            json: async () => ({
              owners: ['Owner A'],
              dashboardContext: context,
              metricsByOwner: {
                'Owner A': {
                  owner: 'Owner A',
                  dashboardContext: context,
                  summary: { totalProjects: context === 'franchise' ? 2 : 1 },
                  benchmark: {},
                  insights: { modules: {} },
                },
              },
            }),
          });
        });
      });
    },
  });
  app.window.location.hash = '#teams?owner=Owner%20A&dashboardContext=direct';

  const directPromise = app.loadTeamMetrics('Owner A', 'direct').catch(() => null);
  await Promise.resolve();
  const franchisePromise = app.loadTeamMetrics('Owner A', 'franchise', { forceBatch: true });
  await Promise.resolve();

  releases.get('franchise')();
  await franchisePromise;
  releases.get('direct')();
  await directPromise;

  assert.equal(app.state.teamMetricsByOwner['Owner A'].dashboardContext, 'franchise');
  assert.equal(app.state.teamMetricsBatchKey, 'franchise');
  assert.equal(app.state.teamMetrics?.dashboardContext, 'franchise');
});

test('team dashboard renders the annual entry structure module from owner metrics', async () => {
  const app = await loadPublicAppHarness({
    fetchImpl: async (path) => {
      assert.match(path, /^\/api\/team-metrics-batch\?/);
      const query = path.split('?')[1] || '';
      const requestedOwner = new URLSearchParams(query).getAll('owner')[0] || 'Owner A';
      return {
        ok: true,
        json: async () => ({
          owners: [requestedOwner],
          metricsByOwner: {
            [requestedOwner]: {
              owner: requestedOwner,
              dashboardContext: 'direct',
              annualEntryStructure: sampleAnnualEntryStructure(2026),
              summary: { totalProjects: 1 },
              monthlyEntry: {},
              fieldCoverage: {},
            },
          },
          dashboardContext: 'direct',
          readOnly: true,
        }),
      };
    },
  });
  app.window.location.hash = '#teams';

  await app.loadTeamMetrics('Owner A', 'direct');

  assert.match(app.elements.teamEntryTrendBoard.innerHTML, /overview-entry-structure-panel/);
  assert.match(app.elements.teamEntryTrendBoard.innerHTML, /entry-structure-scope-switch/);
});

test('team annual entry year loader keeps the selected owner and dashboard context', async () => {
  const requestedPaths = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (path) => {
      requestedPaths.push(path);
      return {
        ok: true,
        json: async () => ({
          annualEntryStructure: sampleAnnualEntryStructure(2025),
          readOnly: true,
        }),
      };
    },
  });
  app.state.teamMetrics = {
    owner: 'Owner A',
    dashboardContext: 'franchise',
  };
  app.state.selectedTeamOwner = 'Owner A';

  const payload = await app.loadTeamAnnualEntryStructure(2025);
  const requestUrl = requestedPaths[0] || '';
  const params = new URLSearchParams(requestUrl.split('?')[1] || '');

  assert.equal(payload.year, 2025);
  assert.equal(requestUrl.startsWith('/api/dashboard-metrics?'), true);
  assert.equal(params.get('profile'), 'ownerMonthly');
  assert.equal(params.get('owner'), 'Owner A');
  assert.equal(params.get('context'), 'franchise');
  assert.equal(params.get('year'), '2025');
});

test('owner responsibility review keeps cached content visible while force refreshing', async () => {
  let requestCount = 0;
  let releaseSecondRequest;
  const app = await loadPublicAppHarness({
    fetchImpl: async (path) => {
      assert.match(path, /^\/api\/team-responsibility-review\?/);
      requestCount += 1;
      if (requestCount === 2) {
        await new Promise((resolve) => {
          releaseSecondRequest = resolve;
        });
      }
      return {
        ok: true,
        json: async () => ({
          owner: '苏佳蕾',
          dashboardContext: 'all',
          team: { owner: '苏佳蕾', groups: [] },
          executionScope: { description: '测试口径' },
          summary: { peopleCount: requestCount, externalSupportCount: 0, borrowedOutCount: 0 },
          memberLoads: [],
          people: [],
          disciplines: [],
        }),
      };
    },
  });
  app.elements.pageSections = [
    { dataset: { page: 'overview' } },
    { dataset: { page: 'teams' } },
  ];
  app.window.location.hash = '#teams?owner=苏佳蕾';
  app.state.snapshot = { source: 'mock', syncedAt: '2026-06-09T00:00:00.000Z', totalRecords: 1 };

  await app.loadOwnerResponsibilityReview('苏佳蕾', 'all');
  const cachedReview = app.state.ownerReview;

  const refreshPromise = app.loadOwnerResponsibilityReview('苏佳蕾', 'all', { forceRefresh: true });
  assert.equal(app.state.ownerReviewLoading, false);
  assert.equal(app.state.ownerReview, cachedReview);

  releaseSecondRequest();
  await refreshPromise;

  assert.equal(requestCount, 2);
  assert.equal(app.state.ownerReview.summary.peopleCount, 2);
});

test('owner responsibility review uses cached results by default', async () => {
  let requestCount = 0;
  const app = await loadPublicAppHarness({
    fetchImpl: async (path) => {
      assert.match(path, /^\/api\/team-responsibility-review\?/);
      requestCount += 1;
      return {
        ok: true,
        json: async () => ({
          owner: 'OwnerA',
          dashboardContext: 'all',
          team: { owner: 'OwnerA', groups: [] },
          executionScope: { description: 'cache test' },
          summary: { peopleCount: requestCount, externalSupportCount: 0, borrowedOutCount: 0 },
          memberLoads: [],
          people: [],
          disciplines: [],
        }),
      };
    },
  });
  app.window.location.hash = '#teams?owner=OwnerA';
  app.state.snapshot = { source: 'mock', syncedAt: '2026-06-09T00:00:00.000Z', totalRecords: 1 };

  await app.loadOwnerResponsibilityReview('OwnerA', 'all');
  const cachedReview = app.state.ownerReview;
  const secondReview = await app.loadOwnerResponsibilityReview('OwnerA', 'all');

  assert.equal(requestCount, 1);
  assert.equal(secondReview, cachedReview);
  assert.equal(app.state.ownerReview.summary.peopleCount, 1);
});

test('owner responsibility review reuses an in-flight request for duplicate team route loads', async () => {
  let requestCount = 0;
  const releaseRequests = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async () => {
      requestCount += 1;
      await new Promise((resolve) => {
        releaseRequests.push(resolve);
      });
      return {
        ok: true,
        json: async () => ({
          owner: 'OwnerA',
          dashboardContext: 'direct',
          team: { owner: 'OwnerA', groups: [{ name: 'Group 1', members: ['Alice'] }] },
          executionScope: { description: 'duplicate request test' },
          summary: { peopleCount: 1, externalSupportCount: 0, borrowedOutCount: 0 },
          memberLoads: [
            {
              name: 'Alice',
              displayName: 'Alice',
              groupName: 'Group 1',
              summary: {
                floorPlanActiveCount: 1,
                floorPlanCompletedCount: 0,
                displayActiveCount: 0,
                displayCompletedCount: 0,
                associatedProjectCount: 1,
              },
              associatedProjects: [],
            },
          ],
          people: [],
          disciplines: [],
        }),
      };
    },
  });
  app.elements.pageSections = [
    { dataset: { page: 'overview' } },
    { dataset: { page: 'teams' } },
  ];
  app.window.location.hash = '#teams?owner=OwnerA&dashboardContext=direct';
  app.state.snapshot = { source: 'mock', syncedAt: '2026-06-09T00:00:00.000Z', totalRecords: 1 };

  const firstLoad = app.loadOwnerResponsibilityReview('OwnerA', 'direct');
  const secondLoad = app.loadOwnerResponsibilityReview('OwnerA', 'direct');
  await Promise.resolve();

  const duplicateRequestCount = requestCount;
  releaseRequests.forEach((release) => release());
  const [firstResult, secondResult] = await Promise.all([firstLoad, secondLoad]);

  assert.equal(duplicateRequestCount, 1);
  assert.equal(firstResult, secondResult);
  assert.equal(app.state.ownerReviewLoading, false);
  assert.equal(app.state.ownerReview.owner, 'OwnerA');
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /Alice/);
});

test('owner responsibility review aborts stale owner requests when the selected owner changes', async () => {
  const requests = [];
  let releaseOwnerA;
  const ownerPayload = (owner, member) => ({
    owner,
    dashboardContext: 'direct',
    team: { owner, groups: [{ name: 'Group 1', members: [member] }] },
    executionScope: { description: 'owner switch abort test' },
    summary: { peopleCount: 1, externalSupportCount: 0, borrowedOutCount: 0 },
    memberLoads: [
      {
        name: member,
        displayName: member,
        groupName: 'Group 1',
        summary: {
          floorPlanActiveCount: 1,
          floorPlanCompletedCount: 0,
          displayActiveCount: 0,
          displayCompletedCount: 0,
          associatedProjectCount: 1,
        },
        associatedProjects: [],
      },
    ],
    people: [],
    disciplines: [],
  });
  const app = await loadPublicAppHarness({
    fetchImpl: async (path, options = {}) => {
      const owner = new URLSearchParams(String(path).split('?')[1] || '').get('owner') || '';
      requests.push({ owner, signal: options.signal });
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
        const resolveResponse = (payload) =>
          resolve({
            ok: true,
            json: async () => payload,
          });
        if (owner === 'OwnerA') {
          releaseOwnerA = () => resolveResponse(ownerPayload('OwnerA', 'Alice'));
          return;
        }
        resolveResponse(ownerPayload('OwnerB', 'Bob'));
      });
    },
  });
  app.elements.pageSections = [
    { dataset: { page: 'overview' } },
    { dataset: { page: 'teams' } },
  ];
  app.window.location.hash = '#teams?owner=OwnerA&dashboardContext=direct';
  app.state.snapshot = { source: 'mock', syncedAt: '2026-06-09T00:00:00.000Z', totalRecords: 1 };

  const firstLoad = app.loadOwnerResponsibilityReview('OwnerA', 'direct');
  await Promise.resolve();
  app.window.location.hash = '#teams?owner=OwnerB&dashboardContext=direct';
  const secondLoad = app.loadOwnerResponsibilityReview('OwnerB', 'direct');
  await Promise.resolve();
  const ownerAAborted = requests.find((request) => request.owner === 'OwnerA')?.signal?.aborted;

  releaseOwnerA?.();
  const [firstResult, secondResult] = await Promise.all([firstLoad, secondLoad]);

  assert.equal(ownerAAborted, true);
  assert.equal(firstResult, null);
  assert.equal(secondResult.owner, 'OwnerB');
  assert.equal(app.state.ownerReview.owner, 'OwnerB');
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /Bob/);
  assert.doesNotMatch(app.elements.ownerReviewPersonRows.innerHTML, /Alice/);
});

test('owner responsibility review cache is bounded for long-running dashboards', async () => {
  const app = await loadPublicAppHarness({
    fetchImpl: async (path) => {
      const owner = new URLSearchParams(String(path).split('?')[1] || '').get('owner') || '';
      return {
        ok: true,
        json: async () => ({
          owner,
          dashboardContext: 'all',
          team: { owner, groups: [] },
          executionScope: { description: 'cache test' },
          summary: { peopleCount: 1, externalSupportCount: 0, borrowedOutCount: 0 },
          memberLoads: [],
          people: [],
          disciplines: [],
        }),
      };
    },
  });
  app.window.location.hash = '#teams?owner=Owner0';
  app.state.snapshot = { source: 'mock', syncedAt: '2026-06-09T00:00:00.000Z', totalRecords: 1 };

  for (let index = 0; index < 18; index += 1) {
    await app.loadOwnerResponsibilityReview(`Owner${index}`, 'all');
  }

  assert.ok(Object.keys(app.state.ownerReviewByKey).length <= 12);
});

test('owner responsibility review reports cached refresh failure without hiding cached data', async () => {
  let requestCount = 0;
  const app = await loadPublicAppHarness({
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 2) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: 'temporary unavailable' }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          owner: 'OwnerA',
          dashboardContext: 'all',
          team: { owner: 'OwnerA', groups: [] },
          executionScope: { description: 'refresh failure test' },
          summary: { peopleCount: 1, externalSupportCount: 0, borrowedOutCount: 0 },
          memberLoads: [],
          people: [],
          disciplines: [],
        }),
      };
    },
  });
  app.elements.pageSections = [
    { dataset: { page: 'overview' } },
    { dataset: { page: 'teams' } },
  ];
  app.window.location.hash = '#teams?owner=OwnerA';
  app.state.snapshot = { source: 'mock', syncedAt: '2026-06-09T00:00:00.000Z', totalRecords: 1 };

  await app.loadOwnerResponsibilityReview('OwnerA', 'all');
  const cachedReview = app.state.ownerReview;
  const staleReview = await app.loadOwnerResponsibilityReview('OwnerA', 'all', { forceRefresh: true });

  assert.equal(staleReview, cachedReview);
  assert.equal(app.state.ownerReview, cachedReview);
  assert.equal(app.state.ownerReviewError, '');
  assert.equal(app.state.ownerReviewRefreshStatus, 'stale');
  assert.match(app.state.ownerReviewRefreshError, /temporary unavailable/);
  assert.match(app.elements.ownerReviewHeadline.innerHTML, /刷新失败|refresh/i);
});

test('owner responsibility review uses an extended timeout for heavy load payloads', async () => {
  const app = await loadPublicAppHarness({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        owner: '苏佳蕾',
        dashboardContext: 'direct',
        team: { owner: '苏佳蕾', groups: [] },
        executionScope: { description: 'timeout test' },
        summary: { peopleCount: 0, externalSupportCount: 0, borrowedOutCount: 0 },
        memberLoads: [],
        people: [],
        disciplines: [],
      }),
    }),
  });
  const timeoutDelays = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay) => {
    timeoutDelays.push(delay);
    return originalSetTimeout(callback, 10_000);
  };
  globalThis.clearTimeout = (id) => originalClearTimeout(id);

  try {
    await app.loadOwnerResponsibilityReview('苏佳蕾', 'direct');
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  assert.ok(timeoutDelays.includes(90_000));
});

test('loadCoreDashboard fetches metrics once and skips project catalog', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.startsWith('/api/snapshot')) {
        return { ok: true, json: async () => ({ source: 'mock', syncedAt: '2026-06-11T00:00:00.000Z' }) };
      }
      if (path.startsWith('/api/metrics') && !path.includes('dashboard-metrics')) {
        return { ok: true, json: async () => ({ summary: { totalProjects: 0 }, personnel: { roles: [] } }) };
      }
      if (path.startsWith('/api/dashboard-metrics')) {
        return { ok: true, json: async () => ({ profile: 'department' }) };
      }
      throw new Error(`unexpected fetch ${path}`);
    },
  });

  app.elements.teamOwnerSelect = fakeElement();
  const { loadCoreDashboard } = await import('../public/lib/dashboard-loader.mjs');
  await loadCoreDashboard();

  const metricsCalls = requested.filter((path) => path.startsWith('/api/metrics') && !path.includes('dashboard-metrics'));
  assert.equal(metricsCalls.length, 1);
  assert.equal(requested.some((path) => path.startsWith('/api/projects')), false);
});

test('softRefresh on details keeps local catalog without project API', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      requested.push(String(url));
      throw new Error(`soft refresh should not fetch ${url}`);
    },
  });

  const { snapshotSignature } = await import('../public/realtime.js');
  app.window.location.hash = '#details';
  app.elements.pageSections = [
    { dataset: { page: 'overview' }, classList: fakeElement().classList },
    { dataset: { page: 'details' }, classList: fakeElement().classList },
  ];
  app.state.snapshot = { source: 'mock', syncedAt: '2026-06-11T00:00:00.000Z', totalRecords: 2 };
  app.state.allProjects = [
    { id: 'p1', name: '杭州店', province: '浙江', businessType: '餐饮', storeStatus: '常规店', status: '正常', rawFields: {} },
    { id: 'p2', name: '上海店', province: '上海', businessType: '零售', storeStatus: '旗舰店', status: '紧急', rawFields: {} },
  ];
  app.state.projectsCatalogLoaded = true;
  app.state.projectsCatalogSignature = snapshotSignature(app.state.snapshot);
  app.elements.searchInput = fakeElement();
  app.elements.provinceFilter = fakeElement();
  app.elements.provinceFilter.value = '浙江';
  app.elements.businessTypeFilter = fakeElement();
  app.elements.storeStatusFilter = fakeElement();
  app.elements.statusFilter = fakeElement();

  const { softRefresh } = await import('../public/lib/dashboard-loader.mjs');
  const ok = await softRefresh();

  assert.equal(ok, true);
  assert.equal(requested.length, 0);
  assert.equal(app.state.projects.length, 1);
  assert.equal(app.state.projects[0].id, 'p1');
});

test('repeat drill modal uses cached projects without second fields=ids request', async () => {
  let idRequests = 0;
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      if (path.includes('fields=ids')) {
        idRequests += 1;
        return { ok: true, json: async () => ({ ids: ['p1'], total: 1, readOnly: true }) };
      }
      if (path.includes('/api/projects') && path.includes('view=summary')) {
        return {
          ok: true,
          json: async () => ({
            items: [{ id: 'p1', name: '延期门店', province: '浙江', rawFields: {} }],
            fieldCatalog: [],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    },
  });

  app.state.snapshot = { source: 'mock', syncedAt: '2026-06-11T00:00:00.000Z', totalRecords: 1 };
  const { openDrillProjectModal } = await import('../public/components/drill-modal.mjs');
  const filters = { owner: '苏佳蕾', metric: 'openDelayed', dashboardContext: 'direct' };
  await openDrillProjectModal(filters);
  await openDrillProjectModal(filters);
  assert.equal(idRequests, 1);
  assert.equal(app.state.drillModal.projects.length, 1);
});

test('loadTeamPageModules preloads summary catalog for team drills', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.includes('/api/projects') && path.includes('view=summary')) {
        return {
          ok: true,
          json: async () => ({ items: [{ id: 'p1', name: '门店', rawFields: {} }], fieldCatalog: [] }),
        };
      }
      if (path.startsWith('/api/team-metrics-batch')) {
        return {
          ok: true,
          json: async () => ({
            owners: ['Owner A'],
            metricsByOwner: {
              'Owner A': { owner: 'Owner A', dashboardContext: 'all', summary: {}, benchmark: {}, insights: { modules: {} } },
            },
          }),
        };
      }
      if (path.startsWith('/api/team-work-completion')) {
        return { ok: true, json: async () => ({ owner: 'Owner A', year: 2026, summary: {}, groups: [] }) };
      }
      if (path.startsWith('/api/team-responsibility-review')) {
        return { ok: true, json: async () => ({ owner: 'Owner A', summary: {}, people: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    },
  });

  app.elements.teamOwnerSelect = fakeElement();
  app.elements.teamOwnerSelect.value = 'Owner A';
  app.state.snapshot = { source: 'mock', syncedAt: '2026-06-11T00:00:00.000Z', totalRecords: 1 };
  app.state.metrics = {
    personnel: { roles: [{ key: 'cdOwner', people: [{ name: 'Owner A', displayName: 'Owner A' }] }] },
  };

  const { loadTeamPageModules } = await import('../public/lib/dashboard-loader.mjs');
  await loadTeamPageModules();

  assert.ok(requested.some((path) => path.includes('/api/projects') && path.includes('view=summary')));
  assert.equal(app.state.projectsCatalogLoaded, true);
  assert.equal(app.state.allProjects.length, 1);
});

test('drill project modal resolves team drill via fields=ids and cached catalog', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      requested.push(path);
      if (path.includes('fields=ids')) {
        return {
          ok: true,
          json: async () => ({ ids: ['p1'], total: 1, readOnly: true }),
        };
      }
      if (path.includes('/api/projects') && path.includes('view=summary')) {
        return {
          ok: true,
          json: async () => ({
            items: [{ id: 'p1', name: '延期门店', province: '浙江', rawFields: {} }],
            fieldCatalog: [],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({}),
      };
    },
  });

  app.state.snapshot = {
    source: 'mock',
    syncedAt: '2026-06-11T00:00:00.000Z',
    totalRecords: 1,
  };
  const { openDrillProjectModal } = await import('../public/components/drill-modal.mjs');
  await openDrillProjectModal({
    owner: '苏佳蕾',
    metric: 'schemeDelayedThisMonth',
    dashboardContext: 'direct',
  });

  assert.ok(requested.some((path) => path.includes('fields=ids')));
  assert.equal(app.state.drillModal.projects.length, 1);
  assert.equal(app.state.drillModal.projects[0].name, '延期门店');
  assert.equal(app.state.drillModal.loading, false);
});

test('owner responsibility review first load failure does not render static zero member loads', async () => {
  const app = await loadPublicAppHarness({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'temporary unavailable' }),
    }),
  });
  app.elements.pageSections = [
    { dataset: { page: 'overview' } },
    { dataset: { page: 'teams' } },
  ];
  app.window.location.hash = '#teams?owner=苏佳蕾&dashboardContext=direct';
  app.state.snapshot = { source: 'mock', syncedAt: '2026-06-09T00:00:00.000Z', totalRecords: 1 };

  await assert.rejects(() => app.loadOwnerResponsibilityReview('苏佳蕾', 'direct'), /temporary unavailable/);

  assert.doesNotMatch(app.elements.ownerReviewTeamStructure.innerHTML, /未挂载关联项目/);
  assert.doesNotMatch(app.elements.ownerReviewTeamStructure.innerHTML, /直营1组/);
  assert.match(app.elements.ownerReviewDecisionSummary.innerHTML, /团队负载同步失败/);
  assert.match(app.elements.ownerReviewDecisionSummary.innerHTML, /temporary unavailable/);
});
