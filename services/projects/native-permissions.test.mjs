/** Execute patched upstream authentication functions, without starting its server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(process.env.KANEO_BUNDLE || '/app/apps/api/dist/index.js', 'utf8');
function extract(start, end, scope) {
  const begin = source.indexOf(start), finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin);
  return new Function(...Object.keys(scope), source.slice(begin, finish) + '\nreturn ' + start.match(/function (\w+)/)[1])(...Object.values(scope));
}
function verifier(owner) {
  const schema = { apikeyTable: { key: 'key', enabled: 'enabled', expiresAt: 'expiry' }, userTable: { id: 'id', banned: 'banned' } };
  const key = { id: 'key-id', referenceId: 'user', enabled: true, permissions: null, metadata: null };
  const database = { select() { return { from(table) { return { where() { return { limit: async () => table === schema.apikeyTable ? [key] : owner ? [owner] : [] }; } }; } }; } };
  return extract('async function verifyApiKey(key)', '// src/utils/authenticate-api-request.ts', {
    hashApiKey: async () => 'hash', database_default: database, schema,
    and82() {}, eq142() {}, or9() {}, isNull6() {}, gt3() {}, parsePermissions: value => value,
  });
}
test('active native API key cannot authenticate a banned owner', async () => {
  assert.equal(await verifier({ banned: true })('fixture'), null);
});
test('orphan API key cannot authenticate a deleted owner', async () => {
  assert.equal(await verifier(null)('fixture'), null);
});
test('current native owner can retain an active API key', async () => {
  assert.equal((await verifier({ banned: false })('fixture')).key.userId, 'user');
});
test('native session wrapper rejects a freshly banned user', async () => {
  const getSession = extract('async function getSession(headers)', 'async function getSessionFromBearerOnlyHeaders', {
    auth: { api: { getSession: async () => ({ user: { banned: true } }) } }, isAuthRejection: () => false,
  });
  assert.equal(await getSession(new Headers()), null);
});
