'use strict';
// Operator-only credential enrolment. All credentials remain in memory/Kubernetes.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('../../e2e/node_modules/@playwright/test');
const { authentikLogin } = require('../../e2e/helpers/auth');
const NS = 'blak-micro';
let stage = 'Hermes identity';
function kube(args, input) {
  return execFileSync('kubectl', ['-n', NS, ...args], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 });
}
function secret(name) {
  const raw = kube(['get', 'secret', name, '--ignore-not-found', '-o', 'json']);
  if (!raw.trim()) return {};
  return Object.fromEntries(Object.entries(JSON.parse(raw).data || {}).map(([k, v]) => [k, Buffer.from(v, 'base64').toString()]));
}
function save(name, values) {
  kube(['apply', '-f', '-'], JSON.stringify({ apiVersion: 'v1', kind: 'Secret', metadata: { name, namespace: NS }, stringData: values }));
}
async function main() {
  const values = secret('blak-hermes-sync');
  const config = JSON.parse(values['accounts.json']);
  const mapping = config.accounts.find(a => a.name === (process.env.BLAK_SYNC_ACCOUNT || 'homelab-admin'));
  if (!mapping) throw new Error('Requested Hermes account mapping is missing');
  const hermesIP = kube(['get', 'service', 'hermes', '-o', 'jsonpath={.spec.clusterIP}']);
  const response = await fetch(`http://${hermesIP}:8080/api/v1/auths/`, { headers: { authorization: 'Bearer ' + mapping.hermes.token } });
  if (!response.ok) throw new Error('Hermes identity verification failed');
  const hermes = await response.json();
  if (hermes.id !== mapping.owner_id || !hermes.email) throw new Error('Hermes mapping owner mismatch');
  process.env.BLAK_E2E_USER ||= 'akadmin';
  process.env.BLAK_E2E_PASSWORD ||= secret('blak-idp')['bootstrap-password'];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    stage = 'portal sign-in';
    await page.goto('https://portal.homelab.local/login');
    await authentikLogin(page);
    await page.waitForURL(u => u.hostname === 'portal.homelab.local' && u.pathname === '/');
    const session = (await context.cookies('https://portal.homelab.local')).find(c => c.name === 'blak_session');
    const identity = JSON.parse(Buffer.from(session.value.split('.')[0], 'base64url').toString());
    if (identity.email !== hermes.email || !identity.sub) throw new Error('Portal and Hermes identities differ');
    stage = 'Forms sign-in';
    await page.goto('https://forms.homelab.local');
    await page.getByRole('button', { name: 'Blak ID', exact: true }).click();
    await page.waitForURL(u => u.hostname === 'forms.homelab.local' && u.pathname.startsWith('/workspace/'));
    const detail = await page.request.post('https://forms.homelab.local/graphql', { data: { query: '{userDetail{id email}}' } });
    const user = (await detail.json()).data?.userDetail;
    if (user?.email !== hermes.email) throw new Error('Forms and Hermes identities differ');
    const cookies = await context.cookies('https://forms.homelab.local');
    mapping.sources.forms = { base: 'http://forms:9157', public_base: 'https://forms.homelab.local', expected_user: hermes.email,
      headers: { Cookie: cookies.map(c => c.name + '=' + c.value).join('; ') } };
    const token = mapping.sources.draw?.token || crypto.randomBytes(40).toString('base64url');
    for (const source of ['draw', 'flow']) mapping.sources[source] = { base: 'http://portal:3000', public_base: 'https://portal.homelab.local', token, expected_user: identity.sub };
    const exporters = JSON.parse(secret('blak-portal-exports')['accounts.json'] || '[]').filter(a => a.owner !== identity.sub);
    exporters.push({ owner: identity.sub, sha256: crypto.createHash('sha256').update(token).digest('hex') });
    save('blak-portal-exports', { 'accounts.json': JSON.stringify(exporters) });
    stage = 'CRM API credential';
    const script = fs.readFileSync(path.join(__dirname, '../../services/frappe/export-credentials.py'), 'utf8');
    const crm = JSON.parse(kube(['exec', '-i', 'deploy/frappe-crm', '-c', 'backend', '--', 'env/bin/python', '-c', script], JSON.stringify({ email: hermes.email }) + '\n'));
    mapping.sources.crm = { base: 'http://crm:3000', public_base: 'https://crm.homelab.local', expected_user: hermes.email,
      headers: { Authorization: 'token ' + crm.api_key + ':' + crm.api_secret } };
    mapping.sources.storage = { base: 'http://floci:4566', public_base: 'https://portal.homelab.local/cloud' };
    save('blak-hermes-sync', { 'accounts.json': JSON.stringify(config) });
    stage = 'portal credential projection';
    const portalIP = kube(['get', 'service', 'portal', '-o', 'jsonpath={.spec.clusterIP}']);
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      const result = await fetch(`http://${portalIP}:3000/api/knowledge-export/draw`, { headers: { authorization: 'Bearer ' + token } });
      if (result.ok && (await result.json()).owner === identity.sub) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error('Portal export credential projection is not ready');
    console.log('CRM, Forms, Draw, Flow and Cloud files connected to verified private Hermes owner');
  } finally { await browser.close(); }
}
main().catch(error => { console.error('Hermes connector enrolment failed:', stage, error.name); process.exitCode = 1; });
