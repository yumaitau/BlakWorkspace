import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorized, directoryMembers, planUsers, reconcile } from './role-bridge.mjs';
import { withNativeSession } from './role-bridge.mjs';
import { applicationAllows } from './role-bridge.mjs';
test('application role caps private ownership and arbitrary local workspace roles', async () => {
  const schema = { workspaceUserTable: { workspaceId: 'workspace', role: 'role', userId: 'user' } };
  const rows = [{ workspaceId: 'managed', role: 'blak-reader' }, { workspaceId: 'private', role: 'owner' }];
  const dependencies = { schema, eq() {}, env: { BLAK_ROLE_CONTROLLER_ID: 'controller', BLAK_ROLE_WORKSPACES: '["managed"]' },
    builtInRoles: { viewer: { statements: { task: ['read'] } }, member: { statements: {} }, admin: { statements: {} } },
    database: { select() { return { from() { return { where: async () => rows }; } }; } } };
  assert.equal(await applicationAllows('person', { task: ['read'] }, dependencies), true);
  assert.equal(await applicationAllows('person', { task: ['update'] }, dependencies), false);
  rows[0].role = 'blak-writer';
  assert.equal(await applicationAllows('person', { task: ['update'] }, dependencies), true);
  assert.equal(await applicationAllows('person', { member: ['update'] }, dependencies), false);
  rows.shift();
  assert.equal(await applicationAllows('person', { task: ['read'] }, dependencies), false);
  assert.equal(await applicationAllows('controller', { task: ['update'] }, dependencies), true);
});
test('privileged controller operations use and clean up persisted native sessions', async () => {
  const deleted = [];
  const auth = { $context: Promise.resolve({ baseURL: 'https://projects.example.test/api/auth', internalAdapter: {
    createSession: async id => { assert.equal(id, 'controller'); return { token: 'temporary-native-token' }; },
    deleteSession: async token => deleted.push(token),
  } }) };
  await assert.rejects(withNativeSession(auth, 'controller', async headers => {
    assert.equal(headers.get('authorization'), 'Bearer temporary-native-token');
    assert.equal(headers.get('origin'), 'https://projects.example.test');
    throw Error('Native operation failed');
  }));
  assert.deepEqual(deleted, ['temporary-native-token']);
});
const controller = 'controller', person = 'native-person', workspace = 'workspace';
function fixture() {
  const snapshot = {
    users: [{ id: controller, role: 'admin', banned: false }, { id: person, role: 'admin', banned: false }],
    links: [{ userId: person, subject: 'frozen-subject' }],
    members: [{ id: 'owner-member', workspaceId: workspace, userId: controller, role: 'owner' }, { id: 'member', workspaceId: workspace, userId: person, role: 'admin' }],
    roles: [],
  };
  const calls = [];
  return { snapshot, calls, controller, workspaceIds: [workspace], permissions: { reader: { task: ['read'] }, writer: { task: ['read', 'update'] }, admin: { task: ['read', 'update', 'delete'] } },
    api: async (name, body) => calls.push({ name, body }), closeConnections: id => calls.push({ name: 'close', id }) };
}
const directory = (role, active = true) => directoryMembers([{ subject: 'frozen-subject', active, role }]);
test('bridge requires a complete strong bearer secret', () => {
  const token = 'x'.repeat(48);
  assert.equal(authorized('Bearer ' + token, token), true);
  for (const supplied of ['', token, 'Bearer wrong', undefined]) assert.equal(authorized(supplied, token), false);
  assert.equal(authorized('Bearer weak', 'weak'), false);
});
test('duplicate directory or native subjects are rejected before mutations', async () => {
  assert.throws(() => directoryMembers([{ subject: 'x', role: 'reader', active: true }, { subject: 'x', role: 'admin', active: true }]));
  const value = fixture(); value.snapshot.links.push({ userId: person, subject: 'other' });
  await assert.rejects(reconcile({ ...value, desired: directory('reader') }));
  assert.deepEqual(value.calls, []);
});
test('native identity is immutable; email and names never link an account', () => {
  const value = fixture(); value.snapshot.users[1].email = 'renamed@example.invalid';
  assert.equal(planUsers(value.snapshot.users, value.snapshot.links, directory('writer'), controller)[0].desired, 'writer');
  value.snapshot.links[0].subject = 'unrelated';
  assert.equal(planUsers(value.snapshot.users, value.snapshot.links, directory('admin'), controller)[0].desired, null);
});
test('reader downgrade removes instance admin before setting native workspace role and closes sockets', async () => {
  const value = fixture(); await reconcile({ ...value, desired: directory('reader') });
  assert.deepEqual(value.calls[0], { name: 'setRole', body: { userId: person, role: 'user' } });
  assert.equal(value.calls[1].name, 'close');
  assert.ok(value.calls.some(call => call.name === 'updateMemberRole' && call.body.role === 'blak-reader'));
  assert.equal(value.calls.filter(call => call.name === 'close').length, 2);
});
test('disabled and removed users are banned and removed from managed membership', async () => {
  for (const desired of [directory('writer', false), directory(null), new Map([['other-app-admin', 'admin']])]) {
    const value = fixture(); await reconcile({ ...value, desired });
    assert.ok(value.calls.some(call => call.name === 'banUser' && call.body.userId === person));
    assert.ok(value.calls.some(call => call.name === 'removeMember' && call.body.memberIdOrEmail === 'member'));
    assert.ok(!value.calls.some(call => call.name === 'unbanUser'));
  }
});
test('new native memberships use the upstream server-only addMember method', async () => {
  const value = fixture(); value.snapshot.members.pop(); value.snapshot.users[1].banned = true;
  await reconcile({ ...value, desired: directory('writer') });
  assert.ok(value.calls.some(call => call.name === 'addMember' && call.body.userId === person && call.body.role === 'blak-writer'));
  assert.equal(value.calls.at(-1).name, 'unbanUser');
});
test('failed membership update cannot restore a banned user', async () => {
  const value = fixture(); value.snapshot.users[1].banned = true;
  const api = async (name, body) => { if (name === 'updateMemberRole') throw Error('unavailable'); return value.api(name, body); };
  await assert.rejects(reconcile({ ...value, api, desired: directory('reader') }));
  assert.ok(!value.calls.some(call => call.name === 'unbanUser'));
});
test('enrolled controller and other workspaces are preserved', async () => {
  const value = fixture(); value.snapshot.members.push({ id: 'private', workspaceId: 'other', userId: person, role: 'owner' });
  await reconcile({ ...value, desired: directory('admin') });
  assert.ok(!value.calls.some(call => call.body?.userId === controller || call.body?.memberIdOrEmail === 'owner-member' || call.body?.memberIdOrEmail === 'private'));
  assert.ok(value.calls.some(call => call.name === 'updateMemberRole' && call.body.role === 'blak-admin'));
});
test('foreign workspace ownership stops reconciliation before mutation', async () => {
  const value = fixture(); value.snapshot.members[0].role = 'admin';
  await assert.rejects(reconcile({ ...value, desired: directory('writer') }));
  assert.deepEqual(value.calls, []);
});

test('native app admins cannot change controller membership or managed role policy', async () => {
  const { protectsManagedAuthority } = await import('./role-bridge.mjs');
  const schema = { workspaceRoleTable: { id: 'r', role: 'role', workspaceId: 'workspace' }, workspaceUserTable: { id: 'm', userId: 'user' }, userTable: { id: 'u', email: 'email' } };
  const rows = new Map([[schema.workspaceRoleTable, [{ id: 'role-id', role: 'blak-reader', workspaceId: workspace }]], [schema.workspaceUserTable, [{ id: 'owner-member' }]], [schema.userTable, [{ email: 'controller@example.invalid' }]]]);
  const database = { select() { return { from(table) { return { then(resolve) { resolve(rows.get(table)); }, where() { return Promise.resolve(rows.get(table)); } }; } }; } };
  const dependencies = { database, schema, eq() {}, env: { BLAK_ROLE_CONTROLLER_ID: controller, BLAK_ROLE_WORKSPACES: JSON.stringify([workspace]) }, getSessionFromCtx: async () => ({ user: { id: person } }) };
  for (const [path, body] of [
    ['/admin/ban-user', { userId: controller }],
    ['/organization/remove-member', { memberIdOrEmail: 'owner-member' }],
    ['/organization/update-member-role', { memberId: 'owner-member', role: 'blak-reader' }],
    ['/organization/update-role', { roleName: 'blak-reader' }],
    ['/organization/delete', { organizationId: workspace }],
    ['/organization/update-member-role', { organizationId: workspace, memberId: 'reader-member', role: 'owner' }],
    ['/organization/invite-member', { organizationId: workspace, email: 'reader@example.invalid', role: 'admin' }],
    ['/organization/create-role', { organizationId: workspace, role: 'extra-admin' }],
  ]) {
    assert.equal(await protectsManagedAuthority({ path, body }, dependencies), true);
    assert.equal(await protectsManagedAuthority({ path, body }, { ...dependencies, getSessionFromCtx: async () => ({ user: { id: controller } }) }), false);
  }
  assert.equal(await protectsManagedAuthority({ path: '/get-session' }, dependencies), false);
  assert.equal(await protectsManagedAuthority({ path: '/admin/ban-user', body: { userId: person } }, dependencies), false);
});
