'use strict';
const http = require('node:http');
// Unlike fetch(), this leaves Sec-Fetch-* absent unless a test explicitly sets it.
function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const value = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: { get: key => res.headers[key] }, text: async () => value, json: async () => JSON.parse(value) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
module.exports = { request };
