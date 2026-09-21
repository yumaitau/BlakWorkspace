/** Exercise the patched native policy engine and account-linking function. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { allows } = require('./roles.cjs');
const root = process.env.OUTLINE_SERVER || '/opt/outline/build/server';
test('managed reader cap preserves collection ACLs while upstream unmanaged downgrades still apply', async () => {
  const source = readFileSync(join(root, 'models/User.js'), 'utf8');
  const start = source.indexOf('static async updateMembershipPermissions(');
  const end = source.indexOf('    // When a user', start);
  let updates = 0;
  const environment = { env: { BLAK_ROLE_CONTROLLER_ID: 'controller' } };
  const User = new Function('process', '_types', '_UserRoleHelper', '_UserMembership', 'return class User { ' + source.slice(start, end) + ' };')(
    environment, { UserRole: { Viewer: 'viewer', Member: 'member' }, CollectionPermission: { Read: 'read' } },
    { UserRoleHelper: { isRoleLower: (a, b) => ({ guest: 0, viewer: 1, member: 2 }[a] < { guest: 0, viewer: 1, member: 2 }[b]) } },
    { default: { update: async () => { updates++; } } });
  const model = { id: 'user', role: 'viewer', previous: () => 'member', changed: () => true };
  await User.updateMembershipPermissions(model, {});
  assert.equal(updates, 0);
  delete environment.env.BLAK_ROLE_CONTROLLER_ID;
  await User.updateMembershipPermissions(model, {});
  assert.equal(updates, 1);
});
function engine() {
  const exports = {};
  vm.runInNewContext(readFileSync(join(root, 'policies/cancan.js'), 'utf8'), { exports, require(name) {
    if (name === '../errors') return { AuthorizationError: message => Error(message) };
    if (name === '../blak/roles.cjs') return { allows: (actor, action, target) => allows(actor, action, target, 'controller') };
    if (name === 'es-toolkit/compat') return { isPlainObject: value => value?.constructor === Object, isMatch: () => true };
    return require(name);
  } });
  return new exports.CanCan();
}
test('patched native policy engine denies an owned document even when its original policy grants edit', () => {
  class User { constructor() { this.id = 'person'; this.role = 'viewer'; } }
  class Document {}
  const policy = engine();
  policy.allow(User, ['read', 'update'], Document, () => true);
  const actor = new User(), document = new Document();
  assert.equal(policy.can(actor, 'read', document), true);
  assert.equal(policy.can(actor, 'update', document), false);
  actor.role = 'member';
  assert.equal(policy.can(actor, 'update', document), true);
});
test('native serialized policies also respect the reader cap', () => {
  class User { constructor() { this.id = 'person'; this.role = 'viewer'; } }
  class Document {}
  const policy = engine();
  policy.allow(User, ['read', 'update'], Document, () => true);
  const result = policy.serialize(new User(), new Document());
  assert.equal(result.read, true);
  assert.equal(result.update, false);
});
test('native email matching cannot relink an existing account with a different subject', async () => {
  const source = readFileSync(join(root, 'commands/userProvisioner.js'), 'utf8');
  const begin = source.indexOf('async function userProvisioner(');
  const errors = { InvalidAuthenticationError: message => Error(message) };
  const models = {
    UserAuthentication: { findOne: async query => {
      assert.equal(query.where.providerId, 'new-subject');
      assert.equal(query.where.authenticationProviderId, 'oidc-provider');
      return null;
    } },
    User: { scope: () => ({ findOne: async () => ({ id: 'old-user' }) }) },
    Team: { scope: () => ({ findByPk: async () => ({ allowedDomains: [] }) }) },
  };
  const provision = new Function('_models', '_sequelize', '_errors', 'process', source.slice(begin) + '; return userProvisioner;')(
    models, { Op: { iLike: 'iLike' } }, errors, { env: { BLAK_ROLE_CONTROLLER_ID: 'controller' } });
  await assert.rejects(provision({}, { email: 'same@example.invalid', emailVerified: true, teamId: 'team', authentication: { providerId: 'new-subject', authenticationProviderId: 'oidc-provider' } }), /immutable identity link/);
});
test('new native OIDC users start read-only even if a provider requests admin', async () => {
  const source = readFileSync(join(root, 'commands/userProvisioner.js'), 'utf8');
  let created;
  const models = {
    UserAuthentication: { findOne: async () => null },
    User: { scope: () => ({ findOne: async () => null }),
      sequelize: { transaction: async () => ({ commit: async () => {}, rollback: async () => {} }) },
      createWithCtx: async (ctx, values) => { created = values; return { ...values, authentications: [{}] }; } },
    Team: { scope: () => ({ findByPk: async () => ({ defaultUserRole: 'admin', allowedDomains: [], isDomainAllowed: async () => true }) }) },
  };
  const provision = new Function('_models', '_sequelize', '_errors', 'process', 'require', source.slice(source.indexOf('async function userProvisioner(')) + '; return userProvisioner;')(
    models, { Op: { iLike: 'iLike' } }, {}, { env: { BLAK_ROLE_CONTROLLER_ID: 'controller' } }, () => ({ UserRole: { Viewer: 'viewer' } }));
  await provision({ ip: '127.0.0.1' }, { email: 'new@example.invalid', emailVerified: true, teamId: 'team', role: 'admin', authentication: { providerId: 'new', authenticationProviderId: 'oidc' } });
  assert.equal(created.role, 'viewer');
});
test('native controller can set least privilege before activating a suspended account', () => {
  class User { constructor(id, role) { this.id = id; this.role = role; this.isAdmin = role === 'admin'; } }
  class Team {}
  const policy = engine();
  vm.runInNewContext(readFileSync(join(root, 'policies/user.js'), 'utf8'), { exports: {}, process: { env: { BLAK_ROLE_CONTROLLER_ID: 'controller' } }, require(name) {
    if (name === '../../shared/types') return {};
    if (name === '../models') return { User, Team };
    if (name === './cancan') return policy;
    if (name === './utils') return { and: (...values) => values.every(Boolean), or: (...values) => values.some(Boolean), isTeamAdmin: actor => actor.isAdmin };
    throw Error('Unexpected native policy dependency');
  } });
  const target = new User('person', 'viewer'); target.isSuspended = true;
  assert.equal(policy.can(new User('controller', 'admin'), 'promote', target), true);
  assert.equal(policy.can(new User('other-admin', 'admin'), 'promote', target), false);
});
