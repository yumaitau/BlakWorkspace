'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const backups = require('../backups');

const admin = { sub: 'a', name: 'Admin', apps: ['idp', 'drive'] };
const driveAdmin = { sub: 'd', name: 'Drive admin', apps: ['drive'], roles: { drive: 'admin' } };
const state = {
  running: null, failed: [], keyPresent: true, next: { backup: 1790443800 },
  backups: [{ name: 'workspace-20260924T173000Z.tar.gpg', size: 2e9, created: 1790271000 }, { name: 'workspace-20260925T173000Z.tar.gpg', size: 2.1e9, created: 1790357400 }],
  lastBackup: null, lastCheck: { completed_at: 1790230144, files_verified: 16288, database_checks: { postgres: 7, mongo: 5 } }, lastRestore: null,
  places: [{ id: 'aaaa0001', kind: 's3', name: 'R2 <off-site>', keep: 7, endpoint: 'https://acct.example.com', bucket: 'blak', last: { ok: false, at: 1790357700, error: 'Bucket not found' } }],
};

function request(method, body = '') {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method; req.headers = {};
  return req;
}
function response() {
  return { status: 0, headers: {}, body: '', writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(body = '') { this.body = String(body); } };
}
function fakeAgent(overrides = {}) {
  const calls = [];
  const agent = {
    calls,
    status: async () => state,
    start: async (action, body) => { calls.push(['start', action, body]); return { started: action }; },
    addPlace: async (place) => { calls.push(['addPlace', place]); return place; },
    removePlace: async (id) => { calls.push(['removePlace', id]); },
    testPlace: async (id) => { calls.push(['testPlace', id]); },
    placeBackups: async () => [],
    key: async () => 'recovery-key-value',
    ...overrides,
  };
  return agent;
}
async function hit(handle, method, path, user, body) {
  const res = response();
  const handled = await handle(request(method, body), res, new URL(path, 'http://x'), user);
  return { handled, res };
}
const shell = (user, active, title, main) => `<shell ${active}>${main}</shell>`;

test('only Blak ID admins manage backups', () => {
  assert.equal(backups.canManage(admin), true);
  assert.equal(backups.canManage(driveAdmin), false);
  assert.equal(backups.canManage(null), false);
});

test('agent client sends the token and turns failures into plain messages', async () => {
  const seen = [];
  const ok = backups.createClient('http://10.42.0.1:8093/', 'secret', async (url, options) => { seen.push([url, options]); return { ok: true, json: async () => ({ started: 'backup' }) }; });
  await ok.start('backup');
  assert.equal(seen[0][0], 'http://10.42.0.1:8093/jobs/backup');
  assert.equal(seen[0][1].headers.authorization, 'Bearer secret');
  const refused = backups.createClient('http://agent', 't', async () => ({ ok: false, status: 409, json: async () => ({ error: 'Another backup job is running. Wait for it to finish.' }) }));
  await assert.rejects(refused.start('backup'), { status: 409, message: /Another backup job/ });
  const down = backups.createClient('http://agent', 't', async () => { throw new Error('ECONNREFUSED 10.42.0.1'); });
  await assert.rejects(down.status(), { status: 503, message: 'The backup service is not answering.' });
});

test('page lists backups newest first, escapes names and hides the key until asked', () => {
  const html = backups.pageHtml(state);
  assert.ok(html.indexOf('2026-09-25 17:30') < html.indexOf('2026-09-24 17:30'));
  assert.match(html, /R2 &lt;off-site&gt;/);
  assert.match(html, /The last copy failed .*Bucket not found/);
  assert.match(html, /name=archive value="workspace-20260925T173000Z.tar.gpg"/);
  assert.match(html, /16288 files and 2 databases read back correctly/);
  assert.doesNotMatch(html, /recovery-key-value/);
  assert.doesNotMatch(html, /backup-live/);
  assert.match(backups.pageHtml(state, { key: 'recovery-key-value' }), /recovery-key-value/);
  assert.match(backups.pageHtml(null), /Backups are not available right now/);
});

test('a running job disables new jobs and keeps the page polling', () => {
  const html = backups.pageHtml({ ...state, running: { action: 'restore', step: 'Putting data back' } });
  assert.match(html, /Restoring the workspace: Putting data back/);
  assert.match(html, /data-testid="backup-now" disabled/);
  assert.match(html, /fetch\('\/api\/backups'/);
});

test('routes refuse people who are not Blak ID admins', async () => {
  const handle = backups.createRoutes({ agent: fakeAgent(), shell });
  assert.equal((await hit(handle, 'GET', '/held-files', admin)).handled, false);
  assert.equal((await hit(handle, 'GET', '/backups', null)).res.headers.location, '/login');
  assert.equal((await hit(handle, 'GET', '/api/backups', null)).res.status, 401);
  const refused = await hit(handle, 'POST', '/backups/run', driveAdmin, 'action=backup');
  assert.equal(refused.res.status, 403);
  assert.match(refused.res.body, /Ask a workspace admin/);
});

test('restore needs RESTORE typed and passes the chosen backup to the agent', async () => {
  const agent = fakeAgent();
  const handle = backups.createRoutes({ agent, shell });
  const unconfirmed = await hit(handle, 'POST', '/backups/restore', admin, 'archive=workspace-20260925T173000Z.tar.gpg&confirm=restore');
  assert.equal(unconfirmed.res.status, 400);
  assert.match(unconfirmed.res.body, /Type RESTORE in capitals/);
  assert.deepEqual(agent.calls, []);
  const started = await hit(handle, 'POST', '/backups/restore', admin, 'archive=workspace-20260925T173000Z.tar.gpg&place=aaaa0001&confirm=RESTORE');
  assert.equal(started.res.status, 303);
  assert.equal(started.res.headers.location, '/backups?done=restore');
  assert.deepEqual(agent.calls, [['start', 'restore', { archive: 'workspace-20260925T173000Z.tar.gpg', place: 'aaaa0001' }]]);
});

test('jobs, places and agent errors', async () => {
  const agent = fakeAgent({ start: async () => { throw Object.assign(new Error('Another backup job is running. Wait for it to finish.'), { status: 409 }); } });
  const handle = backups.createRoutes({ agent, shell });
  const busy = await hit(handle, 'POST', '/backups/run', admin, 'action=backup');
  assert.equal(busy.res.status, 409);
  assert.match(busy.res.body, /Another backup job is running/);
  assert.equal((await hit(handle, 'POST', '/backups/run', admin, 'action=restore')).res.status, 400);
  const added = await hit(handle, 'POST', '/backups/places', admin, 'kind=smb&name=NAS&share=%2F%2Fnas%2Fb&username=u&password=p&admin=1');
  assert.equal(added.res.headers.location, '/backups?done=added');
  assert.deepEqual(agent.calls.at(-1), ['addPlace', { kind: 'smb', name: 'NAS', share: '//nas/b', username: 'u', password: 'p' }]);
  await hit(handle, 'POST', '/backups/places/aaaa0001/test', admin);
  assert.deepEqual(agent.calls.at(-1), ['testPlace', 'aaaa0001']);
  assert.equal((await hit(handle, 'POST', '/backups/places/ZZZZ/remove', admin)).res.status, 404);
  const key = await hit(handle, 'POST', '/backups/key', admin);
  assert.match(key.res.body, /recovery-key-value/);
  const api = await hit(handle, 'GET', '/api/backups', admin);
  assert.deepEqual(JSON.parse(api.res.body), { running: null, label: '', failed: [] });
});

test('no agent configured shows setup guidance instead of failing', async () => {
  const handle = backups.createRoutes({ agent: null, shell });
  const page = await hit(handle, 'GET', '/backups', admin);
  assert.equal(page.res.status, 200);
  assert.match(page.res.body, /Backups are not available right now/);
  assert.equal((await hit(handle, 'POST', '/backups/run', admin, 'action=backup')).res.status, 503);
});
