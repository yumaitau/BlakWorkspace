'use strict';
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { identityCookies, updateIdentity } = require('../helpers/identity');
const { serviceURL } = require('../helpers/sync');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function controller() {
  try {
    const secret = JSON.parse(execFileSync('kubectl', ['-n', 'blak-micro', 'get', 'secret', 'blak-projects-role-controller', '-o', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
    const values = Object.fromEntries(Object.entries(secret.data).map(([key, value]) => [key, Buffer.from(value, 'base64').toString()]));
    const source = `import { blakNativeAuth as auth } from '/app/apps/api/dist/index.js';
      const native = await auth.$context;
      const session = await native.internalAdapter.createSession(process.env.BLAK_ROLE_CONTROLLER_ID);
      console.log('BLAK_SESSION=' + JSON.stringify({ token: session.token })); process.exit(0);`;
    const output = execFileSync('kubectl', ['-n', 'blak-micro', 'exec', '-i', 'deploy/projects', '-c', 'kaneo', '--', 'node', '--input-type=module'], { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const line = output.split('\n').find(line => line.startsWith('BLAK_SESSION='));
    values['session-token'] = JSON.parse(line.slice('BLAK_SESSION='.length)).token;
    return values;
  } catch { throw Error('Cannot load native Projects fixture; credentials omitted'); }
}

test('native Projects roles constrain existing keys, sessions and managed authority', async ({ page, context }) => {
  test.setTimeout(780000);
  const key = 'projects-roles-' + crypto.randomBytes(6).toString('hex');
  const operator = controller(), endpoint = serviceURL('projects', 5173);
  const origin = new URL(process.env.BLAK_E2E_PROJECTS_URL).origin;
  const workspaceId = JSON.parse(operator.workspaces)[0];
  async function response(token, method, path, data) {
    return fetch(endpoint + path, { method, headers: { ...(token === operator['session-token'] ? { authorization: 'Bearer ' + token } : { 'x-api-key': token }), origin, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  }
  async function api(token, method, path, data) {
    const result = await response(token, method, path, data);
    if (!result.ok) throw Error('Native Projects fixture returned HTTP ' + result.status + ' at ' + path);
    return result.json();
  }
  let native, token, project;
  const organizationPath = '/api/auth/organization/get-full-organization?organizationId=' + workspaceId;
  async function waitRole(role) {
    await expect.poll(async () => {
      const user = await api(operator['session-token'], 'GET', '/api/auth/admin/get-user?id=' + native.id);
      const organization = await api(operator['session-token'], 'GET', organizationPath);
      return { role: user.role, banned: !!user.banned, membership: organization.members.find(member => member.userId === native.id)?.role || null };
    }, { timeout: 160000, intervals: [2000, 4000] }).toEqual({ role: 'user', banned: !role, membership: role ? 'blak-' + role : null });
  }
  async function denied(method, path, data) {
    const result = await response(token, method, path, data);
    expect([401, 403, 404]).toContain(result.status);
  }
  try {
    await context.addCookies(await identityCookies(key, 'Projects native role fixture', ['projects'], { projects: 'writer' }));
    const portal = await (await page.request.get('/api/me')).json();
    await page.goto(origin);
    await expect.poll(async () => {
      const result = await page.request.get(origin + '/api/auth/get-session');
      return result.ok() && (await result.json())?.user?.id;
    }, { timeout: 60000 }).toBeTruthy();
    native = (await (await page.request.get(origin + '/api/auth/get-session')).json()).user;
    const accounts = await (await page.request.get(origin + '/api/auth/list-accounts')).json();
    expect(accounts.some(account => account.providerId === 'custom' && account.accountId === portal.sub && account.userId === native.id)).toBeTruthy();
    await waitRole('writer');
    const createdKey = await page.request.post(origin + '/api/auth/api-key/create', { data: { name: key }, headers: { origin } });
    expect(createdKey.ok()).toBeTruthy();
    token = (await createdKey.json()).key;
    project = await api(token, 'POST', '/api/project', { workspaceId, name: key, slug: 'E2E' + crypto.randomBytes(4).toString('hex').toUpperCase(), icon: 'folder' });
    const board = await api(token, 'GET', '/api/task/tasks/' + project.id);
    await api(token, 'POST', '/api/task/' + project.id, { title: key, description: 'Disposable native role fixture', priority: 'medium', status: board.data.columns[0].slug });
    await denied('POST', '/api/auth/organization/invite-member', { organizationId: workspaceId, email: key + '@example.invalid', role: 'admin' });
    await denied('GET', '/api/auth/admin/list-users');
    await page.evaluate(() => {
      window.roleSocketClosed = null;
      window.roleSocket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/api/ws/user');
      window.roleSocket.onclose = event => { window.roleSocketClosed = event.code; };
    });
    await page.waitForFunction(() => window.roleSocket.readyState === WebSocket.OPEN);
    updateIdentity(key, { roles: { projects: 'reader' } });
    await waitRole('reader');
    await expect.poll(() => page.evaluate(() => window.roleSocketClosed)).toBe(1008);
    expect((await response(token, 'GET', '/api/task/tasks/' + project.id)).status).toBe(200);
    await denied('POST', '/api/task/' + project.id, { title: 'forbidden', priority: 'medium', status: board.data.columns[0].slug });
    await denied('DELETE', '/api/project/' + project.id);
    const cookieWrite = await page.request.post(origin + '/api/task/' + project.id, { data: { title: 'forbidden-cookie', priority: 'medium', status: board.data.columns[0].slug }, headers: { origin } });
    expect(cookieWrite.status()).toBe(403);
    updateIdentity(key, { roles: { projects: 'admin' } });
    await waitRole('admin');
    await api(token, 'PUT', '/api/project/' + project.id, { name: key + '-admin', slug: project.slug, icon: 'folder' });
    const organization = await api(operator['session-token'], 'GET', organizationPath);
    const membership = organization.members.find(member => member.userId === native.id);
    await denied('POST', '/api/auth/organization/update-member-role', { organizationId: workspaceId, memberId: membership.id, role: 'owner' });
    await denied('POST', '/api/auth/organization/update-role', { organizationId: workspaceId, roleName: 'blak-reader', data: { permission: { task: ['create', 'read', 'update', 'delete'] } } });
    await denied('POST', '/api/auth/admin/ban-user', { userId: operator['user-id'] });
    await denied('POST', '/api/auth/organization/delete', { organizationId: workspaceId });
    updateIdentity(key, { roles: { projects: 'reader' } });
    await waitRole('reader');
    await denied('PUT', '/api/project/' + project.id, { name: 'forbidden', slug: project.slug, icon: 'folder' });
    updateIdentity(key, { active: false });
    await waitRole(null);
    await denied('GET', '/api/task/tasks/' + project.id);
    expect((await page.request.get(origin + '/api/task/tasks/' + project.id)).status()).toBe(401);
    updateIdentity(key, { active: true, grants: ['search'], roles: { search: 'admin' } });
    await waitRole(null);
    await denied('GET', '/api/task/tasks/' + project.id);
    updateIdentity(key, { grants: ['projects'], roles: { projects: 'reader' } });
    await waitRole('reader');
    expect((await response(token, 'GET', '/api/task/tasks/' + project.id)).status).toBe(200);
    updateIdentity(key, { grants: [] });
    await waitRole(null);
    await denied('GET', '/api/task/tasks/' + project.id);
  } finally {
    if (project) await api(operator['session-token'], 'DELETE', '/api/project/' + project.id);
    if (native) await api(operator['session-token'], 'POST', '/api/auth/admin/remove-user', { userId: native.id });
    await api(operator['session-token'], 'POST', '/api/auth/sign-out', {});
  }
});
