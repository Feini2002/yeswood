export const STATIC_OWNER_TEAM_GROUPS = {
  苏佳蕾: [
    { name: '直营1组', lead: '陈菲菲', members: ['陈菲菲', '乔玲玲', '陈晶晶', '张莹莹', '杨雪倩'] },
    { name: '直营2组', lead: '陶媛媛', members: ['陶媛媛', '梁玉贞', '安灵玲', '何赛平', '古茂琨'] },
    { name: '直营3组', lead: '杨晓芸', members: ['杨晓芸', '陈红燕', '臧传宝', '庞小琪', '禹凯鹏', '陈梦然', '占俊鑫'] },
    { name: '直营4组', lead: '刘雯蓓', members: ['刘雯蓓', '董一凡', '郭后冲', '杨莉', '牛超凡'] },
  ],
};

export function hasExplicitTeamMembers(team = {}) {
  if ((team.members || []).length || (team.designers || []).length) {
    return true;
  }
  return (team.groups || []).some((group) => (group?.members || []).length);
}

function staticGroupsForTeam(team = {}) {
  return STATIC_OWNER_TEAM_GROUPS[team.owner] || STATIC_OWNER_TEAM_GROUPS[team.requestedOwner] || null;
}

function enrichGroupsWithStaticLeads(groups = [], staticGroups = []) {
  const staticGroupsByName = new Map(staticGroups.map((group) => [group.name, group]));
  return groups.map((group) => {
    const staticGroup = staticGroupsByName.get(group?.name);
    if (!staticGroup) {
      return group;
    }
    return {
      ...group,
      lead: group.lead || staticGroup.lead || '',
    };
  });
}

export function teamWithStaticGroups(team = {}, { fillMissingLeads = false } = {}) {
  const groups = staticGroupsForTeam(team);
  if (!groups) {
    return team;
  }
  if (hasExplicitTeamMembers(team)) {
    return fillMissingLeads
      ? {
          ...team,
          groups: enrichGroupsWithStaticLeads(team.groups || [], groups),
        }
      : team;
  }
  return groups ? { ...team, groups } : team;
}
