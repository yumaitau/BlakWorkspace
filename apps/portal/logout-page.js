'use strict';
const crypto = require('node:crypto');

function logoutPage(apps, endSessionURL) {
  const state = crypto.randomBytes(16).toString('hex');
  const targets = apps.filter(a => ['forms','crm','drive','sites','projects','chat','hermes','smith','eyes'].includes(a.id))
    .map(a => ({ id: a.id, name: a.name, origin: new URL(a.url).origin, url: new URL('/_blak/signout.html?state=' + state, a.url).href }));
  const data = JSON.stringify({ state, targets, endSessionURL }).replace(/</g, '\\u003c');
  const vaultNotice = apps.some(a => a.id === 'vault') ? '<p>Also lock or log out of Blak Vault in its own tab and in your Bitwarden apps. Workspace sign-out does not lock an already unlocked or offline vault.</p>' : '';
  return `<main style="max-width:640px;margin:12vh auto;padding:24px"><h1>Signing out of your workspace</h1><p id="logout-status" role="status">Ending your app sessions, then Blak ID…</p>${vaultNotice}<ul id="logout-results"></ul><button id="logout-retry" hidden>Retry remaining apps</button><a id="logout-finish" hidden>Finish Blak ID sign-out</a></main><script type="application/json" id="logout-config">${data}</script><script src="/brand/logout.js"></script>`;
}
module.exports = { logoutPage };
