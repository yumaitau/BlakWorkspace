'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { openStore, connectScan, clamdCommand, createLoop, releaseFile, deleteHeld } = require('./file-guard');

const dir = process.env.FILE_GUARD_DIR || '/var/lib/file-guard';
const root = process.env.SCAN_ROOT || '';
const token = process.env.FILE_GUARD_TOKEN || '';
const host = process.env.CLAMAV_HOST || 'clamav';
const port = Number(process.env.CLAMAV_PORT || 3310);
const listenPort = Number(process.env.FILE_GUARD_PORT || 8092);
const store = openStore(dir);

function authorized(req) {
  if (!token) return false;
  const header = String(req.headers.authorization || '');
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const loop = root ? createLoop({
  root,
  store,
  intervalMs: Number(process.env.SCAN_EVERY_MS || 300000),
  scanFile: (filePath, size) => connectScan(host, port, filePath, size),
  version: () => clamdCommand(host, port, 'VERSION'),
}) : null;

const server = http.createServer((req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"message":"Unauthorized"}');
    return;
  }
  const url = new URL(req.url, 'http://file-guard');
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && url.pathname === '/held') {
    send(200, { held: store.list(), checker: loop ? loop.lastError() : '' });
    return;
  }
  const match = url.pathname.match(/^\/held\/([a-f0-9]+)\/(release|delete)$/);
  if (req.method === 'POST' && match) {
    try {
      const meta = match[2] === 'release' ? releaseFile(store, match[1], root) : deleteHeld(store, match[1]);
      send(200, { ok: true, id: meta.id, state: meta.state });
    } catch (error) {
      send(error.status || 400, { message: error.message });
    }
    return;
  }
  send(404, { message: 'Not found' });
});

if (require.main === module) {
  if (loop) loop.start();
  server.listen(listenPort, '0.0.0.0');
}

module.exports = { server };
