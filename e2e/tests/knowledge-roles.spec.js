'use strict';
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { identityCookies, updateIdentity } = require('../helpers/identity');
const { serviceURL } = require('../helpers/sync');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function nativeScript(source) {
  try {
    return execFileSync('kubectl', ['-n', 'blak-micro', 'exec', '-i', 'deploy/outline', '--', 'node'], { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
  } catch { throw Error('Native Knowledge fixture operation failed; credentials omitted'); }
}
function operatorSession() {
  const output = nativeScript(`require('./build/server/scripts/bootstrap');
    const {User}=require('./build/server/models');
    (async()=>{const user=await User.findByPk(process.env.BLAK_ROLE_CONTROLLER_ID);
      if (!user?.isAdmin || user.isSuspended) throw Error('Native operator mismatch');
      console.log('BLAK_SESSION='+JSON.stringify({id:user.id,token:user.getSessionToken(new Date(Date.now()+20*60*1000))}));process.exit(0);
    })().catch(()=>process.exit(1));`);
  const line = output.split('\n').find(line => line.startsWith('BLAK_SESSION='));
  if (!line) throw Error('Native Knowledge session unavailable');
  return JSON.parse(line.slice('BLAK_SESSION='.length));
}
function revokeOperator(operator) {
  nativeScript(`require('./build/server/scripts/bootstrap');
    const {User}=require('./build/server/models');
    (async()=>{if(process.env.BLAK_ROLE_CONTROLLER_ID!==${JSON.stringify(operator.id)}) throw Error('Controller changed');
      const user=await User.findByPk(process.env.BLAK_ROLE_CONTROLLER_ID);await user.rotateJwtSecret();process.exit(0);
    })().catch(()=>process.exit(1));`);
}

test('native Knowledge roles cap owned documents and revoke existing sessions and keys', async ({ page, context }) => {
  test.setTimeout(840000);
  const key = 'knowledge-roles-' + crypto.randomBytes(6).toString('hex');
  const operator = operatorSession(), endpoint = serviceURL('sites', 3000);
  const origin = new URL(process.env.BLAK_E2E_KNOWLEDGE_URL).origin;
  async function response(token, path, data = {}) {
    return fetch(endpoint + '/api/' + path, { method: 'POST', headers: { authorization: 'Bearer ' + token, origin, 'content-type': 'application/json' }, body: JSON.stringify(data) });
  }
  async function api(token, path, data) {
    const result = await response(token, path, data);
    if (!result.ok) throw Error('Native Knowledge fixture returned HTTP ' + result.status + ' at ' + path);
    return result.json();
  }
  let native, token, collection, document, group, csrf, verifiedFixture = false;
  async function waitRole(role) {
    const expected = { reader: 'viewer', writer: 'member', admin: 'admin' };
    await expect.poll(async () => {
      const identities = await api(operator.token, 'users.blak_identities');
      const user = identities.data.find(user => user.id === native.id);
      return user ? { role: user.role, suspended: user.suspended } : null;
    }, { timeout: 160000, intervals: [2000, 4000] }).toEqual({ role: expected[role] || 'viewer', suspended: !role });
  }
  async function denied(path, data) {
    const result = await response(token, path, data);
    expect([401, 403, 404]).toContain(result.status);
  }
  async function cookieAPI(path, data = {}) {
    return page.request.post(origin + '/api/' + path, { data, headers: { origin, 'x-csrf-token': csrf } });
  }
  try {
    await context.addCookies(await identityCookies(key, 'Knowledge native role fixture', ['sites'], { sites: 'writer' }));
    const portal = await (await page.request.get('/api/me')).json();
    await page.goto(origin + '/auth/oidc');
    await page.waitForURL(url => url.origin === origin && !url.pathname.startsWith('/auth'), { timeout: 60000 });
    csrf = (await context.cookies(origin)).find(cookie => /csrfToken$/.test(cookie.name))?.value;
    if (!csrf) throw Error('Native Knowledge CSRF cookie unavailable');
    const profile = await cookieAPI('auth.info');
    expect(profile.ok()).toBeTruthy();
    native = (await profile.json()).data.user;
    const identities = await api(operator.token, 'users.blak_identities');
    expect(identities.data.find(user => user.id === native.id)?.subject).toBe(portal.sub);
    verifiedFixture = true;
    await waitRole('writer');
    const createdKey = await cookieAPI('apiKeys.create', { name: key });
    expect(createdKey.ok()).toBeTruthy();
    token = (await createdKey.json()).data.value;
    expect(typeof token).toBe('string');
    collection = (await api(token, 'collections.create', { name: key, permission: null })).data;
    document = (await api(token, 'documents.create', { title: key, collectionId: collection.id, text: '# Native role fixture\n\n' + key, publish: true })).data;
    expect((await cookieAPI('documents.update', { id: document.id, title: key + '-writer' })).ok()).toBeTruthy();
    await denied('users.update_role', { id: native.id, role: 'admin' });
    await denied('groups.create', { name: key });
    const documentURL = new URL(document.url, origin);
    expect(documentURL.origin).toBe(origin);
    await page.goto(documentURL.href);
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible({ timeout: 60000 });
    updateIdentity(key, { roles: { sites: 'reader' } });
    await waitRole('reader');
    expect((await api(token, 'documents.info', { id: document.id })).data.title).toBe(key + '-writer');
    await denied('documents.update', { id: document.id, title: 'forbidden' });
    await denied('documents.delete', { id: document.id });
    await denied('documents.create', { title: 'forbidden', collectionId: collection.id, text: 'forbidden', publish: true });
    await denied('collections.update', { id: collection.id, name: 'forbidden' });
    await denied('collections.delete', { id: collection.id });
    expect((await cookieAPI('documents.update', { id: document.id, title: 'forbidden-cookie' })).status()).toBe(403);
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0, { timeout: 60000 });
    updateIdentity(key, { roles: { sites: 'admin' } });
    await waitRole('admin');
    group = (await api(token, 'groups.create', { name: key })).data;
    await denied('users.update_role', { id: native.id, role: 'viewer' });
    await denied('users.suspend', { id: operator.id });
    await denied('users.delete', { id: operator.id });
    updateIdentity(key, { roles: { sites: 'reader' } });
    await waitRole('reader');
    await denied('groups.create', { name: key + '-forbidden' });
    updateIdentity(key, { active: false });
    await waitRole(null);
    await denied('documents.info', { id: document.id });
    expect([401, 403]).toContain((await cookieAPI('documents.info', { id: document.id })).status());
    updateIdentity(key, { active: true, grants: ['sites'], roles: { sites: 'reader' } });
    await waitRole('reader');
    expect((await response(token, 'documents.info', { id: document.id })).status).toBe(200);
    updateIdentity(key, { grants: ['search'], roles: { search: 'admin' } });
    await waitRole(null);
    await denied('documents.info', { id: document.id });
    updateIdentity(key, { grants: ['sites'], roles: { sites: 'writer' } });
    await waitRole('writer');
    await api(token, 'documents.update', { id: document.id, title: key + '-restored' });
    updateIdentity(key, { grants: [] });
    await waitRole(null);
    await denied('documents.info', { id: document.id });
  } finally {
    try {
      if (group) await api(operator.token, 'groups.delete', { id: group.id });
      if (collection) await api(operator.token, 'collections.delete', { id: collection.id });
      if (native && verifiedFixture) await api(operator.token, 'users.delete', { id: native.id });
    } finally { revokeOperator(operator); }
  }
});
