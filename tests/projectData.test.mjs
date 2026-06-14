import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanProjectRecord,
  calculateDashboardMetrics,
  createFieldCatalog,
  enrichProjectsForDisplay,
  filterProjects,
  isValidProjectRecord,
} from '../src/backend/projectData.mjs';

test('cleanProjectRecord maps DingTalk-style fields into readonly dashboard projects', () => {
  const project = cleanProjectRecord({
    recordId: 'rec-1',
    fields: {
      '项目名称': '  杭州湖滨旗舰店  ',
      '省份': '浙江',
      '业态': '旗舰店',
      '店态': '新店',
      '项目状态': '推进中',
      '负责人': '林清',
      '进度': '72%',
      '计划完成日期': '2026-05-20',
      '风险等级': '高',
      '风险说明': '图纸复核中',
      '更新时间': '2026-05-01T08:00:00.000Z',
    },
  });

  assert.equal(project.id, 'rec-1');
  assert.equal(project.name, '杭州湖滨旗舰店');
  assert.equal(project.progress, 72);
  assert.equal(project.isDelayed, true);
  assert.equal(project.riskLevel, '高');
  assert.equal(project.source, 'dingtalk-ai-table');
});

test('cleanProjectRecord exposes hard and soft workflow progress stages separately', () => {
  const project = cleanProjectRecord({
    recordId: 'rec-workflow-stages',
    fields: {
      项目名称: '双进度记录店',
      省份: '浙江',
      业态: '购物中心',
      店态: '常规店',
      项目状态: '一般',
      负责人: '苏佳蕾',
      硬装项目进度: '施工图完成审核',
      软装项目进度: '未安排摆场',
    },
  });

  assert.equal(project.hardProgressStage, '施工图完成审核');
  assert.equal(project.softProgressStage, '未安排摆场');
});

test('enrichProjectsForDisplay attaches unified hard decoration deadline reminders', () => {
  const project = cleanProjectRecord({
    recordId: 'system-deadline-floor',
    fields: {
      项目名称: '系统规则延期平面店',
      省份: '浙江',
      业态: '直营店',
      店态: 'mini店',
      项目状态: '一般',
      负责人: '苏佳蕾',
      CD设计师: '陈晶晶',
      硬装项目进度: '平面方案',
      复尺时间: '2026-06-01',
      面积: '280',
      平面开始时间: '2026-06-02',
      硬装方案情况: '进行中',
    },
  });

  const [enriched] = enrichProjectsForDisplay([project], {}, {
    today: '2026-06-10',
    hardDecorationCalendar: { timezone: 'Asia/Shanghai', holidays: [], workdays: [] },
  });

  assert.equal(enriched.hardDeadline.ruleVersion, 'hard-decoration-deadline-v2026-06-12');
  assert.equal(enriched.hardDeadline.areaBucket.label, 'mini店：≤300㎡');
  assert.equal(enriched.hardDeadline.floorPlan.dueDate, '2026-06-09');
  assert.equal(enriched.hardDeadline.floorPlan.completionStatus, 'delayed_open');
  assert.equal(enriched.hardDeadline.reminder.title, '系统平面 Deadline 已延期');
  assert.deepEqual(
    {
      reminderId: enriched.primaryReminder.reminderId,
      type: enriched.primaryReminder.type,
      label: enriched.primaryReminder.label,
      dueDate: enriched.primaryReminder.dueDate,
      source: enriched.primaryReminder.source,
    },
    {
      reminderId: 'system-deadline-floor:hard:floorPlanDue:overdue',
      type: 'overdue',
      label: '平面超期',
      dueDate: '2026-06-09',
      source: 'system_deadline',
    }
  );
  assert.equal(enriched.reminders.length, 1);
  assert.equal(enriched.reminders[0], enriched.primaryReminder);
});

test('cleanProjectRecord marks missing risk and plan dates as unknown data instead of safe defaults', () => {
  const project = cleanProjectRecord({
    recordId: 'rec-missing-risk-plan',
    fields: {
      项目名称: '缺字段测试店',
      省份: '北京',
      业态: '家居卖场',
      店态: '常规店',
      项目状态: '紧急',
      负责人: '苏佳蕾',
      启动时间: '2026-05-01',
    },
  });

  assert.equal(project.riskLevel, '未知');
  assert.equal(project.scheduleStatus, 'missingDueDate');
  assert.equal(project.isDelayed, false);
});

test('cleanProjectRecord leaves invalid source datetimes empty instead of using now', () => {
  const project = cleanProjectRecord(
    {
      recordId: 'bad-source-date',
      createdTime: '',
      lastModifiedTime: 'not-a-date',
      fields: {
        name: 'Bad Date Store',
        updatedAt: 'also-not-a-date',
      },
    },
    {
      fieldMap: {
        name: 'name',
        updatedAt: 'updatedAt',
      },
    }
  );

  assert.equal(project.recordMeta.createdTime, '');
  assert.equal(project.recordMeta.lastModifiedTime, '');
  assert.equal(project.updatedAt, '');
});

test('cleanProjectRecord still normalizes valid source datetimes', () => {
  const project = cleanProjectRecord(
    {
      recordId: 'valid-source-date',
      createdTime: '2026-03-26T00:00:00.000Z',
      lastModifiedTime: '2026-03-26T08:00:00.000Z',
      fields: {
        name: 'Valid Date Store',
        updatedAt: '2026-03-27T09:30:00.000Z',
      },
    },
    {
      fieldMap: {
        name: 'name',
        updatedAt: 'updatedAt',
      },
    }
  );

  assert.equal(project.recordMeta.createdTime, '2026-03-26T00:00:00.000Z');
  assert.equal(project.recordMeta.lastModifiedTime, '2026-03-26T08:00:00.000Z');
  assert.equal(project.updatedAt, '2026-03-27T09:30:00.000Z');
});

test('cleanProjectRecord calculates delay from raw lifecycle status, not normalized priority status', () => {
  const baseRecord = (status) => ({
    recordId: `status-${status}`,
    fields: {
      name: `Status ${status}`,
      status,
      dueDate: '2000-01-01',
    },
  });
  const fieldMap = {
    name: 'name',
    status: 'status',
    dueDate: 'dueDate',
  };

  assert.equal(cleanProjectRecord(baseRecord('待完成确认'), { fieldMap }).isDelayed, true);
  assert.equal(cleanProjectRecord(baseRecord('非完成'), { fieldMap }).isDelayed, true);
  assert.equal(cleanProjectRecord(baseRecord('完成'), { fieldMap }).isDelayed, false);
  assert.equal(cleanProjectRecord(baseRecord('已完成'), { fieldMap }).isDelayed, false);
  assert.equal(cleanProjectRecord(baseRecord('完成'), { fieldMap }).status, '未设置');
});

test('cleanProjectRecord keeps explicit unknown risk values as unknown', () => {
  const unknownProject = cleanProjectRecord(
    {
      id: 'explicit-unknown-risk',
      fields: {
        风险字段: '未知',
      },
    },
    { fieldMap: { riskLevel: '风险字段' } }
  );
  const unsetProject = cleanProjectRecord(
    {
      id: 'explicit-unset-risk',
      fields: {
        风险字段: '未设置',
      },
    },
    { fieldMap: { riskLevel: '风险字段' } }
  );

  assert.equal(unknownProject.riskLevel, '未知');
  assert.equal(unsetProject.riskLevel, '未知');
});

test('cleanProjectRecord keeps 杨锦帆 hard-owner projects in the hard slot without synthetic soft ownership', () => {
  const project = cleanProjectRecord({
    recordId: 'rec-yang-dual-owner',
    fields: {
      项目名称: '创意负责人规则测试店',
      省份: '广东省',
      业态: '购物中心',
      店态: '黑标店',
      项目状态: '推进中',
      CD负责人: '杨锦帆',
      硬装项目进度: '施工图',
    },
  });

  assert.equal(project.cdOwner, '杨锦帆');
  assert.equal(project.vmOwner, '');
  assert.equal(project.owner, '杨锦帆');
  assert.equal(project.rawFields.VM负责人, undefined);
  assert.deepEqual(project.derivedOwners, {
    ownerResponsibilityRouting: true,
    soleDualOwnerName: '杨锦帆',
    cdOwner: '杨锦帆',
    vmOwner: '',
    owner: '杨锦帆',
    reviewChannel: '',
  });
});

test('cleanProjectRecord preserves explicit VM collaborators without appending 杨锦帆 from hard slot', () => {
  const project = cleanProjectRecord({
    recordId: 'rec-yang-dual-owner-collaborator',
    fields: {
      项目名称: '创意负责人规则测试店',
      省份: '广东省',
      业态: '购物中心',
      店态: '黑标店',
      项目状态: '推进中',
      负责人: '杨晶晶',
      CD负责人: '杨锦帆',
      VM负责人: '杨晶晶',
      硬装项目进度: '施工图',
    },
  });

  assert.equal(project.cdOwner, '杨锦帆');
  assert.equal(project.vmOwner, '杨晶晶');
  assert.equal(project.owner, '杨晶晶、杨锦帆');
  assert.equal(project.rawFields.负责人.display, '杨晶晶');
  assert.equal(project.rawFields.VM负责人.display, '杨晶晶');
  assert.deepEqual(project.derivedOwners, {
    ownerResponsibilityRouting: true,
    soleDualOwnerName: '杨锦帆',
    cdOwner: '杨锦帆',
    vmOwner: '杨晶晶',
    owner: '杨晶晶、杨锦帆',
    reviewChannel: '',
  });
});

test('cleanProjectRecord ignores mistaken soft-owner fields on sleep stores', () => {
  const project = cleanProjectRecord({
    recordId: 'rec-sleep-hard-only-owner',
    fields: {
      项目名称: '睡眠店硬装口径测试店',
      省份: '上海市',
      业态: '家居卖场',
      店态: '睡眠店',
      项目状态: '一般',
      CD负责人: '杨锦帆',
      VM负责人: '误填软装负责人',
      VM组长: '误填软装组长',
      VM设计师: '误填软装设计师',
      硬装项目进度: '施工图',
    },
  });

  assert.equal(project.cdOwner, '杨锦帆');
  assert.equal(project.vmOwner, '');
  assert.equal(project.owner, '杨锦帆');
});

test('sleep store generic owner is treated as hard-decoration owner fallback', () => {
  const project = cleanProjectRecord({
    recordId: 'rec-sleep-generic-owner',
    fields: {
      项目名称: '睡眠店负责人兜底测试店',
      店态: '睡眠店',
      项目状态: '一般',
      负责人: '杨锦帆',
      硬装项目进度: '施工图',
    },
  });

  assert.equal(project.cdOwner, '');
  assert.equal(project.vmOwner, '');
  assert.equal(project.owner, '杨锦帆');
});

test('calculateDashboardMetrics summarizes totals, status, risk, owner load, and trend', () => {
  const projects = [
    {
      id: '1',
      name: 'A',
      status: '推进中',
      owner: '林清',
      province: '浙江',
      businessType: '旗舰店',
      storeStatus: '新店',
      progress: 70,
      dueDate: '2026-05-20',
      updatedAt: '2026-05-01T00:00:00.000Z',
      riskLevel: '高',
      isDelayed: true,
      rawFields: {
        平面开始时间: { display: '2026-05-01' },
        硬装方案情况: { display: '延期' },
      },
    },
    {
      id: '2',
      name: 'B',
      status: '已完成',
      owner: '林清',
      province: '江苏',
      businessType: '社区店',
      storeStatus: '改造',
      progress: 100,
      dueDate: '2026-06-01',
      updatedAt: '2026-06-01T00:00:00.000Z',
      riskLevel: '低',
      isDelayed: false,
    },
    {
      id: '3',
      name: 'C',
      status: '待启动',
      owner: '周燃',
      province: '浙江',
      businessType: '社区店',
      storeStatus: '新店',
      progress: 8,
      dueDate: '2026-07-01',
      updatedAt: '2026-07-01T00:00:00.000Z',
      riskLevel: '中',
      isDelayed: false,
    },
  ];

  const metrics = calculateDashboardMetrics(projects, {
    personnelArchitecture: {
      people: {
        杨晶晶: { discipline: 'hard' },
        张情: { discipline: 'soft' },
      },
    },
  });

  assert.equal(metrics.summary.totalProjects, 3);
  assert.equal(metrics.summary.delayedProjects, 1);
  assert.equal(metrics.summary.planOverdueProjects, 1);
  assert.equal(metrics.summary.missingDueDateProjects, 0);
  assert.equal(metrics.summary.highRiskProjects, 1);
  assert.equal(metrics.summary.averageProgress, 59);
  assert.equal(metrics.summary.activeProjects, 1);
  assert.deepEqual(metrics.statusCounts, [
    { label: '推进中', value: 1 },
  ]);
  assert.deepEqual(metrics.priorityStatusCounts, metrics.statusCounts);
  assert.deepEqual(metrics.ownerLoad[0], { label: '林清', value: 1 });
  assert.deepEqual(metrics.monthlyTrend.map((item) => item.label), ['2026-05', '2026-06', '2026-07']);
});

test('calculateDashboardMetrics dedupes personnel aliases in owner load and owner role options', () => {
  const projects = [
    {
      id: 'owner-alias-both-in-one-field',
      name: '别名同字段店',
      status: '推进中',
      owner: 'Jarvan范嘉瑞、范嘉瑞',
      province: '浙江',
      businessType: '购物中心',
      storeStatus: '常规店',
      progress: 50,
      dueDate: '2026-06-10',
      riskLevel: '低',
      rawFields: {
        负责人: { display: 'Jarvan范嘉瑞、范嘉瑞' },
        VM负责人: { display: 'Jarvan范嘉瑞、范嘉瑞' },
        软装方案开始时间: { display: '2026-06-01' },
        软装完成情况: { display: '进行中' },
      },
    },
    {
      id: 'owner-alias-display-only',
      name: '别名显示店',
      status: '推进中',
      owner: '范嘉瑞',
      province: '江苏',
      businessType: '家居卖场',
      storeStatus: '常规店',
      progress: 40,
      dueDate: '2026-06-11',
      riskLevel: '低',
      rawFields: {
        负责人: { display: '范嘉瑞' },
        VM负责人: { display: '范嘉瑞' },
        软装方案开始时间: { display: '2026-06-02' },
        软装完成情况: { display: '进行中' },
      },
    },
  ];

  const metrics = calculateDashboardMetrics(projects, {
    personnelArchitecture: {
      people: {
        Jarvan范嘉瑞: {
          name: 'Jarvan范嘉瑞',
          displayName: '范嘉瑞',
          aliases: ['范嘉瑞', 'Jarvan'],
          position: 'owner',
          discipline: 'soft',
        },
      },
    },
  });

  const vmOwnerRole = metrics.personnel.roles.find((role) => role.key === 'vmOwner');
  assert.deepEqual(metrics.ownerLoad, [{ label: '范嘉瑞', value: 2 }]);
  assert.deepEqual(vmOwnerRole.people.map(({ name, displayName, value }) => ({ name, displayName, value })), [
    { name: 'Jarvan范嘉瑞', displayName: '范嘉瑞', value: 2 },
  ]);
});

test('calculateDashboardMetrics excludes fully closed design projects from active risk responsibility', () => {
  const projects = [
    {
      id: 'closed-risk',
      name: '北京北四居然店',
      status: '紧急',
      owner: '苏佳蕾',
      province: '北京',
      businessType: '家居卖场',
      storeStatus: '常规店',
      progress: 100,
      dueDate: '2026-05-30',
      updatedAt: '2026-05-30T00:00:00.000Z',
      riskLevel: '高',
      isDelayed: true,
      rawFields: {
        硬装项目进度: { display: '闭环' },
        躺平内部审核结束时间: { display: '2026-05-12' },
        软装项目进度: { display: '闭环' },
        软装完成情况: { display: '准时完成' },
      },
    },
    {
      id: 'open-delay',
      name: '上海待采购店',
      status: '一般',
      owner: '苏佳蕾',
      province: '上海',
      businessType: '家居卖场',
      storeStatus: '常规店',
      progress: 45,
      dueDate: '2026-05-29',
      updatedAt: '2026-05-29T00:00:00.000Z',
      riskLevel: '低',
      isDelayed: true,
      rawFields: {
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-05-01' },
        软装项目进度: { display: '待采购' },
        硬装方案情况: { display: '延期' },
      },
    },
    {
      id: 'soft-done-purchase-waiting',
      name: '杭州软装已完成待采购店',
      status: '一般',
      owner: '苏佳蕾',
      province: '浙江',
      businessType: '家居卖场',
      storeStatus: '常规店',
      progress: 90,
      dueDate: '2026-05-15',
      updatedAt: '2026-05-29T00:00:00.000Z',
      riskLevel: '低',
      isDelayed: true,
      rawFields: {
        硬装项目进度: { display: '闭环' },
        躺平内部审核结束时间: { display: '2026-05-12' },
        软装项目进度: { display: '待采购' },
        软装完成情况: { display: '准时完成' },
      },
    },
  ];

  const metrics = calculateDashboardMetrics(projects);

  assert.equal(metrics.summary.totalProjects, 3);
  assert.equal(metrics.summary.activeProjects, 2);
  assert.equal(metrics.summary.delayedProjects, 1);
  assert.equal(metrics.summary.planOverdueProjects, 2);
  assert.equal(metrics.summary.highRiskProjects, 0);
  assert.deepEqual(metrics.riskProjects.map((project) => project.id), ['open-delay']);
  assert.deepEqual(metrics.statusCounts, [{ label: '一般', value: 2 }]);
  assert.deepEqual(metrics.ownerLoad, [{ label: '苏佳蕾', value: 2 }]);
});

test('calculateDashboardMetrics uses design responsibility completion instead of company workflow closure', () => {
  const hardDoneCompanyActive = {
    id: 'hard-done-company-active',
    name: '硬装已完成但公司未闭环',
    status: '一般',
    riskLevel: '高',
    storeStatus: '常规店',
    businessType: '购物中心',
    owner: '硬装负责人',
    rawFields: {
      硬装项目进度: { display: '施工图' },
      躺平内部审核结束时间: { display: '2026-05-12' },
      产品清单发出时间: { display: '2026-05-15' },
    },
  };
  const softDoneCompanyActive = {
    id: 'soft-done-company-active',
    name: '软装已完成但公司未闭环',
    status: '一般',
    riskLevel: '高',
    storeStatus: '常规店',
    businessType: '购物中心',
    owner: '软装负责人',
    rawFields: {
      软装项目进度: { display: '待采购' },
      点位完成情况: { display: '已完成' },
      点位完成时间: { display: '2026-05-16' },
      软装方案开始时间: { display: '2026-05-18' },
      软装完成情况: { display: '延期完成' },
    },
  };
  const softDelayedOpen = {
    id: 'soft-delayed-open',
    name: '软装延期中',
    status: '一般',
    riskLevel: '低',
    storeStatus: '常规店',
    businessType: '购物中心',
    owner: '软装负责人',
    rawFields: {
      软装项目进度: { display: '软装方案中' },
      软装方案开始时间: { display: '2026-05-18' },
      软装完成情况: { display: '延期中' },
    },
  };

  const metrics = calculateDashboardMetrics([hardDoneCompanyActive, softDoneCompanyActive, softDelayedOpen]);

  assert.equal(metrics.summary.totalProjects, 3);
  assert.equal(metrics.summary.activeProjects, 2);
  assert.equal(metrics.summary.delayedProjects, 1);
  assert.equal(metrics.summary.highRiskProjects, 1);
  assert.deepEqual(metrics.riskProjects.map((project) => project.id), ['hard-done-company-active', 'soft-delayed-open']);
  assert.deepEqual(
    filterProjects([hardDoneCompanyActive, softDoneCompanyActive, softDelayedOpen], { activeResponsibility: '1' }).map(
      (project) => project.id
    ),
    ['hard-done-company-active', 'soft-delayed-open']
  );
});

test('cleanProjectRecord attaches explainable project difficulty for downstream load metrics', () => {
  const project = cleanProjectRecord(
    {
      recordId: 'rec-difficulty',
      fields: {
        项目名称: '烟台莱山万象店',
        省份: '山东省',
        业态: '购物中心',
        店态: '常规店',
        项目状态: '一般',
        负责人: '苏佳蕾',
        组别: '直营新店',
        店铺性质: '新店',
        面积: '700㎡',
        硬装项目进度: '施工图',
        软装项目进度: '软装方案中',
      },
    },
    {
      fieldMap: {
        name: '项目名称',
        province: '省份',
        businessType: '业态',
        storeStatus: '店态',
        status: '项目状态',
        owner: '负责人',
      },
    }
  );

  assert.equal(project.difficultyScore, 46);
  assert.equal(project.difficultyLevel, '难');
  assert.equal(project.difficultyWeight, 2.1);
  assert.equal(project.difficulty.hard.workdays, 27.3);
  assert.equal(project.difficulty.soft.workdays, 18.9);
  assert.deepEqual(project.difficulty.components.map((item) => item.ruleKey), [
    'direct-hard-regular',
    'direct-soft-regular',
  ]);
});

test('calculateDashboardMetrics groups personnel into architecture role lists', () => {
  const projects = [
    {
      id: '1',
      name: 'A',
      status: '推进中',
      owner: '陈立营、Jarvan范嘉瑞',
      province: '浙江省',
      businessType: '购物中心',
      storeStatus: '常规店',
      progress: 70,
      dueDate: '2026-05-20',
      updatedAt: '2026-05-01T00:00:00.000Z',
      riskLevel: '高',
      isDelayed: true,
      rawFields: {
        平面开始时间: { display: '2026-05-01' },
        硬装方案情况: { display: '延期' },
        负责人: { display: '陈立营、Jarvan范嘉瑞' },
        CD负责人: { display: '陈立营' },
        VM负责人: { display: 'Jarvan范嘉瑞' },
        CD组长: { display: '陈立营、杨晶晶' },
        CD设计师: { display: '鲁倩雨、杨晶晶' },
        VM组长: { display: '张情、Jarvan范嘉瑞' },
        VM设计师: { display: '甄普' },
        点位设计师: { display: '于雨' },
      },
    },
    {
      id: '2',
      name: 'B',
      status: '一般',
      owner: '陈立营、Jarvan范嘉瑞',
      province: '江苏省',
      businessType: '家居卖场',
      storeStatus: '常规店',
      progress: 45,
      dueDate: '2026-06-01',
      updatedAt: '2026-05-02T00:00:00.000Z',
      riskLevel: '低',
      isDelayed: false,
      rawFields: {
        负责人: { display: '陈立营、Jarvan范嘉瑞' },
        CD负责人: { display: '陈立营' },
        VM负责人: { display: 'Jarvan范嘉瑞' },
        CD组长: { display: '杨晶晶' },
        CD设计师: { display: '鲁倩雨' },
        摆场设计师: { display: '苏佳蕾' },
      },
    },
  ];

  const metrics = calculateDashboardMetrics(projects, {
    personnelArchitecture: {
      people: {
        Jarvan范嘉瑞: { position: 'owner', discipline: 'soft', displayName: '范嘉瑞' },
        杨晶晶: { discipline: 'hard' },
        张情: { discipline: 'soft' },
      },
    },
  });

  assert.equal(metrics.personnel.summary.uniquePeople, 4);
  assert.equal(metrics.personnel.summary.roleCount, 4);
  assert.deepEqual(
    metrics.personnel.roles.map((role) => role.label),
    ['硬装负责人', '软装负责人', '硬装组长', '软装组长']
  );
  assert.deepEqual(metrics.personnel.roles[0].topPeople, [
    { name: '陈立营', value: 2, delayed: 1, highRisk: 1 },
  ]);
  assert.deepEqual(metrics.personnel.roles[1].topPeople, [
    {
      name: 'Jarvan范嘉瑞',
      displayName: '范嘉瑞',
      value: 2,
      delayed: 0,
      highRisk: 0,
      discipline: 'soft',
      disciplineLabel: '软装',
      position: 'owner',
      positionLabel: '负责人',
      category: 'ownerSoft',
      categoryLabel: '软装负责人',
    },
  ]);
  assert.deepEqual(metrics.personnel.roles[0].people, [
    { name: '陈立营', value: 2, delayed: 1, highRisk: 1 },
  ]);
  assert.deepEqual(metrics.personnel.roles[1].people, [
    {
      name: 'Jarvan范嘉瑞',
      displayName: '范嘉瑞',
      value: 2,
      delayed: 0,
      highRisk: 0,
      discipline: 'soft',
      disciplineLabel: '软装',
      position: 'owner',
      positionLabel: '负责人',
      category: 'ownerSoft',
      categoryLabel: '软装负责人',
    },
  ]);
  assert.deepEqual(metrics.personnel.roles[2].people, [
    { name: '杨晶晶', value: 2, delayed: 1, highRisk: 1, discipline: 'hard', disciplineLabel: '硬装' },
    { name: '陈立营', value: 1, delayed: 1, highRisk: 1 },
  ]);
  assert.deepEqual(metrics.personnel.roles[3].people, [
    { name: '张情', value: 1, delayed: 0, highRisk: 0, discipline: 'soft', disciplineLabel: '软装' },
    {
      name: 'Jarvan范嘉瑞',
      displayName: '范嘉瑞',
      value: 1,
      delayed: 0,
      highRisk: 0,
      discipline: 'soft',
      disciplineLabel: '软装',
      position: 'owner',
      positionLabel: '负责人',
      category: 'ownerSoft',
      categoryLabel: '软装负责人',
    },
  ]);
  assert.equal(metrics.personnel.roles[2].people.some((person) => person.name === '陈立营'), true);
  assert.equal(metrics.personnel.roles[3].people.some((person) => person.name === 'Jarvan范嘉瑞'), true);
  assert.equal(Object.hasOwn(metrics.personnel, 'ownerHierarchy'), false);
});

test('calculateDashboardMetrics personnel lists follow dingtalk columns not local role groups', () => {
  const projects = [
    {
      id: '1',
      name: 'A',
      status: '推进中',
      owner: '陈立营',
      province: '浙江省',
      businessType: '购物中心',
      storeStatus: '常规店',
      progress: 70,
      dueDate: '2026-05-20',
      updatedAt: '2026-05-01T00:00:00.000Z',
      riskLevel: '低',
      isDelayed: false,
      rawFields: {
        负责人: { display: '陈立营' },
        CD组长: { display: '陈菲菲、马琳琳' },
        VM组长: { display: '张情、马琳琳' },
        CD设计师: { display: '李爽' },
        VM设计师: { display: '甄普' },
      },
    },
  ];

  const metrics = calculateDashboardMetrics(projects, {
    personnelArchitecture: {
      people: [
        { name: '陈立营', position: 'owner', discipline: 'hard', status: 'active' },
        { name: '陈菲菲', position: 'lead', discipline: 'hard', status: 'active' },
        { name: '张情', position: 'lead', discipline: 'soft', status: 'active' },
        { name: '马琳琳', position: 'lead', discipline: 'both', status: 'active' },
      ],
      teams: [{ owner: '陈立营', cdLeads: [], vmLeads: [] }],
      roleGroups: {
        cdLead: { position: 'lead', discipline: 'hard', people: ['陈菲菲'] },
        creativeLead: { position: 'lead', discipline: 'both', people: ['马琳琳'] },
        vmLead: { position: 'lead', discipline: 'soft', people: ['张情'] },
      },
    },
  });

  const cdLead = metrics.personnel.roles.find((role) => role.key === 'cdLead');
  const vmLead = metrics.personnel.roles.find((role) => role.key === 'vmLead');

  assert.deepEqual(
    cdLead.people.map((person) => person.name).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    ['陈菲菲', '马琳琳（硬装）']
  );
  assert.equal(vmLead.people.length, 2);
  assert.ok(vmLead.people.some((person) => person.name === '张情'));
  assert.ok(vmLead.people.some((person) => person.name === '马琳琳（软装）'));
  assert.equal(metrics.personnel.roles.some((role) => role.key === 'cdDesigner'), false);
  assert.equal(metrics.personnel.roles.some((role) => role.key === 'vmDesigner'), false);
});

test('filterProjects supports search, province, business type, and store status', () => {
  const projects = [
    { id: '1', name: '杭州湖滨旗舰店', owner: '林清', province: '浙江', businessType: '旗舰店', storeStatus: '新店' },
    { id: '2', name: '南京社区店', owner: '周燃', province: '江苏', businessType: '社区店', storeStatus: '改造' },
  ];

  const result = filterProjects(projects, {
    search: '湖滨',
    province: '浙江',
    businessType: '旗舰店',
    storeStatus: '新店',
  });

  assert.deepEqual(result.map((project) => project.id), ['1']);
});

test('filterProjects matches province display aliases used by the frontend matrix', () => {
  const projects = [
    { id: 'gx-short', name: '广西短名店', province: '广西省' },
    { id: 'gx-full', name: '广西全称店', province: '广西壮族自治区' },
    { id: 'nm-short', name: '内蒙古短名店', province: '内蒙古' },
    { id: 'nm-full', name: '内蒙古全称店', province: '内蒙古自治区' },
    { id: 'xj-short', name: '新疆短名店', province: '新疆省' },
    { id: 'xj-full', name: '新疆全称店', province: '新疆维吾尔自治区' },
  ];

  assert.deepEqual(
    filterProjects(projects, { province: '广西省' }).map((project) => project.id),
    ['gx-short', 'gx-full']
  );
  assert.deepEqual(
    filterProjects(projects, { province: '内蒙古' }).map((project) => project.id),
    ['nm-short', 'nm-full']
  );
  assert.deepEqual(
    filterProjects(projects, { province: '新疆省' }).map((project) => project.id),
    ['xj-short', 'xj-full']
  );
});

test('filterProjects applies dashboard drill owner, tier, and metric filters', () => {
  const projects = [
    {
      id: 'in-progress-regular',
      name: '常规推进店',
      owner: '王吉祥',
      storeStatus: '常规店',
      rawFields: {
        负责人: { display: '王吉祥' },
        店态: { display: '常规店' },
        硬装项目进度: { display: '施工图' },
        软装项目进度: { display: '未开始' },
      },
    },
    {
      id: 'not-started-regular',
      name: '常规未开始店',
      owner: '王吉祥',
      storeStatus: '常规店',
      rawFields: {
        负责人: { display: '王吉祥' },
        店态: { display: '常规店' },
        硬装项目进度: { display: '未开始' },
        软装项目进度: { display: '未开始' },
      },
    },
    {
      id: 'in-progress-sinking',
      name: '下沉推进店',
      owner: '王吉祥',
      storeStatus: '下沉店',
      rawFields: {
        负责人: { display: '王吉祥' },
        店态: { display: '下沉店' },
        硬装项目进度: { display: '施工图' },
        软装项目进度: { display: '未开始' },
      },
    },
    {
      id: 'other-owner-regular',
      name: '他人常规推进店',
      owner: '李清',
      storeStatus: '常规店',
      rawFields: {
        负责人: { display: '李清' },
        店态: { display: '常规店' },
        硬装项目进度: { display: '施工图' },
        软装项目进度: { display: '未开始' },
      },
    },
  ];

  const result = filterProjects(projects, {
    owner: '王吉祥',
    search: '王吉祥',
    tier: 'regular',
    storeStatus: '常规店',
    metric: 'inProgress',
  });

  assert.deepEqual(result.map((project) => project.id), ['in-progress-regular']);
});

test('filterProjects can exclude paused projects for active dashboard drill counts', () => {
  const projects = [
    {
      id: 'active-premium',
      name: '高标推进店',
      storeStatus: '高标店',
      rawFields: {
        店态: { display: '高标店' },
        硬装项目进度: { display: '施工图' },
        软装项目进度: { display: '待采购' },
      },
    },
    {
      id: 'paused-premium',
      name: '高标暂停店',
      storeStatus: '高标店',
      rawFields: {
        店态: { display: '高标店' },
        硬装项目进度: { display: '暂停' },
        软装项目进度: { display: '暂停' },
      },
    },
  ];

  const result = filterProjects(projects, {
    tier: 'premium',
    metric: 'projectCount',
    storeStatus: '高标店',
    excludePaused: '1',
  });

  assert.deepEqual(result.map((project) => project.id), ['active-premium']);
});

test('filterProjects drills collaborator responsibility fields without matching owner text', () => {
  const fields = {
    owner: '\u8d1f\u8d23\u4eba',
    cdLead: 'CD\u7ec4\u957f',
    cdDesigner: 'CD\u8bbe\u8ba1\u5e08',
    vmDesigner: 'VM\u8bbe\u8ba1\u5e08',
  };
  const projects = [
    {
      id: 'owner-only',
      name: 'Owner only',
      owner: 'Lu',
      rawFields: {
        [fields.owner]: { display: 'Lu' },
        [fields.cdDesigner]: { display: 'Other' },
      },
    },
    {
      id: 'hard-designer',
      name: 'Hard designer',
      owner: 'Lu',
      rawFields: {
        [fields.owner]: { display: 'Lu' },
        [fields.cdDesigner]: { display: 'Lu' },
      },
    },
    {
      id: 'hard-lead',
      name: 'Hard lead',
      owner: 'Lu',
      rawFields: {
        [fields.owner]: { display: 'Lu' },
        [fields.cdLead]: { display: 'Lu' },
      },
    },
    {
      id: 'soft-designer',
      name: 'Soft designer',
      owner: 'Lu',
      rawFields: {
        [fields.owner]: { display: 'Lu' },
        [fields.vmDesigner]: { display: 'Lu' },
      },
    },
  ];

  const result = filterProjects(
    projects,
    {
      owner: 'Lu',
      collaborator: 'Lu',
      collaborationDiscipline: 'hard',
    },
    {
      personnelArchitecture: {
        people: [{ name: 'Lu', position: 'owner', discipline: 'hard', status: 'active' }],
      },
    }
  );

  assert.deepEqual(result.map((project) => project.id), ['hard-designer', 'hard-lead']);
});

test('cleanProjectRecord supports DingTalk timestamps, object selects, arrays, and metadata update time', () => {
  const project = cleanProjectRecord(
    {
      id: 'real-1',
      lastModifiedTime: 1771862400000,
      fields: {
        '项目名称（不要自己添加任何项目）': '真实项目',
        '省份': '浙江',
        '业态': { name: '旗舰店', id: 'opt-1' },
        '店态': { name: '新店', id: 'opt-2' },
        '项目状态': { name: '推进中', id: 'opt-3' },
        '负责人': [{ name: '林清', id: 'u1' }],
        '硬装项目进度': { name: '75%', id: 'opt-4' },
        '启动时间': 1764547200000,
        '计划开业时间': 1774454400000,
      },
    },
    {
      fieldMap: {
        name: '项目名称（不要自己添加任何项目）',
        progress: '硬装项目进度',
        startDate: '启动时间',
        dueDate: '计划开业时间',
      },
    }
  );

  assert.equal(project.name, '真实项目');
  assert.equal(project.businessType, '旗舰店');
  assert.equal(project.owner, '林清');
  assert.equal(project.progress, 75);
  assert.equal(project.startDate, '2025-12-01');
  assert.equal(project.dueDate, '2026-03-26');
  assert.equal(project.updatedAt, '2026-02-23T16:00:00.000Z');
});

test('cleanProjectRecord supports second-level DingTalk update timestamps', () => {
  const project = cleanProjectRecord(
    {
      id: 'second-level-updated-at',
      fields: {
        更新时间: 1771862400,
      },
    },
    { fieldMap: { updatedAt: '更新时间' } }
  );

  assert.equal(project.updatedAt, '2026-02-23T16:00:00.000Z');
});

test('cleanProjectRecord keeps DingTalk date timestamps on the China-local calendar day', () => {
  const project = cleanProjectRecord(
    {
      id: 'china-date-1',
      fields: {
        '项目名称（不要自己添加任何项目）': '兰州城关红星1号店',
        '启动时间': 1779984000000,
        '计划开业时间': 1785340800000,
      },
    },
    {
      fieldMap: {
        name: '项目名称（不要自己添加任何项目）',
        startDate: '启动时间',
        dueDate: '计划开业时间',
      },
    }
  );

  assert.equal(project.startDate, '2026-05-29');
  assert.equal(project.dueDate, '2026-07-30');
  assert.equal(project.rawFields['启动时间'].display, '2026-05-29');
  assert.equal(project.rawFields['计划开业时间'].display, '2026-07-30');
});

test('cleanProjectRecord estimates progress from real DingTalk stage names', () => {
  const project = cleanProjectRecord(
    {
      id: 'real-2',
      fields: {
        '项目名称': '阶段项目',
        '项目状态': '推进中',
        '硬装项目进度': { name: '摆场', id: 'stage-1' },
      },
    },
    {
      fieldMap: {
        progress: '硬装项目进度',
      },
    }
  );

  assert.equal(project.progress, 90);
});

test('cleanProjectRecord keeps original DingTalk fields with readable values', () => {
  const project = cleanProjectRecord({
    id: 'raw-1',
    fields: {
      '项目名称（不要自己添加任何项目）': '真实项目',
      '业态': { name: '旗舰店', id: 'opt-1' },
      '负责人': [{ name: '林清', id: 'u1' }, { name: '周燃', id: 'u2' }],
      '躺平链接': { text: '查看方案', link: 'https://example.test/item' },
      '计划开业时间': 1774454400000,
      '空字段': null,
    },
  });

  assert.equal(project.rawFields['项目名称（不要自己添加任何项目）'].display, '真实项目');
  assert.equal(project.rawFields['业态'].display, '旗舰店');
  assert.deepEqual(project.rawFields['业态'].rawValue, { name: '旗舰店', id: 'opt-1' });
  assert.equal(project.rawFields['负责人'].display, '林清、周燃');
  assert.deepEqual(project.rawFields['负责人'].rawValue, [{ name: '林清', id: 'u1' }, { name: '周燃', id: 'u2' }]);
  assert.equal(project.rawFields['躺平链接'].display, '查看方案 (https://example.test/item)');
  assert.equal(project.rawFields['计划开业时间'].display, '2026-03-26');
  assert.equal(project.rawFields['计划开业时间'].rawValue, 1774454400000);
  assert.equal(project.rawFields['空字段'].display, '');
  assert.equal(project.rawFields['空字段'].rawValue, null);
});

test('cleanProjectRecord filters asset and note fields without dropping business note fields', () => {
  const project = cleanProjectRecord({
    id: 'raw-filter-notes',
    fields: {
      项目名称: '过滤字段店',
      硬装资料: 'hard docs',
      软装资料: 'soft docs',
      备注: '{"markdown":"**CD**"}',
      特殊备注: '仍可检索',
      '平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）': '2026-04-10',
    },
  });

  assert.equal(project.rawFields.硬装资料, undefined);
  assert.equal(project.rawFields.软装资料, undefined);
  assert.equal(project.rawFields.备注, undefined);
  assert.equal(project.rawFields.特殊备注.display, '仍可检索');
  assert.equal(project.rawFields['平面开始时间（二次设计备注好，然后以第二次为准，第一次时间写备注）'].display, '2026-04-10');
});

test('createFieldCatalog summarizes original DingTalk fields for frontend columns', () => {
  const projects = [
    cleanProjectRecord({ id: '1', fields: { A: 'x', B: { name: '选项' } } }),
    cleanProjectRecord({ id: '2', fields: { A: '', C: [{ name: '人' }] } }),
  ];

  assert.deepEqual(createFieldCatalog(projects), [
    { key: 'A', label: 'A', kind: 'string', nonEmpty: 1 },
    { key: 'B', label: 'B', kind: 'object', nonEmpty: 1 },
    { key: 'C', label: 'C', kind: 'array', nonEmpty: 1 },
  ]);
});

test('filterProjects searches original DingTalk field values', () => {
  const projects = [
    cleanProjectRecord({ id: '1', fields: { '项目名称': 'A', '特殊备注': '设计复核中' } }),
    cleanProjectRecord({ id: '2', fields: { '项目名称': 'B', '特殊备注': '正常' } }),
  ];

  assert.deepEqual(filterProjects(projects, { search: '复核' }).map((project) => project.id), ['1']);
});

test('filterProjects team project owner drill matches CD and VM owner columns only', () => {
  const projects = [
    cleanProjectRecord({
      id: 'owner-hit',
      fields: {
        项目名称: '负责人命中',
        负责人: '范嘉瑞',
        组别: '加盟新店',
        硬装项目进度: '施工图',
      },
    }),
    cleanProjectRecord({
      id: 'cd-hit',
      fields: {
        项目名称: '硬装命中',
        负责人: '其他人',
        CD负责人: '范嘉瑞',
        组别: '加盟新店',
        硬装项目进度: '施工图',
      },
    }),
    cleanProjectRecord({
      id: 'vm-hit',
      fields: {
        项目名称: '软装命中',
        负责人: '其他人',
        VM负责人: '范嘉瑞',
        组别: '加盟新店',
        硬装项目进度: '施工图',
      },
    }),
    cleanProjectRecord({
      id: 'remark-noise',
      fields: {
        项目名称: '备注噪声',
        负责人: '其他人',
        组别: '加盟新店',
        特殊备注: '范嘉瑞协助看过一次',
        硬装项目进度: '施工图',
      },
    }),
    cleanProjectRecord({
      id: 'direct-out-of-profile',
      fields: {
        项目名称: '直营不属于当前口径',
        负责人: '其他人',
        CD负责人: '范嘉瑞',
        组别: '直营新店',
        硬装项目进度: '施工图',
      },
    }),
  ];

  assert.deepEqual(
    filterProjects(projects, {
      teamProjectOwner: '范嘉瑞',
      profile: 'franchise',
      excludePaused: '1',
    }).map((project) => project.id),
    ['cd-hit', 'vm-hit']
  );
});

test('isValidProjectRecord rejects rows with a name but too few core fields', () => {
  const fieldMap = {
    name: '项目名称（不要自己添加任何项目）',
    province: '省份',
    businessType: '业态',
    storeStatus: '店态',
    owner: '负责人',
    startDate: '启动时间',
    dueDate: '计划开业时间',
  };

  assert.equal(
    isValidProjectRecord(
      {
        fields: {
          '项目名称（不要自己添加任何项目）': '太原万柏林七美店',
          组别: { name: '加盟老店' },
          店态: { name: '高标店' },
          业态: { name: '家居卖场' },
          省份: '陕西省',
          面积: 450,
          启动时间: 1771862400000,
          计划开业时间: 1782777600000,
        },
      },
      { fieldMap }
    ),
    true
  );

  assert.equal(
    isValidProjectRecord(
      {
        fields: {
          '项目名称（不要自己添加任何项目）': '太原万柏林七美店',
          软装项目进度: { name: '未开始' },
        },
      },
      { fieldMap }
    ),
    false
  );

  assert.equal(
    isValidProjectRecord(
      {
        fields: {
          负责人: [{ name: '苏佳蕾' }],
          店态: { name: '常规店' },
        },
      },
      { fieldMap }
    ),
    false
  );
});
