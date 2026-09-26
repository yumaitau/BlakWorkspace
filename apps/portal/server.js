const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');
const { APPS: CATALOG_APPS, ACCENT, ICON_IMG, RAIL_ICON, liveApps } = require('./catalog');
const { publicApps } = require('./public-urls');
const APPS = publicApps(CATALOG_APPS);
const flowEngine = require('./flow-engine');
const outlineSites = require('./outline-sites');
const fileGuard = require('./file-guard');
const backups = require('./backups');
const { INTEGRATIONS, allowedApps, launchURL, routeApp } = require('./integration');
const { rolesFromClaims, can, requiredRole } = require('./app-roles');
const { supportsAccessFilter, accessFilter } = require('./search-access');
const { readBody, MAX_UPLOAD_BYTES } = require('./request-body');
const { request: upstreamRequest, textRequest } = require('./http-client');
const { dispatchCloudObject, writeCloudResult, validBucketName } = require('./cloud-object');
const { rewriteConsoleDocument, rewriteConsoleScript, consoleUpstreamPath } = require('./cloud-console');
const { createDrawStore } = require('./draw-store');
const path = require('node:path');
const fs = require('node:fs');
const drawStore = createDrawStore(process.env.DRAW_STORE || path.join(path.dirname(process.env.FLOW_STORE || '/tmp/blak-flow.json'), 'draw'));

const port = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const FLOW_STORE = process.env.FLOW_STORE || '';
const flowStore = flowEngine.loadStore(FLOW_STORE);
const knowledge = APPS.find((app) => app.id === 'sites');
const outline = outlineSites.createClient({
  url: process.env.OUTLINE_API_URL || 'http://sites:3000',
  token: process.env.OUTLINE_API_KEY || '',
  publicUrl: process.env.OUTLINE_PUBLIC_URL || (knowledge && knowledge.url) || '',
});
const FILE_GUARD_URL = process.env.FILE_GUARD_URL || '';
const FILE_GUARD_TOKEN = process.env.FILE_GUARD_TOKEN || '';
const SCAN_ROOT = process.env.SCAN_ROOT || '';
const fileGuardRemote = FILE_GUARD_URL && FILE_GUARD_TOKEN ? fileGuard.createRemote(FILE_GUARD_URL, FILE_GUARD_TOKEN) : null;
const fileGuardDir = process.env.FILE_GUARD_DIR || (FLOW_STORE ? path.join(path.dirname(FLOW_STORE), 'file-guard') : '');
const fileGuardStore = !fileGuardRemote && fileGuardDir ? fileGuard.openStore(fileGuardDir) : null;
if (fileGuardStore && SCAN_ROOT && process.env.CLAMAV_HOST && require.main === module) {
  fileGuard.createLoop({
    root: SCAN_ROOT,
    store: fileGuardStore,
    intervalMs: Number(process.env.SCAN_EVERY_MS || 300000),
    scanFile: (filePath, size) => fileGuard.connectScan(process.env.CLAMAV_HOST, Number(process.env.CLAMAV_PORT || 3310), filePath, size),
    version: () => fileGuard.clamdCommand(process.env.CLAMAV_HOST, Number(process.env.CLAMAV_PORT || 3310), 'VERSION'),
  }).start();
}
const backupAgent = process.env.BACKUP_AGENT_URL && process.env.BACKUP_AGENT_TOKEN ? backups.createClient(process.env.BACKUP_AGENT_URL, process.env.BACKUP_AGENT_TOKEN) : null;
async function heldRecords() {
  if (fileGuardRemote) return fileGuardRemote.list();
  return fileGuardStore ? fileGuardStore.list() : [];
}
const ownerConnectors = new Map();
function connectorsFor(owner) {
  if (!ownerConnectors.has(owner)) ownerConnectors.set(owner, flowEngine.defaultConnectors());
  return ownerConnectors.get(owner);
}
const OIDC_BASE = process.env.OIDC_BASE || 'http://id.workspace.example.com/application/o';
const AUTH_URL = process.env.OIDC_AUTH_URL || 'http://id.workspace.example.com/application/o/authorize/';
const CLIENT_ID = process.env.OIDC_CLIENT_ID || 'blak-portal';
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI || 'http://portal.workspace.example.com/callback';

const { CSS, themeScript, blakTheme, tokens } = require('./theme');

const oidc = require('./oidc').createOIDC({ issuer: process.env.OIDC_ISSUER || `${OIDC_BASE}/blak-portal/`, clientId: CLIENT_ID });
const sessions = require('./session-store').createSessionStore(process.env.SESSION_STORE || (FLOW_STORE ? path.join(path.dirname(FLOW_STORE), 'sessions.enc') : ''), process.env.SESSION_SECRET || 'dev-only-change-me');
const refreshes = new Map();
async function sessionUser(req) {
  const cookie = verifySession(req);
  const session = cookie?.sid && sessions.get(cookie.sid);
  if (!session) return null;
  if (!session.checkedAt || Date.now() - session.checkedAt > 30000) {
    if (!refreshes.has(cookie.sid)) refreshes.set(cookie.sid, (async () => {
      if (session.refreshToken && Date.now() >= session.accessExpiresAt - 30000) {
        const result = await postForm(`${OIDC_BASE}/token/`, { grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }).catch(unreachable);
        if (result.status >= 500) unreachable(new Error('Blak ID unavailable'));
        const token = JSON.parse(result.body);
        if (result.status !== 200 || !token.access_token) throw new Error('Session refresh rejected');
        if (token.id_token) await oidc.refreshedIdentity(token.id_token, session.sub);
        if (!sessions.update(cookie.sid, { accessToken: token.access_token, refreshToken: token.refresh_token || session.refreshToken, idToken: token.id_token || session.idToken, accessExpiresAt: Date.now() + Number(token.expires_in || 300) * 1000 })) throw new Error('Session revoked');
      }
      const ui = await getJson(`${OIDC_BASE}/userinfo/`, session.accessToken);
      if (ui.sub !== session.sub || ui.blak_id !== session.identity || ui.blak_active === false) throw new Error('Identity changed');
      session.apps = Array.isArray(ui.blak_apps) ? ui.blak_apps : [];
      session.roles = rolesFromClaims(ui.blak_roles);
      session.name = ui.name; session.email = ui.email; session.checkedAt = Date.now();
    })().finally(() => refreshes.delete(cookie.sid)));
    // Blak ID down (for example during a backup) denies this request but keeps the session.
    try { await refreshes.get(cookie.sid); } catch (error) { if (!error.transient) sessions.revoke(cookie.sid); return null; }
  }
  if (!sessions.get(cookie.sid)) return null;
  return { sub: session.sub, identity: session.identity, name: session.name, email: session.email, apps: session.apps, roles: session.roles, sessionId: cookie.sid };
}

const pending = new Map(); // state -> {nonce, ts}

const { sign, verifySession, COOKIE, SESSION_TTL_MS, LOGIN_TTL_MS, loginCookie, readCookie } = require('./session');
const accessGuard = require('./access-guard');
const access = require('./access-pages').createAccess({
  blakId: require('./blak-id-admin').createBlakIdAdmin({ baseUrl: process.env.BLAK_ID_API_URL || 'http://authentik-server:9000', token: process.env.BLAK_ID_API_TOKEN || '' }),
  csrf: accessGuard.createCsrf(process.env.SESSION_SECRET || 'dev-only-change-me'),
  audit: accessGuard.createAudit(process.env.ACCESS_AUDIT_FILE || (FLOW_STORE ? path.join(path.dirname(FLOW_STORE), 'access-audit.jsonl') : '')),
  origin: new URL(REDIRECT_URI).origin,
  shell: (...args) => shell(...args), esc, readBody,
  writeLimit: accessGuard.createLimiter(20, 60000),
  readLimit: accessGuard.createLimiter(120, 60000),
});
const MEILI_KEY = process.env.MEILI_MASTER_KEY || '';
const FLOCI_HOST = process.env.FLOCI_HOST || 'floci';
const FLOCI_PORT = parseInt(process.env.FLOCI_PORT || '4566', 10);
const FLOCI_UI_HOST = process.env.FLOCI_UI_HOST || 'floci-ui';
const FLOCI_UI_PORT = process.env.FLOCI_UI_PORT || '4500';
const CLOUD_PUBLIC_URL = process.env.CLOUD_PUBLIC_URL || '';
const FLOCI_KEY = process.env.FLOCI_KEY || 'test';
const FLOCI_SECRET = process.env.FLOCI_SECRET || 'test';
const FLOCI_REGION = process.env.FLOCI_REGION || 'us-east-1';
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function hmac(key, s) { return crypto.createHmac('sha256', key).update(s).digest(); }
function awsSign(service, method, path, query, extraHeaders, payloadHash) {
  const now = new Date();
  const amz = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const datestamp = amz.slice(0, 8);
  const q = Object.keys(query || {}).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
  const headers = { host: `${FLOCI_HOST}:${FLOCI_PORT}`, 'x-amz-date': amz, ...(extraHeaders || {}) };
  const signed = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const canonical = [method, path, q, ...signed.map((k) => `${k}:${String(headers[k]).trim()}`), '', signed.join(';'), payloadHash].join('\n');
  const scope = `${datestamp}/${FLOCI_REGION}/${service}/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amz, scope, sha256hex(canonical)].join('\n');
  const sk = hmac(hmac(hmac(hmac('AWS4' + FLOCI_SECRET, datestamp), FLOCI_REGION), service), 'aws4_request');
  const sig = crypto.createHmac('sha256', sk).update(sts).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${FLOCI_KEY}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${sig}`;
  return { headers, queryString: q };
}
async function proxyCloudConsole(req, res, url) {
  const upstreamPath = consoleUpstreamPath(url.pathname);
  const target = `http://${FLOCI_UI_HOST}:${FLOCI_UI_PORT}${upstreamPath}${url.search}`;
  const headers = {};
  if (req.headers.accept) headers.accept = req.headers.accept;
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await readBody(req);
  try {
    const result = await upstreamRequest(target, { method: req.method, headers, body });
    const type = String(result.headers['content-type'] || 'application/octet-stream');
    let payload = result.body;
    if (type.includes('text/html')) payload = Buffer.from(rewriteConsoleDocument(payload.toString('utf8')));
    else if (type.includes('javascript') || upstreamPath.endsWith('.js')) payload = Buffer.from(rewriteConsoleScript(payload.toString('utf8')));
    res.writeHead(result.status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(payload);
  } catch {
    res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html data-blak-app="storage"><head><title>Blak Cloud</title></head><body><main><h1>Blak Cloud is unavailable</h1><p>The cloud console could not be reached.</p></main></body></html>');
  }
}
function awsReq(service, method, path, query, body, contentType) {
  const { headers, queryString } = awsSign(service, method, path, query, contentType ? { 'content-type': contentType } : {}, 'UNSIGNED-PAYLOAD');
  return upstreamRequest(`http://${FLOCI_HOST}:${FLOCI_PORT}${path}${queryString ? '?' + queryString : ''}`, { method, headers, body });
}
function xmlTag(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  let m; while ((m = re.exec(xml)) !== null) out.push(m[1].replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (entity, name) => {
    if (name[0] === '#') return String.fromCodePoint(parseInt(name.slice(name[1] === 'x' ? 2 : 1), name[1] === 'x' ? 16 : 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name] || entity;
  }));
  return out;
}
const BRAND_BASE = process.env.BRAND_BASE || 'http://portal.workspace.example.com';
// Shared Blak brand assets (no cultural motifs; geometric wordmark only)
const { LOGO_SVG, APP_ICONS } = require('./brand');
const FLOW_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${tokens.dark['blak-950']}"/><ellipse cx="1150" cy="620" rx="420" ry="200" fill="${tokens.dark['earth-700']}" opacity="0.7"/><ellipse cx="1150" cy="700" rx="560" ry="160" fill="${tokens.dark['water-700']}" opacity="0.6"/><circle cx="1150" cy="520" r="110" fill="${tokens.dark['ochre-400']}" opacity="0.9"/><ellipse cx="300" cy="150" rx="500" ry="240" fill="${tokens.dark['blak-800']}" opacity="0.9"/></svg>`;
function svcGet(host, port, path, headers) {
  return textRequest(`http://${host}:${port}${path}`, { headers });
}
function svcPost(host, port, path, obj, headers) {
  return textRequest(`http://${host}:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(obj) });
}
function probe(c) {
  return new Promise((resolve) => {
    const lib = c.proto === 'https' ? https : http;
    const opts = { host: c.host, port: c.port, path: c.path, method: 'GET', timeout: 4000 };
    if (c.insecure) opts.rejectUnauthorized = false;
    const req = lib.request(opts, (res) => { res.resume(); resolve(((res.statusCode >= 200 && res.statusCode < 400) || [401, 403].includes(res.statusCode)) ? 'up' : 'down'); });
    req.on('timeout', () => { req.destroy(); resolve('down'); });
    req.on('error', () => resolve('down'));
    req.end();
  });
}
function postForm(url, params) {
  return textRequest(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
}
function unreachable(error) {
  throw Object.assign(error, { transient: true });
}
async function getJson(url, token) {
  const result = await textRequest(url, { headers: { authorization: `Bearer ${token}` } }).catch(unreachable);
  if (result.status >= 500) unreachable(new Error('Blak ID unavailable'));
  if (result.status !== 200) throw new Error('userinfo rejected');
  return JSON.parse(result.body);
}

function page(title, inner) {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>${esc(title)} — Blak Workspace</title><link rel="icon" href="/brand/logo.svg" type="image/svg+xml"><meta name=viewport content="width=device-width,initial-scale=1"><style>${CSS}</style><script>${themeScript}</script></head><body>${inner}<footer>Blak Workspace by Yuma IT · built with open-source software (OpenCloud, Authentik, Collabora, Outline, Floci, Meilisearch) · currently in early development</footer></body></html>`;
}
function appIcon(a, cls) {
  const f = ICON_IMG[a.id];
  if (f) return `<img class="${cls}" src="/brand/icons/${f}.svg" alt="" width="34" height="34">`;
  return `<span class="${cls} tile-ic" style="background:${ACCENT[a.id] || 'var(--text-muted)'}">${esc(a.name.replace('Blak ', '').charAt(0))}</span>`;
}
function scriptJson(value) { return JSON.stringify(value).replace(/</g, '\\u003c'); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wordmark() { return `<div class=brand><img class=brand-mark src="/brand/logo.svg?v=2" alt="" width="36" height="36"><div><b>Blak</b> <span>Workspace</span></div></div>`; }
function homeLogo() { return `<div class="home-logo"><img src="/brand/logo.svg?v=2" alt="" width="224" height="224"><strong>Blak Workspace</strong><span>by Yuma IT</span></div>`; }
function dotSun(cx, cy, r, color, opacity) {
  let s = `<g opacity="${opacity}" fill="${color}">`;
  for (let ring = 1; ring <= 4; ring++) {
    const rr = (r * ring) / 4, n = 6 + ring * 5;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      s += `<circle cx="${(cx + rr * Math.cos(a)).toFixed(1)}" cy="${(cy + rr * Math.sin(a)).toFixed(1)}" r="${(1.2 + ring * 0.5).toFixed(1)}"/>`;
    }
  }
  return s + `<circle cx="${cx}" cy="${cy}" r="${(r / 5).toFixed(1)}"/></g>`;
}
function signinPage() {
  return page('Sign in', `<div class=topbar>${wordmark()}
<div class=userchip style="margin-left:auto"><button class=iconbtn id=themebtn aria-label="Switch to light theme">☀</button></div></div>
<div class=signin><div class=formpane><div class=formbox>
<h2>Your work. Your workspace.</h2>
<p>A digital workplace with a distinct Blak identity.</p>
<p>One login for files, docs, sites and search — Blak ID, powered by Authentik.</p>
<p><a class=btn href="/login">Sign in with Blak ID</a></p>
<p style="font-size:13px">Blak Workspace by Yuma IT · currently in early development</p>
</div></div>
<div class=artpane>${homeLogo()}<div class=strap><b>Our People. Our Data.<br>A Stronger Tomorrow.</b><span>Sovereign · Open · Together</span></div></div></div>
`);
}
function navGroups(active, user) {
  const groups = ['Workspace', 'Organise', 'Platform'];
  return groups.map((g) => {
    const items = allowedApps(APPS, user).filter((a) => a.group === g);
    if (!items.length) return '';
    const links = items.map((a) => {
      const inner = `${ICON_IMG[a.id] ? `<img src="/brand/icons/${ICON_IMG[a.id]}.svg" alt="" width="24" height="24" style="border-radius:6px;flex:none">` : `<span class=ric>${RAIL_ICON[a.id] || '•'}</span>`}<span class=lbl>${esc(a.name)}</span><span class=swatch style="background:${ACCENT[a.id] || 'var(--text-muted)'}"></span>${a.status === 'soon' ? '<span class=tag>Soon</span>' : ''}`;
      return a.url
        ? `<a class=nav-item href="${launchURL(a)}" ${a.id === active ? 'data-active="true"' : ''} title="${esc(a.desc ? a.name + ': ' + a.desc : a.name)}">${inner}</a>`
        : `<span class="nav-item soon" title="${esc(a.name)} — coming soon">${inner}</span>`;
    }).join('');
    return `<div class=nav-sec>${g}</div>${links}`;
  }).join('');
}
function shell(user, active, title, main) {
  const initial = esc((user.name || user.sub || '?').trim().charAt(0).toUpperCase());
  const drawer = allowedApps(APPS, user).map((a) => {
    const inner = `${appIcon(a, 'tile-ic')}<span><span class=t>${esc(a.name)}</span><br><span class=d>${esc(a.backend || 'Coming soon')}</span></span>`;
    return a.url ? `<a class=appitem href="${launchURL(a)}" data-app="${a.id}">${inner}</a>` : `<span class="appitem soon" data-app="${a.id}">${inner}</span>`;
  }).join('');
  return page(title, `<div class=topbar>
<button class=waffle id=wbtn aria-expanded="false" aria-controls="drawer" aria-label="App launcher" data-testid="waffle"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></button>
${wordmark()}
<div class=search><input id=q aria-label="Search workspace" type=search placeholder="Search apps and workspace…" autocomplete=off onkeydown="if(event.key==='Enter'){location='/search?q='+encodeURIComponent(this.value)}"></div>
<div class=userchip data-testid="userchip"><button class=iconbtn id=themebtn aria-label="Switch to light theme">☀</button><span class=nm>${esc(user.name || user.sub)}</span><span class=avatar>${initial}</span><a href="/access/me">My access</a>${allowedApps(APPS, user).some((a) => a.id === 'idp') ? '<a href="/launch/idp">Blak ID</a>' : '<a href="/account">Blak ID</a>'}<a href="/logout">Sign out</a></div>
</div><div class=shell><nav class=sidebar>
<a class=nav-item href="/" ${active === 'home' ? 'data-active="true"' : ''} title="Blak Home"><span class=ric>⌂</span><span class=lbl>Blak Home</span><span class=swatch style="background:${ACCENT.workspace}"></span></a>
<a class=nav-item href="/intranet" ${active === 'intranet' ? 'data-active="true"' : ''} title="Intranet"><span class=ric>☰</span><span class=lbl>Intranet</span></a>
<a class=nav-item href="/held-files" ${active === 'held' ? 'data-active="true"' : ''} title="Files held back by the safety check"><span class=ric>!</span><span class=lbl>Held files</span></a>
<a class=nav-item href="/access" ${active === 'access' ? 'data-active="true" aria-current="page"' : ''} title="People and access: who can use each app"><span class=ric>⚿</span><span class=lbl>People &amp; access</span></a>
${navGroups(active, user)}
${fileGuard.isAdmin(user) ? `<a class=nav-item href="/monitoring" ${active === 'monitoring' ? 'data-active="true"' : ''} title="Host monitoring"><span class=ric>▥</span><span class=lbl>Monitoring</span></a>` : ''}
${backups.canManage(user) ? `<a class=nav-item href="/backups" ${active === 'backups' ? 'data-active="true"' : ''} title="Backups and restore"><span class=ric>↺</span><span class=lbl>Backups</span></a>` : ''}
<a class=nav-item href="/welcome" title="Getting started"><span class=ric>?</span><span class=lbl>Getting started</span></a>
<span class=sp></span><a class=nav-item href="/logout" title="Sign out"><span class=ric>⏻</span><span class=lbl>Sign out</span></a></nav>
<main>${main}</main></div>
<div class=scrim id=scrim hidden></div>
<aside class=drawer id=drawer hidden><h3>Apps</h3><p class=dsub>Every Blak app, one login via Blak ID</p><div class=applist>${drawer}</div></aside>
<div class=scrim id=palscrim hidden style="inset:0;z-index:40"></div>
<div class=drawer id=pal hidden style="left:50%;transform:translateX(-50%);top:12vh;bottom:auto;width:min(560px,92vw);border:1px solid var(--border);border-radius:12px;z-index:41;box-shadow:0 30px 80px rgba(0,0,0,.35)">
<input id=pali type=search placeholder="Type a command or search apps… (Ctrl/⌘ K)" autocomplete=off style="width:100%;padding:12px 14px;font-size:16px;background:var(--surface-raised);border:1px solid var(--border);border-radius:8px;color:var(--text-primary)">
<div id=palres style="margin-top:10px"></div></div>
<script>const b=document.getElementById('wbtn'),w=document.getElementById('drawer'),s=document.getElementById('scrim');
function tog(f){const sh=f!==undefined?f:w.hidden;w.hidden=!sh;s.hidden=!sh;b.setAttribute('aria-expanded',String(sh));}b.onclick=()=>tog();s.onclick=()=>tog(false);
const pal=document.getElementById('pal'),pscrim=document.getElementById('palscrim'),pi=document.getElementById('pali'),pres=document.getElementById('palres');
const ITEMS=${JSON.stringify(allowedApps(APPS, user).filter((a) => a.url).map((a) => ({ t: a.name, d: a.desc, u: launchURL(a) })).concat([{ t: 'Held files', d: 'Files held back because they looked unsafe', u: '/held-files' }, { t: 'People & access', d: 'What roles do and who has them', u: '/access' }, { t: 'My access', d: 'Your apps, roles and where they come from', u: '/access/me' }, ...(fileGuard.isAdmin(user) ? [{ t: 'Monitoring', d: 'Host CPU and memory', u: '/monitoring' }] : []), ...(backups.canManage(user) ? [{ t: 'Backups', d: 'Back up or restore the whole workspace', u: '/backups' }] : []), { t: 'Getting started', d: 'Learn your workspace', u: '/welcome' }, { t: 'Sign out', d: 'End your Blak session', u: '/logout' }]))};
let sel=0,shown=[];
function ptog(f){const sh=f!==undefined?f:pal.hidden;pal.hidden=!sh;pscrim.hidden=!sh;if(sh){pi.value='';prender('');pi.focus();}}
function prender(t){shown=ITEMS.filter(i=>(i.t+' '+i.d).toLowerCase().includes(t.toLowerCase())).slice(0,8);sel=0;
pres.innerHTML=shown.map((i,x)=>'<a href="'+i.u+'" data-x="'+x+'" style="display:block;padding:10px 12px;border-radius:8px;text-decoration:none;color:var(--text-primary);'+(x===0?'background:var(--surface-hover);':'')+'"><b>'+i.t+'</b><br><span style="font-size:12px;color:var(--text-secondary)">'+i.d+'</span></a>').join('')||'<p style="color:var(--text-secondary)">No matches.</p>';}
pi.addEventListener('input',()=>prender(pi.value));
pi.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();sel=Math.min(sel+1,shown.length-1);}else if(e.key==='ArrowUp'){e.preventDefault();sel=Math.max(sel-1,0);}else if(e.key==='Enter'){const a=pres.querySelector('[data-x="'+sel+'"]');if(a){location=a.href;}return;}else return;
pres.querySelectorAll('[data-x]').forEach(a=>{a.style.background=a.dataset.x==sel?'var(--surface-hover)':'';});});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();ptog();}if(e.key==='Escape'){ptog(false);tog(false);}});
pscrim.onclick=()=>ptog(false);</script>`);
}
function flowTabs(active, user) {
  const tabs = [
    ['/flow', 'My flows', 'list'],
    ['/flow/new', 'Create', 'new'],
    ['/flow/activity', 'Activity', 'activity'],
  ];
  return `<nav class=flowtabs data-testid="flow-tabs">${tabs.filter(([, , id]) => id !== 'new' || can(user, 'flow', 'writer')).map(([href, label, id]) => `<a href="${href}" data-active="${id === active}">${label}</a>`).join('')}</nav>`;
}
function persistFlow() {
  flowEngine.saveStore(flowStore, FLOW_STORE);
}
function representativeEvent(flow) {
  if (flow.starter.type === 'schedule') {
    return { type: 'schedule', name: flow.starter.name || 'manual', payload: { content: 'scheduled run', path: '/flows/schedule.txt' } };
  }
  return {
    type: 'event',
    name: flow.starter.name,
    payload: { path: '/inbox/brief.txt', content: 'hello from trigger' },
  };
}
function flowListPage(user) {
  const flows = flowEngine.listFlows(flowStore, user.sub);
  const rows = flows.map((f) => `<tr data-testid="flow-row">
<td><a href="/flow/${esc(f.id)}">${esc(f.name)}</a></td>
<td>${esc(f.starter.type)} · ${esc(f.starter.name)}</td>
<td>${f.steps.length} steps</td>
<td>${f.enabled ? 'On' : 'Off'}</td>
<td>${can(user, 'flow', 'writer') ? `
<form method=post action="/flow/${esc(f.id)}/enable" style="display:inline">${f.enabled ? '' : '<button class=btn-sec type=submit>Enable</button>'}</form>
<form method=post action="/flow/${esc(f.id)}/disable" style="display:inline">${f.enabled ? '<button class=btn-sec type=submit>Disable</button>' : ''}</form>
<form method=post action="/flow/${esc(f.id)}/run" style="display:inline">${f.enabled ? '<button class=btn type=submit data-testid="run-flow">Run</button>' : ''}</form>` : 'Read only'}
</td></tr>`).join('');
  const body = flows.length
    ? `<table class=flowtable data-testid="flow-list"><thead><tr><th>Name</th><th>Starter</th><th>Steps</th><th>State</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class=empty data-testid="flow-empty"><p><b>No flows yet.</b></p>${can(user, 'flow', 'writer') ? `<p>Create a flow with a starter and Drive + Sites steps.</p><p><a class=btn href="/flow/new">Create a flow</a></p>` : '<p>Read-only access. No saved flows to view.</p>'}</div>`;
  return shell(user, 'flow', 'Blak Flow', `<div class=greet>Blak Flow</div>
<p class=gsub>Build and test automations with ordered steps and run history. Drive and Sites connectors currently use isolated demo data; they do not change your live apps.</p>
${flowTabs('list', user)}${body}`);
}
function flowNewPage(user, err) {
  return shell(user, 'flow', 'Create a flow', `<div class=greet>Create a flow</div>
<p class=gsub>Pick a starter, then Drive and Sites steps in order. Same pattern as Power Automate My flows → Create.</p>
${flowTabs('new', user)}
${err ? `<p class=gsub style="color:var(--danger)">${esc(err)}</p>` : ''}
<form class=builder method=post action=/flow data-testid="flow-builder">
<label>Name <input name=name required minlength=2 placeholder="File to Sites"></label>
<label>Starter type
<select name=starterType><option value=event>When an event happens</option><option value=schedule>On a schedule / manual</option></select></label>
<label>Starter name <input name=starterName value="drive.file_created" required></label>
<div class=stepbox><b>Step 1 — Drive</b>
<label>Action <select name=step1Action><option value=write_file>Write file</option><option value=read_file>Read file</option><option value=list_files>List files</option></select></label>
<label>Path <input name=step1Path value="/flows/brief.txt"></label></div>
<div class=stepbox><b>Step 2 — Sites</b>
<label>Action <select name=step2Action><option value=create_page>Create page</option><option value=list_pages>List pages</option></select></label>
<label>Title <input name=step2Title value="Brief from Drive"></label></div>
<button class=btn type=submit data-testid="save-flow">Save flow</button>
</form>`);
}
function flowActivityPage(user, flowId) {
  const runs = flowEngine.listRuns(flowStore, flowId || undefined).filter((r) => r.owner === user.sub);
  const rows = runs.map((r) => `<tr data-testid="run-row">
<td>${esc(r.startedAt)}</td>
<td><a href="/flow/${esc(r.flowId)}">${esc(r.flowName)}</a></td>
<td>${esc(r.status)}</td>
<td>${r.steps.map((s) => `${esc(s.connector)}.${esc(s.action)}: ${s.outcome && s.outcome.ok ? 'ok' : esc((s.outcome && s.outcome.error) || 'error')}`).join('<br>')}</td>
</tr>`).join('');
  const body = runs.length
    ? `<table class=flowtable data-testid="flow-activity"><thead><tr><th>When</th><th>Flow</th><th>Status</th><th>Steps</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class=empty data-testid="flow-activity-empty"><p>No runs yet. Enable a flow and press Run.</p></div>`;
  return shell(user, 'flow', 'Flow activity', `<div class=greet>Activity</div>
<p class=gsub>Run history for your flows.</p>
${flowTabs('activity', user)}${body}`);
}
async function homePage(user) {
  const live = allowedApps(APPS, user);
  const held = fileGuard.visibleHeld(await heldRecords().catch(() => []), user);
  const cards = live.map((a) => `<div class=card data-app="${a.id}" data-name="${esc((a.name + ' ' + a.desc).toLowerCase())}">
<div class=apphead>${appIcon(a, 'tile-ic')}<span class=dot data-dot="${a.id}"> </span></div>
<h3>${esc(a.name)}</h3><p>${esc(a.desc)}</p><p class=be>${esc(a.backend)}</p>
<a href="${launchURL(a)}">Open →</a></div>`).join('');
  return shell(user, 'home', 'Home', `<section class=hero aria-label="Blak Workspace">${homeLogo()}<div class=cap><b>Your work. Your workspace.</b><p>Our People. Our Data. A Stronger Tomorrow.</p><span>Sovereign · Open · Together</span></div></section>
<div class=greet id=greet>Welcome</div><p class=gsub>Blak Workspace · sovereign micro cloud</p>
<p class=guide-prompt>New here? <a href="/welcome">Start with the workspace guide</a>.</p>
${fileGuard.homeFragment(held)}
${outlineSites.homeFragment(await outline.listCollections().catch(() => []), outline.publicUrl)}
<h3 class=sec>Apps</h3><div class=grid id=tiles>${cards}</div>
${live.some(a=>a.id==='drive') ? `<h3 class=sec>Recent documents</h3><div class=empty><svg width="120" height="60" viewBox="0 0 120 60" aria-hidden="true">${dotSun(60, 30, 26, '#21818A', '.55')}</svg><p><b>Nothing here yet.</b></p><p>Open Blak Drive to start working — recent files will appear here.</p><p><a class=btn href="/launch/drive">Open Blak Drive</a></p></div>` : ''}
<h3 class=sec>Announcements</h3><div class=statusrow><span class=pill>Welcome to Blak Workspace — currently in early development.</span></div>
<h3 class=sec>System status</h3><div class=statusrow id=pills><span class=pill>checking…</span></div>
${fileGuard.isAdmin(user) ? '<p><a href="/monitoring">View host CPU and memory</a></p>' : ''}
<script>
const hr=new Date().getHours();
document.getElementById('greet').textContent=(hr<12?'Good morning':hr<18?'Good afternoon':'Good evening')+', '+${scriptJson(user.name || user.sub)};
const qi=document.querySelector('.search input');
if(qi){qi.addEventListener('input',()=>{const t=qi.value.toLowerCase();document.querySelectorAll('#tiles .card').forEach(c=>{c.style.display=c.dataset.name.includes(t)?'':'none';});});}
fetch('/api/status').then(r=>r.json()).then(j=>{const pills=document.getElementById('pills');pills.innerHTML='';
for(const[id,st]of Object.entries(j.status)){const d=document.querySelector('[data-dot="'+id+'"]');if(d){d.style.background=st==='up'?'var(--success)':'var(--danger)';}
const p=document.createElement('span');p.className='pill';p.textContent=id+': '+st;if(st==='up'){p.style.borderColor='var(--success)';}pills.appendChild(p);}}).catch(()=>{});
</script>`);
}
async function searchPage(user, q) {
  let body = '<p class=gsub>Search your connected files, knowledge, conversations and tasks. Content refreshes every five minutes.</p>';
  const filter = accessFilter(user);
  if (q && !filter) {
    body = '<p role=status>No permitted content sources. Ask your administrator for access to the app you want to search.</p>';
  } else if (q) {
    try {
      const headers = MEILI_KEY ? { authorization: `Bearer ${MEILI_KEY}` } : {};
      const settings = await svcGet(process.env.MEILI_HOST || 'meilisearch', 7700, '/indexes/workspace/settings/filterable-attributes', headers);
      if (settings.status === 404) {
        body = '<p role=status>Your search index is being prepared. Check <a href="/sync">connection status</a> and try again after the next sync.</p>';
      } else {
        const fields = JSON.parse(settings.body);
        if (settings.status !== 200 || !supportsAccessFilter(fields) || !fields.includes('expiresAt')) throw new Error('Search access filters unavailable');
        const result = await svcPost(process.env.MEILI_HOST || 'meilisearch', 7700, '/indexes/workspace/search', {
          q: q.slice(0, 500), limit: 30, filter: `(${filter}) AND expiresAt > ${Math.floor(Date.now() / 1000)}`,
          attributesToRetrieve: ['title', 'content', 'url', 'source'],
        }, MEILI_KEY ? { authorization: `Bearer ${MEILI_KEY}` } : {});
        if (result.status !== 200) throw new Error('Search request failed');
        const hits = JSON.parse(result.body).hits || [];
        const rows = hits.map(hit => {
          let url = '';
          try { const parsed = new URL(hit.url); if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.href; } catch {}
          const title = esc(hit.title || 'Untitled');
          return `<li><span class=source>${esc(hit.source)}</span><h2>${url ? `<a href="${esc(url)}">${title}</a>` : title}</h2><p>${esc(String(hit.content || '').slice(0, 350))}</p></li>`;
        }).join('');
        body = hits.length ? `<p role=status>${hits.length} result${hits.length === 1 ? '' : 's'} for “${esc(q)}”</p><ul class=search-results>${rows}</ul>` : `<p role=status>No matches for “${esc(q)}”. Try another word or check <a href="/sync">connection status</a>.</p>`;
      }
    } catch {
      body = '<p role=alert>Search is temporarily unavailable. Check <a href="/sync">connection status</a> and try again.</p>';
    }
  }
  return shell(user, 'search', 'Blak Search', `<h1>Blak Search</h1><p class=gsub>Find content connected to your account.</p>
<form method=get action=/search><div class=search style="margin:0 0 18px;max-width:640px"><input name=q type=search aria-label="Search connected content" placeholder="Search files, knowledge and tasks…" value="${esc(q || '')}" autocomplete=off><button class=btn type=submit>Search</button></div></form>${body}`);
}
async function s3Buckets() {
  const r = await awsReq('s3', 'GET', '/', {}, null, null);
  if (r.status !== 200) throw new Error('S3 status ' + r.status);
  return xmlTag(r.body.toString(), 'Name');
}
async function sqsAction(params) {
  const form = new URLSearchParams({ Version: '2012-11-05', ...params }).toString();
  const sig = awsSign('sqs', 'POST', '/', {}, { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, sha256hex(form));
  return textRequest(`http://${FLOCI_HOST}:${FLOCI_PORT}/`, { method: 'POST', headers: sig.headers, body: form });
}
async function cloudPage(user, bucket, prefix, msg) {
  const writable = can(user, 'storage', 'writer');
  let body = '';
  try {
    const buckets = await s3Buckets();
    const opts = buckets.map((b) => `<option value="${esc(b)}"${b === bucket ? ' selected' : ''}>${esc(b)}</option>`).join('');
    let listing = '';
    if (bucket) {
      const q = { 'list-type': '2', prefix: prefix || '' };
      const r = await awsReq('s3', 'GET', '/' + bucket, q, null, null);
      if (r.status !== 200) throw new Error('list status ' + r.status);
      const keys = xmlTag(r.body.toString(), 'Key');
      listing = keys.length
        ? `<div class=statusrow>${keys.slice(0, 50).map((k) => `<span class=pill><a href="/cloud/object?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(k)}">⬇ ${esc(k)}</a> ${writable ? `<button type=button class=iconbtn data-delete-object="${esc(k)}" aria-label="Delete ${esc(k)}" style="color:var(--danger)">✕</button>` : ''}</span>`).join('')}</div>`
        : `<p class=gsub>No objects in this bucket yet.</p>`;
    }
    let queues = '';
    try {
      const qr = await sqsAction({ Action: 'ListQueues' });
      const urls = xmlTag(qr.body, 'QueueUrl');
      const qforms = urls.slice(0, 10).map((u) => writable ? `<form method=post action=/cloud/send style="margin:6px 0"><input type=hidden name=url value="${esc(u)}"><input name=body aria-label="Message body" required placeholder="Message to ${esc(u.split('/').pop())}…" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;min-width:280px"> <button class=btn-sec type=submit>Send</button></form>` : `<p>${esc(u.split('/').pop())}</p>`).join('');
      queues = `<h3 class=sec>Queues</h3>` + (urls.length ? qforms : `<p class=gsub>No queues yet.</p>`)
        + (writable ? `<form method=post action=/cloud/queue style="margin:6px 0"><input aria-label="New queue name" name=name required minlength=1 placeholder="New queue name…" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px"> <button class=btn-sec type=submit>Create queue</button></form>` : '');
    } catch (e) { queues = `<p class=gsub>Queues unavailable (${esc(e.message)}).</p>`; }
    body = `${msg ? `<p class=gsub>${esc(msg)}</p>` : ''}
<h3 class=sec>Object storage (S3)</h3>
<form method=get action=/cloud><div class=search style="margin:0 0 12px;max-width:640px"><select aria-label="Bucket" name=bucket onchange="this.form.submit()"><option value="">Choose a bucket…</option>${opts}</select>
<input aria-label="Prefix filter" name=prefix type=search placeholder="Prefix filter…" value="${esc(prefix || '')}" autocomplete=off></div></form>
${listing}
${writable ? `<form method=post action=/cloud/bucket style="margin:12px 0"><input aria-label="New bucket name" name=name required minlength=3 placeholder="New bucket name…" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px"> <button class=btn-sec type=submit style="padding:9px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surface-raised);cursor:pointer">Create bucket</button></form>` : '<p>Read-only access</p>'}
${bucket && writable ? `<h3 class=sec>Upload to ${esc(bucket)}</h3><input type=file id=upfile aria-label="File to upload"><button class=btn-sec id=upbtn style="padding:9px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surface-raised);cursor:pointer">Upload</button><p class=gsub id=upmsg></p>
<script>document.getElementById('upbtn').onclick=async()=>{const f=document.getElementById('upfile').files[0];if(!f)return;const m=document.getElementById('upmsg');m.textContent='Uploading…';
try{const r=await fetch('/cloud/object?bucket='+encodeURIComponent(${scriptJson(bucket)})+'&key='+encodeURIComponent(f.name),{method:'PUT',body:f});m.textContent=r.ok?'Uploaded. Reload to see it.':'Upload failed ('+r.status+')';}catch{m.textContent='Upload failed. Please retry.';}};
document.querySelectorAll('[data-delete-object]').forEach(button=>button.onclick=async()=>{const m=document.getElementById('upmsg');try{const response=await fetch('/cloud/object?bucket='+encodeURIComponent(${scriptJson(bucket)})+'&key='+encodeURIComponent(button.dataset.deleteObject),{method:'DELETE'});if(response.ok)location.reload();else m.textContent='Delete failed ('+response.status+')';}catch{m.textContent='Delete failed. Please retry.';}});</script>` : ''}
${queues}`;
  } catch (e) { body = `<p class=gsub>Blak Cloud is unavailable right now (${esc(e.message)}).</p>`; }
  return shell(user, 'storage', 'Blak Cloud', `<div class=greet>Blak Cloud</div>
<p class=gsub>Store files and send queue messages for your workspace automations.</p>${body}`);
}

const handleBackups = backups.createRoutes({ agent: backupAgent, shell });
async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://x');
  const user = await sessionUser(req);
  res.setHeader('cache-control', 'no-store');
  const requiredApp = routeApp(url.pathname);
  if (user && requiredApp && !allowedApps(APPS, user).some(a => a.id === requiredApp)) { res.writeHead(403); res.end('Application access not granted'); return; }
  const permission = requiredRole(requiredApp, req.method, url.pathname);
  if (user && permission && !can(user, requiredApp, permission)) {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: permission === 'reader' ? 'Application role required' : 'Writer role required' }));
    return;
  }
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.headers.origin && req.headers.origin !== new URL(REDIRECT_URI).origin) {
    res.writeHead(403); res.end('Cross-origin request rejected'); return;
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'blak-portal', version: '0.3.0' }));
    return;
  }
  if (url.pathname.startsWith('/api/knowledge-export/')) {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    try {
      if (req.method !== 'GET') throw Object.assign(new Error('Read only'), { status: 405 });
      const exporter = require('./knowledge-export');
      const owner = exporter.exportOwner(req.headers.authorization, process.env.KNOWLEDGE_EXPORT_ACCOUNTS);
      res.end(JSON.stringify({ owner, documents: exporter.documents(url.pathname.slice('/api/knowledge-export/'.length), owner, drawStore, flowStore) }));
    } catch (error) { res.writeHead(error.status || 503); res.end(JSON.stringify({ error: 'Knowledge export unavailable' })); }
    return;
  }
  if (await access.handle(req, res, url, user)) return;
  if (url.pathname === '/account') {
    res.writeHead(302, { location: user ? new URL('/if/user/#/settings', OIDC_BASE).href : '/login' }); res.end(); return;
  }
  if (url.pathname === '/welcome') {
    if (!user) {res.writeHead(302,{location:'/login'});res.end();return;}
    res.setHeader('content-type','text/html; charset=utf-8');
    res.end(shell(user,'home','Getting started',require('./welcome').welcomePage(allowedApps(APPS, user).map(a => ({ ...a, url: launchURL(a) })))));return;
  }
  if (await handleBackups(req, res, url, user)) return;
  if (url.pathname === '/monitoring' || url.pathname === '/api/monitoring') {
    if (!user) { res.writeHead(401); res.end('Sign in required'); return; }
    if (!fileGuard.isAdmin(user)) { res.writeHead(403); res.end('Workspace admin required'); return; }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (url.pathname === '/api/monitoring') {
      try {
        const hosts = await require('./host-monitor').listHosts();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ hosts }));
      } catch {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Host metrics unavailable' }));
      }
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(shell(user, 'monitoring', 'Monitoring', `<h1>Monitoring</h1>
<p class=gsub>CPU and memory on every Kubernetes host running this workspace. Updates every 15 seconds.</p>
<p id=monitor-message role=status>Loading host metrics…</p><div class=grid id=hosts></div>
<script>
async function refreshHosts(){const message=document.getElementById('monitor-message'),grid=document.getElementById('hosts');
try{const response=await fetch('/api/monitoring');if(!response.ok)throw Error('Unavailable');const data=await response.json();
grid.replaceChildren();message.textContent=data.hosts.length?'Host readings updated.':'No Kubernetes hosts found.';
for(const host of data.hosts){const card=document.createElement('section');card.className='card';const heading=document.createElement('h2');heading.textContent=host.name;card.append(heading);
const state=document.createElement('p');state.textContent=host.ready?'Ready':'Not ready';card.append(state);
for(const [label,reading,unit] of [['CPU',host.cpu,'cores'],['Memory',host.memory,'GiB']]){const p=document.createElement('p');
if(!reading){p.textContent=label+': reading unavailable';}else{const scale=unit==='GiB'?1073741824:1;
p.textContent=label+': '+(reading.used/scale).toFixed(2)+' / '+(reading.capacity/scale).toFixed(2)+' '+unit+' ('+(100*reading.used/reading.capacity).toFixed(1)+'%)';
const bar=document.createElement('progress');bar.max=reading.capacity;bar.value=Math.min(reading.used,reading.capacity);bar.setAttribute('aria-label',host.name+' '+label+' usage');p.append(document.createElement('br'),bar);}
card.append(p);}
if(host.measuredAt){const at=document.createElement('small');at.textContent='Measured '+new Date(host.measuredAt).toLocaleString();card.append(at);}grid.append(card);}
}catch{message.textContent='Host metrics unavailable. Try again soon.';grid.replaceChildren();}}
refreshHosts();setInterval(refreshHosts,15000);
</script>`));
    return;
  }
  if (url.pathname === '/api/sync-health' || url.pathname === '/sync') {
    res.setHeader('cache-control','no-store');
    if (!user) { res.writeHead(401); res.end('Sign in required'); return; }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const health = require('./sync-health').healthFor(user.sub, process.env.SYNC_HEALTH_FILE);
    if (url.pathname === '/api/sync-health') { res.setHeader('content-type','application/json'); res.end(JSON.stringify(health)); return; }
    const rows = health.sources.map(source => `<tr><th scope="row">${esc(source.label)}</th><td>${esc(source.status)}</td><td>${source.last_success ? esc(new Date(source.last_success*1000).toISOString().replace('T',' ').slice(0,19))+' UTC' : 'Not yet synced'}</td><td>${source.documents}</td><td>${source.expires_at ? esc(new Date(source.expires_at*1000).toISOString().slice(0,10)) : 'Not reported by source'}</td></tr>`).join('');
    const warning = !health.enrolled ? health.message : health.healthy ? 'Your connected sources are up to date.' : 'Some sources need attention. Answers may omit unavailable or outdated content.';
    res.setHeader('content-type','text/html; charset=utf-8');
    res.end(shell(user,'hermes','Hermes sync status',`<h1>Hermes sync status</h1><p role="status">${esc(warning)}</p><p>Private to your account. Sync runs every five minutes. More than 15 minutes without success is marked stale.</p><div style="overflow-x:auto"><table><caption>Connected sources</caption><thead><tr><th>Source</th><th>Status</th><th>Last success</th><th>Documents</th><th>Credential expiry</th></tr></thead><tbody>${rows}</tbody></table></div><h2>Connect or repair a source</h2><p>Ask your workspace administrator to enrol credentials belonging to your account. Never send passwords or API keys through chat. Revoked credentials need renewal; expiry dates are shown where supplied.</p><p><a href="/launch/hermes">Open Hermes</a> and select <strong>Blak Workspace</strong> to use your connected sources.</p>`)); return;
  }
  if (url.pathname === '/api/draw' || url.pathname.startsWith('/api/draw/')) {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    if (!user) { res.writeHead(401); res.end(JSON.stringify({error:'Sign in required'})); return; }
    try {
      const id = url.pathname.slice('/api/draw/'.length);
      let result;
      if (req.method === 'GET') result = id ? drawStore.read(user.sub,id) : drawStore.list(user.sub);
      else {
        let body;
        try { body=JSON.parse((await readBody(req, MAX_UPLOAD_BYTES)).toString()); } catch(e) { if(e.status)throw e; throw Object.assign(new Error('Invalid JSON'),{status:400}); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Expected a JSON object'),{status:400});
        if (req.method === 'POST' && !id) result=drawStore.create(user.sub,body.name);
        else if (req.method === 'PUT' && id) result=drawStore.save(user.sub,id,body);
        else if (req.method === 'DELETE' && id) result=drawStore.remove(user.sub,id,body.revision);
        else throw Object.assign(new Error('Method not allowed'),{status:405});
      }
      res.end(JSON.stringify(result));
    } catch(e) { res.writeHead(e.status||500); res.end(JSON.stringify({error:e.status?e.message:'Drawing could not be saved'})); }
    return;
  }
  if (url.pathname === '/draw' || url.pathname.startsWith('/draw/')) {
    if (!user) { res.writeHead(302,{location:'/login'}); res.end(); return; }
    const root=path.join(__dirname,'draw-dist');
    const target=path.resolve(root, url.pathname.replace(/^\/draw\/?/,'') || 'index.html');
    if(!target.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
    try {
      const body=fs.readFileSync(target);
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'}[path.extname(target)]||'application/octet-stream';
      res.writeHead(200,{'content-type':mime,'cache-control':'private, no-cache','x-content-type-options':'nosniff'});res.end(body);
    } catch {res.writeHead(404);res.end('Not found');}
    return;
  }
  if (url.pathname === '/api/me') {
    if (!user) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthenticated"}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sub: user.sub, name: user.name, email: user.email, identity: user.identity, apps: user.apps, roles: rolesFromClaims(user.roles) }));
    return;
  }
  if (url.pathname === '/api/modules' || url.pathname === '/api/status') {
    const origin = req.headers.origin;
    if (origin) {
      const origins = new Set(APPS.filter(a => a.url).map(a => new URL(a.url, REDIRECT_URI).origin));
      origins.add(new URL(REDIRECT_URI).origin);
      if (!origins.has(origin)) { res.writeHead(403); res.end(); return; }
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('vary', 'Origin');
    }
    if (!user) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthenticated"}'); return; }
    if (url.pathname === '/api/modules') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ modules: allowedApps(APPS, user).map((a) => ({ id: a.id, name: a.name, backend: a.backend, url: new URL(launchURL(a), REDIRECT_URI).href, status: a.status, oidcClient: a.oidcClient, enabled: a.status === 'live' })) }));
      return;
    }
    const checks = await Promise.all(allowedApps(APPS, user).map(async (a) => ({ id: a.id, status: a.check ? await probe(a.check) : a.status === 'live' ? 'up' : a.status })));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: Object.fromEntries(checks.map((c) => [c.id, c.status])) }));
    return;
  }
  if (url.pathname.startsWith('/launch/')) {
    const app = APPS.find(a => a.id === url.pathname.slice('/launch/'.length));
    if (!app) { res.writeHead(404); res.end(); return; }
    if (!user) { res.writeHead(302, { location: '/login?app=' + encodeURIComponent(app.id) }); res.end(); return; }
    if (!allowedApps(APPS, user).includes(app)) { res.writeHead(403); res.end('Application access not granted'); return; }
    const integration = INTEGRATIONS[app.id] || {};
    const target = new URL(integration.login || app.url, new URL(app.url, REDIRECT_URI));
    // HeyForm accepts a device identifier, then creates and verifies its own
    // OAuth state, nonce and PKCE transaction in the native server.
    if (integration.loginStateParameter) target.searchParams.set(integration.loginStateParameter, crypto.randomBytes(16).toString('hex'));
    res.writeHead(302, { location: target.href }); res.end(); return;
  }
  if (url.pathname === '/oidc/backchannel-logout') {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const body = new URLSearchParams((await readBody(req, 16384)).toString());
      const claims = await oidc.logout(body.get('logout_token'));
      sessions.revokeIdentity(claims);
      res.writeHead(200); res.end();
    } catch { res.writeHead(400); res.end('Invalid logout request'); }
    return;
  }
  if (url.pathname === '/login') {
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    for (const [key, value] of pending) if (Date.now() - value.ts >= LOGIN_TTL_MS) pending.delete(key);
    const verifier = crypto.randomBytes(32).toString('base64url');
    const requestedApp = url.searchParams.get('app');
    const returnTo = APPS.some(a => a.id === requestedApp) ? '/launch/' + requestedApp : '/';
    pending.set(state, { nonce, verifier, returnTo, ts: Date.now() });
    const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', scope: 'openid profile email offline_access', redirect_uri: REDIRECT_URI, state, nonce, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') });
    res.writeHead(302, { location: `${AUTH_URL}?${q}`, 'set-cookie': loginCookie(state, REDIRECT_URI) });
    res.end();
    return;
  }
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const p = pending.get(state);
    const browserState = readCookie(req, 'blak_login');
    pending.delete(state);
    if (!code || !p || browserState !== state || Date.now() - p.ts >= LOGIN_TTL_MS) { res.writeHead(400, { 'content-type': 'text/plain' }); res.end('bad login state'); return; }
    try {
      const tok = await postForm(`${OIDC_BASE}/token/`, { grant_type: 'authorization_code', code, code_verifier: p.verifier, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
      const tj = JSON.parse(tok.body);
      if (tok.status !== 200 || !tj.access_token) throw new Error('token exchange rejected');
      const identity = await oidc.identity(tj.id_token, p.nonce);
      const ui = await getJson(`${OIDC_BASE}/userinfo/`, tj.access_token);
      if (!ui.sub || ui.sub !== identity.sub || typeof ui.blak_id !== 'string' || ui.blak_active === false) throw new Error('invalid identity');
      const exp = Date.now() + SESSION_TTL_MS;
      const sid = sessions.create({ sub: ui.sub, identity: ui.blak_id, name: ui.name, email: ui.email, apps: Array.isArray(ui.blak_apps) ? ui.blak_apps : [], roles: rolesFromClaims(ui.blak_roles), exp, oidcSid: identity.sid, accessToken: tj.access_token, refreshToken: tj.refresh_token, accessExpiresAt: Date.now() + Number(tj.expires_in || 300) * 1000, idToken: tj.id_token, checkedAt: Date.now() });
      const sess = sign({ sub: ui.sub, sid, exp });
      res.writeHead(302, { location: p.returnTo, 'set-cookie': [`${COOKIE}=${sess}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${REDIRECT_URI.startsWith('https:') ? '; Secure' : ''}`, loginCookie('', REDIRECT_URI)] });
      res.end();
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Sign-in failed. Please try again.');
    }
    return;
  }
  if (url.pathname === '/logout') {
    const session = user && sessions.get(user.sessionId);
    if (user) sessions.revoke(user.sessionId);
    const config = await oidc.discovery();
    const end = new URL(config.end_session_endpoint);
    end.searchParams.set('client_id', CLIENT_ID);
    end.searchParams.set('post_logout_redirect_uri', new URL('/', REDIRECT_URI).href);
    if (session?.idToken) end.searchParams.set('id_token_hint', session.idToken);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${REDIRECT_URI.startsWith('https:') ? '; Secure' : ''}` });
    res.end(page('Sign out', require('./logout-page').logoutPage(APPS, end.href)));
    return;
  }
  if (url.pathname === '/brand/logout.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'x-content-type-options': 'nosniff' });
    res.end(fs.readFileSync(path.join(__dirname, 'logout.js'))); return;
  }
  if (url.pathname === '/brand/login-background.png') {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
    res.end(fs.readFileSync(path.join(__dirname, 'login-background.png')));
    return;
  }
  if (url.pathname === '/brand/banner.png' || url.pathname === '/brand/home-logo.jpg') {
    try {
      const isLogo = url.pathname === '/brand/home-logo.jpg';
      const img = fs.readFileSync(path.join(__dirname, isLogo ? 'brand-home-logo.jpg' : 'brand-banner.png'));
      res.writeHead(200, { 'content-type': isLogo ? 'image/jpeg' : 'image/png', 'cache-control': 'public, max-age=86400' });
      res.end(img);
    } catch (e) { res.writeHead(404); res.end(); }
    return;
  }
  if (url.pathname.startsWith('/brand/icons/')) {
    const f = url.pathname.split('/').pop();
    if (f?.endsWith('.svg') && APP_ICONS[f.slice(0,-4)]) { res.writeHead(200, {'content-type':'image/svg+xml','cache-control':'public, max-age=86400'});res.end(APP_ICONS[f.slice(0,-4)]);return; }
    if (!/^[a-z]+\.png$/.test(f || '')) { res.writeHead(400); res.end(); return; }
    try {
      const fs = require('fs');
      const img = fs.readFileSync(__dirname + '/brand-icons/' + f);
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      res.end(img);
    } catch (e) { res.writeHead(404); res.end(); }
    return;
  }
  if (url.pathname === '/brand/logo.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
    res.end(LOGO_SVG);
    return;
  }
  if (url.pathname === '/_blak/fonts/InterVariable.woff2') {
    res.writeHead(200, {'content-type':'font/woff2','cache-control':'public, max-age=86400'});
    res.end(fs.readFileSync(path.join(__dirname,'fonts','InterVariable.woff2'))); return;
  }
  if (url.pathname === '/brand/flow-bg.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
    res.end(FLOW_BG_SVG);
    return;
  }
  if (url.pathname === '/blak-theme/theme.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' });
    res.end(JSON.stringify(blakTheme(`${BRAND_BASE}/brand/logo.svg`)));
    return;
  }
  if (url.pathname === '/search') {
    if (!user) { res.writeHead(302, { location: '/login' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await searchPage(user, url.searchParams.get('q') || ''));
    return;
  }
  if (url.pathname === '/api/cloud-access') {
    if (!user || !can(user, 'storage', 'reader')) { res.writeHead(401); res.end(); return; }
    res.writeHead(204); res.end(); return;
  }
  if ((url.pathname === '/cloud' || url.pathname === '/cloud/') && CLOUD_PUBLIC_URL) {
    if (!user) { res.writeHead(302, { location: '/login' }); res.end(); return; }
    res.writeHead(302, { location: CLOUD_PUBLIC_URL }); res.end(); return;
  }
  if (consoleUpstreamPath(url.pathname)) {
    if (!user) { res.writeHead(302, { location: '/login' }); res.end(); return; }
    await proxyCloudConsole(req, res, url);
    return;
  }
  if (url.pathname === '/cloud/object') {
    if (!user) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthenticated"}'); return; }
    const bucket = url.searchParams.get('bucket') || '';
    const key = url.searchParams.get('key') || '';
    const s3Req = (method, path, body) => awsReq('s3', method, path, {}, body, body ? 'application/octet-stream' : null);
    const body = req.method === 'PUT' ? await readBody(req, MAX_UPLOAD_BYTES) : null;
    try {
      writeCloudResult(res, await dispatchCloudObject(s3Req, { method: req.method, bucket, key, body }));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  if (url.pathname === '/cloud/bucket' && req.method === 'POST') {
    if (!user) { res.writeHead(401); res.end(); return; }
    const data = (await readBody(req)).toString('utf8');
      const name = (new URLSearchParams(data).get('name') || '').trim().toLowerCase();
      if (!validBucketName(name)) {
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent('Invalid bucket name (3-63 chars, lowercase, dots and dashes).') });
        res.end();
        return;
      }
      try {
        const result = await awsReq('s3', 'PUT', `/${name}`, {}, null, null);
        if (result.status < 200 || result.status >= 300) throw new Error('storage returned ' + result.status);
        res.writeHead(302, { location: '/cloud?bucket=' + encodeURIComponent(name) });
      } catch (e) {
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent('Create failed: ' + e.message) });
      }
      res.end();
    return;
  }
  if (url.pathname === '/cloud/queue' && req.method === 'POST') {
    if (!user) { res.writeHead(401); res.end(); return; }
    const data = (await readBody(req)).toString('utf8');
      const name = (new URLSearchParams(data).get('name') || '').trim();
      try {
        const r = await sqsAction({ Action: 'CreateQueue', QueueName: name });
        const ok = r.status === 200 && !r.body.includes('<Code>');
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent(ok ? `Queue ${name} created.` : 'Create queue failed.') });
      } catch (e) {
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent('Create queue failed: ' + e.message) });
      }
      res.end();
    return;
  }
  if (url.pathname === '/cloud/send' && req.method === 'POST') {
    if (!user) { res.writeHead(401); res.end(); return; }
    const data = (await readBody(req)).toString('utf8');
      const p = new URLSearchParams(data);
      try {
        const r = await sqsAction({ Action: 'SendMessage', QueueUrl: p.get('url') || '', MessageBody: p.get('body') || '' });
        const ok = r.status === 200 && r.body.includes('<MessageId>');
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent(ok ? 'Message sent.' : 'Send failed.') });
      } catch (e) {
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent('Send failed: ' + e.message) });
      }
      res.end();
    return;
  }
  if (url.pathname === '/flow' || url.pathname.startsWith('/flow/')) {
    if (!user) { res.writeHead(302, { location: '/login' }); res.end(); return; }
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (url.pathname === '/flow' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(flowListPage(user));
        return;
      }
      if (url.pathname === '/flow/new' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(flowNewPage(user));
        return;
      }
      if (url.pathname === '/flow/activity' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(flowActivityPage(user));
        return;
      }
      if (url.pathname === '/flow' && req.method === 'POST') {
        const data = (await readBody(req)).toString('utf8');
          const p = new URLSearchParams(data);
          try {
            const flow = flowEngine.createFlow(flowStore, {
              owner: user.sub,
              name: p.get('name') || '',
              starter: { type: p.get('starterType') || 'event', name: p.get('starterName') || '' },
              steps: [
                { connector: 'drive', action: p.get('step1Action') || 'write_file', params: { path: p.get('step1Path') || '/flows/brief.txt' } },
                { connector: 'sites', action: p.get('step2Action') || 'create_page', params: { title: p.get('step2Title') || 'Brief from Drive' } },
              ],
            });
            persistFlow();
            res.writeHead(302, { location: '/flow/' + flow.id });
            res.end();
          } catch (e) {
            res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
            res.end(flowNewPage(user, e.message));
          }
        return;
      }
      if (parts.length === 2 && req.method === 'GET') {
        const flow = flowEngine.getFlow(flowStore, parts[1]);
        if (flow.owner !== user.sub) { res.writeHead(404); res.end('not found'); return; }
        const runs = flowEngine.listRuns(flowStore, flow.id);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(shell(user, 'flow', flow.name, `<div class=greet>${esc(flow.name)}</div>
<p class=gsub>${esc(flow.starter.type)} · ${esc(flow.starter.name)} · ${flow.enabled ? 'On' : 'Off'}</p>
${flowTabs('list', user)}
<ol>${flow.steps.map((s) => `<li>${esc(s.connector)}.${esc(s.action)}</li>`).join('')}</ol>
${can(user, 'flow', 'writer') ? `<form method=post action="/flow/${esc(flow.id)}/${flow.enabled ? 'disable' : 'enable'}"><button class=btn-sec type=submit>${flow.enabled ? 'Disable' : 'Enable'}</button></form>
${flow.enabled ? `<form method=post action="/flow/${esc(flow.id)}/run"><button class=btn type=submit data-testid="run-flow">Run now</button></form>` : ''}
<form method=post action="/flow/${esc(flow.id)}/delete" onsubmit="return confirm('Delete this flow and its run history?')"><button class=btn-sec type=submit>Delete flow</button></form>` : '<p>Read-only access</p>'}
<h3 class=sec>Recent runs</h3>
${runs.length ? `<table class=flowtable data-testid="flow-activity"><tbody>${runs.map((r) => `<tr data-testid="run-row"><td>${esc(r.startedAt)}</td><td>${esc(r.status)}</td><td>${r.steps.map((s) => esc(s.connector + '.' + s.action + ':' + (s.outcome && s.outcome.ok ? 'ok' : 'error'))).join('; ')}</td></tr>`).join('')}</tbody></table>` : '<p class=gsub>No runs yet.</p>'}`));
        return;
      }
      if (parts.length === 3 && req.method === 'POST' && ['enable', 'disable', 'run', 'delete'].includes(parts[2])) {
        const flow = flowEngine.getFlow(flowStore, parts[1]);
        if (flow.owner !== user.sub) { res.writeHead(404); res.end('not found'); return; }
        if (parts[2] === 'delete') {
          delete flowStore.flows[flow.id];
          flowStore.runs = flowStore.runs.filter(run => run.flowId !== flow.id);
          persistFlow();
          res.writeHead(302, { location: '/flow' }); res.end(); return;
        }
        if (parts[2] === 'run') {
          flowEngine.trigger(flowStore, flow.id, representativeEvent(flow), connectorsFor(user.sub));
        } else {
          flowEngine.setEnabled(flowStore, flow.id, parts[2] === 'enable');
        }
        persistFlow();
        res.writeHead(302, { location: parts[2] === 'run' ? '/flow/activity' : '/flow/' + flow.id });
        res.end();
        return;
      }
    } catch (e) {
      res.writeHead(e.status || (e.message.startsWith('unknown flow') ? 404 : 400), { 'content-type': 'text/plain' });
      res.end(e.message);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  if (url.pathname === '/intranet' || url.pathname === '/intranet/') {
    if (!user) { res.writeHead(302, { location: '/login' }); res.end(); return; }
    let collections = [];
    try { collections = await outline.listCollections(); } catch (error) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(shell(user, 'intranet', 'Intranet', outlineSites.pageHtml([], outline.publicUrl, error.message)));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(shell(user, 'intranet', 'Intranet', outlineSites.pageHtml(collections, outline.publicUrl)));
    return;
  }
  if (url.pathname === '/intranet/sites' && req.method === 'POST') {
    if (!user) { res.writeHead(302, { location: '/login' }); res.end(); return; }
    const params = new URLSearchParams((await readBody(req)).toString('utf8'));
    try {
      const created = await outline.createSite(params.get('name'), params.get('description'));
      res.writeHead(302, { location: created.href || '/intranet' });
      res.end();
    } catch (error) {
      const collections = await outline.listCollections().catch(() => []);
      res.writeHead(error.status || 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(shell(user, 'intranet', 'Intranet', outlineSites.pageHtml(collections, outline.publicUrl, error.message)));
    }
    return;
  }
  if (url.pathname === '/held-files' || url.pathname === '/held-files/') {
    if (!user) { res.writeHead(302, { location: '/login' }); res.end(); return; }
    let records = [];
    let message = '';
    try { records = await heldRecords(); } catch (error) { message = error.message; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(shell(user, 'held', 'Held files', fileGuard.pageHtml(user, records, message)));
    return;
  }
  const heldAction = url.pathname.match(/^\/held-files\/([a-f0-9]+)\/(release|delete)$/);
  if (heldAction && req.method === 'POST') {
    if (!user) { res.writeHead(302, { location: '/login' }); res.end(); return; }
    if (!fileGuard.isAdmin(user)) {
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
      res.end(shell(user, 'held', 'Held files', fileGuard.pageHtml(user, await heldRecords().catch(() => []), 'Ask a workspace admin to put this file back.')));
      return;
    }
    try {
      if (fileGuardRemote) {
        if (heldAction[2] === 'release') await fileGuardRemote.release(heldAction[1]);
        else await fileGuardRemote.remove(heldAction[1]);
      } else if (heldAction[2] === 'release') fileGuard.releaseFile(fileGuardStore, heldAction[1], SCAN_ROOT);
      else fileGuard.deleteHeld(fileGuardStore, heldAction[1]);
      res.writeHead(302, { location: '/held-files' });
      res.end();
    } catch (error) {
      const records = await heldRecords().catch(() => []);
      res.writeHead(error.status || 400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(shell(user, 'held', 'Held files', fileGuard.pageHtml(user, records, error.message)));
    }
    return;
  }
  if (url.pathname === '/' || url.pathname === '/home') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(user ? await homePage(user) : signinPage());
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(error.status || 500, { 'content-type': 'text/plain' });
    res.end(error.status ? error.message : 'Request failed. Please try again.');
  });
});

module.exports = { server, shell, signinPage, navGroups, page, sign, verifySession, APPS, liveApps };

if (require.main === module) {
  server.listen(port, HOST, () => console.log(`blak-portal listening on ${HOST}:${port}`));
}
