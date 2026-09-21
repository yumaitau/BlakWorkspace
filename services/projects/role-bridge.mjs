/** Trusted directory reconciliation using Kaneo/Better Auth's native role APIs. */
import { timingSafeEqual } from 'node:crypto';

const ROLE_NAMES = ['reader', 'writer', 'admin'];
export function authorized(provided, expected) {
  if (typeof expected !== 'string' || expected.length < 40 || typeof provided !== 'string') return false;
  const left = Buffer.from(provided), right = Buffer.from('Bearer ' + expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function directoryMembers(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100000) throw Error('Invalid directory snapshot');
  const result = new Map();
  for (const entry of value) {
    if (!entry || typeof entry.subject !== 'string' || !entry.subject || entry.subject.trim() !== entry.subject ||
        typeof entry.active !== 'boolean' || !(entry.role === null || ROLE_NAMES.includes(entry.role)) || result.has(entry.subject)) {
      throw Error('Invalid or duplicate directory identity');
    }
    result.set(entry.subject, entry.active ? entry.role : null);
  }
  return result;
}

export function planUsers(users, links, directory, controller) {
  const byUser = new Map(), subjects = new Set(), ids = new Set();
  for (const user of users) {
    if (typeof user.id !== 'string' || !user.id || ids.has(user.id) || !['user', 'admin'].includes(user.role)) throw Error('Invalid native user snapshot');
    ids.add(user.id);
  }
  if (!ids.has(controller)) throw Error('Native controller absent');
  for (const link of links) {
    if (typeof link.subject !== 'string' || !link.subject || subjects.has(link.subject) || byUser.has(link.userId) || !ids.has(link.userId)) {
      throw Error('Ambiguous native OIDC subject');
    }
    subjects.add(link.subject); byUser.set(link.userId, link.subject);
  }
  return users.filter(user => user.id !== controller).map(user => ({ ...user, desired: directory.get(byUser.get(user.id)) ?? null }));
}

export function rolePermissions(builtInRoles) {
  return {
    reader: structuredClone(builtInRoles.viewer.statements),
    writer: { ...structuredClone(builtInRoles.member.statements), project: ['create', 'read', 'update', 'delete'], task: ['create', 'read', 'update', 'delete', 'assign'] },
    admin: structuredClone(builtInRoles.admin.statements),
  };
}

export async function withNativeSession(auth, userId, operation) {
  const context = await auth.$context;
  // Admin endpoints require a persisted native session, not a synthetic API-key
  // session. Let Better Auth create and destroy this short-lived server session.
  const session = await context.internalAdapter.createSession(userId);
  if (!session?.token) throw Error('Native controller session unavailable');
  try {
    return await operation(new Headers({ authorization: 'Bearer ' + session.token, origin: context.baseURL.replace(/\/api\/auth\/?$/, '') }));
  } finally {
    await context.internalAdapter.deleteSession(session.token);
  }
}

export async function reconcile({ api, snapshot, desired, controller, workspaceIds, permissions, closeConnections }) {
  const plans = planUsers(snapshot.users, snapshot.links, desired, controller);
  for (const workspaceId of workspaceIds) {
    if (!snapshot.members.some(member => member.workspaceId === workspaceId && member.userId === controller && member.role === 'owner')) {
      throw Error('Managed workspace must belong to the enrolled controller');
    }
  }
  const counts = { memberships: 0, banned: 0, roles: 0 };
  // Remove global administrator authority before modifying managed memberships.
  for (const user of plans) {
    if (user.role === 'admin') {
      await api('setRole', { userId: user.id, role: 'user' });
      closeConnections(user.id); counts.roles++;
    }
    if (!user.desired && !user.banned) {
      await api('banUser', { userId: user.id, banReason: 'Blak ID application access removed' });
      closeConnections(user.id); counts.banned++;
    }
  }
  for (const workspaceId of workspaceIds) {
    for (const role of ROLE_NAMES) {
      const name = 'blak-' + role;
      const existing = snapshot.roles.filter(item => item.workspaceId === workspaceId && item.role === name);
      if (existing.length > 1) throw Error('Duplicate managed native role');
      if (!existing.length) await api('createOrgRole', { organizationId: workspaceId, role: name, permission: permissions[role] });
      else if (JSON.stringify(JSON.parse(existing[0].permission)) !== JSON.stringify(permissions[role])) {
        await api('updateOrgRole', { organizationId: workspaceId, roleName: name, data: { permission: permissions[role] } });
      }
    }
    for (const user of plans) {
      const members = snapshot.members.filter(member => member.workspaceId === workspaceId && member.userId === user.id);
      if (members.length > 1) throw Error('Duplicate native workspace membership');
      const existing = members[0], role = user.desired && 'blak-' + user.desired;
      if (!role && existing) {
        await api('removeMember', { organizationId: workspaceId, memberIdOrEmail: existing.id });
        closeConnections(user.id); counts.memberships++;
      } else if (role && !existing) {
        // Better Auth intentionally exposes addMember only to trusted server code.
        await api('addMember', { organizationId: workspaceId, userId: user.id, role });
        counts.memberships++;
      } else if (role && existing.role !== role) {
        await api('updateMemberRole', { organizationId: workspaceId, memberId: existing.id, role });
        closeConnections(user.id); counts.memberships++;
      }
    }
  }
  // Restore accounts only after all managed workspace permissions are in place.
  for (const user of plans) {
    if (user.desired && user.banned) await api('unbanUser', { userId: user.id });
  }
  return counts;
}

export function installRoleBridge(router, { auth, database, schema, eq, builtInRoles, closeConnections, env = process.env }) {
  let running = false;
  router.post('/blak/roles/reconcile', async c => {
    if (!authorized(c.req.header('authorization'), env.BLAK_ROLE_BRIDGE_TOKEN)) return c.json({ error: 'Unauthorized' }, 401);
    if (running) return c.json({ error: 'Reconciliation already running' }, 503);
    running = true;
    try {
      const controller = env.BLAK_ROLE_CONTROLLER_ID;
      const workspaceIds = JSON.parse(env.BLAK_ROLE_WORKSPACES || '[]');
      if (!controller || !workspaceIds.length || new Set(workspaceIds).size !== workspaceIds.length || workspaceIds.some(id => typeof id !== 'string' || !id)) throw Error('Invalid managed workspace configuration');
      const headers = new Headers({ 'x-api-key': env.BLAK_ROLE_CONTROLLER_API_KEY, origin: env.KANEO_CLIENT_URL });
      const session = await auth.api.getSession({ headers });
      if (session?.user?.id !== controller || session.user.role !== 'admin' || session.user.banned) throw Error('Native controller mismatch');
      const desired = directoryMembers(await c.req.json());
      const users = await database.select({ id: schema.userTable.id, role: schema.userTable.role, banned: schema.userTable.banned }).from(schema.userTable);
      const links = await database.select({ userId: schema.accountTable.userId, subject: schema.accountTable.accountId }).from(schema.accountTable).where(eq(schema.accountTable.providerId, 'custom'));
      const members = await database.select({ id: schema.workspaceUserTable.id, userId: schema.workspaceUserTable.userId, workspaceId: schema.workspaceUserTable.workspaceId, role: schema.workspaceUserTable.role }).from(schema.workspaceUserTable);
      const roles = await database.select({ workspaceId: schema.workspaceRoleTable.workspaceId, role: schema.workspaceRoleTable.role, permission: schema.workspaceRoleTable.permission }).from(schema.workspaceRoleTable);
      const result = await withNativeSession(auth, controller, headers => reconcile({ snapshot: { users, links, members, roles }, desired, controller, workspaceIds,
        permissions: rolePermissions(builtInRoles), closeConnections,
        api: (name, body) => auth.api[name](name === 'addMember' ? { body } : { headers, body }) }));
      return c.json(result);
    } catch (error) {
      // Native error objects may contain request details; never serialize them.
      console.error('Blak Projects role reconciliation failed: ' + error.constructor.name);
      return c.json({ error: 'Native role reconciliation failed' }, 503);
    } finally {
      running = false;
    }
  });
}

/** Native auth hook: human app admins cannot alter the controller or managed policy. */
export async function protectsManagedAuthority(ctx, { database, schema, eq, getSessionFromCtx, env = process.env }) {
  const controller = env.BLAK_ROLE_CONTROLLER_ID;
  if (!controller) return false;
  const path = ctx.path || '', body = ctx.body || {};
  let protectedTarget = path.startsWith('/admin/') && body.userId === controller;
  const workspaceIds = JSON.parse(env.BLAK_ROLE_WORKSPACES || '[]');
  // Membership and role authority come from Blak ID. A native app admin must
  // not grant a reader owner/admin authority between reconciliation passes.
  const authorityPaths = ['/organization/invite-member', '/organization/update-member-role',
    '/organization/remove-member', '/organization/create-role', '/organization/update-role',
    '/organization/delete-role', '/organization/leave'];
  if (authorityPaths.includes(path)) {
    const session = await getSessionFromCtx(ctx, { disableRefresh: true });
    const workspaceId = body.organizationId || session?.session?.activeOrganizationId;
    if (workspaceIds.includes(workspaceId) && session?.user?.id !== controller) return true;
  }
  if (path === '/organization/delete' && workspaceIds.includes(body.organizationId)) protectedTarget = true;
  if (['/organization/update-role', '/organization/delete-role'].includes(path)) {
    const rows = await database.select({ id: schema.workspaceRoleTable.id, role: schema.workspaceRoleTable.role, workspaceId: schema.workspaceRoleTable.workspaceId }).from(schema.workspaceRoleTable);
    protectedTarget ||= rows.some(row => workspaceIds.includes(row.workspaceId) && row.role.startsWith('blak-') && (row.id === body.roleId || row.role === body.roleName));
  }
  if (['/organization/remove-member', '/organization/update-member-role'].includes(path)) {
    const target = body.memberIdOrEmail || body.memberId;
    const rows = await database.select({ id: schema.workspaceUserTable.id }).from(schema.workspaceUserTable).where(eq(schema.workspaceUserTable.userId, controller));
    const users = await database.select({ email: schema.userTable.email }).from(schema.userTable).where(eq(schema.userTable.id, controller));
    protectedTarget ||= target === controller || rows.some(row => row.id === target) || users.some(row => row.email === target);
  }
  if (!protectedTarget) return false;
  const session = await getSessionFromCtx(ctx, { disableRefresh: true });
  return session?.user?.id !== controller;
}
