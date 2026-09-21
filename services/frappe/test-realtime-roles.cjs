const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const file = process.env.FRAPPE_REALTIME || '/home/frappe/frappe-bench/apps/frappe/realtime/index.js';
const source = readFileSync(file, 'utf8');
const start = source.indexOf('subscriber.subscribe("events", (message) => {');
assert(start >= 0);
const body = source.slice(start + 'subscriber.subscribe("events", (message) => {'.length, source.indexOf('\n\t});', start));

test('native Redis role event disconnects only the affected user in its own site', () => {
  const calls = [];
  const io = { of(namespace) { return {
    to(room) { return { emit(event) { calls.push(['emit', namespace, room, event]); } }; },
    in(room) { return { disconnectSockets(close) { calls.push(['disconnect', namespace, room, close]); } }; },
  }; } };
  const consume = new Function('io', 'realtime', 'return message => {' + body + '};')(io, { emit() { throw Error('Unexpected broadcast'); } });
  consume(JSON.stringify({ namespace: 'tenant', room: 'user:reader@example.invalid', event: 'blak_roles_changed', message: {} }));
  assert.deepEqual(calls, [['emit', '/tenant', 'user:reader@example.invalid', 'blak_roles_changed'], ['disconnect', '/tenant', 'user:reader@example.invalid', true]]);
  calls.length = 0;
  consume(JSON.stringify({ namespace: 'tenant', room: 'doc:CRM Lead/one', event: 'doc_update', message: {} }));
  assert.deepEqual(calls, [['emit', '/tenant', 'doc:CRM Lead/one', 'doc_update']]);
});
