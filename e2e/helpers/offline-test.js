'use strict';
const { test: base, expect } = require('@playwright/test');
const { localBrowserProxy } = require('./local-network');
const { publicNetworkOptions } = require('./network');

const test = base.extend({
  _localProxy: async ({}, use) => {
    if (process.env.BLAK_E2E_LOCAL_ONLY !== '1') return use(null);
    if (process.env.BLAK_E2E_PROXY || process.env.PLAYWRIGHT_WS_ENDPOINT) {
      throw Error('Local-origin gate requires a local browser with direct access to local services');
    }
    const proxy = await localBrowserProxy(JSON.parse(process.env.BLAK_E2E_LOCAL_ORIGINS || '[]'), {
      dnsServers: process.env.BLAK_E2E_DNS_SERVER ? [process.env.BLAK_E2E_DNS_SERVER] : [],
    });
    try { await use(proxy); } finally { await proxy.close(); }
  },
  proxy: async ({ _localProxy }, use) => {
    await use(_localProxy ? { server: _localProxy.address, bypass: '<-loopback>' } : publicNetworkOptions.proxy);
  },
  _localNetwork: [async ({ _localProxy }, use, testInfo) => {
    try { await use(); }
    finally {
      if (_localProxy) {
        const blocked = _localProxy.report();
        console.log('Blocked external browser origins:', JSON.stringify(blocked));
        await testInfo.attach('external-browser-dependencies', {
          body: JSON.stringify({ scope: 'browser HTTP, HTTPS and WebSocket proxy',
            dnsServer: process.env.BLAK_E2E_DNS_SERVER || 'system', blocked }, null, 2),
          contentType: 'application/json',
        });
      }
    }
  }, { auto: true }],
});
module.exports = { test, expect };
