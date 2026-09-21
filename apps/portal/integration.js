'use strict';

// The catalog owns app identity. This contract owns its native integration.
const INTEGRATIONS = {
  vault: { application: 'blak-vault', roleGroups: ['blak-vault-reader', 'blak-vault-writer', 'blak-vault-admin'], login: '/#/sso?identifier=00000000-01DC-01DC-01DC-000000000000', theme: 'vaultwarden' },
  forms: { application: 'blak-forms', group: 'Blak Forms users', login: '/_blak/launch.html', theme: 'heyform' },
  draw: { group: 'Blak Draw users', theme: 'excalidraw' },
  crm: { application: 'blak-crm', group: 'Blak CRM users', login: '/_blak/launch.html', theme: 'frappe' },
  drive: { application: 'opencloud', group: 'Blak Drive users', theme: 'opencloud' },
  docs: { application: 'opencloud', group: 'Blak Drive users', theme: 'collabora' },
  chat: { application: 'rocketchat', group: 'Blak Chat users', login: '/home?blak_launch=1', theme: 'rocketchat' },
  sites: { application: 'outline', group: 'Blak Knowledge users', login: '/auth/oidc', theme: 'outline' },
  projects: { application: 'kaneo', group: 'Blak Projects users', theme: 'kaneo' },
  idp: { admin: true, theme: 'authentik' },
  flow: { group: 'Blak Flow users', theme: 'portal' },
  hermes: { application: 'hermes', group: 'Blak Hermes users', login: '/oauth/oidc/login', theme: 'openwebui' },
  search: { group: 'Blak Search users', theme: 'portal' },
  storage: { group: 'Blak Cloud users', theme: 'portal' },
};

function allowedApps(apps, user) {
  const grants = new Set(Array.isArray(user?.apps) ? user.apps : []);
  return apps.filter(app => app.status === 'live' && grants.has(app.id));
}

function launchURL(app) {
  return '/launch/' + encodeURIComponent(app.id);
}

function routeApp(pathname) {
  if (/^\/(?:api\/)?draw(?:\/|$)/.test(pathname)) return 'draw';
  if (/^\/(?:api\/)?flow(?:\/|$)/.test(pathname)) return 'flow';
  if (/^\/(?:api\/)?cloud(?:\/|$)/.test(pathname)) return 'storage';
  if (/^\/(?:api\/)?search(?:\/|$)/.test(pathname)) return 'search';
  if (['/sync', '/api/sync-health'].includes(pathname)) return 'hermes';
  return null;
}

module.exports = { INTEGRATIONS, allowedApps, launchURL, routeApp };
