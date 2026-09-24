'use strict';

// Browser dependency check only. This does not isolate server egress, DNS or TLS.
function localNetworkPolicy(origins) {
  if (!Array.isArray(origins) || !origins.length) throw Error('Explicit local origins required');
  const allowed = new Set(origins.map(value => {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) throw Error('Local entries must be exact HTTP(S) origins');
    return url.origin;
  }));
  const denied = new Map();
  function permits(value) {
    const url = new URL(value);
    if (url.protocol === 'wss:') url.protocol = 'https:';
    if (url.protocol === 'ws:') url.protocol = 'http:';
    return !url.username && !url.password && allowed.has(url.origin);
  }
  function block(value, transport) {
    // Never retain paths, query strings, tokens, document IDs or message bodies.
    const origin = new URL(value).origin;
    const key = `${transport} ${origin}`;
    denied.set(key, (denied.get(key) || 0) + 1);
  }
  return { permits, block, report: () => Array.from(denied, ([origin, count]) => ({ origin, count })) };
}

async function localBrowserProxy(origins) {
  const http = require('node:http');
  const net = require('node:net');
  const policy = localNetworkPolicy(origins);
  const sockets = new Set();
  function track(socket) {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    return socket;
  }
  function target(value, transport) {
    try {
      const url = new URL(value);
      if (policy.permits(value)) return url;
      policy.block(value, transport);
    } catch { /* Invalid destinations never leave the proxy. */ }
    return null;
  }
  const server = http.createServer((req, res) => {
    const url = target(req.url, 'http');
    if (!url || url.protocol !== 'http:') { res.writeHead(403); res.end(); return; }
    const headers = { ...req.headers, host: url.host };
    delete headers['proxy-authorization']; delete headers['proxy-connection'];
    const upstream = http.request(url, { method: req.method, headers }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('socket', track);
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('connection', track);
  server.on('connect', (req, client, head) => {
    const url = target(`https://${req.url}`, 'connect');
    if (!url) { client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const upstream = track(net.connect(Number(url.port || 443), url.hostname, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    }));
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
  });
  server.on('upgrade', (req, client, head) => {
    const url = target(req.url, 'websocket');
    if (!url || !['ws:', 'http:'].includes(url.protocol)) {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const upstream = track(net.connect(Number(url.port || 80), url.hostname, () => {
      const headers = { ...req.headers, host: url.host };
      delete headers['proxy-authorization']; delete headers['proxy-connection'];
      upstream.write(`${req.method} ${url.pathname}${url.search} HTTP/1.1\r\n` +
        Object.entries(headers).map(([key, value]) => `${key}: ${value}\r\n`).join('') + '\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    }));
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    address: `http://127.0.0.1:${server.address().port}`,
    report: policy.report,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

module.exports = { localNetworkPolicy, localBrowserProxy };
