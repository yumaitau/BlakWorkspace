'use strict';
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = process.argv[2] || '/app/bundle/programs/server/app/app.js';
let source = fs.readFileSync(path, 'utf8');
if (createHash('sha256').update(source).digest('hex') !== 'f2c2451cc70c2f1bc591ea677680fcfc7594956619bc2e45f8f323ed51402da1') throw Error('Pinned Rocket.Chat native source changed');
const bridge = 'require("module").createRequire("/app/bundle/main.js")("/app/bundle/blak/role-bridge.cjs")';
function replace(before, after) {
  if (source.split(before).length !== 2) throw Error('Native patch anchor mismatch: ' + before);
  source = source.replace(before, after);
}
replace('Accounts.config({\n      forbidClientAccountCreation: true',
  `${bridge}.install({ Meteor, Accounts, Users, Roles, Settings, Permissions: require('@rocket.chat/models').Permissions });\n    Accounts.config({\n      forbidClientAccountCreation: true`);
replace('default: createApi({})\n    };', `default: createApi({})\n    };\n    ${bridge}.registerRoutes(API);`);
replace('const addOAuthServiceMethod = async (userId, name) => {',
  `if (${bridge}.enabled()) Meteor.startup(() => addOAuthService('blakid'));\n    const addOAuthServiceMethod = async (userId, name) => {`);
replace('async function insertAdminUserFromEnv() {',
  `async function insertAdminUserFromEnv() {\n      if (${bridge}.enabled()) return;`);
replace("if ((await Roles.countUsersInRole('admin')) === 0) {\n        const oldestUser",
  `if (!${bridge}.enabled() && (await Roles.countUsersInRole('admin')) === 0) {\n        const oldestUser`);
replace('if (options.deprecation) {',
  `if ((options.authRequired || options.authOrAnonRequired) && !await ${bridge}.checkRoute(this.userId, api.apiPath, route, this.request.method, this.bodyParams)) return api.forbidden('Blak ID does not grant this Chat operation');\n                if (options.deprecation) {`);
replace('const validateLoginAttemptAsync = async function (login) {',
  `const validateLoginAttemptAsync = async function (login) {\n      await ${bridge}.validateLogin(login);`);
replace('Accounts.updateOrCreateUserFromExternalService = async function () {',
  `Accounts.updateOrCreateUserFromExternalService = async function () {\n      await ${bridge}.validateExternal(arguments[0], arguments[1]);`);
replace('const canAccessRoom = async (room, user, extraData) => {',
  `const canAccessRoom = async (room, user, extraData) => {\n      if (!await ${bridge}.canRead(user?._id)) return false;`);
replace('const user = file.userId && (await Users.findOne(file.userId)) || undefined;',
  `const user = file.userId && (await Users.findOne(file.userId)) || undefined;\n        await ${bridge}.requireMethod(file.userId, 'sendFileMessage');`);
fs.writeFileSync(path, source);
