'use strict';
// Operator-only homelab fixtures. Secret values stay in memory and never enter reports.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const namespace = process.env.BLAK_E2E_NAMESPACE || 'blak-micro';
function kubectl(args) {
  return execFileSync('kubectl', ['-n', namespace, ...args], { encoding: 'utf8', timeout: 210000, stdio: ['pipe', 'pipe', 'pipe'] });
}
function syncAccount() {
  const secret = JSON.parse(kubectl(['get', 'secret', 'blak-hermes-sync', '-o', 'json']));
  return JSON.parse(Buffer.from(secret.data['accounts.json'], 'base64')).accounts[0];
}
function serviceURL(name, port) {
  const address = kubectl(['get', 'service', name, '-o', 'jsonpath={.spec.clusterIP}']);
  return `http://${address}:${port}`;
}
function syncNow() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const schedule = JSON.parse(kubectl(['get', 'cronjob', 'hermes-workspace-sync', '-o', 'json']));
    for (const active of schedule.status?.active || []) {
      kubectl(['wait', '--for=condition=complete', `job/${active.name}`, '--timeout=180s']);
    }
    const name = 'hermes-e2e-' + crypto.randomBytes(5).toString('hex');
    kubectl(['create', 'job', name, '--from=cronjob/hermes-workspace-sync']);
    try {
      kubectl(['wait', '--for=condition=complete', `job/${name}`, '--timeout=180s']);
      const logs = kubectl(['logs', `job/${name}`]);
      if (logs.includes('Sync complete')) return logs;
      if (!logs.includes('Another sync is active')) throw new Error('Sync did not complete; inspect job ' + name);
    } finally {
      kubectl(['delete', 'job', name, '--wait=false']);
    }
  }
  throw new Error('Scheduled sync remained busy after three attempts');
}
module.exports = { syncAccount, serviceURL, syncNow };
