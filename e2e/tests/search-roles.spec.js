'use strict';
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { session, updateIdentity } = require('../helpers/identity');
const { serviceURL } = require('../helpers/sync');

test('Search removes cached source results when that app grant is revoked', async ({ page, context, baseURL }) => {
  test.setTimeout(150000);
  const suffix = crypto.randomBytes(8).toString('hex');
  const key = 'search-role-' + suffix;
  const phrase = 'SourceRevocation' + suffix;
  await context.addCookies([{ name: 'blak_session', value: await session(key, 'Search role test', ['search', 'draw'], { search: 'admin', draw: 'reader' }), url: baseURL }]);
  const user = await (await page.request.get('/api/me')).json();
  const namespace = process.env.BLAK_E2E_NAMESPACE || 'blak-micro';
  // Node fetch keeps the operator-only fixture credential out of browser traces.
  const secret = execFileSync('kubectl', ['-n', namespace, 'get', 'secret', 'blak-core', '-o', 'jsonpath={.data.meili-master-key}'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const token = Buffer.from(secret.toString(), 'base64').toString();
  const origin = serviceURL('meilisearch', 7700);
  async function api(method, path, data) {
    const response = await fetch(origin + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    if (!response.ok) throw Error('Search fixture API returned HTTP ' + response.status);
    return response.json();
  }
  async function complete(task) {
    await expect.poll(async () => (await api('GET', '/tasks/' + task.taskUid)).status, { timeout: 30000 }).toBe('succeeded');
  }
  const documents = ['private', 'workspace', 'vault'].map(kind => ({
    id: 'e2e-role-' + suffix + '-' + kind, owner: user.sub,
    allowedUsers: kind === 'workspace' ? [] : [user.sub], visibility: kind === 'workspace' ? 'workspace' : 'private',
    source: kind === 'vault' ? 'Vault' : 'Draw', title: phrase + '-' + kind, content: 'Disposable permission fixture',
    url: baseURL + '/draw', expiresAt: Math.floor(Date.now() / 1000) + 600,
  }));
  try {
    await complete(await api('POST', '/indexes/workspace/documents', documents));
    await page.goto('/search?q=' + phrase);
    await expect(page.locator('.search-results li')).toHaveCount(2);
    await expect(page.locator('.search-results')).not.toContainText(phrase + '-vault');
    updateIdentity(key, { grants: ['search'], roles: { search: 'admin' } });
    await expect.poll(async () => (await (await page.request.get('/api/me')).json()).apps.includes('draw'), { timeout: 65000, intervals: [1000, 3000] }).toBe(false);
    await page.reload();
    await expect(page.locator('.search-results li')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('No permitted content sources');
    expect((await page.request.get('/api/me')).status()).toBe(200);
  } finally {
    await complete(await api('POST', '/indexes/workspace/documents/delete-batch', documents.map(item => item.id)));
  }
});
