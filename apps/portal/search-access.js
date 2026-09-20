'use strict';
// Indexed documents must explicitly allow the current account or the whole workspace.
const ACL_FIELDS = ['allowedUsers', 'visibility'];
function supportsAccessFilter(fields) {
  return Array.isArray(fields) && ACL_FIELDS.every(field => fields.includes(field));
}
function accessFilter(user) {
  return `allowedUsers = ${JSON.stringify(user.sub)} OR visibility = "workspace"`;
}
module.exports = { supportsAccessFilter, accessFilter };
