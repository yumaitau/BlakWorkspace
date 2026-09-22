'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.BLAK_CHAT_ROLES = 'true';
const bridge = require('./role-bridge.cjs');
let user = { _id: 'member', active: true, blakRole: 'writer', roles: ['blak-chat-writer'], services: { blakid: { id: 'immutable' } } };
let startup, changed, calls = 0, closed = 0;
const Meteor = {
  Error: class extends Error {},
  startup(callback) { startup = callback; },
  server: {
    method_handlers: { sendMessage() { calls++; }, loadHistory() { calls++; }, login() { return 'native login validation'; } },
    publish_handlers: { room() { calls++; } }, universal_publish_handlers: [],
    sessions: new Map([['session', { userId: 'member', close() { closed++; } }]]),
  },
  methods(handlers) { Object.assign(this.server.method_handlers, handlers); },
  publish(name, handler) { this.server.publish_handlers[name] = handler; },
  users: { find() { return { async observeChangesAsync(callbacks) { changed = callbacks.changed; } }; } },
};
const Users = {
  async findOneById(id) { return id === user._id ? user : null; },
  find(query) { return { async toArray() { return query['services.blakid.id'] === user.services.blakid.id ? [user] : []; } }; },
};
bridge.install({ Meteor, Users });

test('existing method token is checked against current native role; observers close sessions', async () => {
  await startup();
  await Meteor.server.method_handlers.sendMessage.call({ userId: 'member' });
  assert.equal(calls, 1);
  user = { ...user, blakRole: 'reader', roles: ['blak-chat-reader'] };
  changed('member');
  assert.equal(closed, 1);
  await assert.rejects(Meteor.server.method_handlers.sendMessage.call({ userId: 'member' }));
  await Meteor.server.method_handlers.loadHistory.call({ userId: 'member' });
  assert.equal(calls, 2);
  user.active = false;
  await assert.rejects(Meteor.server.publish_handlers.room.call({ userId: 'member' }));
  await assert.rejects(Meteor.server.method_handlers.loadHistory.call({ userId: 'member' }));
  assert.equal(calls, 2);
  user.active = true;
  await Meteor.server.publish_handlers.room.call({ userId: 'member' });
  assert.equal(calls, 3);
});

test('newly registered methods remain capped; password and foreign-subject login fail', async () => {
  Meteor.methods({ deleteMessage() { calls++; } });
  await assert.rejects(Meteor.server.method_handlers.deleteMessage.call({ userId: 'member' }));
  await assert.rejects(bridge.validateLogin({ type: 'password', user }));
  await assert.rejects(bridge.validateLogin({ type: 'oauth', user }));
  await assert.rejects(bridge.validateLogin({ type: 'google', user }));
  await bridge.validateLogin({ type: 'blakid', user });
  await bridge.validateLogin({ type: 'resume', user });
  await assert.rejects(bridge.validateExternal('blakid', { id: 'different', email: 'same@example.invalid' }));
  await assert.rejects(bridge.validateExternal('google', { id: 'immutable' }));
  await bridge.validateExternal('blakid', { id: 'immutable' });
});
