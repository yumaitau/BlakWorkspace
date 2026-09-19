'use strict';

const { test, expect } = require('@playwright/test');

const user = process.env.BLAK_E2E_USER || '';
const password = process.env.BLAK_E2E_PASSWORD || '';

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
    await page.waitForLoadState('domcontentloaded');
    const uid = page.locator('input[name="uidField"], input[name="username"], input#id_uid_field, input[type="text"]').first();
    const pw = page.locator('input[name="password"], input[type="password"]').first();
    await uid.waitFor({ state: 'visible' });
    await uid.fill(user);
    await pw.fill(password);
    await page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")').first().click();
    await page.waitForURL(/portal\.homelab\.local/, { timeout: 30_000 });
    await expect(page.locator('[data-testid="userchip"]')).toBeVisible();
    await expect(page.locator('[data-testid="userchip"] .nm')).not.toHaveText('');

    await page.locator('[data-testid="waffle"]').click();
    const flowItem = page.locator('[data-app="flow"]');
    await expect(flowItem).toBeVisible();
    await expect(flowItem).toHaveAttribute('href', '/flow');
    await expect(flowItem).not.toHaveClass(/soon/);

    await page.goto('/flow/new');
    const name = `e2e-${Date.now()}`;
    await page.locator('[data-testid="flow-builder"] input[name="name"]').fill(name);
    await page.locator('[data-testid="save-flow"]').click();
    await page.waitForURL(/\/flow\/[a-f0-9]+/);
    await page.getByRole('button', { name: 'Enable' }).click();
    await page.locator('[data-testid="run-flow"]').click();
    await page.waitForURL(/\/flow\/activity/);
    await expect(page.locator('[data-testid="run-row"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="flow-activity"]')).toContainText(/ok/i);
  });
});
