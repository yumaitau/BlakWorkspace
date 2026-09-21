'use strict';

const { defineConfig } = require('@playwright/test');

const baseURL = process.env.BLAK_E2E_BASE_URL || 'https://portal.workspace.example.com';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  ...(process.env.BLAK_E2E_SNAPSHOT_PLATFORM ? {snapshotPathTemplate:'{testDir}/{testFilePath}-snapshots/{arg}-'+process.env.BLAK_E2E_SNAPSHOT_PLATFORM+'{ext}'} : {}),
  reporter: [['list'], ['html', { open: 'never', outputFolder: process.env.BLAK_E2E_REPORT || 'playwright-report' }]],
  use: {
    baseURL,
    ...require('./helpers/network').publicNetworkOptions,
    ...(process.env.PLAYWRIGHT_WS_ENDPOINT ? {connectOptions:{wsEndpoint:process.env.PLAYWRIGHT_WS_ENDPOINT,exposeNetwork:process.env.PLAYWRIGHT_EXPOSE_NETWORK}} : {}),
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  outputDir: process.env.BLAK_E2E_OUTPUT || 'test-results',
});
