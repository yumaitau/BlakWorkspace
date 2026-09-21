"""Release checks for the vault's isolation and authentication boundaries."""
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]


class VaultConfigurationTests(unittest.TestCase):
    def test_native_vault_is_non_root_and_has_no_cluster_credentials(self):
        docs = list(yaml.safe_load_all((ROOT / 'deploy/k3s/micro/96-vault.yaml').read_text()))
        pod = next(d for d in docs if d['kind'] == 'Deployment')['spec']['template']['spec']
        self.assertFalse(pod['automountServiceAccountToken'])
        self.assertTrue(pod['securityContext']['runAsNonRoot'])
        container = pod['containers'][0]
        self.assertTrue(container['securityContext']['readOnlyRootFilesystem'])
        self.assertEqual(container['securityContext']['capabilities']['drop'], ['ALL'])
        env = {v['name']: v.get('value') for v in container['env']}
        for key in ['SIGNUPS_ALLOWED', 'SSO_SIGNUPS_MATCH_EMAIL', 'SSO_ALLOW_UNKNOWN_EMAIL_VERIFICATION', 'SENDS_ALLOWED']:
            self.assertEqual(env[key], 'false', key)
        self.assertEqual(env['SSO_ONLY'], 'true')
        self.assertEqual(env['DISABLE_ICON_DOWNLOAD'], 'true')
        token = next(v for v in container['env'] if v['name'] == 'ADMIN_TOKEN')
        self.assertEqual(token['valueFrom']['secretKeyRef']['key'], 'admin-token-hash')

    def test_vault_gateway_has_no_shared_script_and_blocks_operator_ui(self):
        gateway = (ROOT / 'services/workspace-shell/nginx.conf').read_text()
        self.assertIn("vault.blak-micro.svc.cluster.local:8080 '';", gateway)
        self.assertIn('if ($blak_vault_admin) { return 404; }', gateway)
        dockerfile = (ROOT / 'services/vault/Dockerfile').read_text()
        self.assertIn('vaultwarden/server@sha256:', dockerfile)
        self.assertNotIn('shell.js', dockerfile)


if __name__ == '__main__':
    unittest.main()
