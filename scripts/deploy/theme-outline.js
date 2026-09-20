'use strict';
// Operator-only: apply supported Outline theme preferences through the signed-in account.
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const { authentikLogin } = require('../../e2e/helpers/auth');
const { tokens } = require('../../apps/portal/theme');
(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto('https://sites.workspace.example.com');
    await authentikLogin(page);
    await page.waitForURL(url => url.hostname === 'sites.workspace.example.com' && !url.pathname.includes('auth'));
    const csrf = (await context.cookies()).find(cookie => /csrfToken$/.test(cookie.name));
    if (!csrf) throw new Error('Missing Outline CSRF token');
    const response = await context.request.post('https://sites.workspace.example.com/api/teams.update', {
      headers: { 'x-csrf-token': csrf.value },
      data: { name: 'Blak Knowledge', preferences: { customTheme: { accent: tokens.dark.primary, accentText: tokens.dark['sand-50'] } } },
    });
    if (!response.ok()) throw new Error(`Outline branding failed (${response.status()})`);
    console.log('Outline workspace branding applied');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
