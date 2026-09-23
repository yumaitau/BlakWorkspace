'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const {
  judgeReply, scanStream, listFiles, openStore, holdFile, releaseFile, deleteHeld,
  homeFragment, pageHtml, isAdmin, createLoop,
} = require('../file-guard');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'file-guard-'));
}

test('a clamd FOUND reply is unsafe and an OK reply is clean', () => {
  assert.equal(judgeReply('stream: OK').clean, true);
  assert.deepEqual(judgeReply('stream: Eicar-Test-Signature FOUND'), { clean: false, signature: 'Eicar-Test-Signature' });
  assert.throws(() => judgeReply('INSTREAM size limit exceeded ERROR'), /did not finish/);
});

test('INSTREAM sends the file and a zero-length end chunk', async () => {
  const chunks = [];
  const socket = new Readable({ read() {} });
  socket.write = (buf) => { chunks.push(Buffer.from(buf)); return true; };
  socket.end = () => { socket.push('stream: Eicar-Test-Signature FOUND\0'); socket.push(null); };
  socket.destroy = () => {};
  const result = await scanStream(socket, Readable.from([Buffer.from('EICAR')]), 5);
  assert.equal(result.clean, false);
  assert.equal(chunks[0].toString(), 'zINSTREAM\0');
  assert.equal(chunks[1].readUInt32BE(0), 5);
  assert.equal(chunks.at(-1).readUInt32BE(0), 0);
});

test('holding a drive file moves it aside and explains how to get it back', () => {
  const root = tempRoot();
  const owner = path.join(root, 'user-1');
  fs.mkdirSync(owner);
  const file = path.join(owner, 'Budget.odt');
  fs.writeFileSync(file, 'unsafe');
  const store = openStore(path.join(root, 'guard'));
  const held = holdFile(store, { path: file, name: 'Budget.odt', size: 6, mtimeMs: 1 }, 'Eicar-Test-Signature', root);
  assert.equal(fs.existsSync(file), false);
  assert.match(fs.readFileSync(file + '.held.txt', 'utf8'), /Put it back/);
  assert.doesNotMatch(fs.readFileSync(file + '.held.txt', 'utf8'), /ClamAV|quarantine|virus/i);
  const admin = { sub: 'admin', apps: ['idp'], roles: {} };
  const reader = { sub: 'user-1', apps: ['drive'], roles: { drive: 'reader' } };
  const other = { sub: 'user-2', apps: ['drive'], roles: { drive: 'reader' } };
  assert.equal(isAdmin(admin), true);
  const adminPage = pageHtml(admin, store.list(), '');
  assert.match(adminPage, /Budget\.odt/);
  assert.match(adminPage, /Put it back/);
  assert.match(adminPage, /not deleted/);
  assert.match(adminPage, /data-testid="release-file"/);
  assert.match(homeFragment(store.list()), /1 file was held back/);
  const readerPage = pageHtml(reader, store.list(), '');
  assert.match(readerPage, /ask a workspace admin/i);
  assert.doesNotMatch(readerPage, /data-testid="release-file"/);
  assert.match(pageHtml(other, store.list(), ''), /No files are held back/);
  releaseFile(store, held.id, root);
  assert.equal(fs.readFileSync(file, 'utf8'), 'unsafe');
  assert.equal(fs.existsSync(file + '.held.txt'), false);
});

test('delete removes the held copy and a second pass does not hold a clean file again', async () => {
  const root = tempRoot();
  const owner = path.join(root, 'user-9');
  fs.mkdirSync(path.join(owner, '.oc-nodes'), { recursive: true });
  fs.writeFileSync(path.join(owner, '.oc-nodes', 'blob'), 'hidden');
  fs.writeFileSync(path.join(owner, 'Notes.txt'), 'clean');
  fs.writeFileSync(path.join(owner, 'Ok.txt'), 'fine');
  const store = openStore(tempRoot());
  const seen = [];
  const loop = createLoop({
    root,
    store,
    scanFile: async (file) => {
      seen.push(path.basename(file));
      return { clean: path.basename(file) !== 'Notes.txt', signature: 'Bad.File' };
    },
  });
  await loop.pass();
  assert.deepEqual(seen.sort(), ['Notes.txt', 'Ok.txt']);
  assert.equal(fs.existsSync(path.join(owner, 'Ok.txt')), true);
  const held = store.list()[0];
  assert.equal(held.name, 'Notes.txt');
  deleteHeld(store, held.id);
  assert.equal(store.list().length, 0);
  assert.equal(fs.existsSync(path.join(owner, 'Notes.txt.held.txt')), false);
  seen.length = 0;
  fs.writeFileSync(path.join(owner, 'Notes.txt'), 'clean');
  await loop.pass();
  await loop.pass();
  assert.deepEqual(seen, ['Notes.txt']);
  assert.equal(fs.existsSync(path.join(owner, 'Ok.txt')), true);
});
