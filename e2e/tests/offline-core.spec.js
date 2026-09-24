'use strict';
const { test, expect } = require('../helpers/offline-test');
const { authentikLogin } = require('../helpers/auth');

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.BLAK_E2E_LOCAL_ONLY !== '1', 'Operator-run local-origin acceptance');

test('fresh local sign-in opens Knowledge, Chat and the Eyes offline map', async ({ page, baseURL }) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  await page.goto(`${baseURL}/login`);
  await authentikLogin(page);
  await page.waitForURL(url => url.origin === new URL(baseURL).origin && url.pathname === '/');
  await expect(page.getByRole('link', { name: 'Blak Drive', exact: true })).toBeVisible();

  await test.step('Knowledge native account and documents', async () => {
    await page.goto(`${baseURL}/launch/sites`);
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account', exact: true }).first()).toBeVisible();
    // The seeded intranet supplies a real readable page, not just a rendered shell.
    await page.getByRole('link', { name: /^Select Policies / }).click();
    await expect(page).toHaveURL(/\/doc\//);
    await expect(page.getByRole('textbox', { name: 'Editor content', exact: true }).filter({ hasText: 'Current policies' })).toBeVisible();
  });

  await test.step('Chat native session', async () => {
    await page.goto(`${baseURL}/launch/chat`);
    const signIn = page.getByRole('button', { name: /^(Log in|Login|Continue|Sign in) with Blak ID$/i });
    const ready = page.getByRole('button', { name: 'User menu', exact: true });
    await expect(signIn.or(ready)).toBeVisible();
    if (await signIn.isVisible()) await signIn.click();
    await expect(ready).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Welcome to Blak Chat', exact: true })).toBeVisible();
  });

  await test.step('Eyes local map data and rendering', async () => {
    await page.goto(`${baseURL}/launch/eyes`);
    const signIn = page.getByRole('button', { name: 'Continue with Blak ID', exact: true });
    const ready = page.getByRole('button', { name: 'Tools', exact: true });
    await expect(signIn.or(ready)).toBeVisible();
    if (await signIn.isVisible()) await signIn.click();
    await expect(ready).toBeVisible();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Offline world overview' })).toBeVisible();
    await expect(page.getByLabel('Offline survey map').locator('canvas')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
