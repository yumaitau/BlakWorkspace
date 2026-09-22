'use strict';
const { createHash, timingSafeEqual } = require('node:crypto');
const { disconnect } = require('./role-bridge.cjs');
const ROLES = ['reader', 'writer', 'admin'];
const READ_PERMISSIONS = ['view-c-room', 'view-d-room', 'view-p-room', 'view-joined-room', 'preview-c-room', 'view-outside-room'];
const WRITE_PERMISSIONS = ['create-c', 'create-d', 'create-p', 'delete-own-message', 'leave-c', 'leave-p', 'mention-all', 'mention-here', 'start-discussion'];
const ADMIN_PERMISSIONS = ['add-user-to-joined-room', 'archive-room', 'unarchive-room', 'delete-c', 'delete-p', 'edit-room', 'edit-room-avatar', 'edit-message', 'delete-message', 'mute-user', 'remove-user', 'set-moderator', 'set-owner', 'set-leader'];

function requireController(request) {
  const token = process.env.BLAK_CHAT_ROLE_TOKEN;
  const value = request.headers.get('authorization');
  const actual = Buffer.from(typeof value === 'string' ? value : '');
  const expected = Buffer.from('Bearer ' + (token || ''));
  if (process.env.BLAK_CHAT_ROLES !== 'true' || !token || token.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Blak ID controller required');
  }
}

function directoryMembers(value) {
  if (!Array.isArray(value) || !value.length) throw new Error('Complete directory snapshot required');
  const directory = new Map();
  for (const member of value) {
    if (!member || typeof member.subject !== 'string' || !member.subject.trim()
        || typeof member.email !== 'string' || typeof member.active !== 'boolean'
        || member.role !== null && !ROLES.includes(member.role) || directory.has(member.subject)) {
      throw new Error('Invalid or duplicate directory member');
    }
    directory.set(member.subject, member);
  }
  return directory;
}

async function identities(Users) {
  const users = await Users.find({}, { projection: { _id: 1, type: 1, active: 1, roles: 1, blakRole: 1, 'services.blakid.id': 1 } }).toArray();
  const subjects = new Set();
  return users.map(user => {
    const subject = user.services?.blakid?.id ?? null;
    if (subject !== null && (typeof subject !== 'string' || !subject || subjects.has(subject))) throw new Error('Ambiguous Chat identity');
    if (subject) subjects.add(subject);
    return { id: user._id, subject, active: user.active, roles: user.roles, role: user.blakRole || null, type: user.type };
  });
}

async function configureRoles({ Roles, Permissions }) {
  for (const role of ROLES) {
    const id = 'blak-chat-' + role;
    const existing = await Roles.findOneById(id);
    if (existing && (existing.scope !== 'Users' || existing.description !== 'Managed by Blak ID')) throw new Error('Chat managed role collision');
    if (!existing) await Roles.insertOne({ _id: id, name: 'Blak Chat ' + role, scope: 'Users', description: 'Managed by Blak ID', protected: true, mandatory2fa: false });
    const wanted = new Set([...READ_PERMISSIONS, ...(role !== 'reader' ? WRITE_PERMISSIONS : []), ...(role === 'admin' ? ADMIN_PERMISSIONS : [])]);
    for (const permission of await Permissions.find({}).toArray()) {
      const has = permission.roles?.includes(id) || false;
      if (has !== wanted.has(permission._id)) {
        await Permissions.updateOne({ _id: permission._id }, wanted.has(permission._id)
          ? { $addToSet: { roles: id } } : { $pull: { roles: id } });
      }
    }
  }
}

async function reconcile(native, value) {
  const directory = directoryMembers(value);
  const users = await identities(native.Users);
  const bound = new Set(users.map(user => user.subject).filter(Boolean));
  const emails = new Set(), creations = [];
  for (const member of directory.values()) {
    if (bound.has(member.subject) || !member.active || !member.role) continue;
    const email = member.email.trim().toLowerCase();
    const username = 'blak-' + createHash('sha256').update(member.subject).digest('hex').slice(0, 24);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || emails.has(email)
        || await native.Users.findOne({ $or: [{ 'emails.address': email }, { username }] })) throw new Error('Chat identity collision requires explicit migration');
    emails.add(email);
    creations.push({ ...member, email, username });
  }
  await configureRoles(native);
  const counts = { created: 0, roles: 0, disabled: 0, activated: 0 };
  for (const member of creations) {
    const id = await native.Accounts.insertUserDoc({ skipAdminCheck: true, skipAdminEmail: true, skipNewUserRolesSetting: true }, {
      username: member.username, name: member.email.split('@')[0], type: 'user', active: false, roles: [], blakRole: null,
      emails: [{ address: member.email, verified: true }], services: { blakid: { id: member.subject } },
    });
    users.push({ id, subject: member.subject, role: null, roles: [], active: false, type: 'user' });
    counts.created++;
  }
  for (const user of users) {
    // Only the upstream system bot is outside human directory reconciliation.
    if (user.id === 'rocket.cat' && user.type === 'bot' && !user.subject) continue;
    const member = directory.get(user.subject);
    const role = member?.active ? member.role : null;
    const roles = role ? ['blak-chat-' + role] : [];
    const active = Boolean(role);
    if (user.role === role && user.active === active && JSON.stringify(user.roles) === JSON.stringify(roles)) continue;
    await native.Users.updateOne({ _id: user.id }, { $set: { blakRole: role, roles, active } });
    disconnect(user.id);
    counts.roles++;
    counts.disabled += Number(user.active && !active);
    counts.activated += Number(!user.active && active);
  }
  return counts;
}

function register(API, native) {
  let running = false;
  for (const operation of ['identities', 'reconcile']) {
    API.v1.addRoute('blak.roles.' + operation, { authRequired: false, rateLimiterOptions: { numRequestsAllowed: 120, intervalTimeInMS: 60000 } }, {
      async post() {
        try { requireController(this.request); }
        catch { return API.v1.forbidden('Blak ID controller required'); }
        if (running) return API.v1.failure('Reconciliation already running');
        running = true;
        try { return API.v1.success(operation === 'identities' ? { identities: await identities(native.Users) } : await reconcile(native, this.bodyParams.members)); }
        catch (error) { console.error('Chat role reconciliation failed:', error.name); return API.v1.failure('Chat role reconciliation failed'); }
        finally { running = false; }
      },
    });
  }
}

module.exports = { directoryMembers, identities, configureRoles, reconcile, register, requireController };
