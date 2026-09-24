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

test('configured local DNS resolves browser destinations without system DNS fallback', async ({ browser }) => {
  const dgram = require('node:dgram');
  const dns = dgram.createSocket('udp4');
  let lookups = 0;
  dns.on('message', (query, peer) => {
    lookups++;
    const type = query.readUInt16BE(query.length - 4);
    const answer = type === 1 ? Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4, 127, 0, 0, 1]) : Buffer.alloc(0);
    const response = Buffer.concat([query, answer]);
    response.writeUInt16BE(0x8180, 2);
    response.writeUInt16BE(type === 1 ? 1 : 0, 6);
    dns.send(response, peer.port, peer.address);
  });
  await new Promise(resolve => dns.bind(0, '127.0.0.1', resolve));
  let requests = 0;
  const local = http.createServer((_req, res) => { requests++; res.end('<title>Local DNS reached</title>'); });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  const origin = `http://only-local-dns.invalid:${local.address().port}`;
  const gate = await localBrowserProxy([origin], { dnsServers: [`127.0.0.1:${dns.address().port}`] });
  const context = await browser.newContext({ serviceWorkers: 'block', proxy: { server: gate.address, bypass: '<-loopback>' } });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await expect(page).toHaveTitle('Local DNS reached');
    expect(lookups).toBeGreaterThan(0);
    expect(requests).toBeGreaterThan(0);
    // NXDOMAIN from the configured resolver must also block a system-resolvable host.
    dns.removeAllListeners('message');
    dns.on('message', (query, peer) => {
      const response = Buffer.from(query);
      response.writeUInt16BE(0x8183, 2);
      dns.send(response, peer.port, peer.address);
    });
    const failedGate = await localBrowserProxy([`http://localhost:${local.address().port}`], {
      dnsServers: [`127.0.0.1:${dns.address().port}`],
    });
    const before = requests;
    try {
      const response = await new Promise((resolve, reject) => {
        http.get(failedGate.address, { path: `http://localhost:${local.address().port}` }, resolve).on('error', reject);
      });
      response.resume();
      expect(response.statusCode).toBe(502);
      expect(requests).toBe(before);
    } finally { await failedGate.close(); }
  } finally {
    await context.close(); await gate.close();
    local.closeAllConnections();
    await new Promise(resolve => local.close(resolve));
    dns.close();
  }
});
