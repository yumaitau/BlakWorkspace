'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { role, methodAllowed, routeAllowed } = require('./role-policy.cjs');
const member = (blakRole, extra = {}) => ({ active: true, blakRole, roles: ['blak-chat-' + blakRole], ...extra });

test('reader keeps native reads and personal preferences but cannot mutate owned content', () => {
  const reader = member('reader', { roomRoles: ['owner', 'moderator'] });
  for (const name of ['loadHistory', 'readMessages', 'saveUserPreferences']) assert.equal(methodAllowed(reader, name), true);
  for (const name of ['sendMessage', 'updateMessage', 'deleteMessage', 'saveRoomSettings']) assert.equal(methodAllowed(reader, name), false);
  assert.equal(routeAllowed(reader, 'v1', 'channels.history', 'GET'), true);
  assert.equal(routeAllowed(reader, 'v1', 'chat.update', 'POST'), false);
});

test('writer edits content while admin manages rooms; neither controls directory or server trust', () => {
  for (const current of ['writer', 'admin']) {
    assert.equal(methodAllowed(member(current), 'sendMessage'), true);
    for (const name of ['setUserPassword', 'setAdminStatus', 'saveSetting', 'addOAuthService', 'insertOrUpdateUser']) {
      assert.equal(methodAllowed(member(current), name), false);
    }
    for (const route of ['users.update', 'users.create', 'settings/:_id', 'roles.addUserToRole']) {
      assert.equal(routeAllowed(member(current), 'v1', route, 'POST'), false);
    }
  }
  assert.equal(methodAllowed(member('writer'), 'addUsersToRoom'), false);
  assert.equal(methodAllowed(member('admin'), 'addUsersToRoom'), true);
});

test('revoked, disabled and mismatched native grants cannot read', () => {
  for (const user of [null, member(null), member('reader', { active: false }), member('reader', { roles: ['admin'] }), member('reader', { roles: ['blak-chat-reader', 'admin'] })]) {
    assert.equal(role(user), null);
    assert.equal(methodAllowed(user, 'loadHistory'), false);
    assert.equal(routeAllowed(user, 'v1', 'channels.history', 'GET'), false);
  }
  assert.equal(routeAllowed({ _id: 'revoked', active: false }, 'v1', 'logout', 'POST'), true);
  assert.equal(routeAllowed(null, 'v1', 'logout', 'POST'), false);
});

test('method tunnel checks parsed operation; unknown routes and HTTP methods fail closed', () => {
  const reader = member('reader');
  const invoke = method => ({ message: JSON.stringify({ msg: 'method', method, params: [] }) });
  assert.equal(routeAllowed(reader, 'v1', 'method.call/:method', 'POST', invoke('loadHistory')), true);
  assert.equal(routeAllowed(reader, 'v1', 'method.call/:method', 'POST', invoke('sendMessage')), false);
  assert.equal(routeAllowed(reader, 'v1', 'method.call/:method', 'POST', { message: '{' }), false);
  assert.equal(routeAllowed(reader, 'v1', 'channels.history', 'POST'), false);
  assert.equal(routeAllowed(reader, 'v2', 'channels.history', 'GET'), false);
  assert.equal(routeAllowed(member('admin'), 'v1', 'new.serverAdminEndpoint', 'GET'), false);
});
