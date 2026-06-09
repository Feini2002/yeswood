import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fakeElement, loadPublicAppHarness } from '../public/test-harness.mjs';

const publicDir = join(process.cwd(), 'public');

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

test('teams dashboard refresh loads owner review after team owner options resolve', async () => {
  const requested = [];
  const app = await loadPublicAppHarness({
    fetchImpl: async (url) => {
      const path = String(url);
      requested.push(path);
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
  app.window.location.hash = '#teams?dashboardContext=direct';

  await app.refresh();

  assert.ok(
    requested.some((path) =>
      /\/api\/team-responsibility-review\?owner=%E8%8B%8F%E4%BD%B3%E8%95%BE&context=direct/.test(path)
    )
  );
  assert.equal(app.state.ownerReview?.owner, '苏佳蕾');
  assert.match(app.elements.ownerReviewTeamStructure.innerHTML, /直营1组/);
  assert.match(app.elements.ownerReviewPersonRows.innerHTML, /陈晶晶/);
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

test('owner responsibility review marks inactive placeholders green and excludes them from structure load', async () => {
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
  const inactiveButton = html.match(/<button class="owner-review-member-load[^"]*is-inactive[^"]*"[^>]*data-owner-review-member="李晓倩"[\s\S]*?<\/button>/)?.[0] || '';

  assert.match(inactiveButton, /李晓倩/);
  assert.match(inactiveButton, /暂不在职/);
  assert.doesNotMatch(inactiveButton, /未挂载关联项目/);
  assert.match(html, /<span>1 项 · 1\/2 人<\/span>/);
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
  assert.equal(measureDelayed.message, '待填上会日期');

  const meetingStatusOnly = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '完成上会',
      软装项目进度: '未开始',
      上会情况: '准时完成',
    })
  );
  assert.equal(meetingStatusOnly.label, '上会');
  assert.equal(meetingStatusOnly.message, '待填上会日期');

  const measureStatusOnly = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '完成复尺',
      软装项目进度: '未开始',
      上会日期: '2026-06-01',
      复尺情况: '延期复尺',
    })
  );
  assert.equal(measureStatusOnly.label, '复尺');
  assert.equal(measureStatusOnly.message, '待填复尺时间');
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
  assert.equal(reminder.message, '待填上会日期');
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
  assert.match(keyDateText, /施工图初稿 · 待填施工图初稿完成时间/);
  assert.match(keyDateText, /点位完成 · 待填点位完成时间/);

  app.renderProjectDetailModal(handoffProject);
  const html = app.elements.projectDetailModalBody.innerHTML;
  assert.match(html, /硬装：施工图/);
  assert.match(html, /点位：点位设计/);
  assert.match(html, /施工图初稿 · 待填施工图初稿完成时间/);
  assert.match(html, /点位完成 · 待填点位完成时间/);
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
  assert.match(html, /硬装 Deadline/);
  assert.match(html, /系统平面 Deadline 已延期/);
  assert.match(html, /平面截止/);
  assert.match(html, /2026-06-09/);
  assert.match(html, /mini店：≤300㎡/);
  assert.match(html, /确认平面延期原因/);
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
  assert.match(app.readProjectKeyDate(stageUpdatedProject), /点位完成 · 待填点位完成时间/);
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
  assert.equal(stageReminder.message, '待填点位完成时间');

  const statusReminder = app.resolveProjectKeyDate(
    project({
      硬装项目进度: '闭环',
      软装项目进度: '点位待跟进',
      点位完成情况: '准时完成',
    })
  );
  assert.equal(statusReminder.label, '点位完成');
  assert.equal(statusReminder.message, '待填点位完成时间');
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
  assert.equal(reminder.message, '待填点位完成时间');

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
  assert.equal(reminder.message, '待填产品清单接收时间');
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
  assert.equal(reminder.message, '待填产品清单接收时间');
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
  assert.equal(reminder.message, '待填软装完成情况');
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
  assert.equal(activeReminder.message, '待填施工图完成审核时间');

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

test('team daily action board leads with dispatch actions when load review is available', async () => {
  const app = await loadPublicAppHarness();
  app.state.ownerReviewShowBorrowing = true;
  app.state.ownerReview = {
    owner: '苏佳蕾',
    team: {
      groups: [
        { name: '直营1组', members: ['陈晶晶', '安灵玲'] },
      ],
    },
    memberLoads: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 5, floorPlanCompletedCount: 1, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 2 },
        floorPlan: { active: [{ projectId: 'p-1', projectName: '杭州湖滨店', status: '平面推进中' }], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
      {
        name: '安灵玲',
        displayName: '安灵玲',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 1, floorPlanCompletedCount: 0, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 1 },
        floorPlan: { active: [{ projectId: 'p-2', projectName: '南京金鹰店', status: '平面推进中' }], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
    ],
  };

  app.renderTeamDataHealth({
    riskHealthAnalysis: {
      summary: { actionRecommendation: '旧风险队列建议：先看紧急项目。' },
      riskItems: [],
    },
    urgentStatusProjects: [{ id: 'p-1', name: '杭州湖滨店', status: '紧急', owner: '苏佳蕾' }],
    openDelayedProjects: [{ id: 'p-3', name: '上海金山店', owner: '苏佳蕾' }],
    riskProjects: [],
  });

  assert.match(app.elements.teamDataHealthSummary.textContent, /今日调度/);
  assert.doesNotMatch(app.elements.teamDataHealthSummary.textContent, /紧急 \/ 延期/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /今日调度动作/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /需调度人手/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /当前平面/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /责任内提醒/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /可调配人手/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /建议优先调度/);
  assert.doesNotMatch(app.elements.teamDataHealthBody.innerHTML, /项目收口|逐店收口/);
  assert.doesNotMatch(app.elements.teamDataHealthBody.innerHTML, /旧风险队列建议/);
});

test('team daily action board ignores responsibility-outside global risk queue when load is low', async () => {
  const app = await loadPublicAppHarness();
  app.state.ownerReview = {
    owner: '苏佳蕾',
    team: {
      groups: [{ name: '直营1组', members: ['陈晶晶', '安灵玲', '梁玉贞', '乔玲玲'] }],
    },
    memberLoads: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 1, floorPlanCompletedCount: 0, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 1 },
        floorPlan: { active: [{ projectId: 'floor-in-scope', projectName: '责任内平面店', status: '推进中', dueDate: '2026-08-20' }], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
      ...['安灵玲', '梁玉贞', '乔玲玲'].map((name) => ({
        name,
        displayName: name,
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 0, floorPlanCompletedCount: 0, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 0 },
        floorPlan: { active: [], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      })),
    ],
  };

  app.renderTeamDataHealth({
    riskHealthAnalysis: {
      summary: { actionRecommendation: '旧风险队列建议：先看全局紧急项目。' },
      riskItems: [],
    },
    urgentStatusProjects: [{ id: 'global-urgent', name: '责任外紧急店', status: '紧急', owner: '其他负责人' }],
    openDelayedProjects: [{ id: 'global-delay', name: '责任外延期店', owner: '其他负责人' }],
    riskProjects: [{ id: 'global-risk', name: '责任外高风险店', owner: '其他负责人', riskLevel: '高' }],
  });

  assert.match(app.elements.teamDataHealthSummary.textContent, /当前平面 1 项/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /真实负载不高|保留可调配/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /责任内提醒/);
  assert.doesNotMatch(app.elements.teamDataHealthBody.innerHTML, /责任外紧急店|责任外延期店|责任外高风险店/);
  assert.doesNotMatch(app.elements.teamDataHealthBody.innerHTML, /旧风险队列建议|紧急 \/ 延期优先|逐店收口/);
});

test('team daily action board surfaces only active floor-plan delay reminders', async () => {
  const app = await loadPublicAppHarness();
  app.state.ownerReview = {
    owner: '苏佳蕾',
    team: {
      groups: [{ name: '直营1组', members: ['陈晶晶', '安灵玲'] }],
    },
    memberLoads: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 1, floorPlanCompletedCount: 0, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 1 },
        floorPlan: {
          active: [{ projectId: 'floor-delay', projectName: '责任内延期平面店', status: '延期中', dueDate: '2026-05-31' }],
          completed: [],
        },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
      {
        name: '安灵玲',
        displayName: '安灵玲',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 0, floorPlanCompletedCount: 0, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 0 },
        floorPlan: { active: [], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
    ],
  };

  app.renderTeamDataHealth({
    riskHealthAnalysis: {
      summary: { actionRecommendation: '旧风险队列建议：先看紧急项目。' },
      riskItems: [],
    },
    urgentStatusProjects: [{ id: 'global-urgent', name: '责任外紧急店', status: '紧急', owner: '其他负责人' }],
    openDelayedProjects: [],
    riskProjects: [],
  });

  assert.match(app.elements.teamDataHealthBody.innerHTML, /责任内平面提醒/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /责任内延期平面店/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /陈晶晶/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /延期|临期/);
  assert.doesNotMatch(app.elements.teamDataHealthBody.innerHTML, /责任外紧急店|旧风险队列建议/);
});

test('team daily action board uses system hard decoration deadline reminders from member load', async () => {
  const app = await loadPublicAppHarness();
  app.state.ownerReview = {
    owner: '苏佳蕾',
    team: {
      groups: [{ name: '直营1组', members: ['陈晶晶', '安灵玲'] }],
    },
    memberLoads: [
      {
        name: '陈晶晶',
        displayName: '陈晶晶',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 1, floorPlanCompletedCount: 0, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 1 },
        floorPlan: {
          active: [
            {
              projectId: 'floor-system-deadline',
              projectName: '系统规则临期平面店',
              status: '推进中',
              hardDeadline: {
                ruleVersion: 'hard-decoration-deadline-v2026-06-04',
                floorPlan: {
                  warnDueDate: '2026-06-05',
                  dueDate: '2026-06-09',
                  completionStatus: 'pending_complete',
                },
                reminder: {
                  type: 'due_soon',
                  title: '系统平面 Deadline 临期',
                  action: '确认平面能否按系统 Deadline 收口，不能则补反馈时间。',
                  dueDate: '2026-06-09',
                  warningDate: '2026-06-05',
                  severity: 'P2',
                  source: 'system_deadline',
                },
              },
            },
          ],
          completed: [],
        },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
      {
        name: '安灵玲',
        displayName: '安灵玲',
        groupName: '直营1组',
        summary: { floorPlanActiveCount: 0, floorPlanCompletedCount: 0, displayActiveCount: 0, displayCompletedCount: 0, associatedProjectCount: 0 },
        floorPlan: { active: [], completed: [] },
        display: { active: [], completed: [] },
        associatedProjects: [],
      },
    ],
  };

  app.renderTeamDataHealth({
    riskHealthAnalysis: { riskItems: [] },
    urgentStatusProjects: [],
    openDelayedProjects: [],
    riskProjects: [],
  });

  assert.match(app.elements.teamDataHealthBody.innerHTML, /系统规则临期平面店/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /系统平面 Deadline 临期/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /确认平面能否按系统 Deadline 收口/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /06\/09/);
});

test('team daily action board keeps dispatch framing before load review arrives', async () => {
  const app = await loadPublicAppHarness();
  app.state.ownerReview = null;
  app.state.ownerReviewLoading = true;

  app.renderTeamDataHealth({
    riskHealthAnalysis: { riskItems: [] },
    urgentStatusProjects: [{ id: 'p-1', name: '杭州湖滨店', status: '紧急', owner: '苏佳蕾' }],
    openDelayedProjects: [{ id: 'p-3', name: '上海金山店', owner: '苏佳蕾' }],
    riskProjects: [],
  });

  assert.match(app.elements.teamDataHealthSummary.textContent, /今日调度/);
  assert.doesNotMatch(app.elements.teamDataHealthSummary.textContent, /先看紧急 \/ 延期/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /今日调度动作/);
  assert.match(app.elements.teamDataHealthBody.innerHTML, /团队负载同步后/);
  assert.doesNotMatch(app.elements.teamDataHealthBody.innerHTML, /项目收口|责任外|紧急 \/ 延期/);
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

test('team risk action board does not render system diagnosis explainer copy', async () => {
  const app = await loadPublicAppHarness();

  const note = app.renderRiskAuditNote({
    stateConflictImpactCount: 3,
    dataMissingImpactCount: 2,
  });

  assert.equal(note, '');
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

test('owner responsibility review keeps cached content visible while refreshing', async () => {
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

  const refreshPromise = app.loadOwnerResponsibilityReview('苏佳蕾', 'all');
  assert.equal(app.state.ownerReviewLoading, false);
  assert.equal(app.state.ownerReview, cachedReview);

  releaseSecondRequest();
  await refreshPromise;

  assert.equal(requestCount, 2);
  assert.equal(app.state.ownerReview.summary.peopleCount, 2);
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
  const staleReview = await app.loadOwnerResponsibilityReview('OwnerA', 'all');

  assert.equal(staleReview, cachedReview);
  assert.equal(app.state.ownerReview, cachedReview);
  assert.equal(app.state.ownerReviewError, '');
  assert.equal(app.state.ownerReviewRefreshStatus, 'stale');
  assert.match(app.state.ownerReviewRefreshError, /temporary unavailable/);
  assert.match(app.elements.ownerReviewHeadline.innerHTML, /刷新失败|refresh/i);
});
