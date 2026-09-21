'use strict';
const crypto = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { identityCookies } = require('../helpers/identity');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('portal retains native app roles from real Blak ID claims', async ({ context, page }) => {
  const key = 'native-claims-' + crypto.randomBytes(6).toString('hex');
  const roles = { sites: 'reader', projects: 'admin', hermes: 'writer' };
  await context.addCookies(await identityCookies(key, 'Native role claims fixture', Object.keys(roles), roles));
  const response = await page.request.get('/api/me');
  expect(response.ok()).toBeTruthy();
  const user = await response.json();
  expect(user.roles).toEqual(roles);
  expect([...user.apps].sort()).toEqual(Object.keys(roles).sort());
});
