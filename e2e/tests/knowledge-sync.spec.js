'use strict';
const crypto = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { syncAccount, serviceURL, syncNow } = require('../helpers/sync');
const sources = require('../../services/hermes-sync/content-sources.json');
const { authentikLogin } = require('../helpers/auth');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('Knowledge native permissions preserve private Hermes indexing and deletion', async ({ playwright, page, context }) => {
  test.setTimeout(420000);
  const account = syncAccount();
  const source = account.sources.outline;
  expect(source, 'Enrolled Knowledge source required').toBeTruthy();
  const origin = new URL(process.env.BLAK_E2E_KNOWLEDGE_URL).origin;
  await page.goto(origin + '/auth/oidc');
  await authentikLogin(page);
  await page.waitForURL(url => url.origin === origin && !url.pathname.startsWith('/auth'));
  // Freeze one real browser session and its matching CSRF cookie in an isolated
  // request context. Background page GETs otherwise rotate that cookie mid-call.
  const state = await context.storageState();
  const csrf = (state.cookies.find(cookie => cookie.name === '__Host-csrfToken') || state.cookies.find(cookie => cookie.name === 'csrfToken'))?.value;
  if (!csrf) throw Error('Native Knowledge CSRF cookie unavailable');
  const knowledge = await playwright.request.newContext({ baseURL: origin, storageState: state, extraHTTPHeaders: { origin, 'x-csrf-token': csrf } });
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
    expect(await query()).toContain(marker);
    await native('documents.update', { id: document.id, text: 'Verification phrase: ' + changed });
    syncNow();
    const result = await query();
    expect(result).toContain(changed);
    expect(result).not.toContain(marker);
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
