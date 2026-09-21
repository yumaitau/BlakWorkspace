'use strict';
// Indexed documents must explicitly allow the current account or the whole workspace.
const { MANAGED_APPS, can } = require('./app-roles');
const sources = require('./content-sources.json');
const ACL_FIELDS = ['allowedUsers', 'visibility', 'source'];
function supportsAccessFilter(fields) {
  return Array.isArray(fields) && ACL_FIELDS.every(field => fields.includes(field));
}
function accessFilter(user) {
  const grants = new Set(Array.isArray(user.apps) ? user.apps : []);
  const labels = Object.values(sources)
    .filter(({ app }) => grants.has(app) && (!MANAGED_APPS.includes(app) || can(user, app)))
    .map(({ label }) => label);
  if (!labels.length) return null;
  return `(allowedUsers = ${JSON.stringify(user.sub)} OR visibility = "workspace") AND source IN ${JSON.stringify(labels)}`;
}
module.exports = { supportsAccessFilter, accessFilter };
