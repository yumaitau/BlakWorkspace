'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = process.env.BLAK_FORMS_NATIVE_ROOT || '/app/packages/server/dist/src';
process.env.BLAK_FORMS_ROLES = 'true';
process.env.OIDC_ISSUER = 'https://id.example/application/o/forms/';
const bridge = require(path.join(root, 'blak/role-bridge.cjs'));
const policy = require(path.join(root, 'blak/role-policy.cjs'));
const decorator = () => () => undefined;
const common = new Proxy({}, { get: (_, name) => name.endsWith('Exception') ? Error : decorator });
function native(file, extra = {}) {
  const module = { exports: {} };
  const fallback = new Proxy({}, { get: () => class {} });
  const dependencies = {
    '@nestjs/common': common, '@nestjs/mongoose': { InjectModel: decorator },
    '@nestjs/platform-express': { FileInterceptor: decorator },
    '@heyform-inc/utils': { helper: { isValid: value => value !== undefined && value !== null,
      isEmpty: value => value === undefined || value === null }, timestamp: () => 100, hs: () => 10000 },
    '@nestjs/graphql': { GqlExecutionContext: { create: context => context } },
    '@heyform-inc/shared-types-enums': { SocialLoginTypeEnum: { GOOGLE_ONE_TAP: 'one', GOOGLE: 'google' } },
    '../../config': { COOKIE_DEVICE_ID_NAME: 'device' },
    '../config': { COOKIE_DEVICE_ID_NAME: 'device', getMulterStorage: () => ({}),
      isUploadFileContentValid: () => true, saveUploadedFile: () => { throw new Error('Storage touched'); } },
    '../utils': { OidcSocialLogin: class {}, OIDC_LOGIN_KIND: 'oidc', md5: value => value },
    ...extra,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    module, exports: module.exports, Buffer, process,
    require: name => name.endsWith('/role-bridge.cjs') ? bridge : dependencies[name] || fallback,
  }, { filename: file });
  return module.exports;
}
function fixture() {
  const detail = { id: 'native-user', blakRole: 'writer' };
  const req = { get: () => 'device-id', cookies: {}, res: {} };
  const auth = { getSession: () => ({ id: detail.id, deviceId: 'device-id', loginAt: 100 }),
    isExpired: async () => false };
  const users = { findById: async () => detail };
  return { detail, req, auth, users };
}
test('native guard reevaluates roles on the same session and caps object owners', async () => {
  const { AuthGuard } = native('common/guard/auth.guard.js');
  const f = fixture();
  const guard = new AuthGuard(f.auth, f.users);
  const context = { getContext: () => ({ req: f.req }), getHandler: () => function updateForm() {} };
  assert.equal(await guard.canActivate(context), true);
  f.detail.blakRole = 'reader';
  await assert.rejects(guard.canActivate(context), /Blak ID/);
  context.getHandler = () => function formDetail() {};
  assert.equal(await guard.canActivate(context), true);
  f.detail.blakRole = null;
  await assert.rejects(guard.canActivate(context), /Blak ID/);
  f.detail.blakRole = 'admin';
  assert.equal(await guard.canActivate(context), true);
});
test('native guards use resolver identity, not aliases, query labels or HTTP verbs', async () => {
  const { AuthGuard } = native('common/guard/auth.guard.js');
  const f = fixture(); f.detail.blakRole = 'reader';
  f.req.body = { query: 'query { innocent: deleteProjectCode(input: {}) }' };
  f.req.method = 'GET';
  const guard = new AuthGuard(f.auth, f.users);
  await assert.rejects(guard.canActivate({ getContext: () => ({ req: f.req }),
    getHandler: () => function deleteProjectCode() {} }), /Blak ID/);
});
test('native uploads deny current readers before storage and upload quota mutation', async () => {
  const { UploadController } = native('controller/upload.controller.js');
  const f = fixture(); f.detail.blakRole = 'reader';
  const upload = new UploadController(f.auth, {}, {}, { throttler: () => { throw new Error('Quota touched'); } }, f.users);
  await assert.rejects(upload.index(f.req, { originalname: 'fixture.txt' }), /Blak ID/);
  f.detail.blakRole = null;
  await assert.rejects(upload.index(f.req, { originalname: 'fixture.txt' }), /Blak ID/);
});
test('native OIDC callback rejects verified email collisions without linking', async () => {
  const { SocialLoginService } = native('service/social-login.service.js');
  const service = new SocialLoginService({}, { findByEmail: () => { throw new Error('Email lookup reached'); } });
  service.userInfo = async () => ({ openId: 'issuer#new-subject', emailVerified: true, user: { email: 'existing@example.com' } });
  service.findByOpenId = async () => null;
  await assert.rejects(service.authCallback('oidc', 'code'), /immutable subject/);
});
test('native OIDC keeps immutable account across email changes and denies revoked users', async () => {
  const { SocialLoginService } = native('service/social-login.service.js');
  const f = fixture();
  const service = new SocialLoginService({}, f.users);
  service.userInfo = async () => ({ openId: 'issuer#subject', user: { email: 'renamed@example.com' } });
  service.findByOpenId = async () => ({ userId: f.detail.id });
  assert.equal(await service.authCallback('oidc', 'code'), f.detail.id);
  f.detail.blakRole = null;
  await assert.rejects(service.authCallback('oidc', 'code'), /Blak ID/);
});
test('role bounds deny directory authority and unknown operations to every human role', () => {
  for (const blakRole of ['reader', 'writer', 'admin']) {
    for (const operation of ['updateUserPassword', 'updateEmail', 'verifyUserDeletion', 'unknown']) {
      assert.equal(policy.allows({ blakRole }, operation), false);
    }
    assert.equal(policy.allows({ blakRole, isBlocked: true }, 'formDetail'), false);
  }
  assert.equal(policy.allows({ blakRole: 'writer' }, 'inviteMember'), false);
  assert.equal(policy.allows({ blakRole: 'admin' }, 'inviteMember'), true);
  assert.equal(policy.allows({ blakRole: 'writer' }, 'createProject', { input: { memberIds: ['other'] } }), false);
  assert.equal(policy.allows({ blakRole: 'writer' }, 'createProject', { input: { memberIds: [] } }), true);
});
test('controller requires a separate strong bearer token', () => {
  process.env.BLAK_FORMS_ROLE_TOKEN = 'fixture-token-'.repeat(4);
  assert.throws(() => bridge.requireController({ headers: { authorization: 'Bearer native-admin-session' } }), /controller/);
  assert.doesNotThrow(() => bridge.requireController({ headers: { authorization: 'Bearer ' + process.env.BLAK_FORMS_ROLE_TOKEN } }));
  delete process.env.BLAK_FORMS_ROLE_TOKEN;
  assert.throws(() => bridge.requireController({ headers: {} }), /controller/);
});
test('invalid or duplicate directory snapshots fail before changes', () => {
  const member = { subject: 'subject', active: true, email: 'fixture@example.com', role: 'reader' };
  for (const value of [[], null, [member, member], [{ ...member, active: 'true' }], [{ ...member, role: 'owner' }]]) {
    assert.throws(() => policy.directoryMembers(value));
  }
});
function models() {
  const rows = [{ _id: 'native', blakRole: 'writer' }];
  const updates = [];
  return { rows, updates, users: { find: () => ({ lean: async () => rows }), exists: async () => true,
    updateOne: async (where, update) => { updates.push(where); rows.find(row => row._id === where._id).blakRole = update.$set.blakRole; } },
    accounts: { find: () => ({ lean: async () => [{ kind: 'oidc', userId: 'native', openId: process.env.OIDC_ISSUER + '#subject' }] }) } };
}
test('reconciliation revokes missing grants and restores the same native identity', async () => {
  const f = models();
  const member = { subject: 'subject', active: true, email: 'renamed@example.com', role: null };
  assert.equal((await bridge.reconcile(f.users, f.accounts, [member])).disabled, 1);
  member.role = 'reader';
  assert.equal((await bridge.reconcile(f.users, f.accounts, [member])).activated, 1);
  assert.deepEqual(f.updates, [{ _id: 'native' }, { _id: 'native' }]);
  assert.equal(f.rows[0].blakRole, 'reader');
});
test('new subject with existing email fails without mutations or relinking', async () => {
  const f = models();
  await assert.rejects(bridge.reconcile(f.users, f.accounts, [{ subject: 'new', active: true,
    email: 'existing@example.com', role: 'admin' }]), /collision/);
  assert.equal(f.updates.length, 0);
});
