const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');
const { APPS, ACCENT, ICON_IMG, RAIL_ICON, liveApps } = require('./catalog');
const flowEngine = require('./flow-engine');
const { dispatchCloudObject, writeCloudResult } = require('./cloud-object');

const port = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const FLOW_STORE = process.env.FLOW_STORE || '';
const flowStore = flowEngine.loadStore(FLOW_STORE);
const flowConnectors = flowEngine.defaultConnectors();
const ISSUER = process.env.OIDC_ISSUER || 'http://id.homelab.local/application/o/blak-portal';
const OIDC_BASE = process.env.OIDC_BASE || 'http://id.homelab.local/application/o';
const AUTH_URL = process.env.OIDC_AUTH_URL || 'http://id.homelab.local/application/o/authorize/';
const CLIENT_ID = process.env.OIDC_CLIENT_ID || 'blak-portal';
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.OIDC_REDIRECT_URI || 'http://portal.homelab.local/callback';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-me';
const COOKIE = 'blak_session';

// Blak Workspace brand guidelines (Proposed v0.1): Paper/Forest/Clay light theme,
// Inter, sentence case, Forest primary buttons, full Blak names in navigation.
// Colours carry no claimed cultural meaning; no cultural motifs anywhere.
const CSS = `
:root{
--blak-950:#0B1112;--blak-900:#101819;--blak-850:#152022;--blak-800:#1B292B;--blak-700:#29393A;
--earth-700:#8E3525;--earth-600:#B64629;--earth-500:#D65B2E;--earth-400:#E77832;
--ochre-600:#B97524;--ochre-500:#D68B2C;--ochre-400:#E5A447;
--water-700:#14565E;--water-600:#176A72;--water-500:#21818A;--water-400:#3199A2;
--sand-50:#FFF9EF;--sand-100:#F3E7D3;--sand-200:#E6D4B8;--sand-300:#CFB993;
--surface-base:#0B1112;--surface:#101819;--surface-raised:#172123;--surface-hover:#202D2F;--surface-selected:#252F2E;
--border-subtle:#263436;--border:#304043;--border-strong:#455456;
--text-primary:#F4EBDD;--text-secondary:#B8B5AA;--text-muted:#7F8988;
--primary:#D65B2E;--primary-hover:#E77832;--secondary:#21818A;--secondary-hover:#3199A2;
--success:#5E9C67;--warning:#D68B2C;--danger:#D35B48;--info:#3199A2;--focus:#3199A2;
}
[data-theme="light"]{
--surface-base:#EDE5D8;--surface:#F5F0E7;--surface-raised:#FFF9EF;--surface-hover:#EDE5D8;--surface-selected:#E0D6C8;
--border-subtle:#E0D6C8;--border:#D7CBBB;--border-strong:#BCAF9D;
--text-primary:#182122;--text-secondary:#596261;--text-muted:#7A817E;
}
*{box-sizing:border-box}
body{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;min-height:100vh;color:var(--text-primary);background:var(--surface);font-size:16px;line-height:1.5}
a{color:var(--info)}
p a{text-decoration:underline}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;min-height:60px;padding:8px 16px;background:var(--surface-base);border-bottom:1px solid var(--border-subtle)}
.waffle{min-width:44px;min-height:44px;border:1px solid transparent;background:transparent;border-radius:8px;cursor:pointer;display:grid;grid-template-columns:repeat(3,6px);gap:4px;align-content:center;justify-content:center}
.waffle:hover{background:var(--surface-hover)}
.waffle i{width:6px;height:6px;border-radius:50%;background:var(--text-secondary)}
.brand{display:flex;align-items:center;gap:10px;font-size:18px;white-space:nowrap}
.brand b{font-weight:700}.brand span{font-weight:500}
.mark{width:30px;height:30px;flex:none;border-radius:8px;background:var(--primary);color:#FFF4E5;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:17px}
.search{flex:1;max-width:560px;margin:0 auto;display:flex}
.search input,.search select{flex:1;background:#0D1516;border:1px solid var(--border);border-radius:8px;color:var(--text-primary);padding:9px 14px;font-size:16px;min-height:44px}
[data-theme="light"] .search input,[data-theme="light"] .search select{background:var(--surface-raised)}
.search input::placeholder{color:var(--text-muted)}
.search input:hover{border-color:var(--border-strong)}
.search input:focus{border-color:var(--water-400);outline:2px solid rgb(49 153 162 / 20%)}
.userchip{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--text-secondary);white-space:nowrap}
.avatar{width:34px;height:34px;border-radius:50%;background:var(--primary);color:#FFF4E5;font-weight:600;display:flex;align-items:center;justify-content:center;font-size:15px}
.iconbtn{min-width:44px;min-height:44px;border:1px solid transparent;background:transparent;color:var(--text-secondary);border-radius:8px;cursor:pointer;font-size:18px}
.iconbtn:hover{background:var(--surface-hover);color:var(--text-primary)}
.shell{display:flex;min-height:calc(100vh - 60px)}
.sidebar{width:232px;flex:none;background:var(--surface-base);border-right:1px solid var(--border-subtle);padding:14px 10px;display:flex;flex-direction:column;gap:2px;overflow:auto}
.nav-sec{font-size:.75rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);padding:12px 12px 4px}
.nav-item{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 12px;border-radius:8px;color:var(--text-secondary);text-decoration:none;font-size:14px;border-left:3px solid transparent;transition:background-color 150ms ease,border-color 150ms ease,color 150ms ease}
.nav-item:hover{background:var(--surface-hover);color:var(--text-primary)}
.nav-item[data-active="true"]{background:rgb(214 91 46 / 12%);color:var(--text-primary);border-left-color:var(--earth-500)}
.nav-item .ric{font-size:18px;width:24px;text-align:center;flex:none}
.nav-item .swatch{width:10px;height:10px;border-radius:50%;flex:none}
.nav-item.soon{opacity:.55}
.nav-item .tag{margin-left:auto;font-size:11px;color:var(--text-muted)}
.sidebar .sp{flex:1}
main{flex:1;padding:28px 32px;max-width:1150px;min-width:0}
.greet{font-size:32px;margin:4px 0 2px;font-weight:650;letter-spacing:-.02em}.gsub{color:var(--text-secondary);margin:0 0 20px;font-size:16px}
h3.sec{font-size:.75rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin:24px 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.card{background:var(--surface-raised);border:1px solid var(--border-subtle);border-radius:12px;padding:18px;box-shadow:0 1px 2px rgb(0 0 0 / 20%);transition:background-color 150ms ease,border-color 150ms ease}
.card:hover{background:var(--surface-hover);border-color:var(--border)}
.card h3{margin:8px 0 4px;font-size:16px;font-weight:600}
.card p{color:var(--text-secondary);font-size:14px;margin:4px 0}
.be{color:var(--text-muted);font-size:12px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--border-strong);display:inline-block;margin-right:6px}
.svc{color:var(--text-muted);font-size:13px}
.drawer{position:fixed;top:60px;left:0;bottom:0;width:min(440px,92vw);background:var(--surface-base);border-right:1px solid var(--border-subtle);z-index:30;padding:20px;overflow:auto;box-shadow:30px 0 60px rgba(0,0,0,.5)}
.drawer[hidden]{display:none}
.drawer h3{margin:0 0 4px;font-size:17px}.drawer p.dsub{color:var(--text-secondary);font-size:14px;margin:0 0 14px}
.applist{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.appitem{display:flex;gap:10px;align-items:flex-start;background:var(--surface-raised);border:1px solid var(--border-subtle);border-radius:8px;padding:12px;text-decoration:none;color:var(--text-primary);min-height:44px}
.appitem:hover{border-color:var(--border-strong)}
.appitem.soon{opacity:.6}
.appitem .t{font-size:14px;font-weight:600}.appitem .d{font-size:12px;color:var(--text-secondary)}
img.tile-ic{border-radius:9px}.tile-ic{width:34px;height:34px;flex:none;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#FFF4E5}
.scrim{position:fixed;inset:60px 0 0 0;background:rgba(0,0,0,.5);z-index:25}
.scrim[hidden]{display:none}
.btn{display:inline-block;background:var(--primary);color:#FFF4E5;font-weight:600;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;border:0;cursor:pointer;min-height:44px;transition:background-color 150ms ease}
.btn:hover{background:var(--primary-hover)}
.btn-sec{background:var(--surface-raised);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:9px 16px;cursor:pointer;font-size:14px}
.signin{display:grid;grid-template-columns:1fr 1fr;min-height:calc(100vh - 60px)}
.signin .formpane{display:flex;align-items:center;justify-content:center;padding:40px}
.signin .formbox{max-width:420px;width:100%}
.signin h2{font-size:32px;margin:18px 0 8px;font-weight:650;letter-spacing:-.02em}
.signin .tagline{font-size:20px;margin:6px 0}
.signin p{color:var(--text-secondary)}
.artpane{position:relative;overflow:hidden;background:#0B1112}
.artpane svg.scene,.artpane img.scene{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#0B1112;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 22%,#000 100%);mask-image:linear-gradient(to right,transparent 0,#000 22%,#000 100%)}
.artpane .strap{position:absolute;left:32px;right:32px;bottom:28px;color:var(--sand-100)}
.artpane .strap b{display:block;font-size:22px;font-weight:650;letter-spacing:-.02em}
.artpane .strap span{font-size:12px;letter-spacing:.18em;color:var(--ochre-400);font-weight:600}
footer{padding:20px 32px;color:var(--text-muted);font-size:13px;text-align:center}
.statusrow{display:flex;flex-wrap:wrap;gap:8px}
.pill{font-size:12px;color:var(--text-secondary);border:1px solid var(--border);border-radius:20px;padding:4px 12px}
.empty{border:1px dashed var(--border-strong);border-radius:12px;padding:26px;text-align:center;color:var(--text-secondary)}
.empty svg{opacity:.5}
.hero{overflow:hidden;border:0;background:transparent;margin-bottom:8px}
.hero img{display:block;width:100%;height:auto;max-height:340px;object-fit:contain;background:transparent;border-radius:12px;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 10%,#000 88%,transparent 100%);mask-image:linear-gradient(to bottom,transparent 0,#000 10%,#000 88%,transparent 100%)}
.hero .cap{padding:14px 20px;background:var(--surface-raised)}
.hero .cap b{font-size:20px;font-weight:650;letter-spacing:-.02em}
.hero .cap span{display:block;font-size:12px;letter-spacing:.14em;color:var(--ochre-400);font-weight:600}
code,pre{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
.flowtabs{display:flex;gap:8px;margin:0 0 18px;flex-wrap:wrap}
.flowtabs a{min-height:44px;display:inline-flex;align-items:center;padding:8px 14px;border-radius:8px;border:1px solid var(--border);color:var(--text-secondary);text-decoration:none;font-size:14px}
.flowtabs a[data-active="true"]{background:rgb(214 91 46 / 12%);color:var(--text-primary);border-color:var(--earth-500)}
.flowtable{width:100%;border-collapse:collapse;font-size:14px}
.flowtable th,.flowtable td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--border-subtle);vertical-align:top}
.flowtable th{color:var(--text-muted);font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.builder{display:grid;gap:14px;max-width:720px}
.builder label{display:grid;gap:6px;font-size:14px}
.builder input,.builder select{background:var(--surface-raised);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);padding:9px 12px;font-size:16px;min-height:44px}
.stepbox{border:1px solid var(--border-subtle);border-radius:10px;padding:12px;background:var(--surface-raised)}
@media (max-width:900px){.sidebar{width:76px}.sidebar .nav-item span.lbl,.sidebar .nav-sec{display:none}.sidebar .nav-item{justify-content:center}.signin{grid-template-columns:1fr}.artpane{display:none}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const pending = new Map(); // state -> {nonce, ts}

function sign(obj) {
  const p = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const s = crypto.createHmac('sha256', SESSION_SECRET).update(p).digest('base64url');
  return `${p}.${s}`;
}
function verifySession(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [p, s] = m[1].split('.');
  if (!p || !s) return null;
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(p).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expect))) return null;
  try {
    const obj = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (obj.exp < Date.now()) return null;
    return obj;
  } catch { return null; }
}
const MEILI_KEY = process.env.MEILI_MASTER_KEY || '';
const FLOCI_HOST = process.env.FLOCI_HOST || 'floci';
const FLOCI_PORT = parseInt(process.env.FLOCI_PORT || '4566', 10);
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
function awsReq(service, method, path, query, body, contentType) {
  return new Promise((resolve, reject) => {
    const payloadHash = 'UNSIGNED-PAYLOAD';
    const { headers, queryString } = awsSign(service, method, path, query, contentType ? { 'content-type': contentType } : {}, payloadHash);
    const fullPath = path + (queryString ? '?' + queryString : '');
    const req = http.request({ host: FLOCI_HOST, port: FLOCI_PORT, path: fullPath, method, timeout: 10000, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    if (body) req.end(body); else req.end();
  });
}
function xmlTag(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  let m; while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}
const BRAND_BASE = process.env.BRAND_BASE || 'http://portal.homelab.local';
// Shared Blak brand assets (no cultural motifs; geometric wordmark only)
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="#0B1112"/><rect x="14" y="14" width="68" height="68" rx="14" fill="#D65B2E"/><text x="48" y="64" font-family="system-ui,sans-serif" font-size="44" font-weight="700" fill="#FFF4E5" text-anchor="middle">B</text><rect x="26" y="72" width="44" height="4" rx="2" fill="#E5A447"/></svg>`;
const FLOW_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#0B1112"/><ellipse cx="1150" cy="620" rx="420" ry="200" fill="#8E3525" opacity="0.7"/><ellipse cx="1150" cy="700" rx="560" ry="160" fill="#14565E" opacity="0.6"/><circle cx="1150" cy="520" r="110" fill="#E5A447" opacity="0.9"/><ellipse cx="300" cy="150" rx="500" ry="240" fill="#1B292B" opacity="0.9"/></svg>`;
function blakTheme() {
  return {
    common: { name: 'Blak Drive', slogan: 'Your work. Your workspace.', logo: `${BRAND_BASE}/brand/logo.svg` },
    clients: { web: { defaults: { logo: `${BRAND_BASE}/brand/logo.svg`, favicon: `${BRAND_BASE}/brand/logo.svg` }, themes: [{ isDark: false, label: 'Blak', designTokens: { roles: {
      primary: '#205B46', onPrimary: '#FFFFFF', primaryContainer: '#9AC7B2', onPrimaryContainer: '#06231A',
      secondary: '#525C55', onSecondary: '#FFFFFF', secondaryContainer: '#E4E8E2', onSecondaryContainer: '#171A18',
      tertiary: '#AD5B32', onTertiary: '#FFFFFF', tertiaryContainer: '#F2D9C4', onTertiaryContainer: '#3A1F0E',
      error: '#BA1A1A', onError: '#FFFFFF', errorContainer: '#FFDAD6', onErrorContainer: '#410002',
      background: '#F7F5EF', onBackground: '#171A18', surface: '#FFFFFF', onSurface: '#171A18',
      surfaceVariant: '#E4E8E2', onSurfaceVariant: '#525C55', outline: '#525C55', shadow: '#000000', scrim: '#000000',
      inverseSurface: '#171A18', inverseOnSurface: '#F7F5EF', inversePrimary: '#9AC7B2', chrome: '#205B46', onChrome: '#ffffff' } } }] } },
  };
}
function svcGet(host, port, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path, method: 'GET', timeout: 8000, headers: headers || {} }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}
function svcPost(host, port, path, obj, headers) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(obj);
    const req = http.request({ host, port, path, method: 'POST', timeout: 8000, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...(headers || {}) } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end(body);
  });
}
function probe(c) {
  return new Promise((resolve) => {
    const lib = c.proto === 'https' ? https : http;
    const opts = { host: c.host, port: c.port, path: c.path, method: 'GET', timeout: 4000 };
    if (c.insecure) opts.rejectUnauthorized = false;
    const req = lib.request(opts, (res) => { res.resume(); resolve(res.statusCode < 500 ? 'up' : 'down'); });
    req.on('timeout', () => { req.destroy(); resolve('down'); });
    req.on('error', () => resolve('down'));
    req.end();
  });
}
function postForm(urlStr, params) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = new URLSearchParams(params).toString();
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + (u.search || ''), method: 'POST', timeout: 10000, headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end(body);
  });
}
function getJson(urlStr, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + (u.search || ''), method: 'GET', timeout: 10000, headers: { authorization: `Bearer ${token}` } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad userinfo: ' + data.slice(0, 120))); } });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function page(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} — Blak Workspace</title><meta name=viewport content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>${inner}<footer>Blak Workspace by Yuma IT · built with open-source software (OpenCloud, Authentik, Collabora, Outline, Floci, Meilisearch) · currently in early development</footer></body></html>`;
}
function appIcon(a, cls) {
  const f = ICON_IMG[a.id];
  if (f) return `<img class="${cls}" src="/brand/icons/${f}.png" alt="" width="34" height="34">`;
  return `<span class="${cls} tile-ic" style="background:${ACCENT[a.id] || '#888'}">${esc(a.name.replace('Blak ', '').charAt(0))}</span>`;
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wordmark() { return `<div class=brand><div class=mark>B</div><div><b>Blak</b> <span>Workspace</span></div></div>`; }
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
function heroScene(id) {
  return `<svg class=scene viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs><linearGradient id="sky${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B1112"/><stop offset=".62" stop-color="#152022"/><stop offset="1" stop-color="#1B292B"/></linearGradient>
<linearGradient id="sun${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E5A447"/><stop offset="1" stop-color="#B64629"/></linearGradient>
<linearGradient id="hill${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8E3525"/><stop offset="1" stop-color="#0B1112"/></linearGradient></defs>
<rect width="800" height="900" fill="url(#sky${id})"/>
<circle cx="560" cy="430" r="120" fill="url(#sun${id})" opacity=".85"/>
${dotSun(560, 430, 190, '#E5A447', '.5')}
${dotSun(560, 430, 260, '#D65B2E', '.28')}
<path d="M0 560 L140 470 L260 540 L400 450 L540 550 L680 480 L800 550 L800 900 L0 900 Z" fill="url(#hill${id})"/>
<path d="M0 640 L180 580 L360 650 L520 590 L700 650 L800 610 L800 900 L0 900 Z" fill="#101819"/>
<rect y="700" width="800" height="200" fill="#14565E" opacity=".55"/>
${[0, 1, 2, 3].map((r) => { let s = ''; for (let i = 0; i < 26; i++) s += `<circle cx="${20 + i * 30}" cy="${730 + r * 22}" r="2.4" fill="#F4EBDD" opacity="${0.5 - r * 0.1}"/>`; return s; }).join('')}
<path d="M0 700 Q200 690 400 700 T800 700 L800 712 Q600 702 400 712 T0 712 Z" fill="#3199A2" opacity=".5"/>
</svg>`;
}
function signinPage() {
  return page('Sign in', `<div class=topbar>${wordmark()}
<div class=userchip style="margin-left:auto"><button class=iconbtn id=themebtn aria-label="Toggle light theme">☀</button></div></div>
<div class=signin><div class=formpane><div class=formbox>
<div class=mark style="width:44px;height:44px;font-size:24px">B</div>
<h2>Your work. Your workspace.</h2>
<p>A digital workplace with a distinct Blak identity.</p>
<p>One login for files, docs, sites and search — Blak ID, powered by Authentik.</p>
<p><a class=btn href="/login">Sign in with Blak ID</a></p>
<p style="font-size:13px">Blak Workspace by Yuma IT · currently in early development</p>
</div></div>
<div class=artpane><img class=scene src="/brand/banner.png" alt="Blak Workspace banner artwork"><div class=strap><b>Our People. Our Data. A Stronger Tomorrow.</b><span>SOVEREIGN · OPEN · TOGETHER</span></div></div></div>
<script>document.getElementById('themebtn').onclick=()=>{const t=document.documentElement.dataset.theme==='light'?'':'light';if(t)document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;try{localStorage.setItem('blak-theme',t||'dark');}catch(e){}};try{if(localStorage.getItem('blak-theme')==='light')document.documentElement.dataset.theme='light';}catch(e){}</script>`);
}
function navGroups(active) {
  const groups = ['Workspace', 'Organise', 'Platform'];
  return groups.map((g) => {
    const items = APPS.filter((a) => a.group === g);
    if (!items.length) return '';
    const links = items.map((a) => {
      const inner = `${ICON_IMG[a.id] ? `<img src="/brand/icons/${ICON_IMG[a.id]}.png" alt="" width="24" height="24" style="border-radius:6px;flex:none">` : `<span class=ric>${RAIL_ICON[a.id] || '•'}</span>`}<span class=lbl>${esc(a.name)}</span><span class=swatch style="background:${ACCENT[a.id] || '#888'}"></span>${a.status === 'soon' ? '<span class=tag>Soon</span>' : ''}`;
      return a.url
        ? `<a class=nav-item href="${a.url}" ${a.id === active ? 'data-active="true"' : ''} title="${esc(a.name)}">${inner}</a>`
        : `<span class="nav-item soon" title="${esc(a.name)} — coming soon">${inner}</span>`;
    }).join('');
    return `<div class=nav-sec>${g}</div>${links}`;
  }).join('');
}
function shell(user, active, title, main) {
  const initial = esc((user.name || user.sub || '?').trim().charAt(0).toUpperCase());
  const drawer = APPS.map((a) => {
    const inner = `${appIcon(a, 'tile-ic')}<span><span class=t>${esc(a.name)}</span><br><span class=d>${esc(a.backend || 'Coming soon')}</span></span>`;
    return a.url ? `<a class=appitem href="${a.url}" data-app="${a.id}">${inner}</a>` : `<span class="appitem soon" data-app="${a.id}">${inner}</span>`;
  }).join('');
  return page(title, `<div class=topbar>
<button class=waffle id=wbtn aria-label="App launcher" data-testid="waffle"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></button>
${wordmark()}
<div class=search><input id=q type=search placeholder="Search apps and workspace…" autocomplete=off onkeydown="if(event.key==='Enter'){location='/search?q='+encodeURIComponent(this.value)}"></div>
<div class=userchip data-testid="userchip"><button class=iconbtn id=themebtn aria-label="Toggle light theme">☀</button><span class=nm>${esc(user.name || user.sub)}</span><span class=avatar>${initial}</span><a href="/logout">Sign out</a></div>
</div><div class=shell><nav class=sidebar>
<a class=nav-item href="/" ${active === 'home' ? 'data-active="true"' : ''} title="Blak Home"><span class=ric>⌂</span><span class=lbl>Blak Home</span><span class=swatch style="background:${ACCENT.workspace}"></span></a>
${navGroups(active)}
<span class=sp></span><a class=nav-item href="/logout" title="Sign out"><span class=ric>⏻</span><span class=lbl>Sign out</span></a></nav>
<main>${main}</main></div>
<div class=scrim id=scrim hidden></div>
<aside class=drawer id=drawer hidden><h3>Apps</h3><p class=dsub>Every Blak app, one login via Blak ID</p><div class=applist>${drawer}</div></aside>
<div class=scrim id=palscrim hidden style="inset:0;z-index:40"></div>
<div class=drawer id=pal hidden style="left:50%;transform:translateX(-50%);top:12vh;bottom:auto;width:min(560px,92vw);border:1px solid var(--border);border-radius:12px;z-index:41;box-shadow:0 30px 80px rgba(0,0,0,.35)">
<input id=pali type=search placeholder="Type a command or search apps… (Ctrl/⌘ K)" autocomplete=off style="width:100%;padding:12px 14px;font-size:16px;background:#0D1516;border:1px solid var(--border);border-radius:8px;color:var(--text-primary)">
<div id=palres style="margin-top:10px"></div></div>
<script>const b=document.getElementById('wbtn'),w=document.getElementById('drawer'),s=document.getElementById('scrim');
function tog(f){const sh=f!==undefined?f:w.hidden;w.hidden=!sh;s.hidden=!sh;}b.onclick=()=>tog();s.onclick=()=>tog(false);
try{if(localStorage.getItem('blak-theme')==='light')document.documentElement.dataset.theme='light';}catch(e){}
document.getElementById('themebtn').onclick=()=>{const t=document.documentElement.dataset.theme==='light'?'':'light';if(t)document.documentElement.dataset.theme=t;else delete document.documentElement.dataset.theme;try{localStorage.setItem('blak-theme',t||'dark');}catch(e){}};
const pal=document.getElementById('pal'),pscrim=document.getElementById('palscrim'),pi=document.getElementById('pali'),pres=document.getElementById('palres');
const ITEMS=${JSON.stringify(APPS.filter((a) => a.url).map((a) => ({ t: a.name, d: a.desc, u: a.url })).concat([{ t: 'Sign out', d: 'End your Blak session', u: '/logout' }]))};
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
function flowTabs(active) {
  const tabs = [
    ['/flow', 'My flows', 'list'],
    ['/flow/new', 'Create', 'new'],
    ['/flow/activity', 'Activity', 'activity'],
  ];
  return `<nav class=flowtabs data-testid="flow-tabs">${tabs.map(([href, label, id]) => `<a href="${href}" data-active="${id === active}">${label}</a>`).join('')}</nav>`;
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
<td>
<form method=post action="/flow/${esc(f.id)}/enable" style="display:inline">${f.enabled ? '' : '<button class=btn-sec type=submit>Enable</button>'}</form>
<form method=post action="/flow/${esc(f.id)}/disable" style="display:inline">${f.enabled ? '<button class=btn-sec type=submit>Disable</button>' : ''}</form>
<form method=post action="/flow/${esc(f.id)}/run" style="display:inline">${f.enabled ? '<button class=btn type=submit data-testid="run-flow">Run</button>' : ''}</form>
</td></tr>`).join('');
  const body = flows.length
    ? `<table class=flowtable data-testid="flow-list"><thead><tr><th>Name</th><th>Starter</th><th>Steps</th><th>State</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class=empty data-testid="flow-empty"><p><b>No flows yet.</b></p><p>Create a flow with a starter and Drive + Sites steps.</p><p><a class=btn href="/flow/new">Create a flow</a></p></div>`;
  return shell(user, 'flow', 'Blak Flow', `<div class=greet>Blak Flow</div>
<p class=gsub>Automations with a starter, ordered steps, and a run history — Drive plus one other live app.</p>
${flowTabs('list')}${body}`);
}
function flowNewPage(user, err) {
  return shell(user, 'flow', 'Create a flow', `<div class=greet>Create a flow</div>
<p class=gsub>Pick a starter, then Drive and Sites steps in order. Same pattern as Power Automate My flows → Create.</p>
${flowTabs('new')}
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
${flowTabs('activity')}${body}`);
}
function homePage(user) {
  const live = liveApps();
  const cards = live.map((a) => `<div class=card data-app="${a.id}" data-name="${esc((a.name + ' ' + a.desc).toLowerCase())}">
<div class=apphead>${appIcon(a, 'tile-ic')}<span class=dot data-dot="${a.id}"> </span></div>
<h3>${esc(a.name)}</h3><p>${esc(a.desc)}</p><p class=be>${esc(a.backend)}</p>
<a href="${a.url}">Open →</a></div>`).join('');
  return shell(user, 'home', 'Home', `<div class=hero><img src="/brand/banner.png" alt="Blak Workspace banner artwork"><div class=cap><b>Your work. Your workspace.</b><span>SOVEREIGN · OPEN · TOGETHER</span></div></div>
<div class=greet id=greet>Welcome</div><p class=gsub>Blak Workspace · sovereign micro cloud</p>
<h3 class=sec>Apps</h3><div class=grid id=tiles>${cards}</div>
<h3 class=sec>Recent documents</h3><div class=empty><svg width="120" height="60" viewBox="0 0 120 60" aria-hidden="true">${dotSun(60, 30, 26, '#21818A', '.55')}</svg><p><b>Nothing here yet.</b></p><p>Open Blak Drive to start working — recent files will appear here.</p><p><a class=btn href="https://drive.homelab.local">Open Blak Drive</a></p></div>
<h3 class=sec>Announcements</h3><div class=statusrow><span class=pill>Welcome to Blak Workspace — currently in early development.</span></div>
<h3 class=sec>System status</h3><div class=statusrow id=pills><span class=pill>checking…</span></div>
<script>
const hr=new Date().getHours();
document.getElementById('greet').textContent=(hr<12?'Good morning':hr<18?'Good afternoon':'Good evening')+', ${esc(user.name || user.sub).replace(/'/g, "\\'")}';
const qi=document.querySelector('.search input');
if(qi){qi.addEventListener('input',()=>{const t=qi.value.toLowerCase();document.querySelectorAll('#tiles .card').forEach(c=>{c.style.display=c.dataset.name.includes(t)?'':'none';});});}
fetch('/api/status').then(r=>r.json()).then(j=>{const pills=document.getElementById('pills');pills.innerHTML='';
for(const[id,st]of Object.entries(j.status)){const d=document.querySelector('[data-dot="'+id+'"]');if(d){d.style.background=st==='up'?'var(--success)':'var(--danger)';}
const p=document.createElement('span');p.className='pill';p.textContent=id+': '+st;if(st==='up'){p.style.borderColor='var(--success)';}pills.appendChild(p);}}).catch(()=>{});
</script>`);
}
async function searchPage(user, q) {
  let body = '';
  if (!q) {
    body = `<p class=gsub>Search across Blak Drive, Blak Sites and Blak Projects. Indexing connectors are under construction; results appear here as sources are connected.</p>`;
  } else {
    try {
      const idx = await svcGet('meilisearch', 7700, '/indexes', MEILI_KEY ? { authorization: `Bearer ${MEILI_KEY}` } : {});
      const list = JSON.parse(idx.body).results || [];
      if (!list.length) {
        body = `<p class=gsub>No content indexed yet for “${esc(q)}”. Connect a source to Blak Search to populate results.</p>`;
      } else {
        const parts = [];
        for (const ix of list.slice(0, 5)) {
          const r = await svcPost('meilisearch', 7700, `/indexes/${ix.uid}/search`, { q, limit: 5 }, MEILI_KEY ? { authorization: `Bearer ${MEILI_KEY}` } : {});
          const hits = (JSON.parse(r.body).hits || []).map((h) => `<div class=card><h3>${esc(h.title || h.name || h.id || 'result')}</h3><p>${esc(String(h.content || h.description || '')).slice(0, 180)}</p><p class=be>${esc(ix.uid)}</p></div>`).join('');
          if (hits) parts.push(`<h3 class=sec>${esc(ix.uid)}</h3><div class=grid>${hits}</div>`);
        }
        body = parts.join('') || `<p class=gsub>No matches for “${esc(q)}”.</p>`;
      }
    } catch (e) { body = `<p class=gsub>Search is unavailable right now (${esc(e.message)}).</p>`; }
  }
  return shell(user, 'search', 'Blak Search', `<div class=greet>Blak Search</div>
<p class=gsub>Permission-aware search across your workspace</p>
<form method=get action=/search><div class=search style="margin:0 0 18px;max-width:640px"><input name=q type=search placeholder="Search apps and workspace…" value="${esc(q || '')}" autocomplete=off></div></form>${body}`);
}
async function s3Buckets() {
  const r = await awsReq('s3', 'GET', '/', {}, null, null);
  if (r.status !== 200) throw new Error('S3 status ' + r.status);
  return xmlTag(r.body.toString(), 'Name');
}
async function sqsAction(params) {
  const form = new URLSearchParams({ Version: '2012-11-05', ...params }).toString();
  const sig = awsSign('sqs', 'POST', '/', {}, { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, sha256hex(form));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: FLOCI_HOST, port: FLOCI_PORT, path: '/', method: 'POST', timeout: 8000, headers: { ...sig.headers, 'content-length': Buffer.byteLength(form) } }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end(form);
  });
}
async function cloudPage(user, bucket, Table, msg) {
  let body = '';
  try {
    const buckets = await s3Buckets();
    const opts = buckets.map((b) => `<option value="${esc(b)}"${b === bucket ? ' selected' : ''}>${esc(b)}</option>`).join('');
    let listing = '';
    if (bucket) {
      const q = { 'list-type': '2', prefix: Table || '' };
      const r = await awsReq('s3', 'GET', '/' + bucket, q, null, null);
      if (r.status !== 200) throw new Error('list status ' + r.status);
      const keys = xmlTag(r.body.toString(), 'Key');
      listing = keys.length
        ? `<div class=statusrow>${keys.slice(0, 50).map((k) => `<span class=pill><a href="/cloud/object?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(k)}">⬇ ${esc(k)}</a> <a href="#" onclick="fetch('/cloud/object?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(k)}',{method:'DELETE'}).then(()=>location.reload());return false;" style="color:var(--danger)">✕</a></span>`).join('')}</div>`
        : `<p class=gsub>No objects in this bucket yet.</p>`;
    }
    let queues = '';
    try {
      const qr = await sqsAction({ Action: 'ListQueues' });
      const urls = xmlTag(qr.body, 'QueueUrl');
      const qforms = urls.slice(0, 10).map((u) => `<form method=post action=/cloud/send style="margin:6px 0"><input type=hidden name=url value="${esc(u)}"><input name=body required placeholder="Message to ${esc(u.split('/').pop())}…" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;min-width:280px"> <button class=btn-sec type=submit>Send</button></form>`).join('');
      queues = `<h3 class=sec>Queues</h3>` + (urls.length ? qforms : `<p class=gsub>No queues yet.</p>`)
        + `<form method=post action=/cloud/queue style="margin:6px 0"><input name=name required minlength=1 placeholder="New queue name…" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px"> <button class=btn-sec type=submit>Create queue</button></form>`;
    } catch (e) { queues = `<p class=gsub>Queues unavailable (${esc(e.message)}).</p>`; }
    body = `${msg ? `<p class=gsub>${esc(msg)}</p>` : ''}
<h3 class=sec>Object storage (S3)</h3>
<form method=get action=/cloud><div class=search style="margin:0 0 12px;max-width:640px"><select name=bucket onchange="this.form.submit()"><option value="">Choose a bucket…</option>${opts}</select>
<input name=prefix type=search placeholder="Prefix filter…" value="${esc(Table || '')}" autocomplete=off></div></form>
${listing}
<form method=post action=/cloud/bucket style="margin:12px 0"><input name=name required minlength=3 placeholder="New bucket name…" style="padding:9px 12px;border:1px solid var(--stone);border-radius:8px;font-size:14px"> <button class=btn-sec type=submit style="padding:9px 16px;border-radius:8px;border:1px solid var(--stone);background:#fff;cursor:pointer">Create bucket</button></form>
${bucket ? `<h3 class=sec>Upload to ${esc(bucket)}</h3><input type=file id=upfile><button class=btn-sec id=upbtn style="padding:9px 16px;border-radius:8px;border:1px solid var(--stone);background:#fff;cursor:pointer">Upload</button><p class=gsub id=upmsg></p>
<script>document.getElementById('upbtn').onclick=async()=>{const f=document.getElementById('upfile').files[0];if(!f)return;const m=document.getElementById('upmsg');m.textContent='Uploading…';
const r=await fetch('/cloud/object?bucket=${encodeURIComponent(bucket)}&key='+encodeURIComponent(f.name),{method:'PUT',body:f});m.textContent=r.ok?'Uploaded. Reload to see it.':'Upload failed ('+r.status+')';};</script>` : ''}
${queues}`;
  } catch (e) { body = `<p class=gsub>Blak Cloud is unavailable right now (${esc(e.message)}).</p>`; }
  return shell(user, 'storage', 'Blak Cloud', `<div class=greet>Blak Cloud</div>
<p class=gsub>Local cloud services for development, testing and automation — object storage, queues, functions and more, on this sovereign box.</p>${body}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const user = verifySession(req);
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'blak-portal', version: '0.3.0' }));
    return;
  }
  if (url.pathname === '/api/me') {
    if (!user) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthenticated"}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sub: user.sub, name: user.name, email: user.email }));
    return;
  }
  if (url.pathname === '/api/modules' || url.pathname === '/api/status') {
    if (!user) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthenticated"}'); return; }
    if (url.pathname === '/api/modules') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ modules: APPS.map((a) => ({ id: a.id, name: a.name, backend: a.backend, url: a.url, status: a.status, oidcClient: a.oidcClient, enabled: a.status === 'live' })) }));
      return;
    }
    const checks = await Promise.all(APPS.map(async (a) => ({ id: a.id, status: a.check ? await probe(a.check) : a.status })));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: Object.fromEntries(checks.map((c) => [c.id, c.status])) }));
    return;
  }
  if (url.pathname === '/login') {
    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    pending.set(state, { nonce, ts: Date.now() });
    const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', scope: 'openid profile email', redirect_uri: REDIRECT_URI, state, nonce });
    res.writeHead(302, { location: `${AUTH_URL}?${q}` });
    res.end();
    return;
  }
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const p = pending.get(state);
    pending.delete(state);
    if (!code || !p) { res.writeHead(400, { 'content-type': 'text/plain' }); res.end('bad login state'); return; }
    try {
      const tok = await postForm(`${OIDC_BASE}/token/`, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
      const tj = JSON.parse(tok.body);
      if (!tj.access_token) throw new Error('no access token: ' + tok.body.slice(0, 120));
      const ui = await getJson(`${OIDC_BASE}/userinfo/`, tj.access_token);
      const sess = sign({ sub: ui.preferred_username || ui.sub, name: ui.name, email: ui.email, exp: Date.now() + 12 * 3600 * 1000 });
      res.writeHead(302, { location: '/', 'set-cookie': `${COOKIE}=${sess}; Path=/; HttpOnly; SameSite=Lax` });
      res.end();
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('login failed: ' + e.message);
    }
    return;
  }
  if (url.pathname === '/logout') {
    res.writeHead(302, { location: '/', 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Max-Age=0` });
    res.end();
    return;
  }
  if (url.pathname === '/brand/banner.png') {
    try {
      const fs = require('fs');
      const img = fs.readFileSync(__dirname + '/brand-banner.png');
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      res.end(img);
    } catch (e) { res.writeHead(404); res.end(); }
    return;
  }
  if (url.pathname.startsWith('/brand/icons/')) {
    const f = url.pathname.split('/').pop();
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
  if (url.pathname === '/brand/flow-bg.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
    res.end(FLOW_BG_SVG);
    return;
  }
  if (url.pathname === '/blak-theme/theme.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' });
    res.end(JSON.stringify(blakTheme()));
    return;
  }
  if (url.pathname === '/search') {
    if (!user) { res.writeHead(302, { location: '/login' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await searchPage(user, url.searchParams.get('q') || ''));
    return;
  }
  if (url.pathname === '/cloud') {
    if (!user) { res.writeHead(302, { location: '/login' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await cloudPage(user, url.searchParams.get('bucket') || '', url.searchParams.get('prefix') || '', url.searchParams.get('msg') || ''));
    return;
  }
  if (url.pathname === '/cloud/object') {
    if (!user) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthenticated"}'); return; }
    const bucket = url.searchParams.get('bucket') || '';
    const key = url.searchParams.get('key') || '';
    const s3Req = (method, path, body) => awsReq('s3', method, path, {}, body, body ? 'application/octet-stream' : null);
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          writeCloudResult(res, await dispatchCloudObject(s3Req, { method: 'PUT', bucket, key, body: Buffer.concat(chunks) }));
        } catch (e) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    try {
      writeCloudResult(res, await dispatchCloudObject(s3Req, { method: req.method, bucket, key, body: null }));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  if (url.pathname === '/cloud/bucket' && req.method === 'POST') {
    if (!user) { res.writeHead(401); res.end(); return; }
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', async () => {
      const name = (new URLSearchParams(data).get('name') || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)) {
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent('Invalid bucket name (3-63 chars, lowercase, dots and dashes).') });
        res.end();
        return;
      }
      try {
        await awsReq('s3', 'PUT', `/${name}`, {}, null, null);
        res.writeHead(302, { location: '/cloud?bucket=' + encodeURIComponent(name) });
      } catch (e) {
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent('Create failed: ' + e.message) });
      }
      res.end();
    });
    return;
  }
  if (url.pathname === '/cloud/queue' && req.method === 'POST') {
    if (!user) { res.writeHead(401); res.end(); return; }
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', async () => {
      const name = (new URLSearchParams(data).get('name') || '').trim();
      try {
        const r = await sqsAction({ Action: 'CreateQueue', QueueName: name });
        const ok = r.status === 200 && !r.body.includes('<Code>');
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent(ok ? `Queue ${name} created.` : 'Create queue failed.') });
      } catch (e) {
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent('Create queue failed: ' + e.message) });
      }
      res.end();
    });
    return;
  }
  if (url.pathname === '/cloud/send' && req.method === 'POST') {
    if (!user) { res.writeHead(401); res.end(); return; }
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', async () => {
      const p = new URLSearchParams(data);
      try {
        const r = await sqsAction({ Action: 'SendMessage', QueueUrl: p.get('url') || '', MessageBody: p.get('body') || '' });
        const ok = r.status === 200 && r.body.includes('<MessageId>');
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent(ok ? 'Message sent.' : 'Send failed.') });
      } catch (e) {
        res.writeHead(302, { location: '/cloud?msg=' + encodeURIComponent('Send failed: ' + e.message) });
      }
      res.end();
    });
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
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => {
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
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(flowNewPage(user, e.message));
          }
        });
        return;
      }
      if (parts.length === 2 && req.method === 'GET') {
        const flow = flowEngine.getFlow(flowStore, parts[1]);
        if (flow.owner !== user.sub) { res.writeHead(404); res.end('not found'); return; }
        const runs = flowEngine.listRuns(flowStore, flow.id);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(shell(user, 'flow', flow.name, `<div class=greet>${esc(flow.name)}</div>
<p class=gsub>${esc(flow.starter.type)} · ${esc(flow.starter.name)} · ${flow.enabled ? 'On' : 'Off'}</p>
${flowTabs('list')}
<ol>${flow.steps.map((s) => `<li>${esc(s.connector)}.${esc(s.action)}</li>`).join('')}</ol>
<form method=post action="/flow/${esc(flow.id)}/${flow.enabled ? 'disable' : 'enable'}"><button class=btn-sec type=submit>${flow.enabled ? 'Disable' : 'Enable'}</button></form>
${flow.enabled ? `<form method=post action="/flow/${esc(flow.id)}/run"><button class=btn type=submit data-testid="run-flow">Run now</button></form>` : ''}
<h3 class=sec>Recent runs</h3>
${runs.length ? `<table class=flowtable data-testid="flow-activity"><tbody>${runs.map((r) => `<tr data-testid="run-row"><td>${esc(r.startedAt)}</td><td>${esc(r.status)}</td><td>${r.steps.map((s) => esc(s.connector + '.' + s.action + ':' + (s.outcome && s.outcome.ok ? 'ok' : 'error'))).join('; ')}</td></tr>`).join('')}</tbody></table>` : '<p class=gsub>No runs yet.</p>'}`));
        return;
      }
      if (parts.length === 3 && req.method === 'POST' && (parts[2] === 'enable' || parts[2] === 'disable' || parts[2] === 'run')) {
        const flow = flowEngine.getFlow(flowStore, parts[1]);
        if (flow.owner !== user.sub) { res.writeHead(404); res.end('not found'); return; }
        if (parts[2] === 'run') {
          flowEngine.trigger(flowStore, flow.id, representativeEvent(flow), flowConnectors);
        } else {
          flowEngine.setEnabled(flowStore, flow.id, parts[2] === 'enable');
        }
        persistFlow();
        res.writeHead(302, { location: parts[2] === 'run' ? '/flow/activity' : '/flow/' + flow.id });
        res.end();
        return;
      }
    } catch (e) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end(e.message);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  if (url.pathname === '/' || url.pathname === '/home') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(user ? homePage(user) : signinPage());
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

module.exports = { shell, signinPage, navGroups, page, sign, verifySession, APPS, liveApps };

if (require.main === module) {
  server.listen(port, HOST, () => console.log(`blak-portal listening on ${HOST}:${port}`));
}
