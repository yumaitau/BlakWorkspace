'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { request: fetch } = require('./http-fixture');
const { errorPage, sendError, isBrowserNavigation } = require('../error-pages');
const { server } = require('../server');
let base;
before(async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => new Promise(resolve => server.close(resolve)));

test('browser navigation receives branded recovery pages with the original status', async () => {
  for (const [route, status, title] of [
    ['/missing?private=not-for-display', 404, 'We couldn’t find that page'],
    ['/launch/missing', 404, 'We couldn’t find that page'],
    ['/api/missing', 404, 'We couldn’t find that page'],
    ['/api/me', 401, 'Please sign in'],
    ['/callback?code=not-for-display', 400, 'Let’s start sign-in again'],
  ]) {
    const response = await fetch(base + route, { headers: { accept: 'text/html' } });
    const body = await response.text();
    assert.equal(response.status, status, route);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('x-blak-error-page'), '1');
    assert.ok(body.includes(title));
    assert.match(body, /Go Home/);
    assert.doesNotMatch(body, /not-for-display|bad login state/);
    if (status === 400) assert.match(body, /href="\/login">Sign in again/);
  }
});
test('API fetches remain JSON even when requesting HTML', async () => {
  for (const headers of [{ accept: 'application/json' }, { accept: 'text/html', 'sec-fetch-dest': 'empty' }, { accept: '*/*' }, { accept: 'text/html;q=0' }]) {
    const response = await fetch(base + '/api/missing', { headers });
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.match((await response.json()).error, /link may have changed/);
  }
  const response = await fetch(base + '/api/me');
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Sign in/);
});
test('HEAD errors have no body and document fetch metadata wins over Accept', async () => {
  const response = await fetch(base + '/missing', { method: 'HEAD', headers: { 'sec-fetch-dest': 'document' } });
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(await response.text(), '');
  assert.equal(isBrowserNavigation({ headers: { 'sec-fetch-dest': 'script', accept: 'text/html' } }), false);
});
test('error copy and links are escaped; unexpected failures use safe copy', async () => {
  const html = errorPage(404, { message: '<img src=x onerror=alert(1)>', home: '/" onclick="bad' });
  assert.doesNotMatch(html, /<img|href="\/" onclick/);
  assert.match(html, /&lt;img/);
  const mock = http.createServer((req, res) => sendError(req, res, 500));
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${mock.address().port}/`, { headers: { accept: 'text/html' } });
    assert.equal(response.status, 500);
    assert.match(await response.text(), /Something went wrong/);
  } finally { await new Promise(resolve => mock.close(resolve)); }
});
