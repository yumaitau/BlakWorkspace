'use strict';
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { identityCookies, updateIdentity } = require('../helpers/identity');
const { serviceURL, ownedPersonalDrive } = require('../helpers/sync');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('Drive native roles revoke owned-file writes and preserve immutable accounts', async ({ page, context }) => {
  test.setTimeout(720000);
  const key = 'drive-roles-' + crypto.randomBytes(6).toString('hex');
  const origin = 'https://drive.workspace.example.com', endpoint = serviceURL('drive', 9200);
  let subject, token, file;
  page.on('request', request => {
    if (new URL(request.url()).origin === origin && request.headers().authorization?.startsWith('Bearer ')) {
      token = request.headers().authorization;
    }
  });
  if (process.env.BLAK_E2E_DRIVE_DIAGNOSTICS === 'true') page.on('response', response => {
    if (response.status() >= 400) console.log('Drive HTTP rejection', response.status(), new URL(response.url()).pathname);
  });
  async function waitRole(role, active = true) {
    await expect.poll(() => {
      try {
        const snapshot = JSON.parse(execFileSync('kubectl', ['-n', 'blak-micro', 'exec', 'deploy/opencloud', '--',
          'cat', '/var/lib/opencloud/blak-roles.json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
        const member = snapshot.members.find(member => member.subject === subject);
        return member ? { role: member.role, active: member.active } : null;
      } catch { return null; }
    }, { timeout: 150000, intervals: [2000, 4000] }).toEqual({ role, active });
    if (process.env.BLAK_E2E_DRIVE_DIAGNOSTICS === 'true') console.log('Drive grant observed', role || 'none', active);
  }
  async function request(path, method = 'GET', body) {
    return fetch(endpoint + path, { method, signal: AbortSignal.timeout(30000), headers: { authorization: token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  }
  try {
    await context.addCookies(await identityCookies(key, 'Drive native role fixture', ['drive'], { drive: 'writer' }));
    subject = (await (await page.request.get('/api/me')).json()).sub;
    await waitRole('writer');
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => Boolean(token), { timeout: 90000 }).toBe(true);
    // A token is emitted before the callback finishes loading account metadata.
    // Reloading that callback would replay its already-consumed authorization code.
    await page.waitForURL(url => url.origin === origin && /^\/files(?:\/|$)/.test(url.pathname), { timeout: 90000 });
    await expect.poll(async () => (await request('/graph/v1.0/me')).status, { timeout: 60000 }).toBe(200);
    const identity = (await (await request('/graph/v1.0/me')).json()).id;
    const drives = await (await request('/graph/v1.0/drives')).json();
    const personal = ownedPersonalDrive({ id: identity }, drives);
    expect(personal).toBeTruthy();
    const name = key + '.txt';
    file = new URL(personal.root.webDavUrl).pathname + '/' + name;
    expect([200, 201, 204]).toContain((await request(file, 'PUT', key)).status);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 60000 });
    updateIdentity(key, { roles: { drive: 'reader' } });
    await waitRole('reader');
    expect(await (await request(file)).text()).toBe(key);
    for (const method of ['PUT', 'DELETE', 'PROPPATCH']) {
      expect((await request(file, method, method === 'DELETE' ? undefined : 'forbidden')).status).toBe(403);
    }
    updateIdentity(key, { roles: { drive: 'admin' } });
    await waitRole('admin');
    for (const path of ['/graph/v1.0/users', '/graph/v1.0/groups', '/api/v0/settings/assignments-add', '/blak/roles/reconcile']) {
      expect((await request(path, 'POST', {})).status).toBe(403);
    }
    updateIdentity(key, { active: false });
    await waitRole('', false);
    expect([401, 403]).toContain((await request(file)).status);
    updateIdentity(key, { active: true, grants: ['chat'], roles: { chat: 'admin' } });
    await waitRole('');
    expect([401, 403]).toContain((await request(file)).status);
    updateIdentity(key, { grants: ['drive'], roles: { drive: 'writer' }, rename: true });
    await waitRole('writer');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await context.addCookies(await identityCookies(key, 'Drive native role fixture', ['drive'], { drive: 'writer' }));
    token = undefined;
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.origin === origin && /^\/files(?:\/|$)/.test(url.pathname), { timeout: 90000 });
    await expect.poll(() => Boolean(token), { timeout: 90000 }).toBe(true);
    expect((await (await request('/graph/v1.0/me')).json()).id).toBe(identity);
    expect(await (await request(file)).text()).toBe(key);
    expect([200, 201, 204]).toContain((await request(file, 'PUT', key + '-restored')).status);
  } finally {
    if (subject) {
      try {
        updateIdentity(key, { active: true, grants: ['drive'], roles: { drive: 'writer' } });
        await waitRole('writer');
        if (file && token) expect([200, 204, 404]).toContain((await request(file, 'DELETE')).status);
      } finally {
        updateIdentity(key, { active: false });
        await waitRole('', false);
      }
    }
  }
});
