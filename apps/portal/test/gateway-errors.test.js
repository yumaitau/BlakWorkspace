'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { request } = require('./http-fixture');

// Run with BLAK_NGINX_BIN=/path/to/nginx. Uses isolated ports and a fake app.
test('gateway renders browser failures, preserves API bodies, and sends POSTs only once', { skip: !process.env.BLAK_NGINX_BIN }, async () => {
  let posts = 0;
  const app = http.createServer((req, res) => {
    if (req.url === '/api/cloud-access') { res.writeHead(401); res.end(); return; }
    if (req.method === 'POST') posts++;
    res.writeHead(req.url === '/outage' ? 503 : req.url === '/ok' ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream detail', method: req.method }));
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const portProbe = http.createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blak-gateway-'));
  const root = path.resolve(__dirname, '../../..');
  fs.mkdirSync(path.join(dir, 'html/_blak'), { recursive: true });
  fs.cpSync(path.join(root, 'services/workspace-shell/errors'), path.join(dir, 'html/_blak/errors'), { recursive: true });
  let config = fs.readFileSync(path.join(root, 'services/workspace-shell/nginx.conf'), 'utf8')
    .replace('listen 8080;', `listen 127.0.0.1:${port};`)
    .replace('resolver kube-dns.kube-system.svc.cluster.local', 'resolver 127.0.0.1')
    .replaceAll('/usr/share/nginx/html', path.join(dir, 'html'))
    .replace(/(\.workspace\.example\.com )[a-z-]+\.blak-micro\.svc\.cluster\.local:\d+/g, `$1127.0.0.1:${app.address().port}`)
    .replace(/http:\/\/[a-z-]+\.blak-micro\.svc\.cluster\.local:\d+/g, `http://127.0.0.1:${app.address().port}`);
  // Different upstreams become one test server; use the original host for the guard.
  config = config.replace(/map \$blak_upstream \$blak_cloud_guard \{[^}]+\}/, 'map $host $blak_cloud_guard { default ""; cloud.workspace.example.com "1"; }');
  config = config.replace('map "$blak_upstream:$uri" $blak_vault_admin', 'map "$host:$uri" $blak_vault_admin')
    .replace('~^vault\\.blak-micro\\.svc\\.cluster\\.local:8080:', '~^vault\\.workspace\\.example\\.com:');
  fs.writeFileSync(path.join(dir, 'nginx.conf'), `pid ${dir}/nginx.pid; error_log ${dir}/error.log; worker_processes 1; events { worker_connections 64; } http { types { text/html html; application/json json; } ${config} }`);
  const run = args => spawnSync(process.env.BLAK_NGINX_BIN, ['-p', dir, '-c', path.join(dir, 'nginx.conf'), ...args], { encoding: 'utf8', timeout: 10000 });
  try {
    const started = run([]);
    assert.equal(started.status, 0, started.stderr);
    const get = (route, headers = {}, method = 'GET') => request(`http://127.0.0.1:${port}${route}`, { headers: { host: 'portal.workspace.example.com', ...headers }, method, body: method === 'POST' ? 'a=1' : undefined });
    for (const [route, status] of [['/missing', 404], ['/outage', 503], ['/_blak/missing', 404]]) {
      const response = await get(route, { accept: 'text/html' });
      assert.equal(response.status, status);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.match(await response.text(), /Go Home/, fs.readFileSync(path.join(dir, 'error.log'), 'utf8'));
      assert.doesNotMatch(await response.text(), /upstream detail/);
    }
    for (const headers of [{ accept: 'application/json' }, { accept: 'text/html', 'sec-fetch-dest': 'empty' }, { accept: 'text/html;q=0' }]) {
      const response = await get('/missing', headers);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, 'upstream detail');
    }
    const hiddenAdmin = await get('/admin', { host: 'vault.workspace.example.com', accept: 'text/html' });
    assert.equal(hiddenAdmin.status, 404);
    assert.match(await hiddenAdmin.text(), /Go Home/);
    const unknownHost = await get('/missing', { host: 'missing.example', accept: 'text/html' });
    assert.equal(unknownHost.status, 421);
    assert.match(await unknownHost.text(), /Go Home/);
    const post = await get('/missing', { 'sec-fetch-dest': 'document' }, 'POST');
    assert.equal(post.status, 404);
    assert.match(await post.text(), /Go Home/);
    assert.equal(posts, 1);
    const head = await get('/missing', { 'sec-fetch-dest': 'document' }, 'HEAD');
    assert.equal(head.status, 404);
    assert.equal(await head.text(), '');
    assert.equal((await (await get('/ok', { accept: 'text/html' })).json()).method, 'GET');
    const guard = await get('/missing', { host: 'cloud.workspace.example.com', accept: 'text/html' });
    assert.equal(guard.status, 302);
    assert.equal(guard.headers.get('location'), 'https://portal.workspace.example.com/login');
  } finally {
    if (fs.existsSync(path.join(dir, 'nginx.pid'))) run(['-s', 'quit']);
    await new Promise(resolve => app.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
