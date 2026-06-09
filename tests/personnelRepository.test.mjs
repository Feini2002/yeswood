import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { openInitializedDatabase } from '../src/backend/database.mjs';
import {
  readPersonnelArchitectureFromDatabase,
  savePersonnelArchitectureToDatabase,
  seedPersonnelDatabase,
  syncPersonnelFromProjects,
} from '../src/backend/personnelRepository.mjs';

async function createTempDatabase() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-personnel-repo-'));
  return openInitializedDatabase(path.join(tempDir, 'app.sqlite'));
}

function sampleArchitecture() {
  return {
    people: [
      { id: 'owner-chen', name: '陈立营', position: 'owner', discipline: 'hard', status: 'active', source: 'local' },
      { id: 'lead-zhang', name: '张宸瑞', position: 'lead', discipline: 'hard', status: 'active', source: 'local' },
      { id: 'lead-qing', name: '张情', position: 'lead', discipline: 'soft', status: 'active', source: 'local' },
      { id: 'designer-li', name: '李爽', position: 'designer', discipline: 'soft', status: 'active', source: 'local' },
    ],
    roleGroups: {
      cdLead: { position: 'lead', discipline: 'hard', people: ['张宸瑞'] },
      vmLead: { position: 'lead', discipline: 'soft', people: ['张情'] },
      vmDesigner: { position: 'designer', discipline: 'soft', people: ['李爽'] },
    },
    teams: [{ id: 'team-chen', owner: '陈立营', cdLeads: ['张宸瑞'], vmLeads: ['张情'] }],
  };
}

test('seedPersonnelDatabase stores local personnel master data in SQLite', async () => {
  const db = await createTempDatabase();
  const architecture = seedPersonnelDatabase(db, sampleArchitecture());

  assert.equal(architecture.people.陈立营.position, 'owner');
  assert.equal(architecture.roleGroups.cdLead.people.includes('张宸瑞'), true);
  assert.deepEqual(architecture.teams[0].cdLeads, ['张宸瑞']);
  assert.equal(db.prepare('select count(*) as count from personnel_people').get().count, 4);
  db.close();
});

test('savePersonnelArchitectureToDatabase updates roles and team assignments', async () => {
  const db = await createTempDatabase();
  seedPersonnelDatabase(db, sampleArchitecture());

  const saved = savePersonnelArchitectureToDatabase(db, {
    ...sampleArchitecture(),
    people: [
      ...sampleArchitecture().people.filter((person) => person.name !== '张情'),
      { id: 'lead-qing', name: '张情', position: 'lead', discipline: 'hard', status: 'active', source: 'local' },
    ],
    roleGroups: {
      cdLead: { position: 'lead', discipline: 'hard', people: ['张宸瑞', '张情'] },
      vmLead: { position: 'lead', discipline: 'soft', people: [] },
    },
    teams: [{ id: 'team-chen', owner: '陈立营', cdLeads: ['张宸瑞', '张情'], vmLeads: [] }],
  });

  assert.deepEqual(saved.roleGroups.cdLead.people, ['张宸瑞', '张情']);
  assert.deepEqual(saved.roleGroups.vmLead.people, []);
  assert.deepEqual(readPersonnelArchitectureFromDatabase(db).teams[0].cdLeads, ['张宸瑞', '张情']);
  db.close();
});

test('savePersonnelArchitectureToDatabase derives role groups from current people after lead transfer', async () => {
  const db = await createTempDatabase();
  seedPersonnelDatabase(db, sampleArchitecture());

  const saved = savePersonnelArchitectureToDatabase(db, {
    ...sampleArchitecture(),
    people: [
      ...sampleArchitecture().people.filter((person) => person.name !== '张情'),
      { id: 'lead-qing', name: '张情', position: 'lead', discipline: 'hard', status: 'active', source: 'local' },
    ],
    roleGroups: {
      cdLead: { position: 'lead', discipline: 'hard', people: ['张宸瑞'] },
      vmLead: { position: 'lead', discipline: 'soft', people: ['张情'] },
    },
    teams: [{ id: 'team-chen', owner: '陈立营', cdLeads: ['张宸瑞', '张情'], vmLeads: [] }],
  });

  assert.deepEqual(saved.roleGroups.cdLead.people, ['张宸瑞', '张情']);
  assert.deepEqual(saved.roleGroups.vmLead.people, []);
  db.close();
});

test('savePersonnelArchitectureToDatabase persists creative dual-discipline leads', async () => {
  const db = await createTempDatabase();

  const saved = savePersonnelArchitectureToDatabase(db, {
    people: [
      { id: 'owner-chen', name: '陈立营', position: 'owner', discipline: 'hard', status: 'active', source: 'local' },
      { id: 'lead-ma', name: '马琳琳', position: 'lead', discipline: 'both', status: 'active', source: 'local' },
    ],
    roleGroups: {
      creativeLead: { position: 'lead', discipline: 'both', people: ['马琳琳'] },
    },
  });

  assert.equal(saved.people.马琳琳.discipline, 'both');
  assert.deepEqual(saved.roleGroups.creativeLead.people, ['马琳琳']);
  assert.deepEqual(readPersonnelArchitectureFromDatabase(db).roleGroups.creativeLead.people, ['马琳琳']);
  db.close();
});

test('savePersonnelArchitectureToDatabase rejects dual-discipline designers', async () => {
  const db = await createTempDatabase();

  assert.throws(
    () =>
      savePersonnelArchitectureToDatabase(db, {
        people: [{ id: 'designer-bad', name: '错误设计师', position: 'designer', discipline: 'both', status: 'active' }],
      }),
    /不能设置为硬装\+软装设计师/
  );
  db.close();
});

test('syncPersonnelFromProjects creates official personnel from project responsibility fields', async () => {
  const db = await createTempDatabase();
  seedPersonnelDatabase(db, sampleArchitecture());

  const result = syncPersonnelFromProjects(db, [
    {
      id: 'project-new-hires',
      name: '新员工字段同步店',
      rawFields: {
        CD设计师: { display: '陈梦然、占俊鑫' },
        点位设计师: { display: '赵琳琳' },
        摆场设计师: { display: '李晓倩' },
      },
    },
  ]);
  const architecture = readPersonnelArchitectureFromDatabase(db);

  assert.deepEqual(
    result.insertedPeople.map((person) => ({
      name: person.name,
      position: person.position,
      discipline: person.discipline,
      sourceField: person.sourceField,
    })),
    [
      { name: '陈梦然', position: 'designer', discipline: 'hard', sourceField: 'CD设计师' },
      { name: '李晓倩', position: 'member', discipline: '', sourceField: '摆场设计师' },
      { name: '占俊鑫', position: 'designer', discipline: 'hard', sourceField: 'CD设计师' },
      { name: '赵琳琳', position: 'designer', discipline: 'soft', sourceField: '点位设计师' },
    ]
  );
  assert.equal(architecture.people.陈梦然.status, 'active');
  assert.equal(architecture.people.陈梦然.source, 'dingtalk-derived');
  assert.equal(architecture.people.陈梦然.categoryLabel, '硬装设计师');
  assert.equal(architecture.people.李晓倩.status, 'active');
  assert.equal(architecture.people.李晓倩.position, 'member');
  assert.equal(architecture.people.李晓倩.discipline, '');
  assert.equal(architecture.people.李晓倩.sourceField, '摆场设计师');
  assert.deepEqual(
    ['陈梦然', '占俊鑫'].map((name) => architecture.roleGroups.cdDesigner.people.includes(name)),
    [true, true]
  );
  assert.equal(architecture.roleGroups.vmDesigner.people.includes('赵琳琳'), true);
  db.close();
});

test('syncPersonnelFromProjects reuses existing personnel aliases before creating people', async () => {
  const db = await createTempDatabase();
  seedPersonnelDatabase(db, {
    people: [
      {
        id: 'owner-fanjia-rui',
        name: 'Jarvan范嘉瑞',
        displayName: '范嘉瑞',
        aliases: ['Jarvan'],
        position: 'owner',
        discipline: 'soft',
        status: 'active',
        source: 'local',
      },
    ],
  });

  const result = syncPersonnelFromProjects(db, [
    {
      id: 'project-owner-alias',
      name: '负责人别名店',
      rawFields: {
        VM负责人: { display: '范嘉瑞' },
      },
    },
  ]);

  assert.deepEqual(result.insertedPeople, []);
  assert.equal(db.prepare("select count(*) as count from personnel_people where name = '范嘉瑞'").get().count, 0);
  assert.equal(db.prepare("select count(*) as count from personnel_people where name = 'Jarvan范嘉瑞'").get().count, 1);
  db.close();
});
