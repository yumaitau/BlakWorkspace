'use strict';

// Pure access logic: group taxonomy, effective roles, change plans and the
// guardrails every portal write passes. Authentik 2026.8 group semantics: a
// member of a group is also a member of every ancestor group (User.all_groups
// and ak_is_group_member follow `parents`), so a team group that is a child of
// blak-drive-writer gives each member Drive writer. Highest role wins.
// Workspace administrators (Blak ID superusers) are Admin in every app.
const { ROLES, ROLE_LABEL, TIMING, APP_ACCESS, GROUP_TYPES, roleSets, setName } = require('./access-catalog');

const LEVEL = Object.freeze({ reader: 1, writer: 2, admin: 3 });
const PEOPLE_TYPES = new Set(['internal', 'external']);

class GuardError extends Error {
  constructor(message, status = 403) { super(message); this.status = status; this.guard = true; }
}

function highest(roles) {
  return roles.reduce((best, role) => (LEVEL[role] || 0) > (LEVEL[best] || 0) ? role : best, null);
}

function indexGroups(groups, sets = roleSets()) {
  const byPk = new Map(groups.map(group => [String(group.pk), group]));
  const byName = new Map(groups.map(group => [group.name, group]));
  const roleByName = new Map();
  const legacy = new Map();
  for (const set of sets) {
    for (const role of ROLES) roleByName.set(set.groups[role], { set, role });
    for (const name of set.legacy) legacy.set(name, set);
  }
  const memo = new Map();
  function ancestors(pk, trail = new Set()) {
    pk = String(pk);
    if (memo.has(pk)) return memo.get(pk);
    if (trail.has(pk)) throw new Error('Cyclic group ancestry');
    const group = byPk.get(pk);
    if (!group) throw new Error('Unknown group in directory snapshot');
    const result = new Set([pk]);
    for (const parent of group.parents || []) for (const value of ancestors(parent, new Set([...trail, pk]))) result.add(value);
    memo.set(pk, result);
    return result;
  }
  function children(pk) {
    return groups.filter(group => (group.parents || []).map(String).includes(String(pk)));
  }
  return { groups, byPk, byName, roleByName, legacy, sets, ancestors, children };
}

// Returns the group type badge and whether the portal may change it.
function classify(group, index) {
  const lineage = [...index.ancestors(group.pk)].map(pk => index.byPk.get(pk));
  const superuser = lineage.some(item => item.is_superuser);
  const rbac = lineage.some(item => Array.isArray(item.roles) && item.roles.length);
  const role = index.roleByName.get(group.name);
  let type = 'team';
  if (superuser) type = 'admins';
  else if (role) type = 'role';
  else if (index.legacy.has(group.name)) type = 'retired';
  let lock = '';
  if (superuser) lock = 'This group makes its members Blak ID administrators. Change it only in Blak ID.';
  else if (rbac) lock = 'This group carries Blak ID permissions. Change it only in Blak ID.';
  else if (/^authentik /i.test(group.name)) lock = 'This is a built-in Blak ID group. Change it only in Blak ID.';
  else if (type === 'retired') lock = 'This group is retired and has no effect. Use an app role instead.';
  else if (type === 'team' && group.attributes?.blak_team !== true) lock = 'This group was not created in Blak Home, so Blak Home cannot change it. An operator can mark it as a team group in Blak ID (attribute blak_team: true) and re-run access provisioning.';
  else if (type === 'role' && lineage.length > 1) lock = 'This app role group has been nested under another group in Blak ID. Fix that in Blak ID first.';
  return { type, label: GROUP_TYPES[type].label, set: role?.set || index.legacy.get(group.name) || null, role: role?.role || null, locked: Boolean(lock), lock };
}

// Effective access for one person: every app role with the group it came from.
function resolveAccess(user, index) {
  const grants = new Map();
  for (const direct of user.groups || []) {
    const group = index.byPk.get(String(direct));
    if (!group) continue;
    for (const pk of index.ancestors(direct)) {
      const found = index.roleByName.get(index.byPk.get(pk).name);
      if (!found) continue;
      if (!grants.has(found.set.id)) grants.set(found.set.id, { set: found.set, grants: [] });
      grants.get(found.set.id).grants.push({ role: found.role, via: pk === String(direct) ? 'direct' : 'team', group: group.name, groupPk: String(group.pk) });
    }
  }
  if (user.is_superuser === true) {
    for (const set of index.sets) {
      if (!grants.has(set.id)) grants.set(set.id, { set, grants: [] });
      grants.get(set.id).grants.unshift({ role: 'admin', via: 'admins', group: 'Workspace administrators', groupPk: null });
    }
  }
  const apps = [...grants.values()].map(item => ({ ...item, role: highest(item.grants.map(grant => grant.role)) }))
    .sort((a, b) => setName(a.set).localeCompare(setName(b.set)));
  return { active: user.is_active !== false, admin: Boolean(user.is_superuser), apps: user.is_active === false ? [] : apps };
}

function roleFor(access, setId) {
  return access.apps.find(item => item.set.id === setId)?.role || null;
}

function findSet(index, setId) {
  const set = index.sets.find(item => item.id === setId);
  if (!set) throw new GuardError('Unknown app', 400);
  return set;
}

function assertRole(role, allowNone) {
  if (allowNone && role === '') return;
  if (!ROLES.includes(role)) throw new GuardError('Unknown role', 400);
}

function assertPerson(user) {
  if (!user || !PEOPLE_TYPES.has(user.type) || user.username === 'AnonymousUser') {
    throw new GuardError('Only people can be given access here. Service accounts are managed by operators.');
  }
}

function assertWritableGroup(group, index, allowed) {
  if (!group) throw new GuardError('Unknown group', 404);
  const kind = classify(group, index);
  if (kind.locked) throw new GuardError(kind.lock);
  if (!allowed.includes(kind.type)) throw new GuardError('People & access can only change app role groups and team groups.');
  return kind;
}

// A person's direct role in one app. Their team roles are left alone.
function assertNotAdministrator(user) {
  if (user.is_superuser === true) {
    const name = user.name || user.username;
    throw new GuardError(`${name} is a workspace administrator, so ${name} is Admin in every app. That can't be lowered here. To change it, remove ${name} from Workspace administrators in Blak ID.`, 409);
  }
}

function planPersonRole(user, setId, role, index) {
  assertPerson(user);
  assertNotAdministrator(user);
  assertRole(role, true);
  const set = findSet(index, setId);
  const target = role ? index.byName.get(set.groups[role]) : null;
  if (role && !target) throw new GuardError('That app role group does not exist in Blak ID yet. Run identity provisioning first.', 409);
  if (target) assertWritableGroup(target, index, ['role']);
  const direct = new Set((user.groups || []).map(String));
  const remove = ROLES.map(name => index.byName.get(set.groups[name]))
    .filter(group => group && direct.has(String(group.pk)) && group !== target);
  for (const group of remove) assertWritableGroup(group, index, ['role']);
  const add = target && !direct.has(String(target.pk)) ? [target] : [];
  const groups = [...direct].filter(pk => !remove.some(group => String(group.pk) === pk)).concat(add.map(group => String(group.pk)));
  return { kind: 'person-role', set, role, add, remove, after: { ...user, groups } };
}

// A team group's role in one app, by making it a child of the role group.
function planTeamRole(team, setId, role, index) {
  assertRole(role, true);
  const set = findSet(index, setId);
  assertWritableGroup(team, index, ['team']);
  const target = role ? index.byName.get(set.groups[role]) : null;
  if (role && !target) throw new GuardError('That app role group does not exist in Blak ID yet. Run identity provisioning first.', 409);
  if (target) {
    assertWritableGroup(target, index, ['role']);
    if (index.ancestors(target.pk).has(String(team.pk))) throw new GuardError('That would make a group its own parent.', 400);
  }
  const roleGroups = new Set(ROLES.map(name => index.byName.get(set.groups[name])).filter(Boolean).map(group => String(group.pk)));
  const parents = (team.parents || []).map(String).filter(pk => !roleGroups.has(pk));
  if (target) parents.push(String(target.pk));
  return { kind: 'team-role', set, role, team, parents, changed: parents.join() !== (team.parents || []).map(String).join() };
}

function planMembership(user, team, add, index) {
  assertPerson(user);
  assertWritableGroup(team, index, ['team']);
  const direct = (user.groups || []).map(String);
  const groups = add ? [...new Set([...direct, String(team.pk)])] : direct.filter(pk => pk !== String(team.pk));
  return { kind: add ? 'team-join' : 'team-leave', team, after: { ...user, groups } };
}

const TEAM_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.'&()-]{1,63}$/u;
function validateTeamName(name, index) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (!TEAM_NAME.test(value)) throw new GuardError('Use 2 to 64 letters, numbers, spaces and simple punctuation.', 400);
  if (/^blak-/i.test(value) || /^authentik\b/i.test(value) || / users$/i.test(value)) throw new GuardError('That name is reserved for Blak ID groups. Choose another name.', 400);
  if (index.groups.some(group => group.name.toLowerCase() === value.toLowerCase())) throw new GuardError('A group with that name already exists.', 409);
  return value;
}

// Re-index with a team group's parents changed, to preview the effect.
function withParents(index, team, parents) {
  return indexGroups(index.groups.map(group => String(group.pk) === String(team.pk) ? { ...group, parents } : group), index.sets);
}

function roleWords(set, role) {
  return APP_ACCESS[set.id]?.roles[role]?.summary || `use ${setName(set)}`;
}

// Plain-language outcome of a change for one person.
function personOutcome(name, set, before, after) {
  const app = setName(set);
  if (!after) return before ? `${name} will no longer be able to use ${app}.` : `${name} still has no access to ${app}.`;
  if (after === before) return `${name} keeps ${ROLE_LABEL[after]} in ${app} and can ${roleWords(set, after)}.`;
  return `${name} will be able to ${roleWords(set, after)} (${ROLE_LABEL[after]}).`;
}

function describePersonRole(user, plan, index) {
  const name = user.name || user.username;
  const before = roleFor(resolveAccess(user, index), plan.set.id);
  const afterAccess = resolveAccess(plan.after, index);
  const after = roleFor(afterAccess, plan.set.id);
  const lines = [personOutcome(name, plan.set, before, after)];
  const team = afterAccess.apps.find(item => item.set.id === plan.set.id)?.grants.find(grant => grant.via === 'team' && grant.role === after);
  if (after && plan.role !== after && team) lines.push(`${ROLE_LABEL[after]} comes from the team group ${team.group}. The highest role wins.`);
  if (!after && user.is_superuser) lines.push(`${name} stays a workspace administrator in Blak ID.`);
  return { lines, before, after, timing: TIMING[APP_ACCESS[plan.set.id]?.timing || 'native'] };
}

function describeTeamRole(plan, index, members) {
  const count = members.length;
  const people = `${count} ${count === 1 ? 'person' : 'people'}`;
  const lines = plan.role
    ? [`Every member of ${plan.team.name} (${people} now) will be able to ${roleWords(plan.set, plan.role)} (${ROLE_LABEL[plan.role]}).`, 'Anyone who joins the team later gets it too. People with a higher role elsewhere keep it.']
    : [`Members of ${plan.team.name} (${people}) stop getting a role in ${setName(plan.set)} from this team.`];
  const next = withParents(index, plan.team, plan.parents);
  for (const member of members.slice(0, 50)) {
    const before = roleFor(resolveAccess(member, index), plan.set.id);
    const after = roleFor(resolveAccess(member, next), plan.set.id);
    if (before !== after) lines.push(personOutcome(member.name || member.username, plan.set, before, after));
  }
  return { lines, timing: TIMING[APP_ACCESS[plan.set.id]?.timing || 'native'] };
}

function describeMembership(user, plan, index) {
  const name = user.name || user.username;
  const before = resolveAccess(user, index);
  const after = resolveAccess(plan.after, index);
  const lines = [plan.kind === 'team-join' ? `${name} joins the team group ${plan.team.name}.` : `${name} leaves the team group ${plan.team.name}.`];
  const timings = new Set();
  for (const set of index.sets) {
    const was = roleFor(before, set.id), now = roleFor(after, set.id);
    if (was === now) continue;
    lines.push(personOutcome(name, set, was, now));
    timings.add(TIMING[APP_ACCESS[set.id]?.timing || 'native']);
  }
  if (lines.length === 1) lines.push(plan.kind === 'team-join' ? `${plan.team.name} gives no new app roles to ${name}.` : `${name} keeps the same app roles.`);
  return { lines, timing: [...timings].join(' ') };
}

module.exports = {
  LEVEL, GuardError, highest, indexGroups, classify, resolveAccess, roleFor,
  planPersonRole, planTeamRole, planMembership, validateTeamName, assertNotAdministrator,
  describePersonRole, describeTeamRole, describeMembership, assertPerson, assertWritableGroup,
};
