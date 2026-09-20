'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { exportOwner, documents } = require('../knowledge-export');
const { createDrawStore } = require('../draw-store');
test('export credentials bind one owner and reject unrecognised credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blak-export-'));
  try {
    const file = path.join(dir, 'accounts.json');
    fs.writeFileSync(file, JSON.stringify([{ owner: 'alice', sha256: crypto.createHash('sha256').update('alice-token').digest('hex') }]));
    assert.equal(exportOwner('Bearer alice-token', file), 'alice');
    for (const header of [undefined, 'Bearer bob-token', 'Basic alice-token']) assert.throws(() => exportOwner(header, file), { status: 401 });
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('draw exports exclude other owners, deleted shapes and embedded binary files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blak-draw-export-'));
  try {
    const store = createDrawStore(dir);
    const alice = store.create('alice', 'Plan');
    store.create('bob', 'Private Bob');
    store.save('alice', alice.id, { revision: 1, scene: { appState: {}, files: { secret: { dataURL: 'binary' } }, elements: [{ id: 'a', type: 'text', text: 'Plan text' }, { id: 'b', text: 'Deleted', isDeleted: true }] } });
    const exported = documents('draw', 'alice', store, {});
    assert.equal(exported.length, 1);
    assert.equal(exported[0].content.elements[0].text, 'Plan text');
    assert.equal(exported[0].content.elements.length, 1);
    assert.ok(!JSON.stringify(exported).includes('binary'));
    assert.ok(!JSON.stringify(exported).includes('Private Bob'));
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('flow exports preserve owner boundaries and omit connector parameters and event payloads', () => {
  const store = { flows: { a: { id: 'a', owner: 'alice', name: 'Plan', starter: { type: 'schedule' }, steps: [{ connector: 'drive', action: 'read', params: { token: 'sensitive' } }] }, b: { id: 'b', owner: 'bob', name: 'Bob flow' } }, runs: [{ id: 'run', flowId: 'a', status: 'ok', event: { password: 'sensitive' } }] };
  const exported = documents('flow', 'alice', null, store);
  assert.equal(exported.length, 1);
  assert.equal(exported[0].content.runs[0].status, 'ok');
  assert.ok(!JSON.stringify(exported).includes('sensitive'));
  assert.throws(() => documents('unknown', 'alice', null, store), { status: 404 });
});
