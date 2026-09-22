'use strict';
const policy = require('./role-policy.cjs');
let native;
let api;
let registered = false;
const enabled = () => process.env.BLAK_CHAT_ROLES === 'true';

function forbidden() { return new native.Meteor.Error('error-unauthorized', 'Blak ID does not grant this Chat operation'); }
async function current(id) { return id ? native.Users.findOneById(id) : null; }
async function canRead(id) { return !enabled() || Boolean(policy.role(await current(id))); }
async function requireMethod(id, method) {
  if (enabled() && !policy.methodAllowed(await current(id), method)) throw forbidden();
}
async function checkRoute(id, version, route, method, body) {
  return !enabled() || policy.routeAllowed(await current(id), version, route, method, body);
}
async function validateLogin(login) {
  if (!enabled()) return;
  if (!['oauth', 'resume'].includes(login.type) || !await canRead(login.user?._id)) throw forbidden();
}
async function validateExternal(service, data) {
  if (!enabled()) return;
  if (service !== 'blakid' || typeof data?.id !== 'string' || !data.id) throw forbidden();
  const users = await native.Users.find({ 'services.blakid.id': data.id }).toArray();
  if (users.length !== 1 || !policy.role(users[0])) throw forbidden();
}

function disconnect(id) {
  for (const session of native.Meteor.server.sessions.values()) {
    if (session.userId === id) session.close();
  }
}

function install(dependencies) {
  native = dependencies;
  if (!enabled()) return;
  registerRoutes();
  const { Meteor } = native;
  function wrapMethod(name, handler) {
    if (['login', 'logout'].includes(name)) return handler; // Native login validation still applies.
    return async function (...args) {
      await requireMethod(this.userId, name);
      return handler.apply(this, args);
    };
  }
  function wrapPublication(handler) {
    return async function (...args) {
      if (this.userId && !await canRead(this.userId)) throw forbidden();
      return handler.apply(this, args);
    };
  }
  Meteor.startup(async () => {
    for (const [name, handler] of Object.entries(Meteor.server.method_handlers)) {
      Meteor.server.method_handlers[name] = wrapMethod(name, handler);
    }
    const methods = Meteor.methods;
    Meteor.methods = function (handlers) {
      return methods.call(this, Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, wrapMethod(name, handler)])));
    };
    for (const [name, handler] of Object.entries(Meteor.server.publish_handlers)) {
      Meteor.server.publish_handlers[name] = wrapPublication(handler);
    }
    Meteor.server.universal_publish_handlers = Meteor.server.universal_publish_handlers.map(wrapPublication);
    const publish = Meteor.publish;
    Meteor.publish = function (name, handler, ...args) {
      if (name && typeof name === 'object') {
        return publish.call(this, Object.fromEntries(Object.entries(name).map(([key, value]) => [key, wrapPublication(value)])));
      }
      return publish.call(this, name, wrapPublication(handler), ...args);
    };
    await Meteor.users.find({}, { fields: { active: 1, blakRole: 1, roles: 1 } }).observeChangesAsync({
      changed(id) { disconnect(id); },
      removed(id) { disconnect(id); },
    });
  });
}

function registerRoutes(value) {
  if (value) api = value;
  if (enabled() && native && api && !registered) {
    require('./role-controller.cjs').register(api, native);
    registered = true;
  }
}

module.exports = { enabled, install, registerRoutes, canRead, requireMethod, checkRoute, validateLogin, validateExternal, disconnect };
