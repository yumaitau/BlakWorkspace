'use strict';
// Operator-only dedicated fixtures. Secret values stay in memory and never enter reports.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const namespace = process.env.BLAK_E2E_NAMESPACE || 'blak-micro';
function kubectl(args) {
  return execFileSync('kubectl', ['-n', namespace, ...args], { encoding: 'utf8', timeout: 210000, stdio: ['pipe', 'pipe', 'pipe'] });
}
function syncAccount() {
  const secret = JSON.parse(kubectl(['get', 'secret', 'blak-hermes-sync', '-o', 'json']));
  const accounts = JSON.parse(Buffer.from(secret.data['accounts.json'], 'base64')).accounts;
  const account = process.env.BLAK_SYNC_ACCOUNT ? accounts.find(item => item.name === process.env.BLAK_SYNC_ACCOUNT) : accounts[0];
  if (!account) throw new Error('Configured sync account not found');
  return account;
}
function serviceURL(name, port) {
  const overrides=JSON.parse(process.env.BLAK_E2E_SERVICE_ORIGINS||'{}');
  if(overrides[name]) return overrides[name];
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
      const pod = kubectl(['get', 'pods', '-l', `job-name=${name}`, '--field-selector=status.phase=Succeeded', '-o', 'jsonpath={.items[0].metadata.name}']);
      if (!pod) throw new Error('Completed sync job has no successful pod');
      const logs = kubectl(['logs', pod]);
      if (logs.includes('Sync complete')) return logs;
      if (!logs.includes('Another sync is active')) throw new Error('Sync did not complete; inspect job ' + name);
    } finally {
      kubectl(['delete', 'job', name, '--wait=false']);
    }
  }
  throw new Error('Scheduled sync remained busy after three attempts');
}
module.exports = { syncAccount, serviceURL, syncNow };
