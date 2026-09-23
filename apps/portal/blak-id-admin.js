'use strict';
// Server-side Blak ID (Authentik) API client for People & access. The token
// belongs to the dedicated blak-portal-access service account. Globally it can
// only view users and groups and add groups. Membership and group changes are
// object permissions on the app role groups and blak_team groups only
// (scripts/deploy/ak-access-admin.py), so Authentik itself refuses any other
// group. The portal guardrails refuse them first.
const { textRequest } = require('./http-client');

class BlakIdError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const LIST = 'page_size=100&include_users=false&include_children=false&include_parents=false&include_inherited_roles=false';
const USER_FIELDS = 'include_groups=false&include_roles=false';

function createBlakIdAdmin({ baseUrl, token, request = textRequest }) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  async function api(method, path, body) {
    let result;
    try {
      result = await request(base + '/api/v3' + path, {
        method,
        headers: { authorization: 'Bearer ' + token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new BlakIdError('Blak ID could not be reached', 502); }
    if (result.status < 200 || result.status >= 300) {
      // Never echo the upstream body: it can name internal objects.
      throw new BlakIdError(result.status === 403 ? 'Blak ID refused this change' : result.status === 404 ? 'Not found in Blak ID' : 'Blak ID returned an error (' + result.status + ')', result.status === 404 ? 404 : 502);
    }
    return result.status === 204 || !result.body ? null : JSON.parse(result.body);
  }
  async function pages(path) {
    const out = [];
    const seen = new Set();
    for (let page = 1; page;) {
      if (seen.has(page) || seen.size > 200) throw new BlakIdError('Invalid directory pagination', 502);
      seen.add(page);
      const result = await api('GET', path + (path.includes('?') ? '&' : '?') + 'page=' + page);
      out.push(...result.results);
      page = result.pagination?.next || 0;
    }
    return out;
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function uuid(value) {
    if (!uuidPattern.test(String(value))) throw new BlakIdError('Invalid identifier', 400);
    return String(value).toLowerCase();
  }
  function userPk(value) {
    const pk = Number(value);
    if (!Number.isSafeInteger(pk) || pk <= 0) throw new BlakIdError('Invalid person', 400);
    return pk;
  }
  return {
    configured: Boolean(base && token),
    // Live check on every admin request; never trusts the session claim alone.
    async isWorkspaceAdmin(identity) {
      const result = await api('GET', '/core/users/?' + USER_FIELDS + '&uuid=' + encodeURIComponent(uuid(identity)));
      const user = result.results?.length === 1 ? result.results[0] : null;
      return Boolean(user && user.is_active === true && user.is_superuser === true && String(user.uuid).toLowerCase() === uuid(identity));
    },
    async groups() { return pages('/core/groups/?' + LIST); },
    async group(pk) { return api('GET', '/core/groups/' + uuid(pk) + '/?include_users=true&include_children=false&include_parents=false&include_inherited_roles=false'); },
    async user(pk) { return api('GET', '/core/users/' + userPk(pk) + '/?' + USER_FIELDS); },
    async userByIdentity(identity) {
      const result = await api('GET', '/core/users/?' + USER_FIELDS + '&uuid=' + encodeURIComponent(uuid(identity)));
      return result.results?.length === 1 ? result.results[0] : null;
    },
    async searchUsers(query) {
      const q = String(query || '').trim().slice(0, 100);
      const result = await api('GET', '/core/users/?' + USER_FIELDS + '&page_size=25&type=internal&type=external&ordering=username' + (q ? '&search=' + encodeURIComponent(q) : ''));
      return result.results || [];
    },
    // Direct members of one group, with their own direct group lists.
    async members(group) { return pages('/core/users/?' + USER_FIELDS + '&page_size=100&ordering=username&groups_by_pk=' + uuid(group)); },
    async addMember(group, pk) { return api('POST', '/core/groups/' + uuid(group) + '/add_user/', { pk: userPk(pk) }); },
    async removeMember(group, pk) { return api('POST', '/core/groups/' + uuid(group) + '/remove_user/', { pk: userPk(pk) }); },
    async setParents(group, parents) { return api('PATCH', '/core/groups/' + uuid(group) + '/', { parents: parents.map(uuid) }); },
    async createTeam(name, description) {
      return api('POST', '/core/groups/', { name, is_superuser: false, parents: [], attributes: { blak_type: 'team', blak_team: true, description } });
    },
  };
}

module.exports = { createBlakIdAdmin, BlakIdError };
