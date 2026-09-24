'use strict';
// Operator-only. Credential values stay in memory, out of arguments and artifacts.
const { execFileSync, spawnSync } = require('node:child_process');
const { localNetworkPolicy } = require('./helpers/local-network');

const env = { ...process.env, BLAK_E2E_LOCAL_ONLY: '1' };
const origins = JSON.parse(env.BLAK_E2E_LOCAL_ORIGINS || '[]');
const policy = localNetworkPolicy(origins);
for (const key of ['BLAK_E2E_BASE_URL', 'BLAK_E2E_IDP_URL', 'BLAK_E2E_DRIVE_URL']) {
  if (!env[key] || !policy.permits(env[key])) throw Error(`${key} must be an explicit allowed local URL`);
}
if (!env.KUBECONFIG) throw Error('Explicit KUBECONFIG required for owned document fixtures');
if (!env.BLAK_E2E_USER || !env.BLAK_E2E_PASSWORD) {
  if (env.BLAK_E2E_BOOTSTRAP !== '1') throw Error('Supply test credentials or explicitly opt into bootstrap credentials');
  const secret = JSON.parse(execFileSync('kubectl', [
    '--kubeconfig', env.KUBECONFIG, '--request-timeout=15s', '-n', env.BLAK_E2E_NAMESPACE || 'blak-micro',
    'get', 'secret', 'blak-idp', '-o', 'json',
  ], { encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] }));
  env.BLAK_E2E_USER = 'akadmin';
  env.BLAK_E2E_PASSWORD = Buffer.from(secret.data['bootstrap-password'], 'base64').toString();
}
const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
  'offline-core.spec.js', 'drive-renewal.spec.js', 'docs.spec.js', 'smith-field-guard.spec.js', '--workers=1', ...process.argv.slice(2)], {
  cwd: __dirname, env, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
