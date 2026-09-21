const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const { vaultLogin } = require('../helpers/vault');
const base = 'https://vault.workspace.example.com';
const fixtureFile = process.env.BLAK_VAULT_FIXTURE_FILE;

test('Vault serves native encrypted client with isolated branding and operator boundary', async ({ page, request }) => {
  const response = await request.get(base);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(await response.text()).not.toContain('/_blak/shell.js');
  for (const path of ['/admin', '/admin/', '/admin/users', '/%61dmin/users']) {
    expect((await request.get(base + path)).status()).toBe(404);
  }
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.blak-vault-brand')).toContainText('Blak Vault');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Inter' && font.status === 'loaded'))).toBe(true);
  expect((await request.get(base + '/images/blak-logo.svg')).headers()['content-type']).toContain('image/svg+xml');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('Vault rejects password authentication when native SSO is required', async ({ request }) => {
  const response = await request.post(base + '/identity/connect/token', { form: {
    grant_type: 'password', client_id: 'web', username: 'e2e-not-a-user@example.invalid',
    password: 'not-a-real-password', scope: 'api offline_access',
    deviceIdentifier: 'blak-vault-negative-e2e', deviceName: 'Vault acceptance', deviceType: '10',
  } });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain('SSO sign-in is required');
});

test('Native Blak ID MFA login unlocks the vault and opens its native item editor', async ({ page }) => {
  test.skip(!fixtureFile, 'Operator-provisioned disposable native vault fixture required');
  test.setTimeout(180000);
  const account = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  await vaultLogin(page, account, base);
  const skip = page.getByRole('button', { name: 'Skip', exact: true });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(page.getByRole('link', { name: 'Vaults', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New', exact: true }).click({ timeout: 15000 });
  await page.getByRole('menuitem', { name: /login/i }).click({ timeout: 15000 });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('vault-editor.png'), animations: 'disabled' });
  // Item creation details are exercised by the native CLI acceptance suite; this
  // browser check verifies the actual unlocked client, not merely an HTTP 200.
});
