'use strict';

const { test, expect } = require('@playwright/test');

const user = process.env.BLAK_E2E_USER || '';
const password = process.env.BLAK_E2E_PASSWORD || '';

const { authentikLogin } = require('../helpers/auth');
const { tokens } = require('../../apps/portal/theme');

test.describe('Blak Portal homelab', () => {
  test('anonymous visitor is gated', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Sign in with Blak ID/i })).toBeVisible();
    await expect(page.locator('[data-testid="userchip"] .nm')).toHaveCount(0);
  });

  test('login shows user chip, waffle lists Flow live, create-enable-run writes activity', async ({ page }) => {
    test.skip(!user || !password, 'BLAK_E2E_USER and BLAK_E2E_PASSWORD required');
    await page.goto('/');
    await page.getByRole('link', { name: /Sign in with Blak ID/i }).click();
    await authentikLogin(page);
    await page.waitForURL((url) => url.hostname === 'portal.homelab.local' && url.pathname !== '/login' && url.pathname !== '/callback', { timeout: 30_000 });
    await expect(page.locator('[data-testid="userchip"]')).toBeVisible();
    await expect(page.locator('[data-testid="userchip"] .nm')).not.toHaveText('');

    await page.locator('[data-testid="waffle"]').click();
    const flowItem = page.locator('a.appitem[data-app="flow"]');
    await expect(flowItem).toBeVisible();
    await expect(flowItem).toHaveAttribute('href', '/flow');
    await expect(flowItem).not.toHaveClass(/soon/);

    await page.goto('/flow/new');
    const name = `e2e-${Date.now()}`;
    await page.locator('[data-testid="flow-builder"] input[name="name"]').fill(name);
    await page.locator('[data-testid="save-flow"]').click();
    await page.waitForURL(/\/flow\/[a-f0-9]+/);
    const flowPath = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Enable' }).click();
    await page.locator('[data-testid="run-flow"]').click();
    await page.waitForURL(/\/flow\/activity/);
    await expect(page.locator('[data-testid="run-row"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="run-row"]').filter({ hasText: name })).toContainText('ok');

    const waffleChat = page.locator('a.appitem[data-app="chat"]');
    await page.locator('[data-testid="waffle"]').click();
    await expect(waffleChat).toHaveAttribute('href', 'https://chat.homelab.local');
    await expect(page.locator('a.appitem[data-app="projects"]')).toHaveAttribute('href', 'https://projects.homelab.local');
    expect((await page.request.post(flowPath + '/delete')).ok()).toBeTruthy();
  });
});

test.describe('Blak Chat and Projects SSO', () => {
  test('Rocket.Chat signs in through Blak ID', async ({ page }) => {
    test.skip(!user || !password, 'BLAK_E2E_USER and BLAK_E2E_PASSWORD required');
    await page.goto('https://chat.homelab.local');
    const sso = page.getByRole('button', { name: /Blak ID|blakid/i }).or(page.getByRole('link', { name: /Blak ID|blakid/i }));
    await sso.first().click({ timeout: 45_000 });
    await authentikLogin(page);
    await page.waitForURL((url) => url.hostname === 'chat.homelab.local' && !url.pathname.includes('_oauth'), { timeout: 45_000 });
    await expect(page).not.toHaveURL(/id\.homelab\.local/);
    await expect(page.getByRole('button', { name: 'Create channel', exact: true })).toBeVisible({ timeout: 45000 });
    await expect(page.getByRole('heading', { name: 'Reset password', exact: true })).toHaveCount(0);
    await expect.poll(() => page.locator('body').evaluate(el => getComputedStyle(el).getPropertyValue('--rcx-color-button-background-primary-default').trim())).toBe(tokens.dark.primary);
    await expect(page.locator('nav.rcx-sidebar--main')).toHaveCSS('background-color', 'rgb(11, 17, 18)');
  });

  test('Kaneo signs in through Blak ID', async ({ page }) => {
    test.skip(!user || !password, 'BLAK_E2E_USER and BLAK_E2E_PASSWORD required');
    await page.goto('https://projects.homelab.local');
    const oidc = page.getByRole('button', { name: /Continue with OIDC/i });
    await Promise.race([
      page.waitForURL(/id\.homelab\.local/, { timeout: 20_000 }),
      oidc.waitFor({ state: 'visible', timeout: 20_000 }),
    ]).catch(() => {});
    if (!page.url().includes('id.homelab.local')) {
      await oidc.click({ timeout: 10_000 });
    }
    await authentikLogin(page);
    await page.waitForURL((url) => url.hostname === 'projects.homelab.local' && !url.pathname.includes('sign-in'), { timeout: 45_000 });
    await expect(page.getByRole('button', { name: /Continue with OIDC/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create workspace', exact: true })).toBeVisible();
  });
});
