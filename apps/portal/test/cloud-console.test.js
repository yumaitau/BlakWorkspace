'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rewriteConsoleDocument, rewriteConsoleScript, consoleUpstreamPath } = require('../cloud-console');

test('console document is served under the portal cloud path and Blak name', () => {
  const html = '<html lang="en"><head><title>Floci UI</title><meta name="description" content="Floci UI — Any Cloud. Locally. The local cloud console for Floci."><link rel="icon" href="/assets/logo.svg"></head><body><div id="root"></div></body></html>';
  const out = rewriteConsoleDocument(html);
  assert.match(out, /<title>Blak Cloud<\/title>/);
  assert.match(out, /data-blak-app="storage"/);
  assert.match(out, /href="\/cloud\/assets\/logo.svg"/);
  assert.match(out, /<main id="root"><\/main>/);
  assert.doesNotMatch(out, /<title>Floci UI<\/title>/);
});

test('console script calls the portal cloud API prefix', () => {
  assert.equal(rewriteConsoleScript('fetch("/api/clouds/aws/status")'), 'fetch("/cloud/api/clouds/aws/status")');
});

test('only the console document, assets and API are proxied', () => {
  assert.equal(consoleUpstreamPath('/cloud'), '/');
  assert.equal(consoleUpstreamPath('/cloud/assets/index.js'), '/assets/index.js');
  assert.equal(consoleUpstreamPath('/cloud/api/clouds/aws/status'), '/api/clouds/aws/status');
  assert.equal(consoleUpstreamPath('/cloud/object'), null);
  assert.equal(consoleUpstreamPath('/cloud/bucket'), null);
});
