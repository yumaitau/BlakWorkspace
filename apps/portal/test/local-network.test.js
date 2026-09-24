'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { localNetworkPolicy } = require('../../../e2e/helpers/local-network');

test('local network gate requires exact origins and denies unlisted ports, schemes and hosts', () => {
  const gate = localNetworkPolicy(['https://workspace.test', 'https://workspace.test:8444']);
  for (const url of ['https://workspace.test/', 'https://workspace.test:8444/login', 'wss://workspace.test/socket']) {
    assert.equal(gate.permits(url), true);
  }
  for (const url of ['http://workspace.test/', 'https://workspace.test:8445/', 'https://workspace.test.attacker.test/', 'https://attacker.test/', 'ws://workspace.test/socket', 'https://user:secret@workspace.test/']) {
    assert.equal(gate.permits(url), false);
  }
  for (const origins of [[], null, ['https://workspace.test/path'], ['https://workspace.test/?key=secret'], ['ftp://workspace.test'], ['https://user:secret@workspace.test']]) {
    assert.throws(() => localNetworkPolicy(origins));
  }
});

test('dependency report counts attempts without retaining credentials, paths or query strings', () => {
  const gate = localNetworkPolicy(['https://workspace.test']);
  gate.block('https://name:secret@remote.test/private-record?token=secret', 'http');
  gate.block('https://remote.test/another', 'http');
  gate.block('wss://remote.test/private?token=secret', 'websocket');
  assert.deepEqual(gate.report(), [
    { origin: 'http https://remote.test', count: 2 },
    { origin: 'websocket wss://remote.test', count: 1 },
  ]);
});
