'use strict';
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { identityCookies, updateIdentity } = require('../helpers/identity');
const { serviceURL } = require('../helpers/sync');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function controller() {
  try {
    const secret = JSON.parse(execFileSync('kubectl', ['-n', 'blak-micro', 'get', 'secret', 'blak-crm-role-controller', '-o', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
    const value = key => Buffer.from(secret.data[key], 'base64').toString();
    return { id: value('user-id'), authorization: 'token ' + value('api-key') + ':' + value('api-secret') };
  } catch { throw Error('CRM controller fixture unavailable; credentials omitted'); }
}

test('native CRM roles cap owners, RPCs and existing keys and restore the same identity', async ({ page, context }) => {
  test.setTimeout(840000);
  const operator = controller(), endpoint = serviceURL('crm', 3000);
  const origin = new URL(process.env.BLAK_E2E_CRM_URL).origin;
  const key = 'crm-roles-' + crypto.randomBytes(6).toString('hex');
  let native, authorization, lead, socket;
  const resource = (doctype, id) => '/api/resource/' + encodeURIComponent(doctype) + (id ? '/' + encodeURIComponent(id) : '');
  async function request(method, path, data, auth = authorization) {
    return fetch(endpoint + path, { method, headers: { authorization: auth, origin, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  }
  async function api(method, path, data, auth = authorization) {
    const response = await request(method, path, data, auth);
    if (!response.ok) throw Error('Native CRM fixture returned HTTP ' + response.status + ' at ' + path.split('?')[0]);
    return response.json();
  }
  async function denied(method, path, data) {
    expect([401, 403, 404]).toContain((await request(method, path, data)).status);
  }
  async function waitRole(subject, role) {
    await expect.poll(async () => {
      const users = (await api('POST', '/api/method/crm.blak_roles.identities', {}, operator.authorization)).message;
      native = users.find(user => user.subject === subject);
      return native ? { role: native.role, enabled: native.enabled } : null;
    }, { timeout: 160000, intervals: [2000, 4000] }).toEqual({ role, enabled: !!role });
  }
  async function cookieAPI(method, path, data) {
    const csrf = await page.evaluate(() => window.csrf_token);
    return page.request.fetch(origin + path, { method, data, headers: { 'X-Frappe-CSRF-Token': csrf || '' } });
  }
  page.on('websocket', connection => { if (connection.url().includes('/socket.io/')) socket = connection; });
  try {
    await context.addCookies(await identityCookies(key, 'CRM native role fixture', ['crm'], { crm: 'writer' }));
    const portal = await (await page.request.get('/api/me')).json();
    expect(portal.roles.crm).toBe('writer');
    await waitRole(portal.sub, 'writer');
    const nativeId = native.id;
    await page.goto(origin + '/_blak/launch.html');
    await page.waitForURL(url => url.origin === origin && url.pathname.startsWith('/crm'), { timeout: 60000 });
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible({ timeout: 60000 });
    expect((await (await cookieAPI('GET', '/api/method/frappe.auth.get_logged_user')).json()).message).toBe(nativeId);
    const keys = (await api('POST', '/api/method/frappe.core.doctype.user.user.generate_keys', { user: nativeId }, operator.authorization)).message;
    const profile = (await api('GET', resource('User', nativeId), undefined, operator.authorization)).data;
    authorization = 'token ' + profile.api_key + ':' + keys.api_secret;
    lead = (await api('POST', resource('CRM Lead'), { first_name: key, job_title: 'writer' })).data;
    expect(lead.owner).toBe(nativeId);
    expect((await cookieAPI('PUT', resource('CRM Lead', lead.name), { job_title: 'cookie-writer' })).ok()).toBeTruthy();
    await denied('PUT', resource('User', nativeId), { roles: [{ role: 'System Manager' }] });
    await expect.poll(() => !!socket && !socket.isClosed(), { timeout: 60000 }).toBe(true);
    const beforeDowngrade = socket;
    updateIdentity(key, { roles: { crm: 'reader' } });
    await waitRole(portal.sub, 'reader');
    await expect.poll(() => beforeDowngrade.isClosed(), { timeout: 60000 }).toBe(true);
    expect((await api('GET', resource('CRM Lead', lead.name))).data.job_title).toBe('cookie-writer');
    await denied('PUT', resource('CRM Lead', lead.name), { job_title: 'forbidden' });
    await denied('DELETE', resource('CRM Lead', lead.name));
    await denied('POST', resource('CRM Lead'), { first_name: 'forbidden' });
    await denied('POST', '/api/method/frappe.client.set_value', { doctype: 'CRM Lead', name: lead.name, fieldname: 'job_title', value: 'forbidden' });
    const bypass = new URLSearchParams({ doctype: 'CRM Lead', name: lead.name, assignees: '[]', ignore_permissions: 'true' });
    await denied('GET', '/api/method/crm.api.doc.remove_assignments?' + bypass);
    await page.goto(origin + '/crm/leads/' + encodeURIComponent(lead.name));
    await expect.poll(() => page.locator('input').evaluateAll((inputs, value) => inputs.some(input => input.value === value && (input.disabled || input.readOnly)), key), { timeout: 60000 }).toBe(true);
    expect((await cookieAPI('PUT', resource('CRM Lead', lead.name), { job_title: 'forbidden-cookie' })).status()).toBe(403);
    updateIdentity(key, { roles: { crm: 'admin' } });
    await waitRole(portal.sub, 'admin');
    await api('PUT', resource('CRM Lead', lead.name), { job_title: 'admin' });
    await denied('PUT', resource('User', nativeId), { roles: [{ role: 'System Manager' }] });
    await denied('PUT', resource('User', operator.id), { enabled: 0 });
    updateIdentity(key, { active: false });
    await waitRole(portal.sub, null);
    await denied('GET', resource('CRM Lead', lead.name));
    updateIdentity(key, { active: true, roles: { crm: 'reader' } });
    await waitRole(portal.sub, 'reader');
    expect(native.id).toBe(nativeId);
    expect((await request('GET', resource('CRM Lead', lead.name))).status).toBe(200);
    await denied('PUT', resource('CRM Lead', lead.name), { job_title: 'forbidden-restored-reader' });
    updateIdentity(key, { grants: ['search'], roles: { search: 'admin' } });
    await waitRole(portal.sub, null);
    await denied('GET', resource('CRM Lead', lead.name));
    updateIdentity(key, { grants: ['crm'], roles: { crm: 'writer' }, rename: true });
    await waitRole(portal.sub, 'writer');
    expect(native.id).toBe(nativeId);
    await api('PUT', resource('CRM Lead', lead.name), { job_title: 'restored-writer' });
    updateIdentity(key, { grants: [] });
    await waitRole(portal.sub, null);
    await denied('GET', resource('CRM Lead', lead.name));
  } finally {
    if (lead) await api('DELETE', resource('CRM Lead', lead.name), undefined, operator.authorization);
    if (native) await api('DELETE', resource('User', native.id), undefined, operator.authorization);
  }
});
