'use strict';

const LEVELS = Object.freeze({ reader: 1, writer: 2, admin: 3 });
const { INTEGRATIONS } = require('./integration');
const ROLE_APPS = new Set(Object.entries(INTEGRATIONS).filter(([, app]) => app.roleGroups?.length).map(([id]) => id));
const MANAGED_APPS = Object.freeze(['draw', 'flow', 'storage', 'search']);

function rolesFromClaims(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([app, role]) =>
    ROLE_APPS.has(app) && Object.hasOwn(LEVELS, role)));
}

function can(user, app, permission = 'reader') {
  return Array.isArray(user?.apps) && user.apps.includes(app) &&
    Object.hasOwn(LEVELS, permission) &&
    (LEVELS[rolesFromClaims(user.roles)[app]] || 0) >= LEVELS[permission];
}

function requiredRole(app, method, pathname) {
  if (!MANAGED_APPS.includes(app)) return null;
  // These are the portal's own REST operations, not a proxy policy for native
  // applications. Every mutation retains its existing resource owner checks.
  if (app === 'flow' && pathname === '/flow/new') return 'writer';
  return ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'reader' : 'writer';
}

module.exports = { MANAGED_APPS, rolesFromClaims, can, requiredRole };
