'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { anchors, inspect, apply } = require('./patch.cjs');

function bundle() {
  return anchors.map(([, before]) => before).join('\n');
}

test('a moved anchor is named and a matching bundle asks for the new hash', () => {
  const source = bundle().replace(anchors[0][1], 'gone');
  const missing = inspect(source);
  assert.deepEqual(missing.missing, ['accounts']);
  const intact = bundle();
  const report = inspect(intact);
  assert.deepEqual(report.missing, []);
  assert.equal(report.pinned, false);
  assert.match(report.hash, /^[a-f0-9]{64}$/);
  assert.throws(() => apply(intact), /Anchors still match/);
});

test('the pinned hash applies every hook once', () => {
  const source = bundle();
  const pin = createHash('sha256').update(source).digest('hex');
  const patched = apply(source, pin);
  assert.match(patched, /role-bridge\.cjs/);
  assert.equal(patched.split('registerRoutes').length, 2);
  assert.equal(patched.split('validateExternal').length, 2);
});
