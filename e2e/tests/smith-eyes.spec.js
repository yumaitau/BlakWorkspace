'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { authentikLogin } = require('../helpers/auth');

const host = process.env.BLAK_E2E_HOST || 'homelab.tail073805.ts.net';
const portal = process.env.BLAK_E2E_BASE_URL || `https://${host}`;
const smith = process.env.BLAK_E2E_SMITH_URL || `https://${host}:8455`;
const eyes = process.env.BLAK_E2E_EYES_URL || `https://${host}:8456`;
const layer = path.join(__dirname, '../fixtures/survey-layer.geojson');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function ensureCredentials() {
  process.env.BLAK_E2E_IDP_URL = process.env.BLAK_E2E_IDP_URL || `https://${host}:8444`;
  if (process.env.BLAK_E2E_USER && process.env.BLAK_E2E_PASSWORD) return;
  const kubeconfig = process.env.KUBECONFIG || `${process.env.HOME}/.kube/blak-homelab-ts.yaml`;
  const secret = JSON.parse(execFileSync('kubectl', ['-n', 'blak-micro', 'get', 'secret', 'blak-idp', '-o', 'json'], {
    encoding: 'utf8',
    env: { ...process.env, KUBECONFIG: kubeconfig },
  }));
  process.env.BLAK_E2E_USER = 'akadmin';
  process.env.BLAK_E2E_PASSWORD = Buffer.from(secret.data['bootstrap-password'], 'base64').toString();
}

async function continueWithBlakId(page, origin, signedIn) {
  const button = page.getByRole('button', { name: 'Continue with Blak ID' });
  await expect(button.or(signedIn)).toBeVisible();
  if (!(await button.isVisible())) return;
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await button.click();
  const idp = new URL(process.env.BLAK_E2E_IDP_URL).origin;
  await page.waitForURL(url => url.origin === idp || url.origin === origin, { timeout: 60000 });
  if (new URL(page.url()).origin === idp) await authentikLogin(page);
  await expect(signedIn).toBeVisible({ timeout: 60000 });
}

test('Blak ID opens Eyes and a survey layer can be read', async ({ page }) => {
  test.setTimeout(180000);
  ensureCredentials();
  await page.goto(`${portal}/login`);
  await authentikLogin(page);
  await page.waitForURL(url => url.origin === new URL(portal).origin && url.pathname === '/');
  await page.goto(eyes);
  await continueWithBlakId(page, new URL(eyes).origin, page.getByRole('button', { name: 'Tools' }));
  await page.getByRole('button', { name: 'Tools' }).click();
  await expect(page.getByRole('heading', { name: 'Survey layers' })).toBeVisible();
  await expect(page.getByText('GeoPackage')).toBeVisible();
  await page.getByLabel('Upload').setInputFiles(layer);
  await expect(page.getByText('survey-layer.geojson · geojson')).toBeVisible();
});

test('Blak ID opens Smith', async ({ page }) => {
  test.setTimeout(180000);
  ensureCredentials();
  await page.goto(`${portal}/login`);
  await authentikLogin(page);
  await page.waitForURL(url => url.origin === new URL(portal).origin && url.pathname === '/');
  await page.goto(`${smith}/login`);
  await continueWithBlakId(page, new URL(smith).origin, page.getByRole('heading', { name: 'Home' }));
  await expect(page.getByText('Records your organisation holds')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});
