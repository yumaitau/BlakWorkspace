'use strict';
const crypto = require('node:crypto');
const { test, expect } = require('@playwright/test');
const { authentikLogin } = require('../helpers/auth');
const { syncAccount, serviceURL, syncNow } = require('../helpers/sync');
const HERMES = 'https://hermes.workspace.example.com';

test('Hermes requires authentication for knowledge and chat', async ({ request }) => {
  for (const path of ['/api/v1/knowledge/', '/api/models']) {
    expect([401, 403]).toContain((await request.get(HERMES + path)).status());
  }
});

test('Hermes SSO opens a usable workspace chat', async ({ page }) => {
  await page.goto(HERMES);
  await page.getByRole('button', { name: 'Continue with Blak ID' }).click();
  await authentikLogin(page);
  await page.waitForURL(url => url.hostname === 'hermes.workspace.example.com' && !/^\/(auth|oauth)/.test(url.pathname));
  await expect(page.getByRole('link', { name: /New Chat/i }).or(page.getByRole('button', { name: /New Chat/i })).first()).toBeVisible();
  await expect(page.locator('#chat-input')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('hermes-chat.png'), fullPage: true });
});

test('continuous sync creates, updates, retrieves and removes real Drive content', async ({ playwright, page }) => {
  test.setTimeout(600000);
  const account = syncAccount();
  const source = account.sources.drive;
  const drive = await playwright.request.newContext({ proxy: undefined, baseURL: serviceURL('drive', 9200), extraHTTPHeaders: { authorization: 'Basic ' + Buffer.from(source.username + ':' + source.password).toString('base64') } });
  const hermes = await playwright.request.newContext({ proxy: undefined, baseURL: serviceURL('hermes', 8080), extraHTTPHeaders: { authorization: 'Bearer ' + account.hermes.token }, timeout: 180000 });
  const id = crypto.randomBytes(5).toString('hex');
  const phrase = 'WORKSPACE-' + id.toUpperCase();
  const updated = 'UPDATED-' + id.toUpperCase();
  const drives = await (await drive.get('/graph/v1.0/drives')).json();
  const personal = drives.value.find(item => item.driveType === 'personal');
  expect(personal).toBeTruthy();
  const path = new URL(personal.root.webDavUrl).pathname + '/hermes-e2e-' + id + '.md';
  let collection;
  try {
    expect((await drive.put(path, { data: '# Workspace sync test\nThe verification phrase is ' + phrase, headers: { 'content-type': 'text/markdown' } })).ok()).toBeTruthy();
    syncNow();
    const knowledge = await (await hermes.get('/api/v1/knowledge/')).json();
    collection = knowledge.items.find(item => item.name === 'Blak Workspace · Drive');
    expect(collection.user_id).toBe(account.owner_id);
    expect(collection.access_grants).toEqual([]);
    const query = async () => {
      const response = await hermes.post('/api/v1/retrieval/query/collection', { data: { collection_names: [collection.id], query: 'What is the verification phrase in hermes-e2e-' + id + '?', k: 20 } });
      expect(response.ok()).toBeTruthy();
      return JSON.stringify(await response.json());
    };
    expect(await query()).toContain(phrase);
    const answer = await hermes.post('/api/chat/completions', { data: { model: 'blak-workspace-' + account.owner_id, stream: false, messages: [{ role: 'user', content: 'What is the exact verification phrase in document hermes-e2e-' + id + '? Return the phrase.' }] } });
    expect(answer.ok()).toBeTruthy();
    const completion = await answer.json();
    expect(completion.choices[0].message.content).toContain(phrase);
    expect(JSON.stringify(completion.sources)).toContain(phrase);
    await page.goto('https://portal.workspace.example.com/login');
    await authentikLogin(page);
    await expect(page).toHaveURL('https://portal.workspace.example.com/');
    await page.goto('https://portal.workspace.example.com/launch/hermes');
    await page.waitForURL(url => url.hostname === 'hermes.workspace.example.com' && !/^\/(auth|oauth)/.test(url.pathname));
    await page.goto(HERMES + '/?model=blak-workspace-' + account.owner_id);
    await page.locator('#chat-input').waitFor();
    const releaseNotes = page.getByRole('button', { name: "Okay, Let's Go!" });
    if (await releaseNotes.isVisible()) await releaseNotes.click();
    await page.locator('#chat-input').fill('What is the exact verification phrase in document hermes-e2e-' + id + '? Return the phrase.');
    await page.locator('#chat-input').press('Enter');
    await expect(page.locator('body')).toContainText(phrase, { timeout: 180000 });
    await page.screenshot({ path: test.info().outputPath('hermes-grounded-answer.png'), fullPage: true });

    expect(syncNow()).toContain('"uploaded": 0');
    expect((await drive.put(path, { data: '# Workspace sync test\nThe verification phrase is ' + updated, headers: { 'content-type': 'text/markdown' } })).ok()).toBeTruthy();
    syncNow();
    const changed = await query();
    expect(changed).toContain(updated);
    expect(changed).not.toContain(phrase);
  } finally {
    await drive.delete(path);
    syncNow();
    if (collection) {
      const files = await (await hermes.get(`/api/v1/knowledge/${collection.id}/files`)).json();
      expect(JSON.stringify(files)).not.toContain('hermes-e2e-' + id);
    }
    await drive.dispose();
    await hermes.dispose();
  }
});

test('sync includes private team-channel and Projects task data', async ({ playwright }) => {
  test.setTimeout(420000);
  const account = syncAccount();
  const chat = await playwright.request.newContext({ proxy: undefined, baseURL: serviceURL('chat', 3000), extraHTTPHeaders: account.sources.chat.headers });
  const projects = await playwright.request.newContext({ proxy: undefined, baseURL: serviceURL('projects', 5173), extraHTTPHeaders: { ...account.sources.projects.headers, origin: 'https://projects.workspace.example.com' } });
  const hermes = await playwright.request.newContext({ proxy: undefined, baseURL: serviceURL('hermes', 8080), extraHTTPHeaders: { authorization: 'Bearer ' + account.hermes.token }, timeout: 180000 });
  const suffix = crypto.randomBytes(5).toString('hex');
  const phrase = 'TEAMDATA-' + suffix.toUpperCase();
  let room, workspace;
  try {
    // Private test group contains only the current account; no messages reach other users.
    const createdRoom = await chat.post('/api/v1/groups.create', { data: { name: 'hermes-e2e-' + suffix, members: [] } });
    expect(createdRoom.ok()).toBeTruthy();
    room = (await createdRoom.json()).group;
    expect((await chat.post('/api/v1/chat.postMessage', { data: { roomId: room._id, text: 'Workspace test marker ' + phrase } })).ok()).toBeTruthy();
    const createdWorkspace = await projects.post('/api/auth/organization/create', { data: { name: 'Hermes E2E ' + suffix, slug: 'hermes-e2e-' + suffix } });
    expect(createdWorkspace.ok(), await createdWorkspace.text()).toBeTruthy();
    workspace = await createdWorkspace.json();
    const createdProject = await projects.post('/api/project', { data: { workspaceId: workspace.id, name: 'Sync test', slug: 'SYNC', icon: 'folder' } });
    expect(createdProject.ok(), await createdProject.text()).toBeTruthy();
    const project = await createdProject.json();
    const board = await (await projects.get('/api/task/tasks/' + project.id)).json();
    const status = board.data.columns[0].slug;
    const task = await projects.post('/api/task/' + project.id, { data: { title: 'Workspace test ' + phrase, description: 'Private sync verification fixture', priority: 'medium', status } });
    expect(task.ok(), await task.text()).toBeTruthy();
    syncNow();
    const collections = (await (await hermes.get('/api/v1/knowledge/')).json()).items;
    for (const name of ['Blak Workspace · Chat', 'Blak Workspace · Projects']) {
      const collection = collections.find(item => item.name === name);
      expect(collection.access_grants).toEqual([]);
      const result = await hermes.post('/api/v1/retrieval/query/collection', { data: { collection_names: [collection.id], query: 'Workspace test marker ' + phrase, k: 5 } });
      expect(result.ok()).toBeTruthy();
      expect(JSON.stringify(await result.json())).toContain(phrase);
    }
  } finally {
    if (room) expect((await chat.post('/api/v1/groups.delete', { data: { roomId: room._id } })).ok()).toBeTruthy();
    if (workspace) expect((await projects.post('/api/auth/organization/delete', { data: { organizationId: workspace.id } })).ok()).toBeTruthy();
    syncNow();
    await Promise.all([chat.dispose(), projects.dispose(), hermes.dispose()]);
  }
});
