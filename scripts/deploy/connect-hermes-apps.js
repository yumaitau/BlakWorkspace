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
  const requested = process.env.BLAK_SYNC_ACCOUNT;
  const mapping = requested ? config.accounts.find(a => a.name === requested) : (config.accounts.length === 1 ? config.accounts[0] : undefined);
  if (!mapping) throw new Error('Set BLAK_SYNC_ACCOUNT to an existing mapping when multiple accounts are configured');
  const hermesIP = kube(['get', 'service', 'hermes', '-o', 'jsonpath={.spec.clusterIP}']);
  const response = await fetch(`http://${hermesIP}:8080/api/v1/auths/`, { headers: { authorization: 'Bearer ' + mapping.hermes.token } });
  if (!response.ok) throw new Error('Hermes identity verification failed');
  const hermes = await response.json();
  if (hermes.id !== mapping.owner_id || !hermes.email) throw new Error('Hermes mapping owner mismatch');
  process.env.BLAK_E2E_USER ||= 'akadmin';
  process.env.BLAK_E2E_PASSWORD ||= secret('blak-idp')['bootstrap-password'];
  const browser = process.env.PLAYWRIGHT_WS_ENDPOINT
    ? await chromium.connect(process.env.PLAYWRIGHT_WS_ENDPOINT)
    : await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, ...require('../../e2e/helpers/network').publicNetworkOptions });
    const page = await context.newPage();
    stage = 'portal sign-in';
    await page.goto('https://portal.workspace.example.com/login');
    await authentikLogin(page);
    await page.waitForURL(u => u.hostname === 'portal.workspace.example.com' && u.pathname === '/');
    const profile = await page.request.get('https://portal.workspace.example.com/api/me');
    if (!profile.ok()) throw new Error('Portal identity verification failed');
    const identity = await profile.json();
    if (!identity.sub || !identity.identity) throw new Error('Portal immutable identity is missing');
    // Verify the native account reached through this same Blak ID session.
    // Email is mutable and must never serve as an account-linking key.
    await page.goto('https://hermes.workspace.example.com/oauth/oidc/login');
    await page.waitForURL(url => url.origin === 'https://hermes.workspace.example.com' && url.pathname === '/');
    await page.waitForFunction(() => Boolean(localStorage.getItem('token')));
    const nativeOwner = await page.evaluate(async () => {
      const response = await fetch('/api/v1/auths/', { headers: { authorization: 'Bearer ' + localStorage.getItem('token') } });
      if (!response.ok) throw Error('Native Hermes identity verification failed');
      return (await response.json()).id;
    });
    if (nativeOwner !== mapping.owner_id) throw new Error('Portal SSO reached a different native Hermes owner');
    mapping.portal_owner = identity.sub;
    mapping.credential_metadata ||= {};
    const checkedAt = Math.floor(Date.now()/1000);
    delete mapping.sources.forms;
    delete mapping.credential_metadata.forms;
    const token = mapping.sources.draw?.token || crypto.randomBytes(40).toString('base64url');
    for (const source of ['draw', 'flow']) mapping.sources[source] = { base: 'http://portal:3000', public_base: 'https://portal.workspace.example.com', token, expected_user: identity.sub };
    const exporters = JSON.parse(secret('blak-portal-exports')['accounts.json'] || '[]').filter(a => a.owner !== identity.sub);
    exporters.push({ owner: identity.sub, sha256: crypto.createHash('sha256').update(token).digest('hex') });
    save('blak-portal-exports', { 'accounts.json': JSON.stringify(exporters) });
    stage = 'CRM API credential';
    const script = fs.readFileSync(path.join(__dirname, '../../services/frappe/export-credentials.py'), 'utf8');
    const crm = JSON.parse(kube(['exec', '-i', 'deploy/frappe-crm', '-c', 'backend', '--', 'env/bin/python', '-c', script], JSON.stringify({ email: hermes.email }) + '\n'));
    mapping.sources.crm = { base: 'http://crm:3000', public_base: 'https://crm.workspace.example.com', expected_user: hermes.email,
      headers: { Authorization: 'token ' + crm.api_key + ':' + crm.api_secret } };
    mapping.sources.storage = { base: 'http://floci:4566', public_base: 'https://portal.workspace.example.com/cloud' };
    for (const source of ['draw','flow','crm','storage']) mapping.credential_metadata[source] = { ...mapping.credential_metadata[source], checked_at: checkedAt };
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
    console.log('CRM, Draw, Flow and Cloud files connected to verified private Hermes owner');
  } finally { await browser.close(); }
}
main().catch(error => { console.error('Hermes connector enrolment failed:', stage, error.name); process.exitCode = 1; });
