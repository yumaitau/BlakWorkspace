/** Operator-only kubectl exec entrypoint. Credentials enter/leave over stdin/stdout. */
import { randomBytes } from 'node:crypto';
import { blakNativeAuth as auth, blakNativeDatabase as database, blakNativeSchema as schema, blakNativeEq as eq } from './index.js';
import { withNativeSession } from './blak-role-bridge.mjs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const data = JSON.parse(input);
  let userId = data.userId;
  if (!userId) {
    const accounts = await database.select({ userId: schema.accountTable.userId, provider: schema.accountTable.providerId }).from(schema.accountTable).where(eq(schema.accountTable.accountId, data.bootstrapSubject));
    const bound = accounts.filter(account => account.provider === 'custom');
    if (bound.length !== 1) throw Error('Ambiguous bootstrap subject');
    const users = await database.select({ role: schema.userTable.role, banned: schema.userTable.banned }).from(schema.userTable).where(eq(schema.userTable.id, bound[0].userId));
    if (users.length !== 1 || users[0].role !== 'admin' || users[0].banned) throw Error('Bootstrap subject is not a native administrator');
    const created = await auth.api.createUser({ body: { name: 'Blak ID role controller', email: 'blak-projects-role-' + randomBytes(12).toString('hex') + '@example.invalid', password: randomBytes(48).toString('base64url'), role: 'admin' } });
    console.log('BLAK_ENROLLED=' + JSON.stringify({ userId: created.user.id }));
  } else {
    const users = await database.select({ role: schema.userTable.role, banned: schema.userTable.banned }).from(schema.userTable).where(eq(schema.userTable.id, userId));
    if (users.length !== 1 || users[0].role !== 'admin' || users[0].banned) throw Error('Enrolled native controller invalid');
    const result = await withNativeSession(auth, userId, async headers => {
      let key = data.apiKey;
      if (!key) key = (await auth.api.createApiKey({ headers, body: { name: 'Blak ID role controller' } })).key;
      const profile = await auth.api.getSession({ headers: new Headers({ 'x-api-key': key }) });
      if (profile?.user?.id !== userId) throw Error('Native API key owner mismatch');
      const organizations = await auth.api.listOrganizations({ headers });
      const matches = organizations.filter(item => item.slug === 'blak-group-projects');
      if (matches.length > 1) throw Error('Ambiguous managed workspace');
      const workspace = matches[0] || await auth.api.createOrganization({ headers, body: { name: 'Blak Group Projects', slug: 'blak-group-projects' } });
      const members = await database.select({ userId: schema.workspaceUserTable.userId, role: schema.workspaceUserTable.role }).from(schema.workspaceUserTable).where(eq(schema.workspaceUserTable.workspaceId, workspace.id));
      if (!members.some(member => member.userId === userId && member.role === 'owner')) throw Error('Managed workspace has a different owner');
      return { userId, apiKey: key, workspaces: [workspace.id] };
    });
    console.log('BLAK_ENROLLED=' + JSON.stringify(result));
  }
  process.exit(0);
} catch (error) {
  console.error('Native Projects enrollment failed: ' + error.constructor.name);
  process.exit(1);
}
