'use strict';
const { expect } = require('@playwright/test');
async function authentikLogin(page) {
  const user=process.env.BLAK_E2E_USER;
  const password=process.env.BLAK_E2E_PASSWORD;
  if (!user || !password) throw new Error('BLAK_E2E_USER and BLAK_E2E_PASSWORD required');
  await page.waitForURL(/id\.workspace\.example\.com/);
  // The URL changes before Authentik finishes rendering its first stage.
  const uid=page.getByRole('textbox',{name:/email or username/i});
  await uid.waitFor({state:'visible'});
  await uid.fill(user);
  await expect(uid).toHaveValue(user);
  await page.getByRole('button',{name:/log in/i}).click();
  await page.getByRole('textbox',{name:/password/i}).fill(password);
  await page.getByRole('button',{name:/continue/i}).click();
}
module.exports={authentikLogin};
