'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.BLAK_CHAT_ROLES = 'true';
const bridge = require('./role-bridge.cjs');
const controller = require('./role-controller.cjs');
bridge.install({ Meteor: { startup() {}, server: { sessions: new Map() } } });

function fixture() {
  const users = [{ _id: 'rocket.cat', type: 'bot', active: true, roles: ['bot'] }];
  const roles = [], permissions = ['view-c-room', 'create-c', 'edit-room'].map(_id => ({ _id, roles: ['admin'] }));
  const native = {
    Users: {
      find() { return { async toArray() { return structuredClone(users); } }; },
      async findOne(query) { return users.find(user => query.$or.some(term => term.username && term.username === user.username || term['emails.address'] && user.emails?.some(email => email.address === term['emails.address']))); },
      async updateOne(query, update) { Object.assign(users.find(user => user._id === query._id), update.$set); },
    },
    Accounts: { async insertUserDoc(options, user) { assert.equal(options.skipAdminCheck, true); const _id = 'native-' + users.length;
      // Reproduce native CustomOAuth validateNewUser profile copying.
      user.username = user.services.blakid.username; user.name = user.services.blakid.name;
      users.push({ _id, ...user }); return _id; } },
    Roles: { async findOneById(id) { return roles.find(role => role._id === id); }, async insertOne(role) { roles.push(role); } },
    Permissions: {
      find() { return { async toArray() { return structuredClone(permissions); } }; },
      async updateOne(query, update) { const permission = permissions.find(item => item._id === query._id); if (update.$addToSet) permission.roles.push(update.$addToSet.roles); else permission.roles = permission.roles.filter(role => role !== update.$pull.roles); },
    },
  };
  return { native, users, roles, permissions };
}
const member = (role = 'writer', extra = {}) => ({ subject: 'immutable', email: 'fixture@example.invalid', active: true, role, ...extra });

test('native identity and ownership survive reader downgrade, disable, email change and restoration', async () => {
  const { native, users } = fixture();
  assert.equal((await controller.reconcile(native, [member()])).created, 1);
  const user = users[1], id = user._id;
  assert.match(user.username, /^blak-[a-f0-9]{24}$/);
  assert.equal(user.name, 'fixture');
  user.ownedRoom = 'keep';
  await controller.reconcile(native, [member('reader')]);
  assert.deepEqual(user.roles, ['blak-chat-reader']);
  await controller.reconcile(native, [member(null, { active: false })]);
  assert.equal(user.active, false);
  await controller.reconcile(native, [member('admin', { email: 'renamed@example.invalid' })]);
  assert.equal(user._id, id);
  assert.equal(user.ownedRoom, 'keep');
  assert.deepEqual(user.roles, ['blak-chat-admin']);
  assert.equal(users.length, 2);
  assert.deepEqual(users[0].roles, ['bot']);
});

test('directory omissions and local native admins lose human access', async () => {
  const { native, users } = fixture();
  await controller.reconcile(native, [member()]);
  users.push({ _id: 'local', type: 'user', active: true, roles: ['admin'] });
  await controller.reconcile(native, [member(null, { subject: 'other' })]);
  for (const user of users.slice(1)) { assert.equal(user.active, false); assert.deepEqual(user.roles, []); }
});

test('ambiguous subjects, duplicate directory and email collisions fail before mutations', async () => {
  assert.throws(() => controller.directoryMembers([]));
  assert.throws(() => controller.directoryMembers([member(), member()]));
  const { native, users, roles } = fixture();
  users.push({ _id: 'local', emails: [{ address: 'fixture@example.invalid' }] });
  await assert.rejects(controller.reconcile(native, [member()]));
  assert.equal(roles.length, 0);
  users[1].services = { blakid: { id: 'immutable' } };
  users.push({ _id: 'duplicate', services: { blakid: { id: 'immutable' } } });
  await assert.rejects(controller.reconcile(native, [member()]));
  assert.equal(roles.length, 0);
});

test('native permissions add only scoped role grants and preserve upstream roles', async () => {
  const { native, permissions } = fixture();
  await controller.reconcile(native, [member()]);
  assert.deepEqual(permissions[0].roles, ['admin', 'blak-chat-reader', 'blak-chat-writer', 'blak-chat-admin']);
  assert.deepEqual(permissions[1].roles, ['admin', 'blak-chat-writer', 'blak-chat-admin']);
  assert.deepEqual(permissions[2].roles, ['admin', 'blak-chat-admin']);
});

test('identity status reads remain available during reconciliation while overlapping writes fail', async () => {
  const { native } = fixture(), routes = {};
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const find = native.Roles.findOneById;
  native.Roles.findOneById = async id => { await gate; return find(id); };
  process.env.BLAK_CHAT_ROLE_TOKEN = 'controller-fixture-'.repeat(3);
  const api = { v1: {
    addRoute(name, options, handlers) { routes[name] = handlers.post; },
    success(value) { return { success: true, ...value }; },
    failure() { return { success: false }; },
    forbidden() { return { success: false }; },
  } };
  controller.register(api, native);
  const request = { request: { headers: { get() { return 'Bearer ' + process.env.BLAK_CHAT_ROLE_TOKEN; } } }, bodyParams: { members: [member()] } };
  const pending = routes['blak.roles.reconcile'].call(request);
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal((await routes['blak.roles.identities'].call(request)).success, true);
    assert.equal((await routes['blak.roles.reconcile'].call(request)).success, false);
  } finally { release(); }
  assert.equal((await pending).success, true);
});
