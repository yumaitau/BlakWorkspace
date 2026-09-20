'use strict';
const { test, expect } = require('@playwright/test');
const { authentikLogin } = require('../helpers/auth');
const { tokens } = require('../../apps/portal/theme');

test('Drive SSO renders files and shared brand themes', async ({ page, request }) => {
  await page.goto('https://drive.homelab.local');
  await authentikLogin(page);
  await page.waitForURL(url => url.hostname === 'drive.homelab.local' && !url.pathname.includes('oidc-callback'));
  await expect(page.getByRole('button', { name: /New/i }).first()).toBeVisible({ timeout: 45000 });
  const theme = await (await request.get('https://drive.homelab.local/themes/blak/theme.json')).json();
  expect(theme.common.name).toBe('Blak Drive');
  expect(theme.clients.web.themes.map(item => item.designTokens.roles.primary)).toEqual([tokens.dark.primary, tokens.dark.primary]);
  await page.screenshot({ path: test.info().outputPath('drive.png'), fullPage: true });
});

test('Knowledge SSO renders branded workspace', async ({ page }) => {
  await page.goto('https://sites.homelab.local');
  await authentikLogin(page);
  await page.waitForURL(url => url.hostname === 'sites.homelab.local' && !url.pathname.includes('auth'));
  await expect(page.locator('body')).toContainText('Blak Knowledge');
  await expect(page.getByRole('link', { name: /Home/i }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('knowledge.png'), fullPage: true });
});

test('Projects stylesheet uses shared palette and branded title', async ({ page }) => {
  await page.goto('https://projects.homelab.local');
  await authentikLogin(page);
  await page.waitForURL(url => url.hostname === 'projects.homelab.local' && !url.pathname.includes('sign-in'));
  await expect(page).toHaveTitle('Blak Projects · Powered by Kaneo');
  await expect.poll(() => page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--primary').trim())).toBe(tokens.dark.primary);
  await page.screenshot({ path: test.info().outputPath('projects.png'), fullPage: true });
});

test('Docs discovery and Hermes custom theme are available', async ({ request }) => {
  const docs = await request.get('https://docs.homelab.local/hosting/discovery');
  expect(docs.ok()).toBeTruthy();
  expect(await docs.text()).toContain('wopi-discovery');
  const css = await request.get('https://hermes.homelab.local/static/custom.css');
  expect(css.ok()).toBeTruthy();
  expect(await css.text()).toContain(tokens.dark.primary);
  expect(await css.text()).toContain(tokens.dark.surface);
});
