'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TEMPLATES, createClient, homeFragment } = require('../outline-sites');

test('a new intranet site is an Outline collection filled from the starter templates', async () => {
  const calls = [];
  const client = createClient({
    url: 'http://sites:3000',
    token: 'ol_api_test',
    publicUrl: 'https://sites.example',
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      if (url.endsWith('/collections.create')) {
        return { ok: true, json: async () => ({ ok: true, data: { id: 'col-1', name: body.name, url: '/collection/people-abc' } }) };
      }
      return { ok: true, json: async () => ({ ok: true, data: { id: 'doc', title: body.title } }) };
    },
  });
  const created = await client.createSite('People and culture', 'How the organisation works');
  assert.equal(created.href, 'https://sites.example/collection/people-abc');
  assert.equal(calls[0].url, 'http://sites:3000/api/collections.create');
  assert.equal(calls[0].body.permission, 'read_write');
  assert.deepEqual(calls.slice(1).map((call) => call.body.title), TEMPLATES.map((template) => template.title));
  assert.equal(calls[1].body.collectionId, 'col-1');
  assert.equal(calls[1].body.publish, true);
  assert.match(calls[1].body.text, /^# Home/);
});

test('home lists knowledge sites and a missing key does not invent pages', async () => {
  const html = homeFragment([{ name: 'People and culture', url: '/collection/people-abc', description: 'Team site' }], 'https://sites.example');
  assert.match(html, /href="https:\/\/sites\.example\/collection\/people-abc"/);
  assert.match(html, /People and culture/);
  assert.equal(html.includes('<script>'), false);
  const client = createClient({ url: 'http://sites:3000', token: '' });
  assert.deepEqual(await client.listCollections(), []);
  await assert.rejects(() => client.createSite('Ops', ''), /not connected/);
});
