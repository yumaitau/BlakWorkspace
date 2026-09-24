'use strict';
const { test, expect } = require('../helpers/offline-test');
const { authentikLogin } = require('../helpers/auth');

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.BLAK_E2E_LOCAL_ONLY !== '1', 'Operator-run local-origin acceptance');

test('Smith refuses malformed field imports through its signed-in native API', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/login`);
  await authentikLogin(page);
  await page.waitForURL(url => url.origin === new URL(baseURL).origin && url.pathname === '/');
  await page.goto(`${baseURL}/launch/smith`);
  const signIn = page.getByRole('button', { name: 'Continue with Blak ID', exact: true });
  const ready = page.getByRole('heading', { name: 'Home', exact: true });
  await expect(signIn.or(ready)).toBeVisible();
  if (await signIn.isVisible()) await signIn.click();
  await expect(ready).toBeVisible();
  // Invalid bodies only: no record is created even on a regression of the guard.
  for (const body of [null, [], { format: 'blaksmith.field-capture/v1' }, {
    format: 'blaksmith.field-capture/v1', deviceProfile: 'unknown', observation: {},
  }]) {
    const status = await page.evaluate(async body => (await fetch('/api/field-capture', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })).status, body);
    expect(status).toBe(400);
  }
});
