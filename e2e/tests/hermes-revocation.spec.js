'use strict';
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { identityCookies, updateIdentity } = require('../helpers/identity');
const { syncAccount, syncNow, serviceURL } = require('../helpers/sync');
// Native fixture tokens are never retained in browser traces or screenshots.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
function kube(args, input) {
  try { return execFileSync('kubectl', ['-n', process.env.BLAK_E2E_NAMESPACE || 'blak-micro', ...args], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 }); }
  catch { throw Error('Hermes fixture administration failed; credentials omitted'); }
}
function editSecret(name, change) {
  const secret = JSON.parse(kube(['get', 'secret', name, '-o', 'json']));
  const value = JSON.parse(Buffer.from(secret.data['accounts.json'], 'base64').toString());
  const next = change(value);
  kube(['patch', 'secret', name, '--type=merge', '--patch-file=/dev/stdin'], JSON.stringify({ metadata: { resourceVersion: secret.metadata.resourceVersion }, stringData: { 'accounts.json': JSON.stringify(next) } }));
}

test('Hermes removes revoked source copies from native files, retrieval and model while the token remains valid', async ({ page, context, baseURL }) => {
  test.setTimeout(600000);
  const key = 'hermes-revoke-' + crypto.randomBytes(7).toString('hex');
  const admin = syncAccount();
  const origin = new URL(process.env.BLAK_E2E_HERMES_URL || admin.hermes.public_base || 'https://hermes.workspace.example.com').origin;
  const endpoint = serviceURL('hermes', 8080);
  async function api(token, method, path, body) {
    const response = await fetch(endpoint + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw Error('Native fixture API returned HTTP ' + response.status);
    return response.json();
  }
  await context.addCookies(await identityCookies(key, 'Hermes revocation fixture', ['draw', 'hermes']));
  const portal = await (await page.request.get('/api/me')).json();
  let native, token, board, enrolled = false, exporter = false;
  try {
    await page.goto(origin + '/oauth/oidc/login');
    await page.waitForURL(url => url.origin === origin && url.pathname === '/');
    await page.waitForFunction(() => Boolean(localStorage.getItem('token')));
    token = await page.evaluate(() => localStorage.getItem('token'));
    const profile = await api(token, 'GET', '/api/v1/auths/');
    const users = await api(admin.hermes.token, 'GET', '/api/v1/users/?query=' + encodeURIComponent(profile.email));
    const linked = users.users.find(user => user.id === profile.id);
    expect(linked?.oauth?.oidc?.sub).toBe(portal.sub);
    native = profile;
    // Disposable setup elevation lets the upstream owner create private model/KB fixtures.
    await api(admin.hermes.token, 'POST', '/api/v1/users/' + native.id + '/update', { role: 'admin' });
    const exportToken = crypto.randomBytes(40).toString('base64url');
    editSecret('blak-portal-exports', values => [...values, { owner: portal.sub, sha256: crypto.createHash('sha256').update(exportToken).digest('hex') }]);
    exporter = true;
    await expect.poll(async () => (await page.request.get(baseURL + '/api/knowledge-export/draw', { headers: { authorization: 'Bearer ' + exportToken } })).status(), { timeout: 120000, intervals: [1000, 3000] }).toBe(200);
    board = await (await page.request.post(baseURL + '/api/draw', { data: { name: key } })).json();
    const phrase = 'REVOKED-' + crypto.randomBytes(10).toString('hex');
    await page.request.put(baseURL + '/api/draw/' + board.id, { data: { revision: board.revision, scene: { appState: {}, files: {}, elements: [{ id: 'text', type: 'text', text: phrase, x: 0, y: 0, width: 200, height: 30 }] } } });
    const mapping = { name: key, portal_owner: portal.sub, owner_id: native.id, hermes: { base: 'http://hermes:8080', token }, sources: { draw: { base: 'http://portal:3000', public_base: baseURL, token: exportToken, expected_user: portal.sub } } };
    editSecret('blak-hermes-sync', config => ({ ...config, accounts: [...config.accounts, mapping] }));
    enrolled = true;
    // Secret projection and the scheduler are asynchronous; poll the native output.
    await expect.poll(async () => {
      syncNow();
      return (await api(token, 'GET', '/api/v1/knowledge/')).items.some(item => item.name === 'Blak Workspace · Draw');
    }, { timeout: 180000, intervals: [1000, 3000] }).toBe(true);
    const collection = (await api(token, 'GET', '/api/v1/knowledge/')).items.find(item => item.name === 'Blak Workspace · Draw');
    const retrieval = { collection_names: [collection.id], query: phrase, k: 20 };
    expect(JSON.stringify(await api(token, 'POST', '/api/v1/retrieval/query/collection', retrieval))).toContain(phrase);
    const fileListing = await api(token, 'GET', '/api/v1/knowledge/' + collection.id + '/files');
    const copies = fileListing.items || fileListing.files || fileListing;
    expect(Array.isArray(copies)).toBe(true);
    expect(copies.length).toBeGreaterThan(0);
    updateIdentity(key, { grants: ['hermes'] });
    syncNow();
    expect((await api(token, 'GET', '/api/v1/auths/')).id).toBe(native.id);
    for (const file of copies) {
      const response = await fetch(endpoint + '/api/v1/files/' + file.id, { headers: { authorization: 'Bearer ' + token } });
      expect(response.status).toBe(404);
    }
    const remaining = await api(token, 'GET', '/api/v1/knowledge/' + collection.id + '/files');
    expect(JSON.stringify(remaining)).not.toContain(phrase);
    const model = await api(token, 'GET', '/api/v1/models/model?id=' + encodeURIComponent('blak-workspace-' + native.id));
    expect(model.user_id).toBe(native.id);
    expect(model.meta.knowledge).toEqual([]);
    const query = await fetch(endpoint + '/api/v1/retrieval/query/collection', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(retrieval) });
    expect([200, 400, 404]).toContain(query.status);
    expect(await query.text()).not.toContain(phrase);
  } finally {
    if (enrolled) {
      editSecret('blak-hermes-sync', config => ({ ...config, accounts: config.accounts.map(account => account.name === key ? { ...account, sources: {} } : account) }));
      syncNow();
      editSecret('blak-hermes-sync', config => ({ ...config, accounts: config.accounts.filter(account => account.name !== key) }));
    }
    if (exporter) editSecret('blak-portal-exports', values => values.filter(item => item.owner !== portal.sub));
    if (native) await api(admin.hermes.token, 'DELETE', '/api/v1/users/' + native.id);
    // Restore access only to delete this fixture's original drawing.
    updateIdentity(key, { grants: ['draw', 'hermes'] });
    if (board?.id) {
      await context.addCookies(await identityCookies(key, 'Hermes revocation fixture', ['draw', 'hermes']));
      const current = await (await page.request.get(baseURL + '/api/draw/' + board.id)).json();
      expect((await page.request.delete(baseURL + '/api/draw/' + board.id, { data: { revision: current.revision } })).ok()).toBeTruthy();
    }
  }
});
