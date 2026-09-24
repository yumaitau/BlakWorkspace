'use strict';
const http = require('node:http');
const { test, expect } = require('@playwright/test');
const { localBrowserProxy } = require('../helpers/local-network');

test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });
test('local-origin gate blocks HTTP, redirects and WebSockets before reaching an external server', async ({ browser }) => {
  let externalRequests = 0;
  const outside = http.createServer((_req, res) => { externalRequests++; res.end('outside'); });
  outside.on('upgrade', (_req, socket) => { externalRequests++; socket.destroy(); });
  await new Promise(resolve => outside.listen(0, '127.0.0.1', resolve));
  const outsideOrigin = `http://127.0.0.1:${outside.address().port}`;
  const local = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: outsideOrigin }); res.end(); }
    else { res.setHeader('content-type', 'text/html'); res.end('<title>Local service</title>'); }
  });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  const localOrigin = `http://127.0.0.1:${local.address().port}`;
  const gate = await localBrowserProxy([localOrigin]);
  const context = await browser.newContext({ serviceWorkers: 'block', proxy: { server: gate.address, bypass: '<-loopback>' } });
  const page = await context.newPage();
  try {
    await page.goto(localOrigin);
    await expect(page).toHaveTitle('Local service');
    const results = await page.evaluate(async ({ outsideOrigin, localOrigin }) => {
      const fetches = await Promise.all([outsideOrigin, `${localOrigin}/redirect`].map(url =>
        fetch(url).then(response => response.status === 403 ? 'blocked' : 'allowed', () => 'blocked')));
      const socket = await new Promise(resolve => {
        const ws = new WebSocket(outsideOrigin.replace('http:', 'ws:'));
        ws.onopen = () => { ws.close(); resolve('allowed'); };
        ws.onclose = () => resolve('blocked');
        ws.onerror = () => resolve('blocked');
      });
      return [...fetches, socket];
    }, { outsideOrigin, localOrigin });
    expect(results).toEqual(['blocked', 'blocked', 'blocked']);
    expect(externalRequests).toBe(0);
    expect(gate.report().some(item => item.origin.startsWith('connect '))).toBe(true);
  } finally {
    await context.close();
    await gate.close();
    local.closeAllConnections(); outside.closeAllConnections();
    await Promise.all([new Promise(resolve => local.close(resolve)), new Promise(resolve => outside.close(resolve))]);
  }
});
