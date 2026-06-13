import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { openInitializedDatabase } from '../src/backend/database.mjs';
import {
  databaseHasProjects,
  importSnapshotToDatabase,
  readSnapshotFromDatabase,
} from '../src/backend/projectRepository.mjs';
import { readPersonnelArchitectureFromDatabase, seedPersonnelDatabase } from '../src/backend/personnelRepository.mjs';
import { createProjectSnapshot } from '../src/backend/syncService.mjs';

const fieldMap = {
  name: '项目名称',
  province: '省份',
  businessType: '业态',
  storeStatus: '店态',
  status: '项目状态',
  owner: '负责人',
  progress: '硬装项目进度',
  startDate: '启动时间',
  dueDate: '计划开业时间',
};

async function createTempDatabase() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-project-repo-'));
  return openInitializedDatabase(path.join(tempDir, 'app.sqlite'));
}

function createSnapshot(records) {
  return createProjectSnapshot({
    source: 'dingtalk',
    fieldMap,
    personnelArchitecture: {
      roleDisciplines: {
        cdLead: 'hard',
        vmLead: 'soft',
      },
    },
    records,
  });
}

test('importSnapshotToDatabase stores raw rows, final projects, metrics, filters, and field catalog', async () => {
  const db = await createTempDatabase();
  const snapshot = createSnapshot([
    {
      recordId: 'rec-1',
      createdTime: 1764547200000,
      lastModifiedTime: 1771862400000,
      fields: {
        项目名称: '杭州湖滨店',
        省份: '浙江省',
        业态: '购物中心',
        店态: '常规店',
        项目状态: '推进中',
        负责人: '陈立营',
        硬装项目进度: '75%',
        启动时间: 1764547200000,
        计划开业时间: 1774454400000,
        CD组长: '张宸瑞',
      },
    },
    {
      recordId: 'rec-2',
      createdTime: 1764547200000,
      lastModifiedTime: 1771948800000,
      fields: {
        项目名称: '南京社区店',
        省份: '江苏省',
        业态: '社区店',
        店态: '新店',
        项目状态: '已完成',
        负责人: '苏佳蕾',
        硬装项目进度: '闭环',
        启动时间: 1764547200000,
        计划开业时间: 1774454400000,
        CD组长: '周丹阳',
      },
    },
  ]);

  importSnapshotToDatabase(db, snapshot);

  assert.equal(databaseHasProjects(db), true);
  assert.equal(db.prepare('select count(*) as count from sync_runs').get().count, 1);
  assert.equal(db.prepare('select count(*) as count from dingtalk_raw_records').get().count, 2);
  assert.equal(db.prepare('select count(*) as count from projects').get().count, 2);

  const sqliteSnapshot = readSnapshotFromDatabase(db, { personnelArchitecture: snapshot.personnelArchitecture });

  assert.equal(sqliteSnapshot.storage, 'sqlite');
  assert.equal(sqliteSnapshot.databaseReady, true);
  assert.equal(sqliteSnapshot.totalRecords, 2);
  assert.deepEqual(sqliteSnapshot.projects.map((project) => project.name), ['杭州湖滨店', '南京社区店']);
  assert.equal(sqliteSnapshot.metrics.summary.totalProjects, 2);
  assert.ok(sqliteSnapshot.filters.provinces.includes('浙江省'));
  assert.ok(sqliteSnapshot.fieldCatalog.some((field) => field.key === '项目名称'));
  db.close();
});

test('importSnapshotToDatabase persists project difficulty score and seeded SQL rules', async () => {
  const db = await createTempDatabase();
  const snapshot = createProjectSnapshot({
    source: 'dingtalk',
    fieldMap: {
      name: '项目名称',
      province: '省份',
      businessType: '业态',
      storeStatus: '店态',
      status: '项目状态',
      owner: '负责人',
      startDate: '启动时间',
      dueDate: '计划开业时间',
    },
    records: [
      {
        recordId: 'rec-difficulty-sql',
        fields: {
          项目名称: '烟台莱山万象店',
          省份: '山东省',
          业态: '购物中心',
          店态: '常规店',
          项目状态: '一般',
          负责人: '苏佳蕾',
          启动时间: '2026-01-01',
          计划开业时间: '2026-03-01',
          组别: '直营新店',
          店铺性质: '新店',
          面积: '700㎡',
          硬装项目进度: '施工图',
          软装项目进度: '软装方案中',
        },
      },
    ],
  });

  importSnapshotToDatabase(db, snapshot);

  const row = db.prepare('select difficulty_score, difficulty_level, difficulty_weight, difficulty_json from projects').get();
  const ruleCount = db.prepare('select count(*) as count from project_difficulty_rules').get().count;
  const sqliteSnapshot = readSnapshotFromDatabase(db);

  assert.equal(ruleCount >= 13, true);
  assert.equal(row.difficulty_score, 46);
  assert.equal(row.difficulty_level, '难');
  assert.equal(row.difficulty_weight, 2.1);
  assert.match(row.difficulty_json, /direct-hard-regular/);
  assert.equal(sqliteSnapshot.projects[0].difficultyScore, 46);
  assert.equal(sqliteSnapshot.projects[0].difficulty.level, '难');
  assert.equal(sqliteSnapshot.projects[0].difficulty.hard.workdays, 27.3);
  db.close();
});

test('importSnapshotToDatabase stores split owner columns on projects table', async () => {
  const db = await createTempDatabase();
  const snapshot = createSnapshot([
    {
      recordId: 'rec-split-owner-columns',
      fields: {
        项目名称: '拆分负责人主表测试店',
        省份: '浙江省',
        业态: '购物中心',
        店态: '常规店',
        项目状态: '推进中',
        CD负责人: '苏佳蕾',
        VM负责人: '张情',
        硬装项目进度: '75%',
        启动时间: 1764547200000,
        计划开业时间: 1774454400000,
      },
    },
  ]);

  importSnapshotToDatabase(db, snapshot);

  const row = db
    .prepare('select owner_text, cd_owner_text, vm_owner_text from projects where id = ?')
    .get('rec-split-owner-columns');
  const sqliteSnapshot = readSnapshotFromDatabase(db, { personnelArchitecture: snapshot.personnelArchitecture });

  assert.equal(row.owner_text, '苏佳蕾、张情');
  assert.equal(row.cd_owner_text, '苏佳蕾');
  assert.equal(row.vm_owner_text, '张情');
  assert.equal(sqliteSnapshot.projects[0].owner, '苏佳蕾、张情');
  assert.equal(sqliteSnapshot.projects[0].cdOwner, '苏佳蕾');
  assert.equal(sqliteSnapshot.projects[0].vmOwner, '张情');
  db.close();
});

test('importSnapshotToDatabase stores hard and soft workflow progress columns', async () => {
  const db = await createTempDatabase();
  const snapshot = createSnapshot([
    {
      recordId: 'rec-workflow-progress-columns',
      fields: {
        项目名称: '双进度 SQL 店',
        省份: '浙江省',
        业态: '购物中心',
        店态: '常规店',
        项目状态: '一般',
        负责人: '苏佳蕾',
        硬装项目进度: '施工图完成审核',
        软装项目进度: '未安排摆场',
        启动时间: 1764547200000,
        计划开业时间: 1774454400000,
      },
    },
  ]);

  importSnapshotToDatabase(db, snapshot);

  const row = db
    .prepare('select hard_progress_stage, soft_progress_stage from projects where id = ?')
    .get('rec-workflow-progress-columns');
  const sqliteSnapshot = readSnapshotFromDatabase(db, { personnelArchitecture: snapshot.personnelArchitecture });

  assert.equal(row.hard_progress_stage, '施工图完成审核');
  assert.equal(row.soft_progress_stage, '未安排摆场');
  assert.equal(sqliteSnapshot.projects[0].hardProgressStage, '施工图完成审核');
  assert.equal(sqliteSnapshot.projects[0].softProgressStage, '未安排摆场');
  db.close();
});

test('importSnapshotToDatabase auto-creates official personnel from responsibility fields', async () => {
  const db = await createTempDatabase();
  seedPersonnelDatabase(db, {
    people: [
      { id: 'owner-chen', name: '陈立营', position: 'owner', discipline: 'hard', status: 'active', source: 'local' },
    ],
  });
  const snapshot = createSnapshot([
    {
      recordId: 'rec-new-personnel-from-project',
      fields: {
        项目名称: '新员工自动入库店',
        省份: '浙江省',
        业态: '购物中心',
        店态: '常规店',
        项目状态: '推进中',
        负责人: '陈立营',
        硬装项目进度: '平面方案',
        CD设计师: '陈梦然',
        计划开业时间: 1774454400000,
      },
    },
  ]);

  importSnapshotToDatabase(db, snapshot);

  const architecture = readPersonnelArchitectureFromDatabase(db);
  const assignment = db
    .prepare("select slot_key, person_name from project_responsibilities where person_name = '陈梦然'")
    .get();

  assert.equal(architecture.people.陈梦然.position, 'designer');
  assert.equal(architecture.people.陈梦然.discipline, 'hard');
  assert.equal(architecture.people.陈梦然.source, 'dingtalk-derived');
  assert.equal(architecture.roleGroups.cdDesigner.people.includes('陈梦然'), true);
  assert.deepEqual({ ...assignment }, { slot_key: 'cd_designer', person_name: '陈梦然' });
  db.close();
});

test('readSnapshotFromDatabase preserves old SQLite split owner columns without synthetic soft ownership', async () => {
  const db = await createTempDatabase();
  const importedAt = new Date().toISOString();
  const rawFields = {
    CD负责人: { display: '杨锦帆' },
    店态: { display: '黑标店' },
  };

  db.prepare(
    `insert into projects
      (id, dingtalk_record_id, raw_fields_json, name, province, business_type, store_status, status,
       owner_text, cd_owner_text, vm_owner_text, progress, start_date, due_date, risk_level, risk_notes, local_notes,
       source_updated_at, local_updated_at, created_at, archived_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', '', '', '', '', '', ?, null)`
  ).run(
    'p-yang-dual-owner',
    'p-yang-dual-owner',
    JSON.stringify(rawFields),
    '杨锦帆旧库规则店',
    '广东省',
    '购物中心',
    '黑标店',
    '一般',
    '杨锦帆',
    '杨锦帆',
    '',
    importedAt
  );
  db.prepare(
    `insert into project_responsibilities
      (project_id, slot_key, person_name, person_name_raw, assignment_index, sync_run_id, imported_at)
     values (?, ?, ?, ?, ?, ?, ?)`
  ).run('p-yang-dual-owner', 'cd_owner', '杨锦帆', '杨锦帆', 0, 'stale-run', importedAt);

  const sqliteSnapshot = readSnapshotFromDatabase(db);
  const project = sqliteSnapshot.projects[0];
  const splitOwnerRows = db
    .prepare("select count(*) as count from project_responsibilities where slot_key in ('cd_owner', 'vm_owner')")
    .get().count;

  assert.equal(project.owner, '杨锦帆');
  assert.equal(project.cdOwner, '杨锦帆');
  assert.equal(project.vmOwner, '');
  assert.equal(project.rawFields.VM负责人, undefined);
  assert.deepEqual(project.derivedOwners, {
    ownerResponsibilityRouting: true,
    soleDualOwnerName: '杨锦帆',
    cdOwner: '杨锦帆',
    vmOwner: '',
    owner: '杨锦帆',
    reviewChannel: '',
  });
  assert.equal(splitOwnerRows, 1);
  db.close();
});

test('readSnapshotFromDatabase preserves explicit VM collaborators without appending 杨锦帆 from hard slot', async () => {
  const db = await createTempDatabase();
  const importedAt = new Date().toISOString();
  const rawFields = {
    负责人: { display: '杨晶晶' },
    CD负责人: { display: '杨锦帆' },
    VM负责人: { display: '杨晶晶' },
    店态: { display: '黑标店' },
  };

  db.prepare(
    `insert into projects
      (id, dingtalk_record_id, raw_fields_json, name, province, business_type, store_status, status,
       owner_text, cd_owner_text, vm_owner_text, progress, start_date, due_date, risk_level, risk_notes, local_notes,
       source_updated_at, local_updated_at, created_at, archived_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', '', '', '', '', '', ?, null)`
  ).run(
    'p-yang-dual-owner-collaborator',
    'p-yang-dual-owner-collaborator',
    JSON.stringify(rawFields),
    '杨锦帆旧库协作规则店',
    '广东省',
    '购物中心',
    '黑标店',
    '一般',
    '杨晶晶',
    '杨锦帆',
    '杨晶晶',
    importedAt
  );
  db.prepare(
    `insert into project_responsibilities
      (project_id, slot_key, person_name, person_name_raw, assignment_index, sync_run_id, imported_at)
     values (?, ?, ?, ?, ?, ?, ?)`
  ).run('p-yang-dual-owner-collaborator', 'cd_owner', '杨锦帆', '杨锦帆', 0, 'stale-run', importedAt);

  const sqliteSnapshot = readSnapshotFromDatabase(db);
  const project = sqliteSnapshot.projects[0];
  const vmOwnerRole = sqliteSnapshot.metrics.personnel.roles.find((role) => role.key === 'vmOwner');
  const splitOwnerRows = db
    .prepare("select count(*) as count from project_responsibilities where slot_key in ('cd_owner', 'vm_owner')")
    .get().count;

  assert.equal(project.owner, '杨晶晶、杨锦帆');
  assert.equal(project.cdOwner, '杨锦帆');
  assert.equal(project.vmOwner, '杨晶晶');
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
  assert.ok(vmOwnerRole.people.some((person) => person.name === '杨晶晶' && person.value === 1));
  assert.equal(splitOwnerRows, 2);
  db.close();
});

test('readSnapshotFromDatabase normalizes old SQLite risk and schedule fields', async () => {
  const db = await createTempDatabase();
  const importedAt = new Date().toISOString();

  db.prepare(
    `insert into projects
      (id, dingtalk_record_id, raw_fields_json, name, province, business_type, store_status, status,
       owner_text, cd_owner_text, vm_owner_text, progress, start_date, due_date, risk_level, risk_notes, local_notes,
       source_updated_at, local_updated_at, created_at, archived_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', '', '', '', '', '', ?, null)`
  ).run(
    'p-old-missing-risk-plan',
    'p-old-missing-risk-plan',
    JSON.stringify({ 项目名称: { display: '旧库缺字段店' } }),
    '旧库缺字段店',
    '北京',
    '家居卖场',
    '常规店',
    '一般',
    '未分配',
    '',
    '',
    importedAt
  );

  const sqliteSnapshot = readSnapshotFromDatabase(db);
  const project = sqliteSnapshot.projects[0];

  assert.equal(project.riskLevel, '未知');
  assert.equal(project.scheduleStatus, 'missingDueDate');
  assert.equal(project.isDelayed, false);
  db.close();
});

test('readSnapshotFromDatabase falls back to raw personnel metrics when responsibility rows are empty', async () => {
  const db = await createTempDatabase();
  const snapshot = createSnapshot([
    {
      recordId: 'rec-empty-responsibility',
      fields: {
        项目名称: '责任表回退测试店',
        省份: '浙江省',
        业态: '购物中心',
        店态: '常规店',
        项目状态: '推进中',
        CD负责人: '鲁倩雨',
        硬装项目进度: '75%',
        启动时间: 1764547200000,
        计划开业时间: 1774454400000,
        CD组长: '鲁倩雨',
      },
    },
  ]);
  importSnapshotToDatabase(db, snapshot);
  db.prepare('delete from project_responsibilities').run();

  const sqliteSnapshot = readSnapshotFromDatabase(db, { personnelArchitecture: snapshot.personnelArchitecture });
  const cdOwnerRole = sqliteSnapshot.metrics.personnel.roles.find((role) => role.key === 'cdOwner');

  assert.ok(cdOwnerRole.people.some((person) => person.name === '鲁倩雨' && person.value === 1));
  db.close();
});

test('readSnapshotFromDatabase repairs stale SQLite responsibility rows for split owners', async () => {
  const db = await createTempDatabase();
  const importedAt = new Date().toISOString();
  const rawFields = {
    CD负责人: { display: '苏佳蕾' },
    VM负责人: { display: '张情' },
    CD组长: { display: '周丹阳' },
  };

  db.prepare(
    `insert into projects
      (id, dingtalk_record_id, raw_fields_json, name, province, business_type, store_status, status,
       owner_text, progress, start_date, due_date, risk_level, risk_notes, local_notes,
       source_updated_at, local_updated_at, created_at, archived_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', '', '', '', '', '', ?, null)`
  ).run(
    'p-split-owner',
    'p-split-owner',
    JSON.stringify(rawFields),
    '拆分负责人测试店',
    '山东省',
    '购物中心',
    '常规店',
    '一般',
    '未分配',
    importedAt
  );
  db.prepare(
    `insert into project_responsibilities
      (project_id, slot_key, person_name, person_name_raw, assignment_index, sync_run_id, imported_at)
     values (?, ?, ?, ?, ?, ?, ?)`
  ).run('p-split-owner', 'cd_lead', '周丹阳', '周丹阳', 0, 'stale-run', importedAt);

  const sqliteSnapshot = readSnapshotFromDatabase(db);
  const cdOwnerRole = sqliteSnapshot.metrics.personnel.roles.find((role) => role.key === 'cdOwner');
  const vmOwnerRole = sqliteSnapshot.metrics.personnel.roles.find((role) => role.key === 'vmOwner');
  const splitOwnerRows = db
    .prepare("select count(*) as count from project_responsibilities where slot_key in ('cd_owner', 'vm_owner')")
    .get().count;

  assert.equal(sqliteSnapshot.projects[0].owner, '苏佳蕾、张情');
  assert.ok(cdOwnerRole.people.some((person) => person.name === '苏佳蕾' && person.value === 1));
  assert.ok(vmOwnerRole.people.some((person) => person.name === '张情' && person.value === 1));
  assert.equal(splitOwnerRows, 2);
  db.close();
});

test('importSnapshotToDatabase archives projects that no longer exist in a clean DingTalk snapshot', async () => {
  const db = await createTempDatabase();
  const firstSnapshot = createSnapshot([
    {
      recordId: 'rec-kept',
      fields: {
        项目名称: '仍在钉钉店',
        省份: '浙江省',
        业态: '购物中心',
        店态: '常规店',
        项目状态: '推进中',
        负责人: '鲁倩雨',
        硬装项目进度: '75%',
        启动时间: 1764547200000,
        计划开业时间: 1774454400000,
      },
    },
    {
      recordId: 'rec-removed',
      fields: {
        项目名称: '已从钉钉移除店',
        省份: '江苏省',
        业态: '社区店',
        店态: '常规店',
        项目状态: '推进中',
        负责人: '张情',
        硬装项目进度: '55%',
        启动时间: 1764547200000,
        计划开业时间: 1774454400000,
      },
    },
  ]);
  importSnapshotToDatabase(db, firstSnapshot);

  const secondSnapshot = createSnapshot([
    {
      recordId: 'rec-kept',
      fields: {
        项目名称: '仍在钉钉店',
        省份: '浙江省',
        业态: '购物中心',
        店态: '常规店',
        项目状态: '推进中',
        负责人: '鲁倩雨',
        硬装项目进度: '80%',
        启动时间: 1764547200000,
        计划开业时间: 1774454400000,
      },
    },
  ]);
  importSnapshotToDatabase(db, secondSnapshot);

  const sqliteSnapshot = readSnapshotFromDatabase(db, { personnelArchitecture: secondSnapshot.personnelArchitecture });
  const archived = db.prepare('select archived_at from projects where dingtalk_record_id = ?').get('rec-removed');

  assert.deepEqual(sqliteSnapshot.projects.map((project) => project.id), ['rec-kept']);
  assert.ok(archived.archived_at);
  db.close();
});

test('importSnapshotToDatabase does not mass-archive existing projects from an empty snapshot', async () => {
  const db = await createTempDatabase();
  const firstSnapshot = createSnapshot([
    {
      recordId: 'rec-existing',
      fields: {
        项目名称: '防空响应测试店',
        省份: '浙江省',
        业态: '购物中心',
        店态: '常规店',
        项目状态: '推进中',
        负责人: '鲁倩雨',
        硬装项目进度: '75%',
        启动时间: 1764547200000,
        计划开业时间: 1774454400000,
      },
    },
  ]);
  importSnapshotToDatabase(db, firstSnapshot);

  const emptySnapshot = createProjectSnapshot({
    source: 'dingtalk',
    fieldMap,
    records: [],
  });
  importSnapshotToDatabase(db, emptySnapshot);

  const sqliteSnapshot = readSnapshotFromDatabase(db, { personnelArchitecture: firstSnapshot.personnelArchitecture });
  const project = db.prepare('select archived_at from projects where dingtalk_record_id = ?').get('rec-existing');

  assert.deepEqual(sqliteSnapshot.projects.map((item) => item.id), ['rec-existing']);
  assert.equal(project.archived_at, null);
  db.close();
});

test('importSnapshotToDatabase preserves locally overridden fields and records source differences', async () => {
  const db = await createTempDatabase();
  const firstSnapshot = createSnapshot([
    {
      recordId: 'rec-override',
      fields: {
        项目名称: '覆盖测试店',
        省份: '浙江省',
        业态: '购物中心',
        店态: '常规店',
        项目状态: '推进中',
        负责人: '陈立营',
        硬装项目进度: '55%',
        启动时间: 1764547200000,
        计划开业时间: 1774454400000,
      },
    },
  ]);
  importSnapshotToDatabase(db, firstSnapshot);

  const projectId = db.prepare('select id from projects where dingtalk_record_id = ?').get('rec-override').id;
  db.prepare('update projects set status = ?, local_updated_at = ? where id = ?').run(
    '本地暂停',
    '2026-05-28T00:00:00.000Z',
    projectId
  );
  db.prepare(
    `insert into project_field_overrides
      (project_id, field_key, local_value_json, source_value_json, value_type, reason, edited_by, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    projectId,
    'status',
    JSON.stringify('本地暂停'),
    JSON.stringify('推进中'),
    'string',
    '业务确认',
    'local-admin',
    '2026-05-28T00:00:00.000Z'
  );

  const secondSnapshot = createSnapshot([
    {
      recordId: 'rec-override',
      fields: {
        项目名称: '覆盖测试店',
        省份: '浙江省',
        业态: '购物中心',
        店态: '常规店',
        项目状态: '钉钉已更新',
        负责人: '陈立营',
        硬装项目进度: '65%',
        启动时间: 1764547200000,
        计划开业时间: 1774454400000,
      },
    },
  ]);
  importSnapshotToDatabase(db, secondSnapshot);

  const project = db.prepare('select status, progress from projects where id = ?').get(projectId);
  const difference = Object.fromEntries(
    Object.entries(
      db
        .prepare('select field_key, source_value_json, local_value_json, status from source_differences where project_id = ?')
        .get(projectId)
    )
  );

  assert.equal(project.status, '本地暂停');
  assert.equal(project.progress, 65);
  assert.deepEqual(difference, {
    field_key: 'status',
    source_value_json: JSON.stringify('钉钉已更新'),
    local_value_json: JSON.stringify('本地暂停'),
    status: 'open',
  });
  db.close();
});

test('readSnapshotFromDatabase uses exact terminal status matching for delay state', async () => {
  const db = await createTempDatabase();
  try {
    importSnapshotToDatabase(
      db,
      createSnapshot([
        {
          recordId: 'repo-open-containing-complete',
          fields: {
            项目名称: 'Repo Open Status Store',
            省份: '浙江',
            业态: 'Mall',
            店态: '常规店',
            项目状态: '待完成确认',
            负责人: 'Owner A',
            计划开业时间: '2000-01-01',
          },
        },
        {
          recordId: 'repo-exact-complete',
          fields: {
            项目名称: 'Repo Complete Status Store',
            省份: '浙江',
            业态: 'Mall',
            店态: '常规店',
            项目状态: '完成',
            负责人: 'Owner B',
            计划开业时间: '2000-01-01',
          },
        },
      ])
    );

    const snapshot = readSnapshotFromDatabase(db);
    const openProject = snapshot.projects.find((project) => project.id === 'repo-open-containing-complete');
    const completeProject = snapshot.projects.find((project) => project.id === 'repo-exact-complete');

    assert.equal(openProject.isDelayed, true);
    assert.equal(completeProject.isDelayed, true);
  } finally {
    db.close();
  }
});
