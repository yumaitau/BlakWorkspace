'use strict';

function publicApps(apps, env = process.env) {
  let origins = {};
  if (env.BLAK_APP_ORIGINS) {
    origins = JSON.parse(env.BLAK_APP_ORIGINS);
    if (!origins || typeof origins !== 'object' || Array.isArray(origins)) {
      throw new Error('BLAK_APP_ORIGINS must be a JSON object');
    }
  }
  return apps.map(app => {
    const origin = origins[app.id];
    if (!origin || !app.url || app.url.startsWith('/')) return app;
    const url = new URL(app.url);
    const target = new URL(origin);
    url.protocol = target.protocol;
    url.host = target.host;
    return { ...app, url: url.toString() };
  });
}

module.exports = { publicApps };
