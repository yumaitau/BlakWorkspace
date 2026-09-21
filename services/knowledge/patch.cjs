'use strict';
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const root = process.argv[2] || '/opt/outline/build/server';
function patch(path, digest, edits) {
  const file = join(root, path);
  let source = readFileSync(file, 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== digest) throw Error('Unexpected upstream Outline file: ' + path);
  for (const [before, after, count = 1] of edits) {
    if (source.split(before).length !== count + 1) throw Error('Ambiguous native Knowledge patch: ' + path);
    source = source.replaceAll(before, after);
  }
  writeFileSync(file, source);
}
patch('policies/cancan.js', '5729b42d21e4ceaf77011dcd5cccaa8b2f122427ab27b54f9942281cbbb5dbfb', [
  ['this.computeCan = (performer, action, target, options)=>{', 'this.computeCan = (performer, action, target, options)=>{\n            if (!require("../blak/roles.cjs").allows(performer, action, target)) return false;'],
]);
patch('policies/user.js', '6899550f646e54947abf1e602d4e7a0669631344351bd0da4be8f3ebe82bcb9f', [
  ['!user?.isSuspended, user?.id !== actor.id', '(!user?.isSuspended || actor.id === process.env.BLAK_ROLE_CONTROLLER_ID), user?.id !== actor.id', 2],
]);
patch('routes/api/users/users.js', '7b805b07c8c1116b0a091727d0f2c4ea91cb2dd8fbb0f95359dc21076ab7c26a', [
  ['const router = new _koarouter.default();', `const router = new _koarouter.default();
router.post("users.blak_identities", (0, _authentication.default)({ role: _types.UserRole.Admin }),
  async ctx => require("../../../blak/roles.cjs").identities(ctx, _models));`],
]);
patch('commands/userProvisioner.js', '8726b0544232d1cc5745872f206f99c03ee1fca5d221efa242418300bb26e92d', [
  ['providerId: String(authentication.providerId)', 'providerId: String(authentication.providerId),\n            authenticationProviderId: authentication.authenticationProviderId'],
  ['    if (existingUser) {', `    if (existingUser && process.env.BLAK_ROLE_CONTROLLER_ID) {
        throw (0, _errors.InvalidAuthenticationError)("Blak ID requires an immutable identity link; email cannot link an account");
    }
    if (existingUser) {`],
  ['role: role ?? team?.defaultUserRole,', 'role: process.env.BLAK_ROLE_CONTROLLER_ID ? require("../../shared/types").UserRole.Viewer : (role ?? team?.defaultUserRole),'],
]);
console.log('Native Knowledge identity binding and role limits installed');
