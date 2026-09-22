'use strict';
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { identityCookies, updateIdentity } = require('../helpers/identity');
const { serviceURL, ownedPersonalDrive } = require('../helpers/sync');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('Drive native roles revoke owned-file writes and preserve immutable accounts', async ({ page, context }) => {
  test.setTimeout(900000);
  const key = 'drive-roles-' + crypto.randomBytes(6).toString('hex');
  const origin = 'https://drive.workspace.example.com', endpoint = serviceURL('drive', 9200);
  let subject, token, file, documentFile, identity, failure;
  const captureToken = request => {
    if (new URL(request.url()).origin === origin && request.headers().authorization?.startsWith('Bearer ')) {
      token = request.headers().authorization;
    }
  };
  page.on('request', captureToken);
  if (process.env.BLAK_E2E_DRIVE_DIAGNOSTICS === 'true') page.on('response', response => {
    if (response.status() >= 400) console.log('Drive HTTP rejection', response.status(), new URL(response.url()).pathname);
  });
  async function waitRole(role, active = true) {
    await expect.poll(() => {
      try {
        const snapshot = JSON.parse(execFileSync('kubectl', ['-n', 'blak-micro', 'exec', 'deploy/opencloud', '--',
          'cat', '/var/lib/opencloud/blak-roles.json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
        const member = snapshot.members.find(member => member.subject === subject);
        return member ? { role: member.role, active: member.active } : null;
      } catch { return null; }
    }, { timeout: 150000, intervals: [2000, 4000] }).toEqual({ role, active });
    if (process.env.BLAK_E2E_DRIVE_DIAGNOSTICS === 'true') console.log('Drive grant observed', role || 'none', active);
  }
  async function request(path, method = 'GET', body, headers = {}) {
    return fetch(endpoint + path, { method, signal: AbortSignal.timeout(30000), headers: { authorization: token, 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
  }
  function releaseDocumentLock(accountId) {
    const name = key + '.odt';
    if (!/^[0-9a-f-]{36}$/.test(accountId) || !/^drive-roles-[0-9a-f]+\.odt$/.test(name)) {
      throw new Error('refusing to clear a lock outside this fixture');
    }
    // DAV UNLOCK and DELETE cannot drop a Collabora app lock before it expires.
    // Remove only this fixture document's lock record, then the caller deletes the file.
    const script = [
      'set -eu',
      'root=/var/lib/opencloud/storage/users/users/' + accountId,
      'file=$(find "$root" -name ' + JSON.stringify(name) + ' -type f | head -1)',
      '[ -n "$file" ]',
      'id=$(getfattr --only-values -n user.oc.id "$file" | tr -d "\\n")',
      'tail=${id#????????}',
      'find "$root/.oc-nodes/locks" -type f -name "$id.mlock" -exec rm -f {} \\;',
      'find "$root/.oc-nodes/locks" -type f -name "$id.REV.*.mlock" -exec rm -f {} \\;',
      'find "$root/.oc-nodes" -type f -name "$tail.lock" -exec rm -f {} \\;',
    ].join('\n');
    execFileSync('kubectl', ['-n', 'blak-micro', 'exec', 'deploy/opencloud', '--', 'sh', '-c', script],
      { stdio: ['pipe', 'pipe', 'pipe'] });
  }
  async function documentText() {
    const response = await request(documentFile);
    expect(response.status).toBe(200);
    return execFileSync('python3', ['-c', "import sys,io,zipfile; print(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read('content.xml').decode())"],
      { input: Buffer.from(await response.arrayBuffer()) }).toString();
  }
  try {
    await context.addCookies(await identityCookies(key, 'Drive native role fixture', ['drive'], { drive: 'writer' }));
    subject = (await (await page.request.get('/api/me')).json()).sub;
    await waitRole('writer');
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => Boolean(token), { timeout: 90000 }).toBe(true);
    // A token is emitted before the callback finishes loading account metadata.
    // Reloading that callback would replay its already-consumed authorization code.
    await page.waitForURL(url => url.origin === origin && /^\/files(?:\/|$)/.test(url.pathname), { timeout: 90000 });
    await expect.poll(async () => (await request('/graph/v1.0/me')).status, { timeout: 60000 }).toBe(200);
    identity = (await (await request('/graph/v1.0/me')).json()).id;
    const drives = await (await request('/graph/v1.0/drives')).json();
    const personal = ownedPersonalDrive({ id: identity }, drives);
    expect(personal).toBeTruthy();
    const name = key + '.txt';
    file = new URL(personal.root.webDavUrl).pathname + '/' + name;
    expect([200, 201, 204]).toContain((await request(file, 'PUT', key)).status);
    const documentName = key + '.odt';
    documentFile = new URL(personal.root.webDavUrl).pathname + '/' + documentName;
    expect([200, 201, 204]).toContain((await request(documentFile, 'PUT',
      require('node:fs').readFileSync(require('node:path').join(__dirname, '../fixtures/docs.odt')))).status);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 60000 });
    await page.getByText(documentName, { exact: true }).dblclick();
    const editor = page.frameLocator('iframe');
    await expect(editor.locator('#document-container')).toBeVisible({ timeout: 60000 });
    const welcome = editor.locator('iframe[title="Welcome Dialogue"]');
    await welcome.waitFor({ timeout: 5000 }).catch(() => {});
    if (await welcome.isVisible()) await editor.frameLocator('iframe[title="Welcome Dialogue"]').getByRole('button', { name: 'Close', exact: true }).click();
    const saved = key + '-writer-saved';
    await editor.locator('#document-container').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(saved);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(documentText, { timeout: 45000 }).toContain(saved);
    updateIdentity(key, { roles: { drive: 'reader' } });
    await waitRole('reader');
    expect(await (await request(file)).text()).toBe(key);
    for (const method of ['PUT', 'DELETE', 'PROPPATCH']) {
      expect((await request(file, method, method === 'DELETE' ? undefined : 'forbidden')).status).toBe(403);
    }
    const forbiddenEdit = key + '-reader-must-not-save';
    await editor.locator('#document-container').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(forbiddenEdit);
    if (process.env.BLAK_E2E_DRIVE_DIAGNOSTICS === 'true') {
      await editor.locator('#document-container').screenshot({ path: test.info().outputPath('fixture-before-save.png') });
    }
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    // Collabora retries token refresh before surfacing a WOPI 403 to the user.
    await expect(editor.getByText(/Document cannot be saved/)).toBeVisible({ timeout: 150000 });
    expect(await documentText()).not.toContain(forbiddenEdit);
    // Restore write before leaving the editor. Collabora still keeps its WOPI lock
    // until expiry, so fixture removal handles that lock separately.
    updateIdentity(key, { roles: { drive: 'writer' } });
    await waitRole('writer');
    page.once('dialog', dialog => dialog.accept());
    await page.goto(origin + '/files', { waitUntil: 'domcontentloaded' });
    updateIdentity(key, { roles: { drive: 'admin' } });
    await waitRole('admin');
    for (const path of ['/graph/v1.0/users', '/graph/v1.0/groups', '/api/v0/settings/assignments-add', '/blak/roles/reconcile']) {
      expect((await request(path, 'POST', {})).status).toBe(403);
    }
    updateIdentity(key, { active: false });
    await waitRole('', false);
    expect([401, 403]).toContain((await request(file)).status);
    updateIdentity(key, { active: true, grants: ['chat'], roles: { chat: 'admin' } });
    await waitRole('');
    expect([401, 403]).toContain((await request(file)).status);
    updateIdentity(key, { grants: ['drive'], roles: { drive: 'writer' }, rename: true });
    await waitRole('writer');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await context.addCookies(await identityCookies(key, 'Drive native role fixture', ['drive'], { drive: 'writer' }));
    token = undefined;
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(url => url.origin === origin && /^\/files(?:\/|$)/.test(url.pathname), { timeout: 90000 });
    await expect.poll(() => Boolean(token), { timeout: 90000 }).toBe(true);
    expect((await (await request('/graph/v1.0/me')).json()).id).toBe(identity);
    expect(await (await request(file)).text()).toBe(key);
    expect([200, 201, 204]).toContain((await request(file, 'PUT', key + '-restored')).status);
  } catch (error) {
    failure = error;
    if (process.env.BLAK_E2E_DRIVE_DIAGNOSTICS === 'true' && documentFile) {
      await page.frameLocator('iframe').locator('#document-container').screenshot({ path: test.info().outputPath('fixture-document.png'), timeout: 5000 }).catch(() => {});
      console.log('Drive acceptance failed:', error.message);
    }
    throw error;
  } finally {
    await page.close({ runBeforeUnload: false });
    if (subject) {
      try {
        updateIdentity(key, { active: true, grants: ['drive'], roles: { drive: 'writer' } });
        await waitRole('writer');
        if (token && !(await request('/graph/v1.0/me')).ok) {
          await context.addCookies(await identityCookies(key, 'Drive native role fixture', ['drive'], { drive: 'writer' }));
          const cleanupPage = await context.newPage();
          cleanupPage.on('request', captureToken);
          await cleanupPage.goto(origin);
          await cleanupPage.waitForURL(url => url.origin === origin && /^\/files(?:\/|$)/.test(url.pathname), { timeout: 90000 });
          await cleanupPage.close();
        }
        for (const path of [file, documentFile].filter(Boolean)) {
          if (!token) continue;
          let status = (await request(path, 'DELETE')).status;
          if (status === 423 && path === documentFile) {
            releaseDocumentLock(identity);
            status = (await request(path, 'DELETE')).status;
          }
          expect([200, 204, 404]).toContain(status);
        }
      } catch (cleanupError) {
        if (!failure) throw cleanupError;
        console.log('Drive fixture cleanup failed after primary test failure');
      } finally {
        updateIdentity(key, { active: false });
        await waitRole('', false);
      }
    }
  }
});
