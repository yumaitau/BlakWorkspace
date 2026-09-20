'use strict';

const { defineConfig } = require('@playwright/test');

const baseURL = process.env.BLAK_E2E_BASE_URL || 'https://portal.homelab.local';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: process.env.BLAK_E2E_REPORT || 'playwright-report' }]],
  use: {
    baseURL,
    ...(process.env.PLAYWRIGHT_WS_ENDPOINT ? {connectOptions:{wsEndpoint:process.env.PLAYWRIGHT_WS_ENDPOINT}} : {}),
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  outputDir: process.env.BLAK_E2E_OUTPUT || 'test-results',
});
