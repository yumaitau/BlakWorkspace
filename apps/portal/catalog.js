'use strict';

// status: live = available and advertised; soon = not advertised as live.
// oidcClient identifies SSO; authentication labels explicit local-login exceptions.
const ACCENT = {
  forms: '#D68B2C', draw: '#3199A2', crm: '#D65B2E', workspace: '#D65B2E', drive: '#3199A2', docs: '#66996B', notes: '#D68B2C', chat: '#C55235',
  meet: '#21818A', mail: '#737BB8', knowledge: '#66996B', projects: '#D8792E', admin: '#7583B0',
  flow: '#3199A2', hermes: '#A26CC1', idp: '#7583B0', search: '#D68B2C', storage: '#21818A',
};
const ICON_IMG = { forms: 'docs', draw: 'flow', crm: 'projects', drive: 'drive', docs: 'docs', chat: 'chat', projects: 'projects', idp: 'admin', flow: 'flow', hermes: 'hermes', sites: 'knowledge' };
const RAIL_ICON = {
  forms: '▤', draw: '◇', crm: '▦', home: '⌂', drive: '▤', docs: '▤', notes: '▦', chat: '◫', meet: '◉', mail: '✉', knowledge: '▦',
  projects: '▤', admin: '⚙', flow: '⇄', hermes: '✦', idp: '◉', search: '⌕', storage: '⬢',
};

const APPS = [
  { id: 'forms', name: 'Blak Forms', desc: 'Forms and surveys', url: 'https://forms.homelab.local', backend: 'Powered by HeyForm', group: 'Workspace', status: 'live', oidcClient: 'blak-forms', check: { proto: 'http', host: 'forms', port: 9157, path: '/' } },
  { id: 'draw', name: 'Blak Draw', desc: 'Private diagrams and drawings', url: '/draw', backend: 'Powered by Excalidraw', group: 'Workspace', status: 'live', oidcClient: 'blak-portal', check: null },
  { id: 'crm', name: 'Blak CRM', desc: 'Leads, contacts, organisations and deals', url: 'https://crm.homelab.local/login?redirect-to=/crm', backend: 'Powered by Frappe CRM', group: 'Organise', status: 'live', oidcClient: 'blak-crm', check: { proto: 'http', host: 'crm', port: 3000, path: '/api/method/ping' } },
  { id: 'drive', name: 'Blak Drive', desc: 'Files and sharing', url: 'https://drive.homelab.local', backend: 'Powered by OpenCloud', group: 'Workspace', status: 'live', oidcClient: 'web', check: { proto: 'http', host: 'drive', port: 9200, path: '/' } },
  { id: 'docs', name: 'Blak Docs', desc: 'Documents, spreadsheets, presentations', url: 'https://drive.homelab.local', backend: 'Powered by Collabora (WOPI via Drive SSO)', group: 'Workspace', status: 'live', oidcClient: 'web', check: { proto: 'http', host: 'docs', port: 9980, path: '/hosting/discovery' } },
  { id: 'notes', name: 'Blak Notes', desc: 'Quick notes', url: null, backend: '', group: 'Workspace', status: 'soon', oidcClient: null, check: null },
  { id: 'chat', name: 'Blak Chat', desc: 'Team messaging', url: 'https://chat.homelab.local', backend: 'Powered by Rocket.Chat', group: 'Workspace', status: 'live', oidcClient: 'rocketchat', check: { proto: 'http', host: 'chat', port: 3000, path: '/api/info' } },
  { id: 'sites', name: 'Blak Knowledge', desc: 'Team knowledge', url: 'https://sites.homelab.local', backend: 'Powered by Outline', group: 'Organise', status: 'live', oidcClient: 'outline', check: { proto: 'http', host: 'sites', port: 3000, path: '/_health' } },
  { id: 'projects', name: 'Blak Projects', desc: 'Projects, tasks and boards', url: 'https://projects.homelab.local', backend: 'Powered by Kaneo', group: 'Organise', status: 'live', oidcClient: 'kaneo', check: { proto: 'http', host: 'projects', port: 5173, path: '/api/health' } },
  { id: 'idp', name: 'Blak Admin', desc: 'Workspace administration', url: 'https://id.homelab.local', backend: 'Powered by Authentik', group: 'Platform', status: 'live', oidcClient: 'authentik', check: { proto: 'http', host: 'authentik-server', port: 9000, path: '/-/health/ready/' } },
  { id: 'flow', name: 'Blak Flow', desc: 'Automations', url: '/flow', backend: 'Powered by Blak Flow engine', group: 'Platform', status: 'live', oidcClient: 'blak-portal', check: null },
  { id: 'hermes', name: 'Blak Hermes', desc: 'Local AI assistant', url: 'https://hermes.homelab.local', backend: 'Powered by Open WebUI + Ollama', group: 'Platform', status: 'live', oidcClient: 'hermes', check: { proto: 'http', host: 'hermes', port: 8080, path: '/' } },
  { id: 'search', name: 'Blak Search', desc: 'Permission-aware workspace search', url: '/search', backend: 'Powered by Meilisearch', group: 'Platform', status: 'live', oidcClient: 'blak-portal', check: { proto: 'http', host: 'meilisearch', port: 7700, path: '/health' } },
  { id: 'storage', name: 'Blak Cloud', desc: 'Local cloud services', url: '/cloud', backend: 'Powered by Floci', group: 'Platform', status: 'live', oidcClient: 'blak-portal', check: { proto: 'http', host: 'floci', port: 4566, path: '/_localstack/health' } },
];

function liveApps() {
  return APPS.filter((a) => a.status === 'live' && a.url);
}

module.exports = { APPS, ACCENT, ICON_IMG, RAIL_ICON, liveApps };
