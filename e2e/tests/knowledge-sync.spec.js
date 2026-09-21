'use strict';
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { syncAccount, serviceURL, syncNow } = require('../helpers/sync');
const sources = require('../../services/hermes-sync/content-sources.json');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function sourceSession(account) {
  // The operator's browser account can differ from the enrolled source owner.
  // Mint a short-lived native session only after checking the key's immutable
  // OIDC binding. Keep the production sync key read-only.
  const source = `require('./build/server/scripts/bootstrap');
    const {ApiKey,User,UserAuthentication}=require('./build/server/models');
    (async()=>{const key=await ApiKey.findByToken(${JSON.stringify(account.sources.outline.token)});
      const user=await User.findByPk(key.userId);
      const links=await UserAuthentication.findAll({where:{userId:user.id},attributes:['providerId']});
      if(user.isSuspended||!['admin','member'].includes(user.role)||!links.some(link=>link.providerId===${JSON.stringify(account.portal_owner)}))throw Error('Source owner mismatch');
      console.log('BLAK_SESSION='+user.getSessionToken(new Date(Date.now()+10*60*1000)));process.exit(0);
    })().catch(()=>process.exit(1));`;
  try {
    const output = execFileSync('kubectl', ['-n', 'blak-micro', 'exec', '-i', 'deploy/outline', '--', 'node'], { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
    const line = output.split('\n').find(line => line.startsWith('BLAK_SESSION='));
    if (!line) throw Error('Session missing');
    return line.slice('BLAK_SESSION='.length);
  } catch { throw Error('Native source session unavailable; credentials omitted'); }
}

test('Knowledge native permissions preserve private Hermes indexing and deletion', async ({ playwright }) => {
  test.setTimeout(420000);
  const account = syncAccount();
  const source = account.sources.outline;
  expect(source, 'Enrolled Knowledge source required').toBeTruthy();
  const knowledge = await playwright.request.newContext({ proxy: undefined, baseURL: serviceURL('sites', 3000), extraHTTPHeaders: { authorization: 'Bearer ' + sourceSession(account) } });
  const hermes = await playwright.request.newContext({ proxy: undefined, baseURL: serviceURL('hermes', 8080), extraHTTPHeaders: { authorization: 'Bearer ' + account.hermes.token }, timeout: 180000 });
  const suffix = crypto.randomBytes(6).toString('hex');
  const marker = 'KNOWLEDGE-' + suffix.toUpperCase();
  const changed = 'UPDATED-' + suffix.toUpperCase();
  let collection, document, indexed;
  async function native(path, data) {
    const response = await knowledge.post('/api/' + path, { data });
    expect(response.status(), path).toBe(200);
    return (await response.json()).data;
  }
  async function query() {
    const response = await hermes.post('/api/v1/retrieval/query/collection', { data: { collection_names: [indexed.id], query: 'Verification phrase for knowledge-e2e-' + suffix, k: 20, k_reranker: 20 } });
    expect(response.ok()).toBeTruthy();
    return JSON.stringify(await response.json());
  }
  try {
    const profile = await native('auth.info', {});
    expect(['admin', 'member'], 'Fixture account must have Knowledge write access').toContain(profile.user.role);
    collection = await native('collections.create', { name: 'knowledge-e2e-' + suffix, permission: null });
    document = await native('documents.create', { title: 'knowledge-e2e-' + suffix, collectionId: collection.id, text: 'Verification phrase: ' + marker, publish: true });
    syncNow();
    const response = await hermes.get('/api/v1/knowledge/');
    expect(response.ok()).toBeTruthy();
    indexed = (await response.json()).items.find(item => item.name === 'Blak Workspace · ' + sources.outline.label);
    expect(indexed.user_id).toBe(account.owner_id);
    expect(indexed.access_grants).toEqual([]);
    expect((await query()).includes(marker), 'Private fixture must be retrievable').toBe(true);
    await native('documents.update', { id: document.id, text: 'Verification phrase: ' + changed });
    syncNow();
    const result = await query();
    expect(result.includes(changed), 'Updated fixture must be retrievable').toBe(true);
    expect(result.includes(marker), 'Old fixture content must be removed').toBe(false);
  } finally {
    try {
      if (collection) await native('collections.delete', { id: collection.id });
      if (document) {
        syncNow();
        if (indexed) {
          const files = await hermes.get('/api/v1/knowledge/' + indexed.id + '/files');
          expect(files.ok()).toBeTruthy();
          expect(JSON.stringify(await files.json())).not.toContain(document.id);
        }
      }
    } finally { await Promise.all([knowledge.dispose(), hermes.dispose()]); }
  }
});
