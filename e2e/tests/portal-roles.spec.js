'use strict';
const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const { session, updateIdentity } = require('../helpers/identity');

test('portal roles constrain native operations, existing sessions and private ownership', async ({ page, context, baseURL }) => {
  test.setTimeout(300000);
  const key = 'roles-' + crypto.randomUUID();
  const grants = ['draw', 'flow', 'storage', 'search'];
  async function attach(cookie) {
    await context.addCookies([{ name: 'blak_session', value: cookie, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  }
  await attach(await session(key, 'Role acceptance', grants));
  let board;
  try {
    const created = await page.request.post('/api/draw', { data: { name: 'Private role acceptance' } });
    expect(created.status()).toBe(200);
    board = await created.json();
    const reader = Object.fromEntries(grants.map(app => [app, 'reader']));
    updateIdentity(key, { roles: reader });
    await expect.poll(async () => (await (await page.request.get('/api/me')).json()).roles.draw, { timeout: 65000, intervals: [1000, 3000] }).toBe('reader');
    expect((await page.request.get('/api/draw/' + board.id)).status()).toBe(200);
    for (const [method, path] of [
      ['POST', '/api/draw'], ['PUT', '/api/draw/' + board.id], ['DELETE', '/api/draw/' + board.id],
      ['POST', '/flow'], ['POST', '/flow/0000000000000000/run'], ['GET', '/flow/new'],
      ['PUT', '/cloud/object?bucket=e2e-no-write&key=denied'], ['DELETE', '/cloud/object?bucket=e2e-no-write&key=denied'],
      ['POST', '/cloud/bucket'], ['POST', '/cloud/queue'], ['POST', '/cloud/send'],
    ]) {
      expect((await page.request.fetch(path, { method, headers: { 'x-blak-role': 'admin' }, ...(method === 'GET' ? {} : { data: {} }) })).status()).toBe(403);
    }
    await page.goto('/draw');
    await expect(page.getByRole('button', { name: 'New drawing', exact: true })).toBeDisabled();
    await page.getByRole('combobox', { name: 'Saved drawings' }).selectOption(board.id);
    await expect(page.getByRole('button', { name: 'Save drawing', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Delete drawing', exact: true })).toBeDisabled();
    await page.goto('/flow');
    await expect(page.getByRole('link', { name: 'Create', exact: true })).toHaveCount(0);
    await page.goto('/cloud');
    await expect(page.getByRole('button', { name: 'Create bucket', exact: true })).toHaveCount(0);
    expect((await page.request.get('/search')).status()).toBe(200);

    updateIdentity(key, { roles: { ...reader, draw: 'admin' } });
    await expect.poll(async () => (await (await page.request.get('/api/me')).json()).roles.draw, { timeout: 65000, intervals: [1000, 3000] }).toBe('admin');
    expect((await page.request.put('/api/draw/' + board.id, { data: { revision: board.revision, scene: board.scene } })).status()).toBe(200);
    expect((await page.request.post('/cloud/bucket', { form: { name: 'must-not-exist' } })).status()).toBe(403);

    const otherContext = await context.browser().newContext({ baseURL, ignoreHTTPSErrors: true, ...require('../helpers/network').publicNetworkOptions });
    try {
      await otherContext.addCookies([{ name: 'blak_session', value: await session(key + '-other', 'Other owner', ['draw']), url: baseURL }]);
      const other = await (await otherContext.request.post('/api/draw', { data: { name: 'Other private board' } })).json();
      expect((await page.request.get('/api/draw/' + other.id)).status()).toBe(404);
      expect((await page.request.delete('/api/draw/' + other.id, { data: { revision: other.revision } })).status()).toBe(404);
      expect((await otherContext.request.delete('/api/draw/' + other.id, { data: { revision: other.revision } })).status()).toBe(200);
    } finally { await otherContext.close(); }

    updateIdentity(key, { grants: ['storage'], roles: { storage: 'admin' } });
    await expect.poll(async () => (await page.request.get('/api/draw/' + board.id)).status(), { timeout: 65000, intervals: [1000, 3000] }).toBe(403);
    expect((await page.request.get('/api/me')).status()).toBe(200);
    updateIdentity(key, { active: false });
    await expect.poll(async () => (await page.request.get('/api/me')).status(), { timeout: 65000, intervals: [1000, 3000] }).toBe(401);
  } finally {
    updateIdentity(key, { active: true, grants, roles: Object.fromEntries(grants.map(app => [app, 'writer'])) });
    await attach(await session(key, 'Role acceptance', grants));
    const response = await page.request.get('/api/draw');
    if (response.ok()) for (const item of await response.json()) {
      expect((await page.request.delete('/api/draw/' + item.id, { data: { revision: item.revision } })).status()).toBe(200);
    }
  }
});
