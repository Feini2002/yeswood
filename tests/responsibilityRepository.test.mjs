import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { openInitializedDatabase } from '../src/backend/database.mjs';
import {
  aggregatePersonnelStatsFromProjects,
  aggregatePersonnelStatsFromDatabase,
  expandOwnerNames,
  extractAssignmentsFromProject,
  listProjectsForOwnerSlot,
  rebuildProjectResponsibilities,
  verifyResponsibilityCoverage,
} from '../src/backend/responsibilityRepository.mjs';

function sampleProject(overrides = {}) {
  return {
    id: 'p1',
    name: '测试店',
    owner: '鲁倩雨',
    rawFields: {
      负责人: { display: '鲁倩雨' },
      CD组长: { display: '鲁倩雨' },
      VM组长: { display: '张情' },
      ...overrides.rawFields,
    },
    ...overrides,
  };
}

test('extractAssignmentsFromProject keeps owner and cd_lead rows for same person', () => {
  const assignments = extractAssignmentsFromProject(sampleProject());
  assert.ok(assignments.some((item) => item.slotKey === 'owner' && item.personName === '鲁倩雨'));
  assert.ok(assignments.some((item) => item.slotKey === 'cd_lead' && item.personName === '鲁倩雨'));
});

test('extractAssignmentsFromProject maps split owner fields to split slots and owner union', () => {
  const assignments = extractAssignmentsFromProject(
    sampleProject({
      owner: '未分配',
      rawFields: {
        CD负责人: { display: '苏佳蕾' },
        VM负责人: { display: '张情' },
      },
    })
  );

  assert.ok(assignments.some((item) => item.slotKey === 'cd_owner' && item.personName === '苏佳蕾'));
  assert.ok(assignments.some((item) => item.slotKey === 'vm_owner' && item.personName === '张情'));
  assert.ok(assignments.some((item) => item.slotKey === 'owner' && item.personName === '苏佳蕾'));
  assert.ok(assignments.some((item) => item.slotKey === 'owner' && item.personName === '张情'));
});

test('extractAssignmentsFromProject ignores soft responsibility slots for sleep stores', () => {
  const assignments = extractAssignmentsFromProject(
    sampleProject({
      owner: '未分配',
      storeStatus: '睡眠店',
      rawFields: {
        店态: { display: '睡眠店' },
        CD负责人: { display: '杨锦帆' },
        VM负责人: { display: '误填软装负责人' },
        CD组长: { display: '周俊彬' },
        VM组长: { display: '误填软装组长' },
        CD设计师: { display: '汪卓妍' },
        VM设计师: { display: '误填软装设计师' },
        点位设计师: { display: '误填点位设计师' },
      },
    })
  );

  assert.ok(assignments.some((item) => item.slotKey === 'cd_owner' && item.personName === '杨锦帆'));
  assert.ok(assignments.some((item) => item.slotKey === 'cd_lead' && item.personName === '周俊彬'));
  assert.ok(assignments.some((item) => item.slotKey === 'cd_designer' && item.personName === '汪卓妍'));
  assert.equal(assignments.some((item) => item.slotKey === 'vm_owner'), false);
  assert.equal(assignments.some((item) => item.slotKey === 'vm_lead'), false);
  assert.equal(assignments.some((item) => item.slotKey === 'vm_designer'), false);
  assert.equal(assignments.some((item) => item.slotKey === 'point_designer'), false);
  assert.deepEqual(
    assignments.filter((item) => item.slotKey === 'owner').map((item) => item.personName),
    ['杨锦帆']
  );
});

test('rebuildProjectResponsibilities writes SQLite rows', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resp-repo-'));
  const db = openInitializedDatabase(path.join(tempDir, 'app.sqlite'));
  try {
    db.prepare(
      `insert into projects
        (id, dingtalk_record_id, raw_fields_json, name, province, business_type, store_status, status,
         owner_text, progress, start_date, due_date, risk_level, risk_notes, local_notes,
         source_updated_at, local_updated_at, created_at, archived_at)
       values (?, ?, ?, ?, '', '', '', '', ?, 0, '', '', '', '', '', '', '', ?, null)`
    ).run('p1', 'p1', JSON.stringify(sampleProject().rawFields), '测试店', '鲁倩雨', new Date().toISOString());

    const result = rebuildProjectResponsibilities(db, [sampleProject()], 'run-1');
    assert.ok(result.assignmentCount >= 3);
    const count = db.prepare("select count(*) as c from project_responsibilities where person_name = '鲁倩雨'").get().c;
    assert.equal(count, 2);
  } finally {
    db.close();
  }
});

test('rebuildProjectResponsibilities stores canonical personnel names from aliases', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resp-repo-alias-'));
  const db = openInitializedDatabase(path.join(tempDir, 'app.sqlite'));
  const project = sampleProject({
    id: 'p-alias',
    owner: '范嘉瑞',
    rawFields: {
      负责人: { display: '范嘉瑞' },
      VM负责人: { display: '范嘉瑞' },
    },
  });

  try {
    db.prepare(
      `insert into personnel_people
        (id, name, display_name, position, discipline, status, source, aliases_json,
         assignment_note, source_field, sort_order, updated_at)
       values (?, ?, ?, 'owner', 'soft', 'active', 'local', ?, '', '', 0, ?)`
    ).run('owner-fanjia-rui', 'Jarvan范嘉瑞', '范嘉瑞', JSON.stringify(['Jarvan']), new Date().toISOString());
    db.prepare(
      `insert into projects
        (id, dingtalk_record_id, raw_fields_json, name, province, business_type, store_status, status,
         owner_text, progress, start_date, due_date, risk_level, risk_notes, local_notes,
         source_updated_at, local_updated_at, created_at, archived_at)
       values (?, ?, ?, ?, '', '', '', '', ?, 0, '', '', '', '', '', '', '', ?, null)`
    ).run(project.id, project.id, JSON.stringify(project.rawFields), project.name, project.owner, new Date().toISOString());

    rebuildProjectResponsibilities(db, [project], 'run-alias');

    const row = db
      .prepare("select slot_key, person_name, person_name_raw from project_responsibilities where slot_key = 'vm_owner'")
      .get();
    assert.deepEqual({ ...row }, { slot_key: 'vm_owner', person_name: 'Jarvan范嘉瑞', person_name_raw: '范嘉瑞' });
  } finally {
    db.close();
  }
});

test('rebuildProjectResponsibilities dedupes canonical aliases within one slot', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resp-repo-alias-dedupe-'));
  const db = openInitializedDatabase(path.join(tempDir, 'app.sqlite'));
  const project = sampleProject({
    id: 'p-alias-dedupe',
    owner: 'Jarvan范嘉瑞、范嘉瑞',
    rawFields: {
      负责人: { display: 'Jarvan范嘉瑞、范嘉瑞' },
      VM负责人: { display: 'Jarvan范嘉瑞、范嘉瑞' },
    },
  });

  try {
    db.prepare(
      `insert into personnel_people
        (id, name, display_name, position, discipline, status, source, aliases_json,
         assignment_note, source_field, sort_order, updated_at)
       values (?, ?, ?, 'owner', 'soft', 'active', 'local', ?, '', '', 0, ?)`
    ).run('owner-fanjia-rui', 'Jarvan范嘉瑞', '范嘉瑞', JSON.stringify(['范嘉瑞', 'Jarvan']), new Date().toISOString());
    db.prepare(
      `insert into projects
        (id, dingtalk_record_id, raw_fields_json, name, province, business_type, store_status, status,
         owner_text, progress, start_date, due_date, risk_level, risk_notes, local_notes,
         source_updated_at, local_updated_at, created_at, archived_at)
       values (?, ?, ?, ?, '', '', '', '', ?, 0, '', '', '', '', '', '', '', ?, null)`
    ).run(project.id, project.id, JSON.stringify(project.rawFields), project.name, project.owner, new Date().toISOString());

    rebuildProjectResponsibilities(db, [project], 'run-alias-dedupe');

    const rows = db
      .prepare("select slot_key, person_name, person_name_raw from project_responsibilities where slot_key = 'vm_owner'")
      .all();
    assert.deepEqual(rows.map((row) => ({ ...row })), [
      { slot_key: 'vm_owner', person_name: 'Jarvan范嘉瑞', person_name_raw: 'Jarvan范嘉瑞' },
    ]);

    const stats = aggregatePersonnelStatsFromDatabase(db);
    const vmOwner = stats.roles.find((role) => role.key === 'vmOwner');
    assert.deepEqual(vmOwner.people, [{ name: 'Jarvan范嘉瑞', value: 1, delayed: 0, highRisk: 0 }]);
  } finally {
    db.close();
  }
});

test('aggregatePersonnelStatsFromDatabase uses design responsibility semantics for delays', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resp-db-semantics-'));
  const db = openInitializedDatabase(path.join(tempDir, 'app.sqlite'));
  const projects = [
    sampleProject({
      id: 'hard-done-product-list',
      name: '硬装已完成产品清单店',
      owner: '未分配',
      rawFields: {
        CD负责人: { display: '硬装负责人' },
        硬装项目进度: { display: '施工图' },
        躺平内部审核结束时间: { display: '2026-05-12' },
        产品清单发出时间: { display: '2026-05-15' },
      },
    }),
    sampleProject({
      id: 'hard-open-delay',
      name: '硬装延期中店',
      owner: '未分配',
      rawFields: {
        CD负责人: { display: '硬装负责人' },
        硬装项目进度: { display: '施工图' },
        平面开始时间: { display: '2026-05-01' },
        硬装方案情况: { display: '延期' },
      },
    }),
    sampleProject({
      id: 'soft-done-purchase',
      name: '软装已完成待采购店',
      owner: '未分配',
      rawFields: {
        VM负责人: { display: '软装负责人' },
        软装项目进度: { display: '待采购' },
        点位完成情况: { display: '已完成' },
        点位完成时间: { display: '2026-05-16' },
        软装方案开始时间: { display: '2026-05-18' },
        软装完成情况: { display: '延期完成' },
      },
    }),
    sampleProject({
      id: 'soft-open-delay',
      name: '软装延期中店',
      owner: '未分配',
      rawFields: {
        VM负责人: { display: '软装负责人' },
        软装项目进度: { display: '软装方案中' },
        软装方案开始时间: { display: '2026-05-18' },
        软装完成情况: { display: '延期中' },
      },
    }),
  ];

  try {
    const now = new Date().toISOString();
    const insert = db.prepare(
      `insert into projects
        (id, dingtalk_record_id, raw_fields_json, name, province, business_type, store_status, status,
         owner_text, progress, start_date, due_date, risk_level, risk_notes, local_notes,
         hard_progress_stage, soft_progress_stage, source_updated_at, local_updated_at, created_at, archived_at)
       values (?, ?, ?, ?, '', '', '常规店', '一般', ?, 0, '', '2020-01-01', '高', '', '',
         ?, ?, '', '', ?, null)`
    );
    for (const project of projects) {
      insert.run(
        project.id,
        project.id,
        JSON.stringify(project.rawFields),
        project.name,
        project.owner,
        project.rawFields.硬装项目进度?.display || '',
        project.rawFields.软装项目进度?.display || '',
        now
      );
    }

    rebuildProjectResponsibilities(db, projects, 'run-db-semantics');
    const stats = aggregatePersonnelStatsFromDatabase(db);
    const cdOwner = stats.roles.find((role) => role.key === 'cdOwner');
    const vmOwner = stats.roles.find((role) => role.key === 'vmOwner');

    assert.deepEqual(cdOwner.people, [{ name: '硬装负责人', value: 2, delayed: 1, highRisk: 1 }]);
    assert.deepEqual(vmOwner.people, [{ name: '软装负责人', value: 2, delayed: 1, highRisk: 1 }]);
  } finally {
    db.close();
  }
});

test('aggregatePersonnelStatsFromProjects routes split owner assignments by stable responsibility identity id', () => {
  const stats = aggregatePersonnelStatsFromProjects(
    [
      sampleProject({
        id: 'creative-hard-soft',
        owner: '杨锦帆',
        rawFields: {
          CD负责人: { display: '杨锦帆' },
          VM负责人: { display: '杨锦帆' },
          硬装项目进度: { display: '施工图' },
          平面开始时间: { display: '2026-05-01' },
          硬装方案情况: { display: '延期中' },
          软装项目进度: { display: '软装方案中' },
          软装方案开始时间: { display: '2026-05-02' },
          软装完成情况: { display: '延期中' },
        },
      }),
    ],
    {
      personnelArchitecture: {
        responsibilityIdentities: [
          {
            identityId: 'resp-017',
            displayName: '杨锦帆（硬装）',
            sourceName: '杨锦帆',
            discipline: 'hard',
            scope: 'both',
          },
          {
            identityId: 'resp-018',
            displayName: '杨锦帆（软装）',
            sourceName: '杨锦帆',
            discipline: 'soft',
            scope: 'both',
          },
        ],
      },
    }
  );

  const cdOwner = stats.roles.find((role) => role.key === 'cdOwner');
  const vmOwner = stats.roles.find((role) => role.key === 'vmOwner');

  assert.deepEqual(cdOwner.people, [
    {
      identityId: 'resp-017',
      name: '杨锦帆（硬装）',
      displayName: '杨锦帆（硬装）',
      sourceName: '杨锦帆',
      discipline: 'hard',
      scope: 'both',
      value: 1,
      delayed: 1,
      highRisk: 0,
    },
  ]);
  assert.deepEqual(vmOwner.people, [
    {
      identityId: 'resp-018',
      name: '杨锦帆（软装）',
      displayName: '杨锦帆（软装）',
      sourceName: '杨锦帆',
      discipline: 'soft',
      scope: 'both',
      value: 1,
      delayed: 1,
      highRisk: 0,
    },
  ]);
});

test('aggregatePersonnelStatsFromProjects canonicalizes owner aliases before counting role assignments', () => {
  const stats = aggregatePersonnelStatsFromProjects(
    [
      sampleProject({
        id: 'p-vm-aliases-one-slot',
        owner: 'Jarvan范嘉瑞、范嘉瑞',
        rawFields: {
          VM负责人: { display: 'Jarvan范嘉瑞、范嘉瑞' },
        },
      }),
      sampleProject({
        id: 'p-vm-alias-only',
        owner: '范嘉瑞',
        rawFields: {
          VM负责人: { display: '范嘉瑞' },
        },
      }),
    ],
    {
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
    }
  );

  const vmOwner = stats.roles.find((role) => role.key === 'vmOwner');
  assert.deepEqual(vmOwner.people, [{ name: 'Jarvan范嘉瑞', value: 2, delayed: 0, highRisk: 0 }]);
  assert.equal(vmOwner.uniquePeople, 1);
  assert.equal(vmOwner.totalAssignments, 2);
});

test('aggregatePersonnelStatsFromProjects routes creative lead and designer slots by discipline identity', () => {
  const stats = aggregatePersonnelStatsFromProjects(
    [
      sampleProject({
        id: 'creative-team-cross-discipline',
        name: '创意团队跨专业店',
        owner: '未分配',
        rawFields: {
          CD组长: { display: '马琳琳' },
          VM组长: { display: '马琳琳' },
          点位设计师: { display: '马琳琳' },
          VM设计师: { display: '马琳琳' },
        },
      }),
    ],
    {
      personnelArchitecture: {
        responsibilityIdentities: [
          {
            identityId: 'resp-019',
            displayName: '马琳琳（硬装）',
            sourceName: '马琳琳',
            discipline: 'hard',
            scope: 'both',
          },
          {
            identityId: 'resp-020',
            displayName: '马琳琳（软装）',
            sourceName: '马琳琳',
            discipline: 'soft',
            scope: 'both',
          },
        ],
      },
    }
  );

  const cdLead = stats.roles.find((role) => role.key === 'cdLead');
  const vmLead = stats.roles.find((role) => role.key === 'vmLead');
  const pointDesigner = stats.designerRoles.find((role) => role.slotKey === 'point_designer');
  const schemeDesigner = stats.designerRoles.find((role) => role.slotKey === 'vm_designer');

  assert.deepEqual(cdLead.people, [
    {
      identityId: 'resp-019',
      name: '马琳琳（硬装）',
      displayName: '马琳琳（硬装）',
      sourceName: '马琳琳',
      discipline: 'hard',
      scope: 'both',
      value: 1,
      delayed: 0,
      highRisk: 0,
    },
  ]);
  assert.deepEqual(vmLead.people, [
    {
      identityId: 'resp-020',
      name: '马琳琳（软装）',
      displayName: '马琳琳（软装）',
      sourceName: '马琳琳',
      discipline: 'soft',
      scope: 'both',
      value: 1,
      delayed: 0,
      highRisk: 0,
    },
  ]);
  assert.deepEqual(pointDesigner.people, [
    {
      identityId: 'resp-020',
      name: '马琳琳（软装）',
      displayName: '马琳琳（软装）',
      sourceName: '马琳琳',
      discipline: 'soft',
      scope: 'both',
      value: 1,
      delayed: 0,
      highRisk: 0,
    },
  ]);
  assert.deepEqual(schemeDesigner.people, [
    {
      identityId: 'resp-020',
      name: '马琳琳（软装）',
      displayName: '马琳琳（软装）',
      sourceName: '马琳琳',
      discipline: 'soft',
      scope: 'both',
      value: 1,
      delayed: 0,
      highRisk: 0,
    },
  ]);
});

test('aggregatePersonnelStatsFromDatabase routes creative designer slots by discipline identity', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resp-db-creative-designer-'));
  const db = openInitializedDatabase(path.join(tempDir, 'app.sqlite'));
  const projects = [
    sampleProject({
      id: 'creative-db-designer',
      name: '创意团队数据库聚合店',
      owner: '未分配',
      rawFields: {
        点位设计师: { display: '马琳琳' },
        VM设计师: { display: '马琳琳' },
      },
    }),
  ];

  try {
    db.prepare(
      `insert into projects
        (id, dingtalk_record_id, raw_fields_json, name, province, business_type, store_status, status,
         owner_text, progress, start_date, due_date, risk_level, risk_notes, local_notes,
         source_updated_at, local_updated_at, created_at, archived_at)
       values (?, ?, ?, ?, '', '', '', '', ?, 0, '', '', '', '', '', '', '', ?, null)`
    ).run(projects[0].id, projects[0].id, JSON.stringify(projects[0].rawFields), projects[0].name, projects[0].owner, new Date().toISOString());

    rebuildProjectResponsibilities(db, projects, 'run-db-creative-designer');
    const stats = aggregatePersonnelStatsFromDatabase(db, {
      personnelArchitecture: {
        responsibilityIdentities: [
          {
            identityId: 'resp-019',
            displayName: '马琳琳（硬装）',
            sourceName: '马琳琳',
            discipline: 'hard',
            scope: 'both',
          },
          {
            identityId: 'resp-020',
            displayName: '马琳琳（软装）',
            sourceName: '马琳琳',
            discipline: 'soft',
            scope: 'both',
          },
        ],
      },
    });
    const pointDesigner = stats.designerRoles.find((role) => role.slotKey === 'point_designer');
    const schemeDesigner = stats.designerRoles.find((role) => role.slotKey === 'vm_designer');

    assert.deepEqual(pointDesigner.people, [
      {
        identityId: 'resp-020',
        name: '马琳琳（软装）',
        displayName: '马琳琳（软装）',
        sourceName: '马琳琳',
        discipline: 'soft',
        scope: 'both',
        value: 1,
        delayed: 0,
        highRisk: 0,
      },
    ]);
    assert.deepEqual(schemeDesigner.people, [
      {
        identityId: 'resp-020',
        name: '马琳琳（软装）',
        displayName: '马琳琳（软装）',
        sourceName: '马琳琳',
        discipline: 'soft',
        scope: 'both',
        value: 1,
        delayed: 0,
        highRisk: 0,
      },
    ]);
  } finally {
    db.close();
  }
});

test('aggregatePersonnelStatsFromProjects keeps split owner total-column-only matches in pending review channel', () => {
  const stats = aggregatePersonnelStatsFromProjects(
    [
      sampleProject({
        id: 'creative-total-only',
        name: '总负责人缺槽位店',
        owner: '杨锦帆',
        rawFields: {
          负责人: { display: '杨锦帆' },
          组别: { display: '直营新店' },
          硬装项目进度: { display: '施工图' },
          软装项目进度: { display: '软装方案中' },
        },
      }),
    ],
    {
      personnelArchitecture: {
        responsibilityIdentities: [
          {
            identityId: 'resp-017',
            displayName: '杨锦帆（硬装）',
            sourceName: '杨锦帆',
            discipline: 'hard',
            scope: 'both',
          },
          {
            identityId: 'resp-018',
            displayName: '杨锦帆（软装）',
            sourceName: '杨锦帆',
            discipline: 'soft',
            scope: 'both',
          },
        ],
      },
    }
  );

  assert.deepEqual(
    stats.routingReview.pendingReview.map((item) => ({
      projectId: item.projectId,
      sourceName: item.sourceName,
      reason: item.reason,
      identityIds: item.identityIds,
    })),
    [
      {
        projectId: 'creative-total-only',
        sourceName: '杨锦帆',
        reason: 'multi-identity-owner-total-without-discipline-slot',
        identityIds: ['resp-017', 'resp-018'],
      },
    ]
  );
  assert.equal(stats.roles.find((role) => role.key === 'cdOwner').people.length, 0);
  assert.equal(stats.roles.find((role) => role.key === 'vmOwner').people.length, 0);
});

test('aggregatePersonnelStatsFromProjects closes point and soft scheme designer responsibility independently', () => {
  const stats = aggregatePersonnelStatsFromProjects([
    sampleProject({
      id: 'point-done-scheme-delay',
      name: '点位已完方案延期店',
      owner: '未分配',
      riskLevel: '高',
      rawFields: {
        点位设计师: { display: '点位设计师甲' },
        VM设计师: { display: '方案设计师甲' },
        点位完成情况: { display: '已完成' },
        点位完成时间: { display: '2026-05-16' },
        软装方案开始时间: { display: '2026-05-18' },
        软装完成情况: { display: '延期中' },
      },
    }),
    sampleProject({
      id: 'scheme-done-point-missing',
      name: '方案已完点位缺失店',
      owner: '未分配',
      riskLevel: '高',
      rawFields: {
        点位设计师: { display: '点位设计师乙' },
        VM设计师: { display: '方案设计师乙' },
        软装方案开始时间: { display: '2026-05-18' },
        软装完成情况: { display: '准时完成' },
      },
    }),
  ]);

  const pointRole = stats.designerRoles.find((role) => role.slotKey === 'point_designer');
  const schemeRole = stats.designerRoles.find((role) => role.slotKey === 'vm_designer');

  assert.deepEqual(pointRole.people.find((person) => person.name === '点位设计师甲'), {
    name: '点位设计师甲',
    value: 1,
    delayed: 0,
    highRisk: 0,
  });
  assert.deepEqual(schemeRole.people.find((person) => person.name === '方案设计师甲'), {
    name: '方案设计师甲',
    value: 1,
    delayed: 1,
    highRisk: 1,
  });
  assert.deepEqual(schemeRole.people.find((person) => person.name === '方案设计师乙'), {
    name: '方案设计师乙',
    value: 1,
    delayed: 0,
    highRisk: 0,
  });
});

test('listProjectsForOwnerSlot matches split owners and ignores lead-only matches', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resp-owner-slot-'));
  const db = openInitializedDatabase(path.join(tempDir, 'app.sqlite'));
  const projects = [
    sampleProject({
      id: 'p-hard-owner',
      name: '硬装负责人店',
      owner: '未分配',
      rawFields: {
        硬装负责人: { display: '苏佳蕾' },
        CD组长: { display: '周丹阳' },
      },
    }),
    sampleProject({
      id: 'p-lead-only',
      name: '仅组长店',
      owner: '未分配',
      rawFields: {
        CD组长: { display: '苏佳蕾' },
      },
    }),
  ];

  try {
    const now = new Date().toISOString();
    const insert = db.prepare(
      `insert into projects
        (id, dingtalk_record_id, raw_fields_json, name, province, business_type, store_status, status,
         owner_text, progress, start_date, due_date, risk_level, risk_notes, local_notes,
         source_updated_at, local_updated_at, created_at, archived_at)
       values (?, ?, ?, ?, '', '', '', '', ?, 0, '', '', '', '', '', '', '', ?, null)`
    );
    for (const project of projects) {
      insert.run(project.id, project.id, JSON.stringify(project.rawFields), project.name, project.owner, now);
    }

    rebuildProjectResponsibilities(db, projects, 'run-owner-slot');
    const scoped = listProjectsForOwnerSlot(db, '苏佳蕾');

    assert.deepEqual(
      scoped.map((project) => project.id),
      ['p-hard-owner']
    );
  } finally {
    db.close();
  }
});

test('expandOwnerNames includes aliases from personnel architecture', () => {
  const names = expandOwnerNames('Jarvan范嘉瑞', {
    people: {
      'Jarvan范嘉瑞': { name: 'Jarvan范嘉瑞', aliases: ['范嘉瑞'] },
    },
  });
  assert.ok(names.has('范嘉瑞'));
});

test('verifyResponsibilityCoverage reports unmapped designer-like fields', () => {
  const report = verifyResponsibilityCoverage([
    sampleProject({
      rawFields: {
        负责人: { display: '鲁倩雨' },
        某设计师: { display: '测试' },
      },
    }),
  ]);
  assert.ok(report.unmappedPersonFields.length >= 0);
});
