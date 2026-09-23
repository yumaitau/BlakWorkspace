'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');

// SHA-256 of /app/bundle/programs/server/app/app.js for the pinned Rocket.Chat tag.
// A new upstream with the same anchors prints a new hash and does not write the bundle.
const PIN = '6f58bb2bcfaefff598c0e2f932e245027e5eeb2730a4e0674b93ae021f709f52';
const bridge = 'require("module").createRequire("/app/bundle/main.js")("/app/bundle/blak/role-bridge.cjs")';

const anchors = [
  ['accounts', 'Accounts.config({\n    forbidClientAccountCreation: true',
    `${bridge}.install({ Meteor, Accounts, Users, Roles, Settings, Permissions: require('@rocket.chat/models').Permissions });\n    Accounts.config({\n    forbidClientAccountCreation: true`],
  ['routes', 'default: createApi({})\n};',
    `default: createApi({})\n};\n    ${bridge}.registerRoutes(API);`],
  ['oauth', 'const addOAuthServiceMethod = async (userId, name)=>{',
    `if (${bridge}.enabled()) Meteor.startup(() => addOAuthService('blakid'));\n    const addOAuthServiceMethod = async (userId, name)=>{`],
  ['adminEnv', 'async function insertAdminUserFromEnv() {',
    `async function insertAdminUserFromEnv() {\n      if (${bridge}.enabled()) return;`],
  ['oldestAdmin', "if (await Roles.countUsersInRole('admin') === 0) {\n        const oldestUser",
    `if (!${bridge}.enabled() && await Roles.countUsersInRole('admin') === 0) {\n        const oldestUser`],
  ['routeGuard', 'if (options.deprecation) {',
    `if ((options.authRequired || options.authOrAnonRequired) && !await ${bridge}.checkRoute(this.userId, api.apiPath, route, this.request.method, this.bodyParams)) return api.forbidden('Blak ID does not grant this Chat operation');\n                if (options.deprecation) {`],
  ['login', 'const validateLoginAttemptAsync = async function(login) {',
    `const validateLoginAttemptAsync = async function(login) {\n      await ${bridge}.validateLogin(login);`],
  ['externalLogin', 'Accounts.updateOrCreateUserFromExternalService = async function(...args /* serviceName, serviceData, options*/ ) {',
    `Accounts.updateOrCreateUserFromExternalService = async function(...args /* serviceName, serviceData, options*/ ) {\n      await ${bridge}.validateExternal(args[0], args[1]);`],
  ['room', 'const canAccessRoom = async (room, user, extraData)=>{',
    `const canAccessRoom = async (room, user, extraData)=>{\n      if (!await ${bridge}.canRead(user?._id)) return false;`],
  ['upload', 'const user = file.userId && await Users.findOne(file.userId) || undefined;',
    `const user = file.userId && await Users.findOne(file.userId) || undefined;\n        await ${bridge}.requireMethod(file.userId, 'sendFileMessage');`],
];

function inspect(source, pin = PIN) {
  const hash = createHash('sha256').update(source).digest('hex');
  const missing = anchors.filter(([, before]) => source.split(before).length !== 2).map(([name]) => name);
  return { hash, missing, pinned: hash === pin };
}

function explain(report) {
  const lines = [`Rocket.Chat bundle hash ${report.hash}`];
  if (report.missing.length) lines.push(`Missing anchors: ${report.missing.join(', ')}`);
  else if (!report.pinned) lines.push('Anchors still match. Set PIN in services/chat/patch.cjs to this hash after reviewing the upstream release.');
  return lines.join('\n');
}

function apply(source, pin = PIN) {
  const report = inspect(source, pin);
  if (!report.pinned || report.missing.length) {
    const error = new Error(explain(report));
    error.report = report;
    throw error;
  }
  return anchors.reduce((current, [, before, after]) => current.replace(before, after), source);
}

function main() {
  const path = process.argv[2] || '/app/bundle/programs/server/app/app.js';
  const source = fs.readFileSync(path, 'utf8');
  if (process.argv.includes('--check')) {
    const report = inspect(source);
    console.log(explain(report));
    if (!report.pinned || report.missing.length) process.exitCode = 1;
    return;
  }
  fs.writeFileSync(path, apply(source));
}

module.exports = { PIN, anchors, inspect, explain, apply };

if (require.main === module) main();
