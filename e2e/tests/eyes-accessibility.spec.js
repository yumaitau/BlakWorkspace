'use strict';
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { authentikLogin } = require('../helpers/auth');

// Operator-only: CI cannot reach the homelab. No traces or saved credentials.
const host = process.env.BLAK_E2E_HOST || 'homelab.tail073805.ts.net';
const portal = process.env.BLAK_E2E_BASE_URL || `https://${host}`;
const eyes = process.env.BLAK_E2E_EYES_URL || `https://${host}:8456`;
const screens = ['Overview', 'Surveys', 'Review', 'Objects', 'Map', 'Data quality', 'Taxonomy', 'Models', 'Appliance', 'Tools', 'Exports'];
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function audit(page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
}

for (const theme of ['dark', 'light']) {
  test(`Eyes readable in ${theme} workspace on desktop and mobile`, async ({ page, context }) => {
    test.setTimeout(180000);
    page.setDefaultTimeout(15000);
    process.env.BLAK_E2E_IDP_URL ||= `https://${host}:8444`;
    if (!process.env.BLAK_E2E_USER || !process.env.BLAK_E2E_PASSWORD) {
      const secret = JSON.parse(execFileSync('kubectl', ['--request-timeout=15s', '--kubeconfig', process.env.KUBECONFIG || `${process.env.HOME}/.kube/blak-homelab-ts.yaml`, '-n', 'blak-micro', 'get', 'secret', 'blak-idp', '-o', 'json'], { encoding: 'utf8', timeout: 20000 }));
      process.env.BLAK_E2E_USER = 'akadmin';
      process.env.BLAK_E2E_PASSWORD = Buffer.from(secret.data['bootstrap-password'], 'base64').toString();
    }
    await context.addCookies([{ name: 'blak-theme', value: theme, url: eyes, secure: true, sameSite: 'Lax' }]);
    await page.goto(`${portal}/login`);
    await authentikLogin(page);
    await page.waitForURL(url => url.origin === new URL(portal).origin && url.pathname === '/');
    await page.goto(eyes);
    const signIn = page.getByRole('button', { name: 'Continue with Blak ID' });
    const tools = page.getByRole('button', { name: 'Tools', exact: true });
    await expect(signIn.or(tools)).toBeVisible();
    if (await signIn.isVisible()) await signIn.click();
    await expect(tools).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-blak-theme', theme);
    for (const screen of screens) {
      await test.step(screen, async () => {
        await page.getByRole('button', { name: screen, exact: true }).click();
        await audit(page);
      });
    }
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'New site', exact: true }).click();
    await audit(page);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath(`eyes-${theme}-desktop.png`), fullPage: true });
    // Native light controls must stay light even when workspace chrome is dark.
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).color)).toBe('rgb(40, 41, 35)');
    await page.setViewportSize({ width: 390, height: 844 });
    await audit(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`eyes-${theme}-mobile.png`), fullPage: true });
    const menu = page.getByRole('button', { name: 'Toggle navigation', exact: true });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(tools).toBeVisible();
    await audit(page);
    await tools.click();
    await audit(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
