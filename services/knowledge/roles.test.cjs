const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allows, identities } = require('./roles.cjs');
class Document { constructor(id) { this.id = id; } }
class User { constructor(id) { this.id = id; } }
class ApiKey { constructor(userId) { this.userId = userId; } }
class AuthenticationProvider {}
const controller = 'controller';
test('viewer cannot bypass the app role through ownership, explicit grants, comments or sharing', () => {
  const actor = { id: 'person', role: 'viewer' }, document = new Document('private-document');
  for (const action of ['update', 'delete', 'permanentDelete', 'comment', 'createComment', 'createDocument', 'share', 'createShare', 'archive', 'publish', 'addReaction']) {
    assert.equal(allows(actor, action, document, controller), false, action);
  }
  for (const action of ['read', 'readDocument', 'listRevisions', 'star']) assert.equal(allows(actor, action, document, controller), true);
});
test('viewer can maintain their own profile and reader API key', () => {
  const actor = { id: 'person', role: 'viewer' };
  assert.equal(allows(actor, 'update', new User(actor.id), controller), true);
  assert.equal(allows(actor, 'update', new User('other'), controller), false);
  assert.equal(allows(actor, 'delete', new ApiKey(actor.id), controller), true);
  assert.equal(allows(actor, 'delete', new ApiKey('other'), controller), false);
});
test('native app admin cannot change directory roles or controller authority', () => {
  const actor = { id: 'person', role: 'admin' };
  for (const action of ['promote', 'demote', 'activate', 'suspend', 'inviteUser']) assert.equal(allows(actor, action, new User('other'), controller), false);
  assert.equal(allows(actor, 'update', new User(controller), controller), false);
  assert.equal(allows(actor, 'delete', new ApiKey(controller), controller), false);
  assert.equal(allows(actor, 'update', new AuthenticationProvider(), controller), false);
  assert.equal(allows(actor, 'update', new Document('shared'), controller), true);
  assert.equal(allows({ id: controller, role: 'admin' }, 'demote', new User('other'), controller), true);
});
test('Sequelize model names retain controller protection and self-service limits', () => {
  const user = new User(controller), provider = new AuthenticationProvider(), key = new ApiKey(controller);
  Object.defineProperty(User, 'name', { value: 'user' });
  Object.defineProperty(AuthenticationProvider, 'name', { value: 'authentication_provider' });
  Object.defineProperty(ApiKey, 'name', { value: 'apiKey' });
  const admin = { id: 'person', role: 'admin' };
  assert.equal(allows(admin, 'update', user, controller), false);
  assert.equal(allows(admin, 'listApiKeys', user, controller), false);
  assert.equal(allows(admin, 'update', provider, controller), false);
  assert.equal(allows(admin, 'delete', key, controller), false);
  assert.equal(allows({ id: 'person', role: 'viewer' }, 'update', new User('person'), controller), true);
});
test('native identity endpoint is controller-only and excludes credentials', async () => {
  const models = { AuthenticationProvider: { findAll: async () => [{ id: 'oidc' }] }, User: { findAll: async () => [{ id: 'person', role: 'viewer', suspendedAt: null }] },
    UserAuthentication: { findAll: async () => [{ userId: 'person', providerId: 'immutable', accessToken: 'must-not-leak' }] } };
  const ctx = { state: { auth: { user: { id: controller, teamId: 'team', role: 'admin' } } }, throw() { throw Error('Forbidden'); } };
  await identities(ctx, models, controller);
  assert.deepEqual(ctx.body.data, [{ id: 'person', role: 'viewer', suspended: false, subject: 'immutable' }]);
  ctx.state.auth.user.id = 'other-admin';
  await assert.rejects(identities(ctx, models, controller));
});
test('ambiguous native links fail before producing an identity snapshot', async () => {
  const models = { AuthenticationProvider: { findAll: async () => [{ id: 'oidc' }] }, User: { findAll: async () => [] },
    UserAuthentication: { findAll: async () => [{ userId: 'a', providerId: 'same' }, { userId: 'b', providerId: 'same' }] } };
  const ctx = { state: { auth: { user: { id: controller, teamId: 'team', role: 'admin' } } } };
  await assert.rejects(identities(ctx, models, controller));
  assert.equal(ctx.body, undefined);
});
