'use strict';
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { identityCookies, updateIdentity } = require('../helpers/identity');
const { serviceURL } = require('../helpers/sync');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
function controller() {
  let secret;
  try { secret = JSON.parse(execFileSync('kubectl', ['-n', 'blak-micro', 'get', 'secret', 'blak-hermes-role-controller', '-o', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })); }
  catch { throw Error('Cannot load native controller fixture; credentials omitted'); }
  return Object.fromEntries(Object.entries(secret.data).map(([key, value]) => [key, Buffer.from(value, 'base64').toString()]));
}

test('native Hermes roles constrain existing tokens, shared file ownership and app administration', async ({ page, context }) => {
  test.setTimeout(720000);
  const key = 'hermes-roles-' + crypto.randomBytes(6).toString('hex');
  const operator = controller(), endpoint = serviceURL('hermes', 8080);
  const origin = new URL(process.env.BLAK_E2E_HERMES_URL).origin;
  const collectionId = operator['collection-id'];
  const knowledgePath = '/api/v1/knowledge/' + collectionId;
  async function response(token, method, path, data) {
    return fetch(endpoint + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  }
  async function api(token, method, path, data) {
    const result = await response(token, method, path, data);
    if (!result.ok) throw Error('Native role fixture API returned HTTP ' + result.status + ' at ' + path);
    return result.json();
  }
  const original = await api(operator['api-key'], 'GET', knowledgePath);
  let native, token, uploaded, privateKnowledge, privateFile;
  async function waitRole(role) {
    await expect.poll(async () => {
      const result = await api(operator['api-key'], 'GET', '/api/v1/users/?query=' + encodeURIComponent(native.email));
      const user = result.users.find(item => item.id === native.id);
      if (!user) return null;
      const groups = await api(operator['api-key'], 'GET', '/api/v1/groups/');
      return { role: user.role, managed: groups.filter(group => user.group_ids.includes(group.id)).map(group => group.data?.blak_id_role).sort() };
    }, { timeout: 150000, intervals: [2000, 4000] }).toEqual({ role: role === 'admin' ? 'admin' : role ? 'user' : 'pending', managed: role ? [role] : [] });
  }
  async function denied(method, path, data) {
    const result = await response(token, method, path, data);
    if (result.status === 400) {
      expect((await result.json()).detail).toBe('You do not have permission to access this resource. Please contact your administrator for assistance.');
    } else expect([401, 403, 404]).toContain(result.status);
  }
  try {
    privateKnowledge = await api(operator['api-key'], 'POST', '/api/v1/knowledge/create', {
      name: 'Private role fixture ' + key, description: key, access_grants: [],
    });
    const privateForm = new FormData();
    privateForm.append('file', new Blob(['Private fixture ' + key], { type: 'text/plain' }), key + '-private.txt');
    const privateUpload = await fetch(endpoint + '/api/v1/files/?process=false', {
      method: 'POST', headers: { authorization: 'Bearer ' + operator['api-key'] }, body: privateForm,
    });
    expect(privateUpload.status).toBe(200);
    privateFile = await privateUpload.json();
    await api(operator['api-key'], 'POST', '/api/v1/retrieval/process/file', { file_id: privateFile.id, content: 'Private fixture ' + key });
    await api(operator['api-key'], 'POST', '/api/v1/knowledge/' + privateKnowledge.id + '/file/add', { file_id: privateFile.id });
    await context.addCookies(await identityCookies(key, 'Hermes native role fixture', ['hermes'], { hermes: 'writer' }));
    const portal = await (await page.request.get('/api/me')).json();
    await page.goto(origin + '/oauth/oidc/login');
    await page.waitForURL(url => url.origin === origin && url.pathname === '/');
    await page.waitForFunction(() => Boolean(localStorage.getItem('token')));
    token = await page.evaluate(() => localStorage.getItem('token'));
    const profile = await api(token, 'GET', '/api/v1/auths/');
    const users = await api(operator['api-key'], 'GET', '/api/v1/users/?query=' + encodeURIComponent(profile.email));
    expect(users.users.find(user => user.id === profile.id)?.oauth?.oidc?.sub).toBe(portal.sub);
    native = profile;
    await waitRole('writer');
    await api(token, 'POST', knowledgePath + '/update', { name: original.name, description: key });
    await denied('POST', knowledgePath + '/access/update', { access_grants: [] });
    await denied('POST', knowledgePath + '/update', { name: original.name, description: key, access_grants: [] });
    await denied('DELETE', knowledgePath + '/delete');
    await denied('GET', '/api/v1/users/');
    const form = new FormData();
    form.append('file', new Blob(['Role fixture ' + key], { type: 'text/plain' }), key + '.txt');
    const upload = await fetch(endpoint + '/api/v1/files/?process=false', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: form });
    expect(upload.status).toBe(200);
    uploaded = await upload.json();
    await api(token, 'POST', '/api/v1/retrieval/process/file', { file_id: uploaded.id, content: 'Role fixture ' + key });
    await api(token, 'POST', knowledgePath + '/file/add', { file_id: uploaded.id });
    updateIdentity(key, { roles: { hermes: 'reader' } });
    await waitRole('reader');
    expect((await api(token, 'GET', knowledgePath)).id).toBe(collectionId);
    await denied('POST', knowledgePath + '/update', { name: original.name, description: 'forbidden' });
    await denied('POST', knowledgePath + '/file/remove', { file_id: uploaded.id });
    await denied('POST', '/api/v1/files/' + uploaded.id + '/data/content/update', { content: 'forbidden' });
    await denied('POST', '/api/v1/files/' + uploaded.id + '/rename', { filename: 'forbidden.txt' });
    await denied('DELETE', '/api/v1/files/' + uploaded.id);
    await denied('POST', '/api/v1/retrieval/process/file', { file_id: uploaded.id, content: 'forbidden' });
    await denied('POST', '/api/v1/retrieval/process/files/batch', { files: [{ ...uploaded, data: { content: 'forbidden' } }], collection_name: 'file-' + uploaded.id });
    expect((await api(operator['api-key'], 'GET', knowledgePath)).description).toBe(key);
    const retained = await api(operator['api-key'], 'GET', '/api/v1/files/' + uploaded.id);
    expect(retained.filename).toBe(key + '.txt');
    expect(JSON.stringify(retained.data)).not.toContain('forbidden');
    updateIdentity(key, { roles: { hermes: 'admin' } });
    await waitRole('admin');
    const listed = await api(token, 'GET', '/api/v1/knowledge/');
    expect(listed.items.some(item => item.id === privateKnowledge.id)).toBe(false);
    for (const path of ['/api/v1/knowledge/' + privateKnowledge.id,
                        '/api/v1/knowledge/' + privateKnowledge.id + '/files',
                        '/api/v1/knowledge/' + privateKnowledge.id + '/export',
                        '/api/v1/files/' + privateFile.id,
                        '/api/v1/files/' + privateFile.id + '/content',
                        '/api/v1/files/' + privateFile.id + '/data/content']) {
      await denied('GET', path);
    }
    for (const id of [privateKnowledge.id, 'file-' + privateFile.id]) {
      await denied('POST', '/api/v1/retrieval/query/collection', { collection_names: [id], query: key, k: 1 });
    }
    await denied('POST', '/api/v1/knowledge/' + privateKnowledge.id + '/update', { name: 'forbidden', description: 'forbidden' });
    await denied('POST', '/api/v1/files/' + privateFile.id + '/rename', { filename: 'forbidden.txt' });
    expect((await api(operator['api-key'], 'GET', '/api/v1/knowledge/' + privateKnowledge.id)).name).toBe('Private role fixture ' + key);

    expect((await response(token, 'GET', '/api/v1/users/')).status).toBe(200);
    await api(token, 'POST', knowledgePath + '/access/update', { access_grants: (await api(operator['api-key'], 'GET', knowledgePath)).access_grants });
    await denied('POST', '/api/v1/users/' + operator['user-id'] + '/update', { role: 'pending' });
    await denied('DELETE', '/api/v1/users/' + operator['user-id']);
    updateIdentity(key, { roles: { hermes: 'reader' } });
    await waitRole('reader');
    await denied('GET', '/api/v1/users/');
    updateIdentity(key, { active: false });
    await waitRole(null);
    await denied('GET', knowledgePath);
    updateIdentity(key, { active: true, grants: ['search'], roles: { search: 'admin' } });
    await waitRole(null);
    await denied('GET', knowledgePath);
    // Restore reader to distinguish a disabled-account denial from app-specific removal.
    updateIdentity(key, { grants: ['hermes'], roles: { hermes: 'reader' } });
    await waitRole('reader');
    expect((await response(token, 'GET', knowledgePath)).status).toBe(200);
    updateIdentity(key, { grants: [] });
    await waitRole(null);
    await denied('GET', knowledgePath);
  } finally {
    if (privateFile?.id) await api(operator['api-key'], 'DELETE', '/api/v1/files/' + privateFile.id);
    if (privateKnowledge?.id) await api(operator['api-key'], 'DELETE', '/api/v1/knowledge/' + privateKnowledge.id + '/delete');
    if (uploaded?.id) await api(operator['api-key'], 'DELETE', '/api/v1/files/' + uploaded.id);
    await api(operator['api-key'], 'POST', knowledgePath + '/update', { name: original.name, description: original.description });
    if (native) await api(operator['api-key'], 'DELETE', '/api/v1/users/' + native.id);
  }
});
