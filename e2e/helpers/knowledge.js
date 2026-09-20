'use strict';
const crypto = require('node:crypto');
const { expect } = require('@playwright/test');
const { syncAccount, serviceURL } = require('./sync');
async function privateKnowledge(playwright) {
  const account = syncAccount();
  const client = await playwright.request.newContext({ proxy: undefined, baseURL: serviceURL('hermes', 8080), extraHTTPHeaders: { authorization: 'Bearer ' + account.hermes.token }, timeout: 180000 });
  async function collection(label) {
    const response = await client.get('/api/v1/knowledge/');
    expect(response.ok()).toBeTruthy();
    const item = (await response.json()).items.find(c => c.name === 'Blak Workspace · ' + label);
    expect(item, 'Missing private ' + label + ' collection').toBeTruthy();
    expect(item.user_id).toBe(account.owner_id);
    expect(item.access_grants).toEqual([]);
    return item;
  }
  async function query(label, phrase) {
    const item = await collection(label);
    const response = await client.post('/api/v1/retrieval/query/collection', { data: { collection_names: [item.id], query: phrase, k: 20 } });
    expect(response.ok()).toBeTruthy();
    return JSON.stringify(await response.json());
  }
  async function files(label) {
    const item = await collection(label);
    const response = await client.get(`/api/v1/knowledge/${item.id}/files`);
    expect(response.ok()).toBeTruthy();
    return JSON.stringify(await response.json());
  }
  return { account, client, collection, query, files };
}
const indexedName = (source, id) => source + '-' + crypto.createHash('sha256').update(id).digest('hex').slice(0, 20) + '.json';
module.exports = { privateKnowledge, indexedName };
