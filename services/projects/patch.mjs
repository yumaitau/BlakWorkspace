/** Fail on upstream changes rather than applying a stale native authorization patch. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
let source = readFileSync(path, 'utf8');
if (createHash('sha256').update(source).digest('hex') !== '87af4d1e17713a22f233d9d1784c27a0ed35b0a9908b50a5b62480e904031578') throw Error('Unexpected upstream Kaneo bundle; review native role integration');
function replace(old, next) {
  if (source.split(old).length !== 2) throw Error('Ambiguous native permission patch');
  source = source.replace(old, next);
}
source = `import { installRoleBridge, protectsManagedAuthority } from './blak-role-bridge.mjs';\n` + source;
replace('    before: createAuthMiddleware(async (ctx) => {', `    before: createAuthMiddleware(async (ctx) => {
      if (await protectsManagedAuthority(ctx, { database: database_default, schema, eq: eq147, getSessionFromCtx })) {
        throw new APIError2('FORBIDDEN', { message: 'Blak ID manages this native authority' });
      }`);
replace('  api.route("/", mcp_default);', `  installRoleBridge(api, {
    auth, database: database_default, schema, eq: eq147, builtInRoles,
    closeConnections(userId) {
      for (const connection of userConnections.get(userId) || []) connection.ws.close(1008, 'Workspace access changed');
      userConnections.delete(userId);
      for (const [projectId, connections] of projectConnections) {
        for (const connection of connections) {
          if (connection.userId === userId) {
            connection.ws.close(1008, 'Workspace access changed');
            connections.delete(connection);
          }
        }
        if (!connections.size) projectConnections.delete(projectId);
      }
    },
  });
  api.route("/", mcp_default);`);
replace(`  session: {
    cookieCache: {
      enabled: true,`, `  session: {
    cookieCache: {
      enabled: false,`);
replace(`  if (!apiKey2) {
    return null;
  }
  return {
    valid: true,`, `  if (!apiKey2) {
    return null;
  }
  // Native API keys must obey account deactivation just like browser sessions.
  const [nativeOwner] = await database_default.select({ banned: schema.userTable.banned })
    .from(schema.userTable).where(eq142(schema.userTable.id, apiKey2.referenceId ?? apiKey2.userId ?? "")).limit(1);
  if (!nativeOwner || nativeOwner.banned) return null;
  return {
    valid: true,`);
replace(`    return await auth.api.getSession({ headers });`, `    const result = await auth.api.getSession({ headers });
    return result?.user?.banned ? null : result;`);
// A mutable verified email is not an immutable Blak ID account link.
replace(`      enabled: true,
      trustedProviders: ["github", "google", "discord", "custom"],`, `      enabled: false,
      trustedProviders: [],`);
writeFileSync(path, source);
console.log('Native Projects directory bridge, session freshness and API-key revocation installed');
