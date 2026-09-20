'use strict';
const http = require('node:http');
const https = require('node:https');
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

function request(url, { method = 'GET', headers = {}, body, timeout = TIMEOUT_MS } = {}) {
  const target = new URL(url);
  if (body != null) headers = { ...headers, 'content-length': Buffer.byteLength(body) };
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.request(target, { method, headers, timeout }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          res.destroy(new Error('upstream response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
async function textRequest(url, options) {
  const result = await request(url, options);
  return { ...result, body: result.body.toString('utf8') };
}
module.exports = { request, textRequest };
