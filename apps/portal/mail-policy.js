'use strict';

// Source-level contracts for the new mail control plane. Not an identity verifier.
// Callers must load memberships from the authenticated directory, never req.body.
const REGIONS = Object.freeze({ primary: 'ap-southeast-2', recovery: 'ap-southeast-4' });
const PERMISSIONS = Object.freeze(['domains:read', 'domains:write', 'mailboxes:read',
  'mailboxes:write', 'smtp:manage', 'traces:read', 'audit:read']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireMailAccess(identity, memberships, tenantId, permission) {
  if (!identity?.subject || !identity?.issuer || !UUID.test(tenantId || '') ||
      !PERMISSIONS.includes(permission) || !Array.isArray(memberships)) {
    throw new Error('Mail access denied');
  }
  const membership = memberships.find(item => item.tenantId === tenantId &&
    item.subject === identity.subject && item.issuer === identity.issuer &&
    item.active === true && Array.isArray(item.permissions) && item.permissions.includes(permission));
  if (!membership) throw new Error('Mail access denied');
  return Object.freeze({ tenantId, subject: identity.subject, issuer: identity.issuer, permission });
}

function requireRegion(region) {
  if (!Object.values(REGIONS).includes(region)) throw new Error('Mail region must be Australian');
  return region;
}

function outboundRoute(region, primaryAvailable) {
  requireRegion(region);
  if (typeof primaryAvailable !== 'boolean') throw new Error('Regional health is required');
  if (primaryAvailable) {
    return Object.freeze({ action: 'relay', region: REGIONS.primary, host: 'email-smtp.ap-southeast-2.amazonaws.com', port: 587 });
  }
  // Both regions keep mail in their local queue while Sydney SES is unavailable.
  // Recovery drains only through Sydney SES; no direct or alternate relay.
  return Object.freeze({ action: 'hold', region, reason: 'Waiting for Sydney SES recovery' });
}

module.exports = { REGIONS, PERMISSIONS, requireMailAccess, requireRegion, outboundRoute };
