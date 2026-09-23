'use strict';
// Operator-run against a deployment that includes People & access and the
// blak-portal-access token. Uses throwaway e2e-* accounts and groups only.
const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const { session, workspaceAdmin, account, teamName } = require('../helpers/identity');

test('a workspace admin grants app roles directly and through a team group', async ({ page, context, browser, baseURL }) => {
  test.setTimeout(300000);
  const key = 'access-' + crypto.randomUUID();
  const origin = { origin: new URL(baseURL).origin };
  const targetCookie = await session(key + '-target', 'Access target', ['search'], { search: 'reader' });
  const adminCookie = await session(key + '-admin', 'Access admin', ['search'], { search: 'reader' });
  workspaceAdmin(key + '-admin');
  const target = account(key + '-target');
  const team = teamName('rangers');
  await context.addCookies([{ name: 'blak_session', value: adminCookie, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  const other = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, ...require('../helpers/network').publicNetworkOptions });
  await other.addCookies([{ name: 'blak_session', value: targetCookie, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
  const targetRoles = async () => (await (await other.request.get('/api/me')).json()).roles;
  try {
    // Non-admins are refused by the live Blak ID check.
    expect((await other.request.get('/access/admin/apps')).status()).toBe(403);
    expect((await other.request.get('/access')).status()).toBe(200);

    // Direct role from the person's page, with the effect stated before confirming.
    await page.goto('/access/admin/people?q=' + encodeURIComponent(target.username));
    await page.getByRole('link', { name: 'Access target' }).click();
    const drawRole = page.getByLabel('Direct role in Blak Draw');
    await drawRole.selectOption('writer');
    await drawRole.locator('xpath=ancestor::form').getByRole('button', { name: 'Review change' }).click();
    await expect(page.getByText('Access target will be able to create and edit drawings in Blak Draw')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm change' }).click();
    await expect(page.getByRole('status')).toContainText('Done');
    await expect.poll(async () => (await targetRoles()).draw, { timeout: 65000, intervals: [1000, 3000] }).toBe('writer');

    // Team group: create, add the person, then give the team Flow reader.
    await page.goto('/access/admin/groups');
    await page.getByLabel('Name', { exact: true }).fill(team);
    await page.getByRole('button', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Confirm change' }).click();
    await expect(page.getByRole('status')).toContainText('Done');
    await page.goto('/access/admin/groups');
    await page.getByRole('link', { name: team, exact: true }).click();
    const addPerson = page.getByLabel('Add a person (username or email)');
    await addPerson.fill(target.username);
    await addPerson.locator('xpath=ancestor::form').getByRole('button', { name: 'Review' }).click();
    await page.getByRole('button', { name: 'Confirm change' }).click();
    await expect(page.getByRole('status')).toContainText('Done');
    await page.goto('/access/admin/groups');
    await page.getByRole('link', { name: team, exact: true }).click();
    await page.getByLabel('App', { exact: true }).selectOption('flow');
    await page.getByLabel('Role', { exact: true }).selectOption('reader');
    await page.getByLabel('App', { exact: true }).locator('xpath=ancestor::form').getByRole('button', { name: 'Review' }).click();
    await expect(page.getByText(/Every member of .* will be able to see their flows/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm change' }).click();
    await expect(page.getByRole('status')).toContainText('Done');
    await expect.poll(async () => (await targetRoles()).flow, { timeout: 65000, intervals: [1000, 3000] }).toBe('reader');
    const mine = await other.newPage();
    await mine.goto('/access/me');
    await expect(mine.getByText('Through the team group ' + team)).toBeVisible();
    await mine.close();

    // Guardrails: no CSRF token, and never the administrators group.
    await page.goto('/access/admin/groups');
    const csrf = await page.locator('input[name=csrf]').first().inputValue();
    expect((await page.request.post('/access/admin/apply', { headers: origin, form: { action: 'team-create', name: teamName('no-token') } })).status()).toBe(403);
    const admins = await page.getByRole('link', { name: 'authentik Admins', exact: true }).getAttribute('href');
    const refused = await page.request.post('/access/admin/apply', { headers: origin, form: { csrf, action: 'team-join', team: admins.split('/').pop(), who: target.username } });
    expect(refused.status()).toBe(403);
    expect(await refused.text()).toContain('Blak ID administrators');

    // Removing the direct role takes Draw away.
    await page.goto('/access/admin/people?q=' + encodeURIComponent(target.username));
    await page.getByRole('link', { name: 'Access target' }).click();
    await drawRole.selectOption('');
    await drawRole.locator('xpath=ancestor::form').getByRole('button', { name: 'Review change' }).click();
    await expect(page.getByText('Access target will no longer be able to use Blak Draw.')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm change' }).click();
    await expect.poll(async () => (await targetRoles()).draw, { timeout: 65000, intervals: [1000, 3000] }).toBeUndefined();
  } finally {
    await other.close();
  }
});
