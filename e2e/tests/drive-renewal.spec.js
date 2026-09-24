'use strict';
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { authentikLogin } = require('../helpers/auth');

// Operator-run against the tailnet. Never persist tokens or authentication traces.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('Drive renews an expired session silently and keeps files accessible', async ({ page }) => {
  test.setTimeout(120000);
  const host = process.env.BLAK_E2E_HOST || 'homelab.tail073805.ts.net';
  const portal = process.env.BLAK_E2E_BASE_URL || `https://${host}`;
  const drive = process.env.BLAK_E2E_DRIVE_URL || `https://${host}:8445`;
  process.env.BLAK_E2E_IDP_URL ||= `https://${host}:8444`;
  if (!process.env.BLAK_E2E_USER || !process.env.BLAK_E2E_PASSWORD) {
    const secret = JSON.parse(execFileSync('kubectl', ['--request-timeout=15s', '--kubeconfig', process.env.KUBECONFIG || `${process.env.HOME}/.kube/blak-homelab-ts.yaml`, '-n', 'blak-micro', 'get', 'secret', 'blak-idp', '-o', 'json'], { encoding: 'utf8', timeout: 20000 }));
    process.env.BLAK_E2E_USER = 'akadmin';
    process.env.BLAK_E2E_PASSWORD = Buffer.from(secret.data['bootstrap-password'], 'base64').toString();
  }
  await page.goto(`${portal}/login`);
  await authentikLogin(page);
  await page.waitForURL(url => url.origin === new URL(portal).origin && url.pathname === '/');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/silent token renewal failed|IFrame timed out/.test(message.text())) errors.push('silent renewal failed');
  });
  await page.goto(drive);
  await expect(page.getByRole('button', { name: 'All files', exact: true })).toBeVisible();
  const expired = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('oc_oAuth.user:'));
    if (!key) return false;
    const session = JSON.parse(localStorage.getItem(key));
    session.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(key, JSON.stringify(session));
    return true;
  });
  expect(expired).toBe(true);
  const silent = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/authorize/') && url.searchParams.get('prompt') === 'none';
  });
  const token = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/token/'));
  await page.reload();
  expect((await silent).status()).toBe(302);
  expect((await token).status()).toBe(200);
  await expect.poll(() => page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('oc_oAuth.user:'));
    return key && JSON.parse(localStorage.getItem(key)).expires_at > Date.now() / 1000;
  })).toBe(true);
  await expect(page.getByRole('button', { name: 'All files', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Personal', exact: true })).toBeVisible();
  expect(new URL(page.url()).origin).toBe(new URL(drive).origin);
  expect(errors).toEqual([]);
});
