'use strict';

// status: live = SSO-gated and advertised; soon = not advertised as live.
// oidcClient must be set on every live app (portal session, per-app OIDC, IdP, or WOPI-via-Drive).
const ACCENT = {
  workspace: '#D65B2E', drive: '#3199A2', docs: '#66996B', notes: '#D68B2C', chat: '#C55235',
  meet: '#21818A', mail: '#737BB8', knowledge: '#66996B', projects: '#D8792E', admin: '#7583B0',
  flow: '#3199A2', hermes: '#A26CC1', idp: '#7583B0', search: '#D68B2C', storage: '#21818A',
};
const ICON_IMG = { drive: 'drive', docs: 'docs', chat: 'chat', projects: 'projects', idp: 'admin', flow: 'flow', hermes: 'hermes', sites: 'knowledge' };
const RAIL_ICON = {
  home: '⌂', drive: '▤', docs: '▤', notes: '▦', chat: '◫', meet: '◉', mail: '✉', knowledge: '▦',
  projects: '▤', admin: '⚙', flow: '⇄', hermes: '✦', idp: '◉', search: '⌕', storage: '⬢',
};

const APPS = [
  { id: 'drive', name: 'Blak Drive', desc: 'Files and sharing', url: 'https://drive.homelab.local', backend: 'Powered by OpenCloud', group: 'Workspace', status: 'live', oidcClient: 'web', check: { proto: 'http', host: 'drive', port: 9200, path: '/' } },
  { id: 'docs', name: 'Blak Docs', desc: 'Documents, spreadsheets, presentations', url: 'https://drive.homelab.local', backend: 'Powered by Collabora (WOPI via Drive SSO)', group: 'Workspace', status: 'live', oidcClient: 'web', check: { proto: 'http', host: 'docs', port: 9980, path: '/hosting/discovery' } },
  { id: 'notes', name: 'Blak Notes', desc: 'Quick notes', url: null, backend: '', group: 'Workspace', status: 'soon', oidcClient: null, check: null },
  { id: 'chat', name: 'Blak Chat', desc: 'Team messaging', url: null, backend: 'Mattermost Team cannot do OIDC (Enterprise licence)', group: 'Workspace', status: 'soon', oidcClient: null, check: null },
  { id: 'sites', name: 'Blak Knowledge', desc: 'Team knowledge', url: 'http://sites.homelab.local', backend: 'Powered by Outline', group: 'Organise', status: 'live', oidcClient: 'outline', check: { proto: 'http', host: 'sites', port: 3000, path: '/_health' } },
  { id: 'projects', name: 'Blak Projects', desc: 'Projects, tasks and boards', url: null, backend: 'OpenProject CE SSO plugins are Enterprise-licenced', group: 'Organise', status: 'soon', oidcClient: null, check: null },
  { id: 'idp', name: 'Blak Admin', desc: 'Workspace administration', url: 'http://id.homelab.local', backend: 'Powered by Authentik', group: 'Platform', status: 'live', oidcClient: 'authentik', check: { proto: 'http', host: 'authentik-server', port: 9000, path: '/-/health/ready/' } },
  { id: 'flow', name: 'Blak Flow', desc: 'Automations', url: '/flow', backend: 'Powered by Blak Flow engine', group: 'Platform', status: 'live', oidcClient: 'blak-portal', check: null },
  { id: 'hermes', name: 'Blak Hermes', desc: 'Local AI assistant', url: 'http://hermes.homelab.local', backend: 'Powered by Open WebUI + Ollama', group: 'Platform', status: 'live', oidcClient: 'hermes', check: { proto: 'http', host: 'hermes', port: 8080, path: '/' } },
  { id: 'search', name: 'Blak Search', desc: 'Permission-aware workspace search', url: '/search', backend: 'Powered by Meilisearch', group: 'Platform', status: 'live', oidcClient: 'blak-portal', check: { proto: 'http', host: 'meilisearch', port: 7700, path: '/health' } },
  { id: 'storage', name: 'Blak Cloud', desc: 'Local cloud services', url: '/cloud', backend: 'Powered by Floci', group: 'Platform', status: 'live', oidcClient: 'blak-portal', check: { proto: 'http', host: 'floci', port: 4566, path: '/_localstack/health' } },
];

function liveApps() {
  return APPS.filter((a) => a.status === 'live' && a.url);
}

module.exports = { APPS, ACCENT, ICON_IMG, RAIL_ICON, liveApps };
