import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProjectTeamAssociations,
  buildTeamRoster,
  projectAssociationKey,
} from '../src/backend/teamProjectAssociations.mjs';

function raw(display) {
  return { display };
}

function project(overrides = {}) {
  return {
    id: overrides.id || 'p-1',
    name: overrides.name || '测试项目',
    rawFields: overrides.rawFields || {},
    ...overrides,
  };
}

const architecture = {
  people: {
    苏佳蕾: { name: '苏佳蕾', displayName: '苏佳蕾', aliases: ['苏总'] },
    陈菲菲: { name: '陈菲菲', displayName: '陈菲菲', aliases: ['菲菲'] },
    乔玲玲: { name: '乔玲玲', displayName: '乔玲玲' },
    陶媛媛: { name: '陶媛媛', displayName: '陶媛媛' },
    李晓倩: { name: '李晓倩', displayName: '李晓倩' },
  },
  aliases: {
    陈菲菲: ['陈菲', '菲菲'],
  },
};

test('buildTeamRoster keeps groups and includes team owner as an ungrouped member', () => {
  const roster = buildTeamRoster(
    {
      owner: '苏佳蕾',
      groups: [
        { name: '直营1组', members: ['陈菲菲', '乔玲玲'] },
        { name: '直营2组', lead: '陶媛媛', members: ['陶媛媛'] },
      ],
    },
    architecture
  );

  assert.equal(roster.owner, '苏佳蕾');
  assert.equal(roster.groupCount, 2);
  assert.equal(roster.memberCount, 4);
  assert.deepEqual(roster.groups[0], {
    id: 'group-1',
    name: '直营1组',
    lead: '',
    leadDisplay: '组长未配置',
    members: ['陈菲菲', '乔玲玲'],
  });
  assert.equal(roster.groups[1].lead, '陶媛媛');
  assert.equal(roster.membersByName.get('苏佳蕾').groupId, '');
  assert.equal(roster.membersByName.get('陈菲菲').groupId, 'group-1');
});

test('buildTeamRoster applies group leaders and omits hidden people from visible groups', () => {
  const roster = buildTeamRoster(
    {
      owner: '苏佳蕾',
      groups: [{ name: '直营1组', lead: '陈菲菲', members: ['陈菲菲', '乔玲玲', '李晓倩'] }],
    },
    {
      ...architecture,
      hiddenPeople: ['李晓倩'],
    }
  );

  assert.equal(roster.groups[0].lead, '陈菲菲');
  assert.equal(roster.groups[0].leadDisplay, '陈菲菲');
  assert.deepEqual(roster.groups[0].members, ['陈菲菲', '乔玲玲']);
  assert.equal(roster.membersByName.has('李晓倩'), false);
  assert.equal(roster.memberCount, 3);
});

test('buildProjectTeamAssociations maps owner-only projects to the team owner without a group hit', () => {
  const roster = buildTeamRoster(
    {
      owner: '苏佳蕾',
      groups: [{ name: '直营1组', members: ['陈菲菲'] }],
    },
    architecture
  );
  const association = buildProjectTeamAssociations(
    project({
      id: 'owner-only',
      rawFields: {
        负责人: raw('苏总'),
      },
    }),
    roster,
    architecture
  );

  assert.deepEqual(association.memberNames, ['苏佳蕾']);
  assert.deepEqual(association.groupIds, []);
  assert.deepEqual(association.groupNames, []);
  assert.deepEqual(association.roleLabelsByMember.苏佳蕾, ['负责人']);
});

test('buildProjectTeamAssociations canonicalizes aliases and de-duplicates multiple role hits', () => {
  const roster = buildTeamRoster(
    {
      owner: '苏佳蕾',
      groups: [{ name: '直营1组', members: ['陈菲菲', '乔玲玲'] }],
    },
    architecture
  );
  const association = buildProjectTeamAssociations(
    project({
      id: 'alias-hit',
      rawFields: {
        CD设计师: raw('菲菲'),
        CD组长: raw('陈菲菲'),
        点位设计师: raw('乔玲玲'),
      },
    }),
    roster,
    architecture
  );

  assert.deepEqual(association.memberNames, ['陈菲菲', '乔玲玲']);
  assert.deepEqual(association.groupIds, ['group-1']);
  assert.deepEqual(association.roleLabelsByMember.陈菲菲, ['硬装设计师', '硬装组长']);
  assert.equal(association.unmappedNames.length, 0);
});

test('buildProjectTeamAssociations records cross-group projects once per group', () => {
  const roster = buildTeamRoster(
    {
      owner: '苏佳蕾',
      groups: [
        { name: '直营1组', members: ['陈菲菲'] },
        { name: '直营2组', members: ['陶媛媛'] },
      ],
    },
    architecture
  );
  const association = buildProjectTeamAssociations(
    project({
      id: 'cross-group',
      rawFields: {
        CD设计师: raw('陈菲菲'),
        摆场设计师: raw('陶媛媛'),
      },
    }),
    roster,
    architecture
  );

  assert.deepEqual(association.memberNames, ['陈菲菲', '陶媛媛']);
  assert.deepEqual(association.groupIds, ['group-1', 'group-2']);
  assert.deepEqual(association.groupNames, ['直营1组', '直营2组']);
});

test('buildProjectTeamAssociations surfaces unknown names without counting them', () => {
  const roster = buildTeamRoster(
    {
      owner: '苏佳蕾',
      groups: [{ name: '直营1组', members: ['陈菲菲'] }],
    },
    architecture
  );
  const association = buildProjectTeamAssociations(
    project({
      id: 'unknown-display',
      rawFields: {
        摆场设计师: raw('临时摆场人'),
      },
    }),
    roster,
    architecture
  );

  assert.deepEqual(association.memberNames, []);
  assert.deepEqual(association.groupIds, []);
  assert.deepEqual(association.unmappedNames, [
    {
      fieldName: '摆场设计师',
      sourceName: '临时摆场人',
      canonicalName: '临时摆场人',
      roleLabel: '摆场设计师',
    },
  ]);
});

test('projectAssociationKey prefers stable identifiers and reports weak fallback', () => {
  assert.deepEqual(projectAssociationKey(project({ id: 'id-1', name: 'A' })), {
    key: 'id-1',
    weak: false,
  });
  assert.deepEqual(projectAssociationKey(project({ id: '', rawId: 'raw-1', name: 'A' })), {
    key: 'raw-1',
    weak: false,
  });
  assert.deepEqual(projectAssociationKey(project({ id: '', name: 'A', storeCode: 'S01' })), {
    key: 'A:S01',
    weak: false,
  });
  assert.deepEqual(projectAssociationKey(project({ id: '', name: 'A' })), {
    key: 'A',
    weak: true,
  });
});
