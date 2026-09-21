'use strict';

const { timingSafeEqual } = require('node:crypto');
const { allows, directoryMembers } = require('./role-policy.cjs');

function enabled() { return process.env.BLAK_FORMS_ROLES === 'true'; }

function authorize(user, operation, args) {
  if (enabled() && !allows(user, operation, args)) {
    const { ForbiddenException } = require('@nestjs/common');
    throw new ForbiddenException('Blak ID does not grant this Forms operation');
  }
}

function requireController(request) {
  const expected = process.env.BLAK_FORMS_ROLE_TOKEN;
  const actual = request.headers.authorization;
  const left = Buffer.from(typeof actual === 'string' ? actual : '');
  const right = Buffer.from('Bearer ' + (expected || ''));
  if (!enabled() || !expected || expected.length < 32 || left.length !== right.length
      || !timingSafeEqual(left, right)) {
    const { ForbiddenException } = require('@nestjs/common');
    throw new ForbiddenException('Blak ID controller required');
  }
}

async function identities(users, accounts) {
  const prefix = process.env.OIDC_ISSUER + '#';
  if (!process.env.OIDC_ISSUER) throw new Error('OIDC issuer required');
  const links = await accounts.find({ kind: 'oidc' }).lean();
  const byUser = new Map(), subjects = new Set();
  for (const link of links) {
    if (!link.openId.startsWith(prefix)) throw new Error('Unexpected Forms identity issuer');
    const subject = decodeURIComponent(link.openId.slice(prefix.length));
    const id = String(link.userId);
    if (!subject || byUser.has(id) || subjects.has(subject)
        || prefix + encodeURIComponent(subject) !== link.openId) throw new Error('Ambiguous Forms identity');
    byUser.set(id, subject);
    subjects.add(subject);
  }
  const native = await users.find({}).lean();
  const ids = new Set(native.map(user => String(user._id)));
  if ([...byUser.keys()].some(id => !ids.has(id))) throw new Error('Orphan Forms identity');
  return native.map(user => ({ id: String(user._id), subject: byUser.get(String(user._id)) || null,
    role: user.blakRole || null }));
}

async function reconcile(users, accounts, value) {
  const directory = directoryMembers(value);
  const native = await identities(users, accounts);
  const bound = new Set(native.map(user => user.subject).filter(Boolean));
  const emails = new Set();
  const creations = [];
  // Validate all identity collisions before mutating any account.
  for (const member of directory.values()) {
    if (bound.has(member.subject) || !member.active || !member.role) continue;
    const email = member.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || emails.has(email)
        || await users.exists({ email })) throw new Error('Forms email collision requires explicit identity migration');
    emails.add(email);
    creations.push({ ...member, email });
  }
  const counts = { created: 0, roles: 0, disabled: 0, activated: 0 };
  for (const member of creations) {
    const user = await users.create({ email: member.email, name: member.email.split('@')[0],
      isEmailVerified: true, blakRole: null });
    // Until the immutable link exists and reconciliation completes, access is denied.
    await accounts.create({ kind: 'oidc', userId: user.id,
      openId: process.env.OIDC_ISSUER + '#' + encodeURIComponent(member.subject) });
    native.push({ id: user.id, subject: member.subject, role: null });
    counts.created++;
  }
  for (const user of native) {
    const member = directory.get(user.subject);
    const role = member?.active ? member.role : null;
    if (role === user.role) continue;
    await users.updateOne({ _id: user.id }, { $set: { blakRole: role } });
    counts.roles++;
    counts.disabled += Number(!role && !!user.role);
    counts.activated += Number(!!role && !user.role);
  }
  return counts;
}

module.exports = { enabled, authorize, requireController, identities, reconcile };
