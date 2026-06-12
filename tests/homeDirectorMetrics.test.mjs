import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDirectorOverviewModel,
  classifyProjectStage,
  readRawFieldDisplay,
} from '../public/dashboard/home-director-metrics.mjs';
import { filterProjects } from '../src/backend/projectData.mjs';

function raw(display) {
  return { display };
}

const projects = [
  {
    id: 'p1',
    name: '杭州旗舰店',
    province: '浙江',
    storeStatus: '常规店',
    status: '紧急',
    owner: '范嘉瑞',
    cdOwner: '范嘉瑞',
    progress: 20,
    dueDate: '2026-05-01',
    startDate: '2026-03-05',
    isDelayed: true,
    difficultyWeight: 2.4,
    rawFields: {
      硬装项目进度: raw('施工图初稿'),
      CD负责人: raw('范嘉瑞'),
      软装项目进度: raw('软装方案'),
      店铺性质: raw('新店'),
    },
  },
  {
    id: 'p2',
    name: '宁波标准店',
    province: '浙江',
    storeStatus: '下沉店',
    status: '一般',
    owner: '王吉祥',
    vmOwner: '范嘉瑞',
    progress: 70,
    dueDate: '2026-06-20',
    startDate: '2026-04-08',
    isDelayed: false,
    difficultyWeight: 1.1,
    rawFields: {
      硬装项目进度: raw('采购推进'),
      VM负责人: raw('范嘉瑞'),
      店铺性质: raw('翻新店'),
    },
  },
  {
    id: 'p3',
    name: '苏州暂停店',
    province: '江苏',
    storeStatus: '常规店',
    status: '未设置',
    owner: '范嘉瑞',
    cdOwner: '范嘉瑞',
    progress: 0,
    dueDate: '2026-07-12',
    startDate: '2026-04-15',
    isDelayed: false,
    rawFields: {
      硬装项目进度: raw('暂停'),
      CD负责人: raw('范嘉瑞'),
    },
  },
];

test('readRawFieldDisplay reads exact and fuzzy raw field displays', () => {
  const project = {
    rawFields: {
      '软装项目进度-当前': raw('摆场'),
      硬装项目进度: raw('平面结束'),
    },
  };

  assert.equal(readRawFieldDisplay(project, ['硬装项目进度']), '平面结束');
  assert.equal(readRawFieldDisplay(project, ['软装项目进度']), '摆场');
  assert.equal(readRawFieldDisplay(project, ['不存在']), '');
});

test('classifyProjectStage maps workflow text to stable director stages', () => {
  assert.deepEqual(classifyProjectStage(projects[0]), { key: 'softEntry', label: '方案设计' });
  assert.deepEqual(classifyProjectStage(projects[1]), { key: 'purchase', label: '采购推进' });
  assert.deepEqual(classifyProjectStage(projects[2]), { key: 'paused', label: '暂停/取消' });
});

test('classifyProjectStage treats repeated pause after recovery as current pause', () => {
  assert.deepEqual(
    classifyProjectStage({
      rawFields: {
        硬装项目进度: raw('恢复后再次暂停'),
        软装项目进度: raw('未开始'),
      },
    }),
    { key: 'paused', label: '暂停/取消' }
  );
});

test('classifyProjectStage groups canceled projects into the paused/canceled lifecycle lane', () => {
  assert.deepEqual(
    classifyProjectStage({
      rawFields: {
        硬装项目进度: raw('施工图'),
        软装项目进度: raw('取消'),
      },
    }),
    { key: 'paused', label: '暂停/取消' }
  );
});

test('classifyProjectStage keeps recovered pause projects in active lifecycle stages', () => {
  assert.deepEqual(
    classifyProjectStage({
      rawFields: {
        硬装项目进度: raw('曾暂停，现施工图推进'),
        软装项目进度: raw('未开始'),
      },
    }),
    { key: 'point', label: '点位设计' }
  );
});

test('classifyProjectStage only advances from soft completion on final completion statuses', () => {
  const baseProject = {
    rawFields: {
      硬装项目进度: raw('施工图'),
      软装项目进度: raw('软装方案中'),
      软装方案开始时间: raw('2026-05-02'),
    },
  };

  assert.deepEqual(
    classifyProjectStage({
      ...baseProject,
      rawFields: { ...baseProject.rawFields, 软装完成情况: raw('未完成') },
    }),
    { key: 'softEntry', label: '方案设计' }
  );
  assert.deepEqual(
    classifyProjectStage({
      ...baseProject,
      rawFields: { ...baseProject.rawFields, 软装完成情况: raw('延期中') },
    }),
    { key: 'softEntry', label: '方案设计' }
  );
  assert.deepEqual(
    classifyProjectStage({
      ...baseProject,
      rawFields: { ...baseProject.rawFields, 软装完成情况: raw('准时完成') },
    }),
    { key: 'purchase', label: '采购推进' }
  );
  assert.deepEqual(
    classifyProjectStage({
      ...baseProject,
      rawFields: { ...baseProject.rawFields, 软装完成情况: raw('延期完成') },
    }),
    { key: 'purchase', label: '采购推进' }
  );
});

test('classifyProjectStage does not advance from unfinished point status', () => {
  const baseProject = {
    rawFields: {
      硬装项目进度: raw('施工图'),
      软装项目进度: raw('点位'),
      软装方案开始时间: raw('2026-05-02'),
    },
  };

  assert.deepEqual(
    classifyProjectStage({
      ...baseProject,
      rawFields: { ...baseProject.rawFields, 点位完成情况: raw('未完成') },
    }),
    { key: 'point', label: '点位设计' }
  );
  assert.deepEqual(
    classifyProjectStage({
      ...baseProject,
      rawFields: { ...baseProject.rawFields, 点位完成情况: raw('已完成') },
    }),
    { key: 'softEntry', label: '方案设计' }
  );
});

test('classifyProjectStage treats single-track workflow closure as company closed', () => {
  const project = {
    id: 'hard-closed-stale-soft',
    rawFields: {
      硬装项目进度: raw('闭环'),
      躺平内部审核结束时间: raw('2026-05-12'),
      软装项目进度: raw('完成'),
      软装方案开始时间: raw('2026-05-18'),
      软装完成情况: raw('准时完成'),
    },
  };

  assert.deepEqual(classifyProjectStage(project), { key: 'closed', label: '闭环完成' });
  assert.deepEqual(
    classifyProjectStage({
      rawFields: {
        ...project.rawFields,
        硬装项目进度: raw('闭环'),
        软装项目进度: raw('闭环'),
      },
    }),
    { key: 'closed', label: '闭环完成' }
  );
});

test('classifyProjectStage closes hard-closed projects even when soft track is stale', () => {
  const project = {
    id: 'hard-closed-stale-soft',
    rawFields: {
      硬装项目进度: raw('闭环'),
      软装项目进度: raw('软装方案中'),
      软装方案开始时间: raw('2026-05-18'),
      产品清单发出时间: raw('2026-05-20'),
    },
  };

  assert.deepEqual(classifyProjectStage(project), { key: 'closed', label: '闭环完成' });
  assert.deepEqual(filterProjects([project], { lifecycleStage: 'closed' }).map((item) => item.id), [project.id]);
  assert.deepEqual(filterProjects([project], { lifecycleStage: 'purchase' }), []);
});

test('classifyProjectStage follows the real lifecycle gate before soft not-started text', () => {
  assert.deepEqual(
    classifyProjectStage({
      progress: 55,
      rawFields: {
        硬装项目进度: raw('施工图'),
        软装项目进度: raw('未开始'),
      },
    }),
    { key: 'point', label: '点位设计' }
  );

  assert.deepEqual(
    classifyProjectStage({
      progress: 25,
      rawFields: {
        硬装项目进度: raw('完成复尺'),
        软装项目进度: raw('未开始'),
      },
    }),
    { key: 'plan', label: '平面方案' }
  );

  assert.deepEqual(
    classifyProjectStage({
      progress: 0,
      rawFields: {
        硬装项目进度: raw('未开始'),
        软装项目进度: raw('未开始'),
      },
    }),
    { key: 'notStarted', label: '待上会' }
  );

  assert.deepEqual(
    classifyProjectStage({
      rawFields: {
        硬装项目进度: raw('未开始'),
        软装项目进度: raw('未开始'),
        复尺时间: raw('2026-06-01'),
      },
    }),
    { key: 'plan', label: '平面方案' }
  );

  assert.deepEqual(
    classifyProjectStage({
      rawFields: {
        硬装项目进度: raw('完成上会'),
        软装项目进度: raw('未开始'),
        上会日期: raw('2026-05-28'),
      },
    }),
    { key: 'meeting', label: '待复尺' }
  );
});

test('classifyProjectStage moves finished floor plans into active point design', () => {
  const floorPlanStarted = {
    id: 'floor-plan-started',
    rawFields: {
      硬装项目进度: raw('平面方案'),
      软装项目进度: raw('未开始'),
      平面开始时间: raw('2026-05-26'),
    },
  };
  const floorPlanFinished = {
    id: 'floor-plan-finished',
    rawFields: {
      ...floorPlanStarted.rawFields,
      躺平内部审核结束时间: raw('2026-06-01'),
    },
  };

  assert.deepEqual(classifyProjectStage(floorPlanStarted), { key: 'plan', label: '平面方案' });
  assert.deepEqual(classifyProjectStage(floorPlanFinished), { key: 'point', label: '点位设计' });
  assert.deepEqual(
    filterProjects([floorPlanStarted, floorPlanFinished], { lifecycleStage: 'plan' }).map((project) => project.id),
    ['floor-plan-started']
  );
  assert.deepEqual(
    filterProjects([floorPlanStarted, floorPlanFinished], { lifecycleStage: 'point' }).map((project) => project.id),
    ['floor-plan-finished']
  );
  assert.deepEqual(filterProjects([floorPlanFinished], { lifecycleStage: 'drawing' }), []);
});

test('classifyProjectStage treats construction text as point design handoff when soft stage is not updated', () => {
  const constructionStarted = {
    id: 'construction-started-soft-waiting',
    rawFields: {
      硬装项目进度: raw('施工图'),
      软装项目进度: raw('未开始'),
    },
  };

  assert.deepEqual(classifyProjectStage(constructionStarted), { key: 'point', label: '点位设计' });
  assert.deepEqual(
    filterProjects([constructionStarted], { lifecycleStage: 'point' }).map((project) => project.id),
    ['construction-started-soft-waiting']
  );
  assert.deepEqual(filterProjects([constructionStarted], { lifecycleStage: 'drawing' }), []);
});

test('buildDirectorOverviewModel keeps construction handoff visible as parallel work inside point stage', () => {
  const model = buildDirectorOverviewModel({
    projects: [
      {
        id: 'handoff-parallel',
        progress: 55,
        rawFields: {
          硬装项目进度: raw('施工图'),
          软装项目进度: raw('未开始'),
        },
      },
    ],
  });

  const pointStage = model.stageLane.find((stage) => stage.key === 'point');
  assert.equal(pointStage.total, 1);
  assert.equal(pointStage.parallelHardConstruction, 1);
});

test('classifyProjectStage lets point design evidence advance while construction drawing is external progress', () => {
  const pointInProgress = {
    id: 'point-during-drawing',
    rawFields: {
      硬装项目进度: raw('施工图'),
      躺平内部审核结束时间: raw('2026-06-01'),
      软装项目进度: raw('点位设计'),
      点位完成情况: raw('未完成'),
    },
  };
  const pointDoneSchemeStarted = {
    id: 'scheme-during-drawing',
    rawFields: {
      ...pointInProgress.rawFields,
      点位完成情况: raw('已完成'),
      点位完成时间: raw('2026-06-05'),
      软装方案开始时间: raw('2026-06-06'),
    },
  };

  assert.deepEqual(classifyProjectStage(pointInProgress), { key: 'point', label: '点位设计' });
  assert.deepEqual(classifyProjectStage(pointDoneSchemeStarted), { key: 'softEntry', label: '方案设计' });
});

test('filterProjects can drill by the same lifecycle stage used by the director lane', () => {
  const stagedProjects = [
    {
      id: 'drawing-soft-waiting',
      progress: 55,
      rawFields: {
        硬装项目进度: raw('施工图'),
        软装项目进度: raw('未开始'),
      },
    },
    {
      id: 'true-not-started',
      progress: 0,
      rawFields: {
        硬装项目进度: raw('未开始'),
        软装项目进度: raw('未开始'),
      },
    },
  ];

  assert.deepEqual(
    filterProjects(stagedProjects, { lifecycleStage: 'point' }).map((project) => project.id),
    ['drawing-soft-waiting']
  );
  assert.deepEqual(filterProjects(stagedProjects, { lifecycleStage: 'drawing' }), []);
  assert.deepEqual(
    filterProjects(stagedProjects, { lifecycleStage: 'notStarted' }).map((project) => project.id),
    ['true-not-started']
  );
});

test('classifyProjectStage treats hard closure as closed even when follow-up fields are open', () => {
  assert.deepEqual(
    classifyProjectStage({
      progress: 90,
      rawFields: {
        硬装项目进度: raw('闭环'),
        软装项目进度: raw('待采购'),
        软装完成情况: raw('准时完成'),
        软装发项目群时间: raw('2026-05-11'),
      },
    }),
    { key: 'closed', label: '闭环完成' }
  );
});

test('classifyProjectStage does not treat construction review as company closure', () => {
  assert.deepEqual(
    classifyProjectStage({
      progress: 75,
      rawFields: {
        硬装项目进度: raw('（施工中）施工图完成审核'),
        软装项目进度: raw('待采购'),
        软装完成情况: raw('准时完成'),
        产品清单发出时间: raw('2026-05-10'),
        采购情况: raw('待采购'),
        软装发项目群时间: raw('2026-05-11'),
      },
    }),
    { key: 'purchase', label: '采购推进' }
  );

  assert.deepEqual(
    classifyProjectStage({
      progress: 100,
      rawFields: {
        硬装项目进度: raw('闭环'),
        软装项目进度: raw('闭环'),
        硬装方案情况: raw('延期完成'),
        软装完成情况: raw('延期完成'),
      },
    }),
    { key: 'closed', label: '闭环完成' }
  );
});

test('classifyProjectStage closes hard-closed projects even when soft stage says 未安排摆场', () => {
  assert.deepEqual(
    classifyProjectStage({
      progress: 75,
      rawFields: {
        硬装项目进度: raw('闭环'),
        软装项目进度: raw('未安排摆场'),
        点位完成情况: raw('点位已完成'),
        产品清单发出时间: raw('2026-05-10'),
        软装完成情况: raw('准时完成'),
      },
    }),
    { key: 'closed', label: '闭环完成' }
  );
});

test('buildDirectorOverviewModel derives safe command signals and risk queues', () => {
  const model = buildDirectorOverviewModel({
    metrics: {
      summary: {
        totalProjects: 3,
        activeProjects: 2,
        delayedProjects: 1,
        pausedProjects: 1,
        averageProgress: 30,
      },
      pausedCount: 1,
      totalScopeCount: 4,
      statusCounts: [
        { label: '紧急', value: 1 },
        { label: '一般', value: 1 },
      ],
      ownerLoad: [
        { label: '范嘉瑞', value: 2 },
        { label: '王吉祥', value: 1 },
      ],
      monthlyTrend: [{ label: '2026-05', value: 3 }],
    },
    departmentMetrics: {
      scopeCount: 3,
      pausedCount: 1,
      totalScopeCount: 4,
      totals: {
        inProgress: 2,
        openDelayed: 1,
        notStarted: 0,
      },
      tierOrder: ['regular'],
      tierLabels: { regular: '常规店' },
      tiers: {
        regular: {
          projectCount: 2,
          inProgress: 1,
          openDelayed: 1,
        },
      },
      monthlyOps: {
        regular: {
          hardPlanVolume: 2,
          purchaseVolume: 1,
        },
      },
      fieldCoverage: {
        entryDate: 88,
      },
    },
    projects,
    now: new Date('2026-05-31T00:00:00.000Z'),
  });

  assert.equal(model.summary.scopeCount, 3);
  assert.equal(model.summary.delayedRate, 33);
  assert.equal(model.summary.urgentCount, 1);
  assert.equal(model.riskQueue[0].name, '杭州旗舰店');
  assert.equal(model.ownerPressure[0].name, '范嘉瑞');
  assert.equal(model.regionMatrix.rows[0], '浙江');
  assert.equal(model.tierMatrix.summary.rowCount, 1);
  assert.equal(model.tierMatrix.rows[0].values.find((item) => item.key === 'openDelayed')?.value, 1);
  assert.equal(model.monthlyOpsMatrix.rows.find((item) => item.key === 'hardPlanVolume')?.total, 2);
  assert.ok(model.pressureTimeline.length >= 1);
  assert.equal(Number.isFinite(model.summary.delayedRate), true);
});

test('buildDirectorOverviewModel prefers complete department profile totals over legacy summary kpis', () => {
  const model = buildDirectorOverviewModel({
    metrics: {
      summary: {
        totalProjects: 430,
        activeProjects: 425,
        delayedProjects: 9,
        notStarted: 12,
        pausedProjects: 6,
      },
      pausedCount: 6,
      totalScopeCount: 436,
    },
    departmentMetrics: {
      scopeCount: 438,
      pausedCount: 8,
      totalScopeCount: 446,
      totals: {
        inProgress: 438,
        openDelayed: 0,
        notStarted: 0,
      },
    },
  });

  assert.equal(model.summary.scopeCount, 438);
  assert.equal(model.summary.totalScopeCount, 446);
  assert.equal(model.summary.pausedCount, 8);
  assert.equal(model.summary.inProgress, 438);
  assert.equal(model.summary.openDelayed, 0);
  assert.equal(model.summary.notStarted, 0);
});

test('buildDirectorOverviewModel prefers backend projectBoard over local summary recomputation', () => {
  const model = buildDirectorOverviewModel({
    projects: [
      {
        id: 'local-active',
        name: 'local-active',
        startDate: '2026-02-01',
        rawFields: {
          组别: raw('直营新店'),
          启动时间: raw('2026-02-01'),
          硬装项目进度: raw('施工图'),
          软装项目进度: raw('软装方案'),
        },
      },
    ],
    departmentMetrics: {
      projectBoard: {
        year: 2026,
        previousYear: 2025,
        currentYearEntryTotal: 11,
        currentYearEntryDirect: 7,
        currentYearEntryFranchise: 4,
        pausedOrCanceled: 3,
        closedProjectTotal: 9,
        closedProjectDirect: 5,
        closedProjectFranchise: 4,
        previousYearUnclosedTotal: 2,
        previousYearUnclosedDirect: 1,
        previousYearUnclosedFranchise: 1,
      },
    },
    now: new Date('2026-06-01T00:00:00.000Z'),
  });
  const signals = Object.fromEntries(model.signals.map((item) => [item.key, item]));

  assert.equal(signals.currentYearEntryTotal?.value, 11);
  assert.equal(signals.pausedOrCanceled?.value, 3);
  assert.equal(signals.closedProjectTotal?.value, 9);
  assert.equal(signals.previousYearUnclosedTotal?.value, 2);
});

test('buildDirectorOverviewModel local fallback reads summary catalog workflow fields', () => {
  const summaryProject = (id, startDate, franchiseScope, hardProgressStage, softProgressStage) => ({
    id,
    name: id,
    startDate,
    franchiseScope,
    hardProgressStage,
    softProgressStage,
  });
  const model = buildDirectorOverviewModel({
    projects: [
      summaryProject('direct-active', '2026-02-01', 'direct', '施工图', '软装方案中'),
      summaryProject('franchise-paused', '2026-03-01', 'franchise', '暂停', '未开始'),
      summaryProject('direct-canceled', '2026-04-01', 'direct', '施工图', '取消'),
      summaryProject('franchise-closed', '2026-05-01', 'franchise', '闭环', '闭环'),
      summaryProject('direct-canceled-after-close', '2026-05-15', 'direct', '闭环', '取消'),
      summaryProject('direct-previous-unclosed', '2025-12-01', 'direct', '施工图', '软装方案中'),
    ],
    now: new Date('2026-06-01T00:00:00.000Z'),
  });
  const signals = Object.fromEntries(model.signals.map((item) => [item.key, item]));

  assert.equal(signals.currentYearEntryTotal?.value, 2);
  assert.equal(signals.currentYearEntryDirect?.value, 1);
  assert.equal(signals.currentYearEntryFranchise?.value, 1);
  assert.equal(signals.pausedOrCanceled?.value, 3);
  assert.equal(signals.closedProjectTotal?.value, 1);
  assert.equal(signals.closedProjectDirect?.value, 0);
  assert.equal(signals.closedProjectFranchise?.value, 1);
  assert.equal(signals.previousYearUnclosedTotal?.value, 1);
});

test('buildDirectorOverviewModel surfaces DingTalk form project board signals', () => {
  const formProject = (id, group, startDate, hardStage, softStage, status = '') => ({
    id,
    name: id,
    startDate,
    status,
    rawFields: {
      组别: raw(group),
      启动时间: raw(startDate),
      硬装项目进度: raw(hardStage),
      软装项目进度: raw(softStage),
    },
  });
  const formProjects = [
    formProject('direct-2026-closed', '直营新店', '2026-01-05', '闭环', '待采购'),
    formProject('direct-2026-active', '直营新店', '2026-02-08', '施工图', '软装方案中'),
    formProject('franchise-2026-closed', '加盟新店', '2026-03-10', '闭环', '闭环'),
    formProject('franchise-2026-active', '加盟新店', '2026-04-12', '平面方案', '未开始'),
    formProject('franchise-paused', '加盟新店', '2026-05-15', '暂停', '未开始'),
    formProject('direct-2025-unclosed', '直营老店', '2025-12-20', '施工图', '软装方案中'),
    formProject('franchise-2025-unclosed', '加盟老店', '2025-12-22', '施工图', '软装方案中'),
    formProject('franchise-2025-closed', '加盟老店', '2025-11-18', '闭环', '闭环'),
  ];

  const model = buildDirectorOverviewModel({
    projects: formProjects,
    now: new Date('2026-06-01T00:00:00.000Z'),
  });
  const signals = Object.fromEntries(model.signals.map((item) => [item.key, item]));

  assert.deepEqual(
    model.signals.map((item) => item.label),
    [
      '26年总进店量（推进）',
      '暂停/取消项目量',
      '全年已闭环项目总量',
      '25年未闭环项目量',
      '直营进店量（推进）',
      '加盟进店量（推进）',
      '已闭环项目 - 直营',
      '已闭环项目 - 加盟',
      '25年未闭环项目量 - 直营',
      '25年未闭环项目量 - 加盟',
    ]
  );
  assert.equal(signals.currentYearEntryTotal?.value, 4);
  assert.equal(signals.pausedOrCanceled?.value, 1);
  assert.equal(signals.closedProjectTotal?.value, 3);
  assert.equal(signals.previousYearUnclosedTotal?.value, 2);
  assert.equal(signals.currentYearEntryDirect?.value, 2);
  assert.equal(signals.currentYearEntryFranchise?.value, 2);
  assert.equal(signals.closedProjectDirect?.value, 1);
  assert.equal(signals.closedProjectFranchise?.value, 2);
  assert.equal(signals.previousYearUnclosedDirect?.value, 1);
  assert.equal(signals.previousYearUnclosedFranchise?.value, 1);
});

test('buildDirectorOverviewModel only counts exact workflow closure as project board closed', () => {
  const formProject = (id, hardStage, softStage) => ({
    id,
    name: id,
    startDate: '2026-03-10',
    rawFields: {
      组别: raw('直营新店'),
      启动时间: raw('2026-03-10'),
      硬装项目进度: raw(hardStage),
      软装项目进度: raw(softStage),
    },
  });
  const model = buildDirectorOverviewModel({
    projects: [
      formProject('exact-hard-closed', '闭环', '待采购'),
      formProject('generic-complete-label', '完成', '已完成'),
    ],
    now: new Date('2026-06-01T00:00:00.000Z'),
  });
  const signals = Object.fromEntries(model.signals.map((item) => [item.key, item]));

  assert.equal(signals.closedProjectTotal?.value, 1);
  assert.equal(signals.closedProjectDirect?.value, 1);
});

test('region matrix uses active projects, full store statuses, expandable province rows, and source-name audit', () => {
  const hardStage = '\u786c\u88c5\u9879\u76ee\u8fdb\u5ea6';
  const groupField = '\u7ec4\u522b';
  const activeProjects = [
    ['p1', '\u5e7f\u4e1c\u7701', 'S01', '\u76f4\u8425'],
    ['p2', '\u6d59\u6c5f\u7701', 'S02', '\u52a0\u76df'],
    ['p3', '\u6c5f\u82cf\u7701', 'S03', '\u76f4\u8425'],
    ['p4', '\u5c71\u4e1c\u7701', 'S04', '\u52a0\u76df'],
    ['p5', '\u5b89\u5fbd\u7701', 'S05', '\u76f4\u8425'],
    ['p6', '\u6cb3\u5357\u7701', 'S06', '\u52a0\u76df'],
    ['p7', '\u6e56\u5357\u7701', 'S07', '\u76f4\u8425'],
    ['p8', '\u4e0a\u6d77\u5e02', 'S08', '\u52a0\u76df'],
    ['p9', '\u56db\u5ddd\u7701', 'S09', '\u76f4\u8425'],
    ['p10', '\u5e7f\u897f\u7701', 'S10', '\u76f4\u8425'],
    ['p11', '\u5185\u8499\u53e4', 'S01', '\u52a0\u76df'],
    ['p12', '\u5185\u8499\u53e4\u81ea\u6cbb\u533a', 'S02', '\u76f4\u8425'],
    ['p13', '\u5e7f\u897f\u58ee\u65cf\u81ea\u6cbb\u533a', 'S10', '\u52a0\u76df'],
    ['p14', '\u65b0\u7586\u7ef4\u543e\u5c14\u81ea\u6cbb\u533a', 'S03', '\u76f4\u8425'],
    ['p15', '\u65b0\u7586\u7701', 'S04', '\u52a0\u76df'],
  ].map(([id, province, storeStatus, group]) => ({
    id,
    name: id,
    province,
    storeStatus,
    rawFields: { [hardStage]: raw('\u65bd\u5de5\u56fe'), [groupField]: raw(group) },
  }));
  const pausedProject = {
    id: 'paused',
    name: 'paused',
    province: 'PausedOnly',
    storeStatus: 'S11',
    rawFields: { [hardStage]: raw('\u6682\u505c') },
  };

  const model = buildDirectorOverviewModel({
    projects: [...activeProjects, pausedProject],
  });
  const matrix = model.regionMatrix;

  assert.equal(matrix.activeProjectCount, 15);
  assert.equal(matrix.excludedPausedCount, 1);
  assert.equal(matrix.rows.length, 8);
  assert.equal(matrix.totalRows, 12);
  assert.deepEqual(matrix.allRows.slice(0, 3), ['\u5e7f\u897f\u7701', '\u5185\u8499\u53e4', '\u65b0\u7586\u7701']);
  assert.equal(matrix.cols.length, 10);
  assert.equal(matrix.totalCols, 10);
  assert.equal(matrix.hiddenCols, 0);
  assert.equal(matrix.allRows.includes('PausedOnly'), false);
  assert.equal(matrix.allRows.includes('\u5e7f\u897f\u58ee\u65cf\u81ea\u6cbb\u533a'), false);
  assert.equal(matrix.allRows.includes('\u5185\u8499\u53e4\u81ea\u6cbb\u533a'), false);
  assert.equal(matrix.allRows.includes('\u65b0\u7586\u7ef4\u543e\u5c14\u81ea\u6cbb\u533a'), false);
  assert.equal(
    matrix.cells.find((cell) => cell.province === '\u5e7f\u897f\u7701' && cell.storeStatus === 'S10')?.total,
    2
  );
  assert.equal(
    matrix.cells.find((cell) => cell.province === '\u5e7f\u897f\u7701' && cell.storeStatus === 'S10')?.direct,
    1
  );
  assert.equal(
    matrix.cells.find((cell) => cell.province === '\u5e7f\u897f\u7701' && cell.storeStatus === 'S10')?.franchise,
    1
  );
  assert.equal(
    matrix.cells.find((cell) => cell.province === '\u5e7f\u897f\u7701' && cell.storeStatus === 'S10')?.other,
    0
  );
  assert.equal(
    matrix.cells.find((cell) => cell.province === '\u5185\u8499\u53e4' && cell.storeStatus === 'S02')?.total,
    1
  );
  assert.equal(
    matrix.cells.find((cell) => cell.province === '\u65b0\u7586\u7701' && cell.storeStatus === 'S03')?.total,
    1
  );
  assert.equal(matrix.cols.includes('S11'), false);
  assert.equal(
    matrix.cells.find((cell) => cell.province === '\u5e7f\u4e1c\u7701' && cell.storeStatus === 'S01')?.drillFilter.excludePaused,
    '1'
  );
  assert.equal(matrix.provinceAudit.sourceLabelCount, 15);
  assert.equal(matrix.provinceAudit.canonicalLabelCount, 12);
  assert.equal(matrix.provinceAudit.issueCount, 0);
});

test('region and tier matrices omit unfilled store status while keeping projects in scope', () => {
  const projects = [
    {
      id: 'filled',
      name: 'filled',
      province: '云南省',
      storeStatus: '常规店',
      rawFields: { 硬装项目进度: raw('施工图'), 组别: raw('直营') },
    },
    {
      id: 'missing-status',
      name: 'missing-status',
      province: '云南省',
      storeStatus: '未填写',
      rawFields: { 硬装项目进度: raw('施工图'), 组别: raw('直营') },
    },
  ];

  const model = buildDirectorOverviewModel({
    departmentMetrics: {
      tierLabels: { regular: '常规店', 'custom:未填写': '未填写' },
      tierOrder: ['regular', 'custom:未填写'],
      tiers: {
        regular: { projectCount: 1, inProgress: 1, notStarted: 0, openDelayed: 0, schemeDoneYtd: 0 },
        'custom:未填写': { projectCount: 1, inProgress: 0, notStarted: 1, openDelayed: 0, schemeDoneYtd: 0 },
      },
      monthlyOps: {
        regular: { hardPlanVolume: 1 },
        'custom:未填写': { hardPlanVolume: 0 },
      },
    },
    projects,
  });

  assert.equal(model.regionMatrix.activeProjectCount, 2);
  assert.deepEqual(model.regionMatrix.cols, ['常规店']);
  assert.equal(
    model.regionMatrix.cells.find((cell) => cell.province === '云南省' && cell.storeStatus === '常规店')?.total,
    1
  );
  assert.equal(model.regionMatrix.cols.includes('未填写'), false);
  assert.equal(model.tierMatrix.rows.length, 1);
  assert.equal(model.tierMatrix.rows[0].label, '常规店');
  assert.equal(model.monthlyOpsMatrix.columns.length, 1);
  assert.equal(model.monthlyOpsMatrix.columns[0].label, '常规店');
});

test('buildDirectorOverviewModel handles empty inputs without NaN or thrown errors', () => {
  const model = buildDirectorOverviewModel();

  assert.equal(model.summary.scopeCount, 0);
  assert.equal(model.summary.delayedRate, 0);
  assert.equal(model.signals.length, 10);
  assert.deepEqual(model.riskQueue, []);
  assert.deepEqual(model.ownerPressure, []);
});

test('buildDirectorOverviewModel keeps operational summary while top signals use form board metrics', () => {
  const model = buildDirectorOverviewModel({
    metrics: {
      summary: {
        totalProjects: 3,
        activeProjects: 2,
        pausedProjects: 1,
      },
    },
    departmentMetrics: {
      scopeCount: 3,
      pausedCount: 1,
      totalScopeCount: 4,
      totals: {
        inProgress: 2,
        notStarted: 0,
      },
    },
    projects,
    now: new Date('2026-05-31T00:00:00.000Z'),
  });

  const entrySignal = model.signals.find((item) => item.key === 'currentYearEntryTotal');
  const totalSignal = model.signals.find((item) => item.key === 'closedProjectTotal');

  assert.equal(model.summary.notStarted, 0);
  assert.equal(model.summary.inProgress, 2);
  assert.equal(model.summary.currentYearEntry, 2);
  assert.equal(model.summary.scopeCount, 3);
  assert.equal(model.summary.totalScopeCount, 4);
  assert.equal(entrySignal?.label, '26年总进店量（推进）');
  assert.equal(entrySignal?.value, 0);
  assert.equal(totalSignal?.label, '全年已闭环项目总量');
  assert.equal(totalSignal?.value, 0);
});

test('buildDirectorOverviewModel uses backend current-year entry metric when provided', () => {
  const model = buildDirectorOverviewModel({
    departmentMetrics: {
      scopeCount: 486,
      pausedCount: 30,
      totalScopeCount: 516,
      currentYearEntry: {
        year: 2026,
        count: 346,
      },
    },
    projects: [],
    now: new Date('2026-06-01T00:00:00.000Z'),
  });

  const entrySignal = model.signals.find((item) => item.key === 'currentYearEntryTotal');
  assert.equal(model.summary.currentYearEntry, 346);
  assert.equal(entrySignal?.label, '26年总进店量（推进）');
  assert.equal(entrySignal?.value, 346);
});

test('buildDirectorOverviewModel keeps fully closed design projects out of the command risk queue', () => {
  const closedProject = {
    id: 'closed-risk',
    name: '北京北四居然店',
    province: '北京',
    storeStatus: '常规店',
    status: '紧急',
    owner: '苏佳蕾',
    cdOwner: '苏佳蕾',
    progress: 100,
    dueDate: '2026-05-30',
    startDate: '2026-03-01',
    isDelayed: true,
    riskLevel: '高',
    rawFields: {
      CD负责人: raw('苏佳蕾'),
      硬装项目进度: raw('闭环'),
      躺平内部审核结束时间: raw('2026-05-12'),
      软装项目进度: raw('闭环'),
      点位完成情况: raw('已完成'),
      点位完成时间: raw('2026-05-16'),
      软装完成情况: raw('准时完成'),
      店铺性质: raw('新店'),
    },
  };
  const closedMissingPointProject = {
    id: 'closed-missing-point',
    name: '闭环点位漏填店',
    province: '北京',
    storeStatus: '常规店',
    status: '紧急',
    owner: '苏佳蕾',
    cdOwner: '苏佳蕾',
    progress: 100,
    dueDate: '2026-05-30',
    startDate: '2026-03-01',
    isDelayed: true,
    riskLevel: '高',
    rawFields: {
      CD负责人: raw('苏佳蕾'),
      硬装项目进度: raw('闭环'),
      躺平内部审核结束时间: raw('2026-05-12'),
      软装项目进度: raw('闭环'),
      软装完成情况: raw('准时完成'),
      店铺性质: raw('新店'),
    },
  };
  const openProject = {
    id: 'open-risk',
    name: '上海待采购店',
    province: '上海',
    storeStatus: '常规店',
    status: '一般',
    owner: '苏佳蕾',
    cdOwner: '苏佳蕾',
    progress: 40,
    dueDate: '2026-05-29',
    startDate: '2026-03-01',
    isDelayed: true,
    rawFields: {
      CD负责人: raw('苏佳蕾'),
      硬装项目进度: raw('施工图'),
      平面开始时间: raw('2026-05-12'),
      软装项目进度: raw('待采购'),
      硬装方案情况: raw('延期'),
      店铺性质: raw('新店'),
    },
  };

  const model = buildDirectorOverviewModel({
    metrics: {
      summary: { totalProjects: 3, delayedProjects: 1, averageProgress: 70 },
      ownerLoad: [{ label: '苏佳蕾', value: 3 }],
      statusCounts: [{ label: '紧急', value: 1 }],
    },
    departmentMetrics: {
      scopeCount: 3,
      totals: { openDelayed: 1, inProgress: 1, notStarted: 0 },
    },
    projects: [closedProject, closedMissingPointProject, openProject],
    now: new Date('2026-05-31T00:00:00.000Z'),
  });

  assert.deepEqual(model.riskQueue.map((item) => item.id), ['open-risk']);
  const closedStage = model.stageLane.find((stage) => stage.key === 'closed');
  assert.equal(closedStage.total, 2);
  assert.equal(closedStage.delayed, 0);
  assert.equal(closedStage.urgent, 0);
  assert.equal(Object.hasOwn(model.ownerPressure[0], 'delayedCount'), false);
  assert.equal(Object.hasOwn(model.ownerPressure[0], 'urgentCount'), false);
  assert.equal(Object.hasOwn(model.ownerPressure[0], 'highRiskCount'), false);
});

test('team project quantity rows count CD and VM owner responsibility columns', () => {
  const model = buildDirectorOverviewModel({
    metrics: {
      summary: { totalProjects: 3, delayedProjects: 0, averageProgress: 60 },
      ownerLoad: [{ label: '错误缓存负责人', value: 99 }],
    },
    departmentMetrics: {
      scopeCount: 3,
      totals: { openDelayed: 0, inProgress: 3, notStarted: 0 },
    },
    projects: [
      {
        id: 'owner-a-1',
        name: '负责人同项目双栏去重',
        owner: '王吉祥',
        cdOwner: '范嘉瑞',
        vmOwner: '范嘉瑞',
        status: '紧急',
        progress: 60,
        rawFields: {
          负责人: raw('王吉祥'),
          CD负责人: raw('范嘉瑞'),
          VM负责人: raw('范嘉瑞'),
          硬装方案情况: raw('延期中'),
          硬装项目进度: raw('施工图'),
          店铺性质: raw('新店'),
        },
      },
      {
        id: 'owner-a-2',
        name: 'VM负责人命中',
        owner: '王吉祥',
        cdOwner: '其他硬装',
        vmOwner: '范嘉瑞',
        progress: 60,
        rawFields: {
          负责人: raw('王吉祥'),
          CD负责人: raw('其他硬装'),
          VM负责人: raw('范嘉瑞'),
          硬装项目进度: raw('施工图'),
          店铺性质: raw('新店'),
        },
      },
      {
        id: 'project-owner-noise',
        name: '只在项目负责人出现',
        owner: '范嘉瑞',
        cdOwner: '王吉祥',
        vmOwner: '杨锦帆',
        status: '紧急',
        progress: 60,
        rawFields: {
          负责人: raw('范嘉瑞'),
          CD负责人: raw('王吉祥'),
          VM负责人: raw('杨锦帆'),
          硬装项目进度: raw('施工图'),
          店铺性质: raw('新店'),
        },
      },
    ],
  });

  assert.equal(model.ownerPressure[0].name, '范嘉瑞');
  assert.equal(model.ownerPressure[0].projectCount, 2);
  assert.equal(model.ownerPressure[0].loadScore, 100);
  assert.equal(Object.hasOwn(model.ownerPressure[0], 'delayedCount'), false);
  assert.equal(Object.hasOwn(model.ownerPressure[0], 'urgentCount'), false);
  assert.equal(Object.hasOwn(model.ownerPressure[0], 'highRiskCount'), false);
  assert.deepEqual(model.ownerPressure[0].drillFilter, {
    teamProjectOwner: '范嘉瑞',
    excludePaused: '1',
  });
});

test('buildDirectorOverviewModel keeps the soft point stage visible even when empty', () => {
  const model = buildDirectorOverviewModel({
    metrics: { summary: { totalProjects: 1, averageProgress: 55 } },
    projects: [
      {
        id: 'plan-only',
        name: '平面方案店',
        progress: 25,
        rawFields: {
          硬装项目进度: raw('平面方案'),
          软装项目进度: raw('未开始'),
        },
      },
    ],
  });

  const pointStage = model.stageLane.find((stage) => stage.key === 'point');
  assert.equal(pointStage?.label, '点位设计');
  assert.equal(pointStage?.total, 0);
});

test('buildDirectorOverviewModel does not treat completed soft work waiting for purchase as designer delay', () => {
  const softDoneProject = {
    id: 'soft-done-purchase',
    name: '杭州软装已发群店',
    province: '浙江',
    storeStatus: '常规店',
    status: '一般',
    owner: '苏佳蕾',
    vmOwner: '苏佳蕾',
    progress: 90,
    dueDate: '2026-05-10',
    startDate: '2026-03-01',
    isDelayed: true,
    riskLevel: '低',
    rawFields: {
      硬装项目进度: raw('闭环'),
      软装项目进度: raw('待采购'),
      VM负责人: raw('苏佳蕾'),
      软装完成情况: raw('准时完成'),
      软装发项目群时间: raw('2026-05-11'),
      店铺性质: raw('新店'),
    },
  };

  const model = buildDirectorOverviewModel({
    metrics: {
      summary: { totalProjects: 1, delayedProjects: 0, averageProgress: 90 },
      ownerLoad: [{ label: '苏佳蕾', value: 1 }],
      statusCounts: [{ label: '一般', value: 1 }],
    },
    departmentMetrics: {
      scopeCount: 1,
      totals: { openDelayed: 0, inProgress: 0, notStarted: 0 },
    },
    projects: [softDoneProject],
    now: new Date('2026-05-31T00:00:00.000Z'),
  });

  assert.deepEqual(model.riskQueue, []);
  assert.equal(Object.hasOwn(model.ownerPressure[0], 'delayedCount'), false);
});
