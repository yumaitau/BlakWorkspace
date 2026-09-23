'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { INTEGRATIONS } = require('../integration');
const { APP_ACCESS, ROLES, groupNotes, roleSets } = require('../access-catalog');
const model = require('../access-model');
const { createCsrf, createAudit, createLimiter } = require('../access-guard');
const { createBlakIdAdmin } = require('../blak-id-admin');
const fx = require('../access-fixture');

const ORIGIN = { origin: 'http://portal.workspace.example.com' };
const byName = (directory, name) => directory.groupsList.find(group => group.name === name);
const csrf = user => createCsrf('fixture-secret').token(user.sessionId);

test('every app with role groups explains all three roles in plain language', () => {
  for (const [app, value] of Object.entries(INTEGRATIONS)) {
    if (!value.roleGroups?.length) continue;
    const entry = APP_ACCESS[app];
    assert.ok(entry, app + ' has no access explanation');
    assert.ok(entry.purpose && entry.name, app + ' needs a name and purpose');
    for (const role of ROLES) {
      const item = entry.roles[role];
      assert.ok(item, `${app} ${role} explanation missing`);
      assert.ok(item.summary && item.can.length && item.cannot.length, `${app} ${role} needs summary, can and can't`);
      for (const line of [item.summary, ...item.can, ...item.cannot]) assert.doesNotMatch(line, /CanCan|RBAC|OIDC|ACL|claim/i, `${app} ${role} uses jargon`);
    }
  }
  const notes = groupNotes();
  for (const value of Object.values(INTEGRATIONS)) {
    for (const name of value.roleGroups || []) assert.equal(notes[name].blak_type, 'role');
    if (value.roleGroups && value.group) assert.deepEqual([notes[value.group].blak_type, notes[value.group].blak_retired], ['retired', true]);
  }
});

test('direct and team roles resolve to the highest role per app', () => {
  const directory = fx.fakeDirectory();
  const index = model.indexGroups(directory.groupsList);
  const ada = directory.usersList[0];
  const access = model.resolveAccess(ada, index);
  const drive = access.apps.find(item => item.set.id === 'drive');
  assert.equal(drive.role, 'writer');
  assert.deepEqual(drive.grants.map(grant => [grant.role, grant.via, grant.group]).sort(), [['reader', 'direct', 'blak-drive-reader'], ['writer', 'team', 'Rangers']]);
  assert.equal(model.roleFor(access, 'sites'), 'reader');
  assert.equal(model.roleFor(access, 'chat'), 'admin');
  // A nested team inherits through its parent team.
  const nested = { pk: '99999999-9999-4999-8999-999999999999', name: 'Junior rangers', parents: [byName(directory, 'Rangers').pk], is_superuser: false, roles: [] };
  const withNested = model.indexGroups([...directory.groupsList, nested]);
  assert.equal(model.roleFor(model.resolveAccess({ groups: [nested.pk], is_active: true }, withNested), 'drive'), 'writer');
  assert.deepEqual(model.resolveAccess({ ...ada, is_active: false }, index).apps, []);
});

test('guardrails refuse admin groups, permission groups, retired groups and service accounts', () => {
  const directory = fx.fakeDirectory();
  const index = model.indexGroups(directory.groupsList);
  const [ada, sam, jo, robot] = directory.usersList;
  const admins = byName(directory, 'authentik Admins');
  assert.throws(() => model.planMembership(jo, admins, true, index), /administrators/);
  assert.throws(() => model.planMembership(jo, byName(directory, 'Blak ID operators'), true, index), /permissions/);
  assert.throws(() => model.planMembership(jo, byName(directory, 'Blak Drive users'), true, index), /retired/);
  assert.throws(() => model.planMembership(jo, byName(directory, 'blak-drive-writer'), true, index), /only change app role groups and team groups|team/);
  assert.throws(() => model.planPersonRole(robot, 'drive', 'writer', index), /Only people/);
  assert.throws(() => model.planTeamRole(admins, 'drive', 'writer', index), /administrators/);
  assert.throws(() => model.planPersonRole(jo, 'idp', 'admin', index), /Unknown app/);
  assert.throws(() => model.planPersonRole(jo, 'drive', 'owner', index), /Unknown role/);
  // A team under a superuser group is itself an admin group.
  const hidden = { pk: '88888888-8888-4888-8888-888888888888', name: 'Quiet team', parents: [admins.pk], is_superuser: false, roles: [] };
  const escalated = model.indexGroups([...directory.groupsList, hidden]);
  assert.equal(model.classify(hidden, escalated).type, 'admins');
  assert.throws(() => model.planMembership(jo, hidden, true, escalated), /administrators/);
  // A role group nested under a team would make a cycle.
  const loop = model.indexGroups(directory.groupsList.map(group => group.name === 'blak-flow-reader' ? { ...group, parents: [byName(directory, 'Finance').pk] } : group));
  assert.throws(() => model.planTeamRole(byName(directory, 'Finance'), 'flow', 'reader', loop), /nested|own parent/);
  for (const name of ['blak-drive-admin', 'authentik Admins', 'Blak Drive users', 'x', 'Rangers']) assert.throws(() => model.validateTeamName(name, index));
  assert.equal(model.validateTeamName('  Sea   rangers ', index), 'Sea rangers');
  assert.ok(ada && sam);
});

test('plans keep team roles and describe the effect in plain words', () => {
  const directory = fx.fakeDirectory();
  const index = model.indexGroups(directory.groupsList);
  const [ada, sam, jo] = directory.usersList;
  const plan = model.planPersonRole(jo, 'drive', 'writer', index);
  assert.deepEqual(plan.add.map(group => group.name), ['blak-drive-writer']);
  assert.match(model.describePersonRole(jo, plan, index).lines[0], /^Jo Nguyen will be able to add and edit files in Blak Drive/);
  // Ada's direct reader goes, but writer through Rangers stays.
  const removal = model.planPersonRole(ada, 'drive', '', index);
  assert.deepEqual(removal.remove.map(group => group.name), ['blak-drive-reader']);
  const text = model.describePersonRole(ada, removal, index);
  assert.equal(text.after, 'writer');
  assert.match(text.lines.join(' '), /team group Rangers/);
  const team = model.planTeamRole(byName(directory, 'Rangers'), 'flow', 'reader', index);
  assert.ok(team.parents.includes(byName(directory, 'blak-flow-reader').pk));
  assert.match(model.describeTeamRole(team, index, [ada, sam]).lines[0], /Every member of Rangers \(2 people now\)/);
  const leave = model.planMembership(sam, byName(directory, 'Rangers'), false, index);
  assert.match(model.describeMembership(sam, leave, index).lines.join(' '), /Sam Taylor will no longer be able to use Blak Drive/);
});

function harness(options = {}) {
  const directory = fx.fakeDirectory(options);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blak-access-'));
  const audit = createAudit(path.join(dir, 'audit.jsonl'));
  const access = fx.fixtureAccess(options.unconfigured ? { ...directory, configured: false } : directory, { audit, writeLimit: createLimiter(options.writes || 20, 60000) });
  return { directory, audit, access, dir, run: request => fx.renderRoute(access, request) };
}

test('admin pages re-check Blak ID live and refuse everyone else', async () => {
  const { run, directory } = harness();
  // Sam's session claims idp, but Blak ID says Sam is not an administrator.
  const forged = { ...fx.MEMBER, apps: [...fx.MEMBER.apps, 'idp'] };
  for (const pathName of ['/access/admin/apps', '/access/admin/groups', '/access/admin/people?q=a']) {
    const result = await run({ path: pathName, user: forged });
    assert.equal(result.status, 403, pathName);
    assert.match(result.body, /Only workspace administrators/);
  }
  const post = await run({ method: 'POST', path: '/access/admin/apply', user: forged, headers: ORIGIN, form: { csrf: csrf(forged), action: 'team-join', team: byName(directory, 'Rangers').pk, person: '3' } });
  assert.equal(post.status, 403);
  assert.deepEqual(directory.calls, []);
  assert.equal((await run({ path: '/access/admin/apps', user: fx.ADMIN })).status, 200);
  assert.equal((await run({ path: '/access/me', user: fx.MEMBER })).status, 200);
  assert.equal((await run({ path: '/access/admin/apps', user: null })).status, 302);
  // Admin status that cannot be confirmed is never assumed.
  assert.equal((await harness({ fail: { isWorkspaceAdmin: true } }).run({ path: '/access/admin/apps', user: fx.ADMIN })).status, 503);
  assert.equal((await harness({ unconfigured: true }).run({ path: '/access/admin/apps', user: fx.ADMIN })).status, 503);
});

test('writes need the CSRF token and the portal origin', async () => {
  const { run, directory } = harness();
  const form = { action: 'person-role', person: '3', app: 'drive', role: 'writer' };
  assert.equal((await run({ method: 'POST', path: '/access/admin/apply', user: fx.ADMIN, headers: ORIGIN, form })).status, 403);
  assert.equal((await run({ method: 'POST', path: '/access/admin/apply', user: fx.ADMIN, headers: ORIGIN, form: { ...form, csrf: csrf(fx.MEMBER) } })).status, 403);
  assert.equal((await run({ method: 'POST', path: '/access/admin/apply', user: fx.ADMIN, headers: { origin: 'https://evil.example' }, form: { ...form, csrf: csrf(fx.ADMIN) } })).status, 403);
  assert.equal((await run({ method: 'POST', path: '/access/admin/apply', user: fx.ADMIN, form: { ...form, csrf: csrf(fx.ADMIN) } })).status, 403);
  assert.deepEqual(directory.calls, []);
  const ok = await run({ method: 'POST', path: '/access/admin/apply', user: fx.ADMIN, headers: { referer: 'http://portal.workspace.example.com/access/admin/people/3' }, form: { ...form, csrf: csrf(fx.ADMIN) } });
  assert.equal(ok.status, 200);
});

test('review shows the effect, apply changes Blak ID, verifies it and audits it', async () => {
  const { run, directory, audit } = harness();
  const form = { csrf: csrf(fx.ADMIN), action: 'person-role', person: '3', app: 'drive', role: 'writer', return: '/access/admin/people/3' };
  const review = await run({ method: 'POST', path: '/access/admin/review', user: fx.ADMIN, headers: ORIGIN, form });
  assert.equal(review.status, 200);
  assert.match(review.body, /Jo Nguyen will be able to add and edit files in Blak Drive/);
  assert.match(review.body, /Confirm change/);
  assert.deepEqual(directory.calls, [], 'review must not change anything');
  const applied = await run({ method: 'POST', path: '/access/admin/apply', user: fx.ADMIN, headers: ORIGIN, form });
  assert.equal(applied.status, 200);
  assert.match(applied.body, /role=status/);
  assert.match(applied.body, /Done: Set Jo Nguyen/);
  assert.ok(directory.usersList[2].groups.includes(byName(directory, 'blak-drive-writer').pk));
  const [entry] = audit.recent();
  assert.deepEqual([entry.actor.sub, entry.action, entry.outcome, entry.target.name, entry.role], ['ada', 'person-role', 'applied', 'jo', 'writer']);
  // Applying the same change again is refused as a no-op.
  assert.equal((await run({ method: 'POST', path: '/access/admin/apply', user: fx.ADMIN, headers: ORIGIN, form })).status, 400);
});

test('team groups are created and given roles as child groups of the role group', async () => {
  const { run, directory } = harness();
  const post = form => run({ method: 'POST', path: '/access/admin/apply', user: fx.ADMIN, headers: ORIGIN, form: { csrf: csrf(fx.ADMIN), ...form } });
  assert.equal((await post({ action: 'team-create', name: 'Sea rangers', description: 'Sea country team' })).status, 200);
  const team = byName(directory, 'Sea rangers');
  assert.equal(team.attributes.blak_type, 'team');
  assert.equal((await post({ action: 'team-role', team: team.pk, app: 'chat', role: 'reader' })).status, 200);
  assert.deepEqual(team.parents, [byName(directory, 'blak-chat-reader').pk]);
  assert.equal((await post({ action: 'team-join', team: team.pk, person: '3' })).status, 200);
  assert.equal((await post({ action: 'team-role', team: team.pk, app: 'chat', role: 'writer' })).status, 200);
  assert.deepEqual(team.parents, [byName(directory, 'blak-chat-writer').pk]);
  const refused = await post({ action: 'team-join', team: byName(directory, 'authentik Admins').pk, person: '3' });
  assert.equal(refused.status, 403);
  assert.match(refused.body, /role=alert/);
  assert.ok(!directory.calls.some(([, pk]) => pk === byName(directory, 'authentik Admins').pk));
});

test('a failed Blak ID call is reported as not saved', async () => {
  const { run, directory, audit } = harness({ fail: { addMember: true } });
  const result = await run({ method: 'POST', path: '/access/admin/apply', user: fx.ADMIN, headers: ORIGIN, form: { csrf: csrf(fx.ADMIN), action: 'person-role', person: '3', app: 'drive', role: 'writer' } });
  assert.equal(result.status, 502);
  assert.match(result.body, /Not saved/);
  assert.doesNotMatch(result.body, /Done:/);
  assert.equal(directory.usersList[2].groups.length, 0);
  assert.equal(audit.recent()[0].outcome, 'failed');
});

test('writes are rate limited per administrator', async () => {
  const { run } = harness({ writes: 1 });
  const form = { csrf: csrf(fx.ADMIN), action: 'team-create', name: 'First team' };
  assert.equal((await run({ method: 'POST', path: '/access/admin/apply', user: fx.ADMIN, headers: ORIGIN, form })).status, 200);
  assert.equal((await run({ method: 'POST', path: '/access/admin/apply', user: fx.ADMIN, headers: ORIGIN, form: { ...form, name: 'Second team' } })).status, 429);
});

test('Blak ID client uses the service token and the documented endpoints', async () => {
  const directory = fx.fakeDirectory();
  const server = fx.fakeAuthentikServer(directory, 'service-token');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  try {
    const client = createBlakIdAdmin({ baseUrl, token: 'service-token' });
    assert.equal(await client.isWorkspaceAdmin(fx.ADMIN_UUID), true);
    assert.equal(await client.isWorkspaceAdmin(fx.MEMBER.identity), false);
    const rangers = byName(directory, 'Rangers');
    assert.deepEqual((await client.members(rangers.pk)).map(user => user.username), ['ada', 'sam']);
    await client.addMember(rangers.pk, 3);
    assert.ok(directory.usersList[2].groups.includes(rangers.pk));
    await client.setParents(rangers.pk, []);
    assert.deepEqual((await client.group(rangers.pk)).parents, []);
    await assert.rejects(client.addMember('not-a-uuid', 3), /Invalid identifier/);
    await assert.rejects(createBlakIdAdmin({ baseUrl, token: 'wrong' }).groups(), /refused/);
    assert.equal(createBlakIdAdmin({ baseUrl, token: '' }).configured, false);
  } finally { server.close(); }
});

test('role sets merge apps that share role groups', () => {
  const drive = roleSets().find(set => set.id === 'drive');
  assert.deepEqual(drive.apps, ['drive', 'docs']);
  assert.deepEqual(drive.legacy, ['Blak Drive users']);
});
