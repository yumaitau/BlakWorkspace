'use strict';
const { test, expect } = require('@playwright/test');
const { authentikLogin } = require('../helpers/auth');
const CRM = 'https://crm.workspace.example.com';
test.use({ viewport: { width: 1440, height: 1000 } });
test.describe.configure({ timeout: 120000 });
async function login(page) {
  await page.goto(CRM + '/login?redirect-to=/crm');
  await page.getByRole('link', { name: /Blak ID/ }).click();
  await authentikLogin(page);
  await page.waitForURL(/crm\.workspace\.example\.com\/crm/);
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible({ timeout: 30000 });
}
test('CRM protects records and offers native Blak ID login', async ({ page, request }) => {
  expect((await page.goto(CRM + '/crm')).status()).toBe(403);
  await page.goto(CRM + '/login?redirect-to=/crm');
  await expect(page.getByRole('link', { name: /Blak ID/ })).toBeVisible();
  const response = await request.get(CRM + '/api/resource/CRM%20Lead');
  expect([401, 403]).toContain(response.status());
});
test('CRM native SSO and shared theme', async ({ page }) => {
  await login(page);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--blak-crm-accent').trim())).toBe('#D65B2E');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
  const logo = page.locator('img[src="https://portal.workspace.example.com/brand/logo.svg"]').first();
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('frappe-crm.png'), fullPage: true });
});
async function api(page, method, path, data) {
  const token = await page.evaluate(() => window.csrf_token);
  const response = await page.request.fetch(CRM + '/api/' + path, {
    method, data, headers: { 'X-Frappe-CSRF-Token': token || '' },
  });
  expect(response.ok(), `${method} ${path}: ${response.status()}`).toBeTruthy();
  return response.json();
}
async function findRecords(page, doctype, filters) {
  const query = new URLSearchParams({ filters: JSON.stringify(filters), fields: '["name"]' });
  return (await api(page, 'GET', `resource/${encodeURIComponent(doctype)}?${query}`)).data;
}
async function cleanup(page, doctype, filters) {
  for (const doc of await findRecords(page, doctype, filters))
    await api(page, 'DELETE', `resource/${encodeURIComponent(doctype)}/${encodeURIComponent(doc.name)}`);
}
test('CRM lead creation, persistence and conversion to a deal', async ({ page }) => {
  await login(page);
  const name = 'E2E Lead ' + Date.now();
  const email = `e2e-${Date.now()}@example.test`;
  try {
    await page.goto(CRM + '/crm/leads');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('First Name', { exact: true }).fill(name);
    await dialog.getByPlaceholder('Email', { exact: true }).fill(email);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await findRecords(page, 'CRM Lead', { email })).length).toBe(1);
    const [lead] = await findRecords(page, 'CRM Lead', { email });
    await page.goto(CRM + '/crm/leads/' + lead.name);
    await page.reload();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Convert to Deal', exact: true }).click();
    await dialog.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await findRecords(page, 'CRM Deal', { email })).length).toBe(1);
    const [deal] = await findRecords(page, 'CRM Deal', { email });
    await page.goto(CRM + '/crm/deals/' + deal.name);
    await page.reload();
    await expect(page.getByRole('link', { name: deal.name, exact: true })).toBeVisible();
    expect((await api(page, 'GET', 'resource/CRM%20Deal/' + deal.name)).data.email).toBe(email);
  } finally {
    await cleanup(page, 'CRM Deal', { email });
    await cleanup(page, 'CRM Lead', { email });
    await cleanup(page, 'Contact', { email_id: email });
  }
});
test('CRM reuses portal identity and logout invalidates CRM session', async ({ page }) => {
  await page.goto('https://portal.workspace.example.com/login');
  await authentikLogin(page);
  await page.waitForURL(url => url.hostname === 'portal.workspace.example.com' && url.pathname === '/');
  await expect(page.getByText('Blak CRM', { exact: true }).first()).toBeVisible();
  await page.goto(CRM + '/login?redirect-to=/crm');
  await page.getByRole('link', { name: /Blak ID/ }).click();
  await page.waitForURL(/crm\.workspace\.example\.com\/crm/);
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
  await api(page, 'POST', 'method/logout');
  const denied = await page.request.get(CRM + '/api/resource/CRM%20Lead');
  expect([401, 403]).toContain(denied.status());
  expect((await page.goto(CRM + '/crm')).status()).toBe(403);
});
for (const record of [
  { section: 'organizations', doctype: 'CRM Organization', field: 'organization_name', placeholder: 'Organization Name', rename: true },
  { section: 'contacts', doctype: 'Contact', field: 'first_name', placeholder: 'First Name' },
]) {
  test(`CRM ${record.section}: create in browser, persist, update and delete`, async ({ page }) => {
    await login(page);
    const name = `E2E ${record.section} ${Date.now()}`, updated = name + ' Updated';
    try {
      await page.goto(`${CRM}/crm/${record.section}`);
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder(record.placeholder, { exact: true }).fill(name);
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(async () => (await findRecords(page, record.doctype, { [record.field]: name })).length).toBe(1);
      const [doc] = await findRecords(page, record.doctype, { [record.field]: name });
      await page.goto(`${CRM}/crm/${record.section}`);
      await page.reload();
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      // Exercise the authenticated public API too; the browser must reflect saved changes.
      if (record.rename) {
        await api(page, 'POST', 'method/frappe.client.rename_doc', { doctype: record.doctype, old_name: doc.name, new_name: updated });
        doc.name = updated;
      } else {
        await api(page, 'PUT', `resource/${encodeURIComponent(record.doctype)}/${encodeURIComponent(doc.name)}`, { [record.field]: updated });
      }
      await page.reload();
      await expect(page.getByText(updated, { exact: true }).first()).toBeVisible();
      await api(page, 'DELETE', `resource/${encodeURIComponent(record.doctype)}/${encodeURIComponent(doc.name)}`);
      await page.reload();
      await expect(page.getByText(updated, { exact: true })).toHaveCount(0);
      expect(await findRecords(page, record.doctype, { [record.field]: updated })).toEqual([]);
    } finally {
      await cleanup(page, record.doctype, { [record.field]: ['in', [name, updated]] });
    }
  });
}
