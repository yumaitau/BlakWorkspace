'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publicApps } = require('../public-urls');

const apps = [
  { id: 'chat', url: 'https://chat.workspace.example.com' },
  { id: 'crm', url: 'https://crm.workspace.example.com/login?redirect-to=/crm' },
  { id: 'draw', url: '/draw' },
  { id: 'sites', url: 'https://sites.workspace.example.com' },
];

test('public origins replace only the host and keep the path', () => {
  const out = publicApps(apps, { BLAK_APP_ORIGINS: JSON.stringify({
    chat: 'https://homelab.tail073805.ts.net:8451',
    crm: 'https://homelab.tail073805.ts.net:8450',
  }) });
  assert.equal(out[0].url, 'https://homelab.tail073805.ts.net:8451/');
  assert.equal(out[1].url, 'https://homelab.tail073805.ts.net:8450/login?redirect-to=/crm');
  assert.equal(out[2].url, '/draw');
  assert.equal(out[3].url, 'https://sites.workspace.example.com');
});

test('missing origins leave the catalog unchanged', () => {
  assert.equal(publicApps(apps, {})[0].url, apps[0].url);
});
