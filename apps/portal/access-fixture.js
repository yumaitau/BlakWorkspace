'use strict';
// In-memory Blak ID directory for render fixtures, tests and local previews.
// Not part of the portal image.
const { Readable } = require('node:stream');
const { roleSets, ROLES } = require('./access-catalog');

const ADMIN_UUID = '11111111-1111-4111-8111-111111111111';
const SAM_UUID = '22222222-2222-4222-8222-222222222222';

function fakeDirectory({ fail = {} } = {}) {
  let next = 1;
  const id = () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
  const groups = [];
  const add = (name, extra = {}) => { const group = { pk: id(), name, is_superuser: false, parents: [], attributes: {}, roles: [], users: [], ...extra }; groups.push(group); return group; };
  const admins = add('authentik Admins', { is_superuser: true });
  for (const set of roleSets()) {
    for (const role of ROLES) add(set.groups[role]);
    for (const legacy of set.legacy) if (!groups.some(group => group.name === legacy)) add(legacy);
  }
  const byName = name => groups.find(group => group.name === name);
  const rangers = add('Rangers', { attributes: { blak_type: 'team', description: 'Ranger team on Country' }, parents: [byName('blak-drive-writer').pk, byName('blak-knowledge-reader').pk] });
  add('Finance', { attributes: { blak_type: 'team', description: 'Finance and grants' } });
  add('Blak ID operators', { roles: ['rbac-role'] });
  const users = [
    { pk: 1, uuid: ADMIN_UUID, username: 'ada', name: 'Ada Example', email: 'ada@example.test', is_active: true, type: 'internal', groups: [admins.pk, byName('blak-drive-reader').pk, rangers.pk, byName('blak-chat-admin').pk] },
    { pk: 2, uuid: SAM_UUID, username: 'sam', name: 'Sam Taylor', email: 'sam@example.test', is_active: true, type: 'internal', groups: [byName('blak-chat-writer').pk, rangers.pk] },
    { pk: 3, uuid: '33333333-3333-4333-8333-333333333333', username: 'jo', name: 'Jo Nguyen', email: 'jo@example.test', is_active: true, type: 'internal', groups: [] },
    { pk: 4, uuid: '44444444-4444-4444-8444-444444444444', username: 'blak-role-reader', name: 'Role reader', email: '', is_active: true, type: 'service_account', groups: [] },
  ];
  const calls = [];
  const view = user => {
    const ancestry = new Set();
    const walk = pk => { if (ancestry.has(pk)) return; ancestry.add(pk); groups.find(group => group.pk === pk)?.parents.forEach(walk); };
    user.groups.forEach(walk);
    return { ...user, groups: [...user.groups], is_superuser: groups.some(group => ancestry.has(group.pk) && group.is_superuser) };
  };
  const snapshot = group => ({ ...group, parents: [...group.parents], users: users.filter(user => user.groups.includes(group.pk)).map(user => user.pk) });
  const need = (value, what) => { if (!value) throw Object.assign(new Error('Not found in Blak ID'), { status: 404 }); return value; };
  const guard = name => { if (fail[name]) throw Object.assign(new Error('Blak ID refused this change'), { status: 502 }); };
  const api = {
    configured: true, calls, groupsList: groups, usersList: users,
    async isWorkspaceAdmin(identity) { guard('isWorkspaceAdmin'); const user = users.find(item => item.uuid === identity); return Boolean(user && user.is_active && view(user).is_superuser); },
    async groups() { guard('groups'); return groups.map(snapshot); },
    async group(pk) { return snapshot(need(groups.find(group => group.pk === pk))); },
    async user(pk) { return view(need(users.find(user => user.pk === Number(pk)))); },
    async userByIdentity(identity) { const user = users.find(item => item.uuid === identity); return user ? view(user) : null; },
    async searchUsers(q) { q = q.toLowerCase(); return users.filter(user => ['internal', 'external'].includes(user.type) && (user.username + ' ' + user.name + ' ' + user.email).toLowerCase().includes(q)).map(view); },
    async members(pk) { return users.filter(user => user.groups.includes(pk)).map(view); },
    async addMember(pk, userPk) {
      calls.push(['addMember', pk, userPk]); guard('addMember');
      const group = need(groups.find(item => item.pk === pk));
      if (group.is_superuser) throw Object.assign(new Error('Blak ID refused this change'), { status: 502 });
      const user = need(users.find(item => item.pk === userPk));
      if (!user.groups.includes(pk)) user.groups.push(pk);
    },
    async removeMember(pk, userPk) { calls.push(['removeMember', pk, userPk]); guard('removeMember'); const user = need(users.find(item => item.pk === userPk)); user.groups = user.groups.filter(item => item !== pk); },
    async setParents(pk, parents) { calls.push(['setParents', pk, parents]); guard('setParents'); need(groups.find(item => item.pk === pk)).parents = [...parents]; },
    async createTeam(name, description) { calls.push(['createTeam', name]); guard('createTeam'); return snapshot(add(name, { attributes: { blak_type: 'team', description } })); },
  };
  return api;
}

// Minimal Authentik REST surface over fakeDirectory, for client tests and previews.
function fakeAuthentikServer(directory, token) {
  const http = require('node:http');
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://ak');
    const reply = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(value === undefined ? '' : JSON.stringify(value)); };
    if (req.headers.authorization !== 'Bearer ' + token) return reply(403, { detail: 'denied' });
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : {};
    const page = list => reply(200, { results: list, pagination: { next: 0 } });
    try {
      let match;
      if (req.method === 'GET' && url.pathname === '/api/v3/core/users/') {
        const q = url.searchParams;
        if (q.get('uuid')) return page((await directory.userByIdentity(q.get('uuid'))) ? [await directory.userByIdentity(q.get('uuid'))] : []);
        if (q.get('groups_by_pk')) return page(await directory.members(q.get('groups_by_pk')));
        return page(await directory.searchUsers(q.get('search') || ''));
      }
      if (req.method === 'GET' && (match = url.pathname.match(/^\/api\/v3\/core\/users\/(\d+)\/$/))) return reply(200, await directory.user(match[1]));
      if (req.method === 'GET' && url.pathname === '/api/v3/core/groups/') return page(await directory.groups());
      if (req.method === 'POST' && url.pathname === '/api/v3/core/groups/') return reply(201, await directory.createTeam(data.name, data.attributes.description));
      if ((match = url.pathname.match(/^\/api\/v3\/core\/groups\/([0-9a-f-]{36})\/(add_user\/|remove_user\/)?$/))) {
        if (req.method === 'GET' && !match[2]) return reply(200, await directory.group(match[1]));
        if (req.method === 'PATCH' && !match[2]) { await directory.setParents(match[1], data.parents); return reply(200, await directory.group(match[1])); }
        if (req.method === 'POST' && match[2] === 'add_user/') { await directory.addMember(match[1], data.pk); return reply(204); }
        if (req.method === 'POST' && match[2] === 'remove_user/') { await directory.removeMember(match[1], data.pk); return reply(204); }
      }
      reply(404, { detail: 'not found' });
    } catch (error) { reply(error.status === 404 ? 404 : 400, { detail: 'failed' }); }
  });
}

// Drives the access route handler without a network listener.
async function renderRoute(access, { method = 'GET', path, user, form, headers = {} }) {
  const body = form ? new URLSearchParams(form).toString() : '';
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.headers = { host: 'portal.workspace.example.com', ...headers };
  const res = { status: 200, headers: {}, body: '', setHeader(name, value) { this.headers[name] = value; }, writeHead(status, extra) { this.status = status; Object.assign(this.headers, extra || {}); return this; }, end(value) { this.body = String(value || ''); } };
  const handled = await access.handle(req, res, new URL(path, 'http://portal.workspace.example.com'), user);
  return { handled, ...res };
}

function fixtureAccess(blakId, extra = {}) {
  const { createAccess } = require('./access-pages');
  const { createCsrf, createAudit, createLimiter } = require('./access-guard');
  const { shell } = require('./server');
  const { readBody } = require('./request-body');
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return createAccess({ blakId, csrf: createCsrf('fixture-secret'), audit: createAudit(''), origin: 'http://portal.workspace.example.com', shell, esc, readBody, writeLimit: createLimiter(20, 60000), readLimit: createLimiter(1000, 60000), ...extra });
}

const ADMIN = { sub: 'ada', identity: ADMIN_UUID, name: 'Ada Example', email: 'ada@example.test', apps: ['idp', 'drive', 'docs', 'chat', 'sites'], roles: { drive: 'writer', docs: 'writer', chat: 'admin', sites: 'reader' }, sessionId: 'fixture-admin-session' };
const MEMBER = { sub: 'sam', identity: SAM_UUID, name: 'Sam Taylor', email: 'sam@example.test', apps: ['drive', 'docs', 'chat', 'sites'], roles: { drive: 'writer', docs: 'writer', chat: 'writer', sites: 'reader' }, sessionId: 'fixture-member-session' };

async function accessFixture() {
  const directory = fakeDirectory();
  const access = fixtureAccess(directory);
  const csrf = require('./access-guard').createCsrf('fixture-secret').token(ADMIN.sessionId);
  const origin = { origin: 'http://portal.workspace.example.com' };
  const get = async (path, user = ADMIN) => (await renderRoute(access, { path, user })).body;
  const drive = directory.groupsList.find(group => group.name === 'blak-drive-writer');
  const rangers = directory.groupsList.find(group => group.name === 'Rangers');
  return {
    explainer: await get('/access', MEMBER),
    me: await get('/access/me', MEMBER),
    memberAdmin: await renderRoute(access, { path: '/access/admin/apps', user: MEMBER }),
    apps: await get('/access/admin/apps'),
    app: await get('/access/admin/apps/drive'),
    groups: await get('/access/admin/groups'),
    group: await get('/access/admin/groups/' + rangers.pk),
    person: await get('/access/admin/people/2'),
    people: await get('/access/admin/people?q=sa'),
    review: (await renderRoute(access, { method: 'POST', path: '/access/admin/review', user: ADMIN, headers: origin, form: { csrf, action: 'person-role', person: '3', app: 'drive', role: 'writer', return: '/access/admin/apps/drive' } })).body,
    roleGroup: drive.pk,
  };
}

module.exports = { fakeDirectory, fakeAuthentikServer, renderRoute, fixtureAccess, accessFixture, ADMIN, MEMBER, ADMIN_UUID };
