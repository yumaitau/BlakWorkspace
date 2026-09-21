'use strict';
const crypto = require('node:crypto');
const { expect } = require('@playwright/test');

function totp(key) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = crypto.createHmac('sha1', Buffer.from(key, 'hex')).update(counter).digest();
  return String((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function vaultLogin(page, account, base = 'https://vault.workspace.example.com') {
  // Discover the upstream identifier rather than inventing an organization ID:
  // Vaultwarden uses it to select the native initial master-password policy.
  const response = await page.request.post(base + '/api/organizations/domain/sso/verified', { data: {} });
  expect(response.ok()).toBeTruthy();
  const identifier = (await response.json()).data[0].organizationIdentifier;
  expect(identifier).toMatch(/^[a-f0-9-]{36}$/i);
  await page.goto(base + '/#/sso?identifier=' + encodeURIComponent(identifier), { waitUntil: 'domcontentloaded' });
  let submittedMfa = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const username = page.getByRole('textbox', { name: /email or username/i });
    const loginPassword = page.getByRole('textbox', { name: /^password$/i });
    const mfa = page.locator('#validation-code-input');
    const initial = page.locator('#input-password-form_new-password');
    const unlock = page.getByRole('button', { name: 'Unlock', exact: true });
    const skipExtension = page.getByText('Skip to web app', { exact: true });
    const later = page.getByText('Add it later', { exact: true });
    if (await username.isVisible()) {
      await username.fill(account.username);
      await page.getByRole('button', { name: /log in/i }).click();
    } else if (new URL(page.url()).origin !== new URL(base).origin && await loginPassword.isVisible()) {
      await loginPassword.fill(account.password);
      await page.getByRole('button', { name: /continue/i }).click();
    } else if (await mfa.isVisible() && !submittedMfa) {
      await mfa.fill(totp(account.totp));
      await expect(mfa).not.toHaveValue('');
      await page.getByRole('button', { name: /continue/i }).click();
      submittedMfa = true;
    } else if (await initial.isVisible()) {
      if (!account.allowCreate) throw Error('Unexpected native vault enrollment');
      await initial.fill(account.master);
      await page.locator('#input-password-form_new-password-confirm').fill(account.master);
      // This is a disposable test password; no external breach lookup needed.
      await page.locator('#input-password-form_check-for-breaches').uncheck();
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
    } else if (await unlock.isVisible()) {
      await page.locator('input[type=password]').first().fill(account.master);
      await unlock.click();
    } else if (await skipExtension.isVisible()) {
      await skipExtension.click();
    } else if (await later.isVisible()) {
      await later.click();
      await skipExtension.waitFor({state:'visible'});
      await skipExtension.click();
    } else if (new URL(page.url()).origin === new URL(base).origin && new URL(page.url()).hash.startsWith('#/vault')) {
      return;
    }
    await page.waitForTimeout(500);
  }
  throw Error('Native vault login did not reach an unlocked vault');
}

module.exports = { vaultLogin, totp };
