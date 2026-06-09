import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { findOwnerDisciplineEvidence, normalizePersonnelArchitecture } from '../src/backend/personnelArchitecture.mjs';

test('normalizePersonnelArchitecture keeps local CD and VM discipline labels', () => {
  const architecture = normalizePersonnelArchitecture({
    sourcePriority: ['localPersonnelDatabase', 'dingtalkProjectData', 'systemInference'],
    people: {
      张宸瑞: { discipline: 'hard' },
      张情: { discipline: 'soft' },
      杨锦帆: { discipline: 'both' },
      Jarvan范嘉瑞: { discipline: 'soft', displayName: '范嘉瑞' },
      未定负责人: { role: 'owner' },
    },
    roleDisciplines: {
      cdLead: 'hard',
      vmLead: 'soft',
    },
    groups: {
      cdLead: { discipline: 'hard', people: ['张宸瑞'] },
    },
  });

  assert.deepEqual(architecture.people.张宸瑞, { discipline: 'hard', disciplineLabel: '硬装' });
  assert.deepEqual(architecture.people.张情, { discipline: 'soft', disciplineLabel: '软装' });
  assert.equal(architecture.people.杨锦帆.discipline, 'both');
  assert.equal(architecture.people.杨锦帆.categoryLabel, '创意负责人');
  assert.equal(architecture.people.杨锦帆.dualDisciplineOwner, true);
  assert.deepEqual(architecture.people.Jarvan范嘉瑞, {
    discipline: 'soft',
    disciplineLabel: '软装',
    displayName: '范嘉瑞',
  });
  assert.deepEqual(architecture.people.未定负责人, { role: 'owner' });
  assert.equal(architecture.roleDisciplines.cdLead, 'hard');
  assert.deepEqual(architecture.groups.cdLead.people, ['张宸瑞']);
  assert.deepEqual(architecture.sourcePriority, ['localPersonnelDatabase', 'dingtalkProjectData', 'systemInference']);
});

test('normalizePersonnelArchitecture accepts maintainable personnel table rows', () => {
  const architecture = normalizePersonnelArchitecture({
    schemaVersion: 1,
    people: [
      {
        id: 'owner-yang-jinfan',
        name: '杨锦帆',
        position: 'owner',
        discipline: 'both',
        status: 'active',
      },
      {
        id: 'lead-ma-linlin',
        name: '马琳琳',
        position: 'lead',
        discipline: 'soft',
        status: 'active',
        aliases: ['马琳琳VM'],
      },
      {
        id: 'designer-li-shuang',
        name: '李爽',
        position: 'designer',
        discipline: 'soft',
        status: 'active',
      },
    ],
    roleGroups: {
      vmLead: { position: 'lead', discipline: 'soft', people: ['马琳琳'] },
      vmDesigner: { position: 'designer', discipline: 'soft', people: ['李爽'] },
    },
  });

  assert.deepEqual(architecture.people.杨锦帆, {
    id: 'owner-yang-jinfan',
    name: '杨锦帆',
    position: 'owner',
    discipline: 'both',
    status: 'active',
    disciplineLabel: '硬装+软装',
    positionLabel: '负责人',
    category: 'ownerBoth',
    categoryLabel: '创意负责人',
    dualDisciplineOwner: true,
  });
  assert.equal(architecture.people.马琳琳.category, 'leadSoft');
  assert.equal(architecture.people.马琳琳.categoryLabel, '软装组长');
  assert.equal(architecture.people.李爽.category, 'designerSoft');
  assert.equal(architecture.people.李爽.categoryLabel, '软装设计师');
  assert.equal(architecture.roleDisciplines.vmDesigner, 'soft');
  assert.deepEqual(architecture.aliases.马琳琳, ['马琳琳VM']);
});

test('normalizePersonnelArchitecture exposes stable responsibility identities for split owners', () => {
  const architecture = normalizePersonnelArchitecture({
    people: [
      {
        id: 'owner-yang-jinfan',
        name: '杨锦帆',
        position: 'owner',
        discipline: 'both',
        status: 'active',
      },
    ],
    responsibilityIdentities: [
      {
        identityId: 'resp-017',
        displayName: '杨锦帆（硬装）',
        sourceName: '杨锦帆',
        discipline: 'hard',
        scope: 'both',
        validFrom: '',
        validTo: null,
      },
      {
        identityId: 'resp-018',
        displayName: '杨锦帆（软装）',
        sourceName: '杨锦帆',
        discipline: 'soft',
        scope: 'both',
        validFrom: '',
        validTo: null,
      },
    ],
  });

  assert.deepEqual(
    architecture.responsibilityIdentities
      .filter((identity) => identity.sourceName === '杨锦帆')
      .map((identity) => ({
        identityId: identity.identityId,
        displayName: identity.displayName,
        sourceName: identity.sourceName,
        discipline: identity.discipline,
        scope: identity.scope,
        active: identity.active,
      })),
    [
      {
        identityId: 'resp-017',
        displayName: '杨锦帆（硬装）',
        sourceName: '杨锦帆',
        discipline: 'hard',
        scope: 'both',
        active: true,
      },
      {
        identityId: 'resp-018',
        displayName: '杨锦帆（软装）',
        sourceName: '杨锦帆',
        discipline: 'soft',
        scope: 'both',
        active: true,
      },
    ]
  );
  assert.equal(architecture.responsibilityIdentitiesById['resp-017'].sourceName, '杨锦帆');
});

test('local personnel database keeps creative leads dual-discipline with split responsibility identities', async () => {
  const database = JSON.parse(await readFile('data/personnel-database.json', 'utf8'));
  const architecture = normalizePersonnelArchitecture(database);
  const categories = architecture.categories;
  const people = Object.values(architecture.people);
  const hardDesigners = people.filter((person) => person.position === 'designer' && person.discipline === 'hard');
  const softDesigners = people.filter((person) => person.position === 'designer' && person.discipline === 'soft');
  const bothOwners = people.filter((person) => person.position === 'owner' && person.discipline === 'both');
  const hardDesignerNames = new Set(hardDesigners.map((person) => person.name));
  const softDesignerNames = new Set(softDesigners.map((person) => person.name));
  const creativeLeads = ['马琳琳', '熊亮', '周俊彤'];

  assert.ok(categories.ownerBoth);
  assert.equal(categories.ownerBoth.label, '创意负责人');
  assert.ok(categories.leadBoth);
  assert.equal(categories.leadBoth.label, '创意组长');
  assert.equal(architecture.soleDualDisciplineOwner?.name, '杨锦帆');
  assert.deepEqual(
    architecture.responsibilityIdentities.map((identity) => identity.identityId),
    ['resp-017', 'resp-018', 'resp-019', 'resp-020', 'resp-021', 'resp-022', 'resp-023', 'resp-024']
  );
  assert.ok(categories.leadHard);
  assert.ok(categories.leadSoft);
  assert.ok(categories.designerHard);
  assert.ok(categories.designerSoft);
  assert.equal(Object.hasOwn(categories, 'designerBoth'), false);
  assert.deepEqual(bothOwners.map((person) => person.name), ['杨锦帆']);
  assert.ok(hardDesigners.length > 0);
  assert.ok(softDesigners.length > 0);
  assert.equal(hardDesigners.some((person) => softDesignerNames.has(person.name)), false);
  assert.equal(softDesigners.some((person) => hardDesignerNames.has(person.name)), false);
  assert.deepEqual(
    people
      .filter((person) => person.position === 'lead' && person.discipline === 'both')
      .map((person) => person.name),
    creativeLeads
  );
  assert.equal(people.some((person) => person.position === 'designer' && person.discipline === 'both'), false);
  assert.equal(architecture.roleGroups.cdDesigner.discipline, 'hard');
  assert.equal(architecture.roleGroups.vmDesigner.discipline, 'soft');
  assert.equal(architecture.roleGroups.creativeLead.discipline, 'both');
  assert.deepEqual(
    creativeLeads.map((name) => architecture.people[name]?.discipline),
    ['both', 'both', 'both']
  );
  assert.deepEqual(
    creativeLeads.map((name) => architecture.people[name]?.categoryLabel),
    ['创意组长', '创意组长', '创意组长']
  );
  assert.deepEqual(
    creativeLeads.map((name) => architecture.people[name]?.status),
    ['active', 'active', 'active']
  );
  assert.deepEqual(
    creativeLeads.map((name) => architecture.roleGroups.cdLead.people.includes(name)),
    [false, false, false]
  );
  assert.deepEqual(
    creativeLeads.map((name) => architecture.roleGroups.vmLead.people.includes(name)),
    [false, false, false]
  );
  assert.deepEqual(
    creativeLeads.map((name) => architecture.roleGroups.creativeLead.people.includes(name)),
    [true, true, true]
  );
  assert.deepEqual(
    creativeLeads.map((name) =>
      architecture.responsibilityIdentities
        .filter((identity) => identity.sourceName === name)
        .map((identity) => identity.discipline)
    ),
    [
      ['hard', 'soft'],
      ['hard', 'soft'],
      ['hard', 'soft'],
    ]
  );
});

test('findOwnerDisciplineEvidence does not infer owner discipline from project hard or soft fields', () => {
  const evidence = findOwnerDisciplineEvidence([
    {
      rawFields: {
        负责人: { display: '陈立营' },
        硬装项目进度: { display: '闭环' },
        软装项目进度: { display: '未开始' },
        CD组长: { display: '周丹阳' },
        VM组长: { display: '张情' },
      },
    },
  ]);

  assert.equal(evidence.hasExplicitOwnerDisciplineField, false);
  assert.deepEqual(evidence.fields, []);
});
