"""Release checks for the vault's isolation and authentication boundaries."""
from pathlib import Path
import importlib.util
import base64
import io
import json
import unittest
from unittest.mock import MagicMock, patch
import yaml

ROOT = Path(__file__).resolve().parents[1]


class VaultConfigurationTests(unittest.TestCase):
    def test_enrollment_preserves_other_apps_and_uses_resource_version(self):
        spec = importlib.util.spec_from_file_location('role_enrollment', ROOT / 'services/app-roles/enrollment.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        existing = {'metadata': {'resourceVersion': '42'}, 'data': {'config.json': base64.b64encode(json.dumps({'hermes': {'token': 'fixture'}}).encode()).decode()}}
        with patch.object(module.subprocess, 'check_output', return_value=json.dumps(existing).encode()), patch.object(module.subprocess, 'run') as write:
            module.save_app(['kubectl'], 'vault', {'organization_id': 'fixture-org'})
        saved = json.loads(write.call_args.kwargs['input'])
        self.assertEqual(saved['metadata']['resourceVersion'], '42')
        self.assertEqual(json.loads(saved['stringData']['config.json']), {'hermes': {'token': 'fixture'}, 'vault': {'organization_id': 'fixture-org'}})

    def test_enrollment_preserves_normalized_owner_protection(self):
        spec = importlib.util.spec_from_file_location('enroll_vault_roles', ROOT / 'scripts/deploy/enroll-vault-roles.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        collection = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        data = {'controller_user_id': owner.upper(), 'organization_id': org.upper(),
                'collection_ids': [collection.upper()], 'client_id': 'user.' + owner,
                'client_secret': 'disposable-test-api-key'}
        responses = {
            '/api/accounts/profile': {'id': owner},
            '/api/organizations/' + org + '/users': {'data': [{'userId': owner, 'type': 0, 'status': 2}]},
            '/api/organizations/' + org + '/collections': {'data': [{'id': collection}]},
        }
        api = MagicMock(side_effect=lambda method, route: responses[route])
        with patch.object(module, 'API', return_value=api), \
                patch.object(module.Path, 'read_text', return_value=json.dumps({'domain': 'workspace.test'})), \
                patch.object(module.sys, 'stdin', io.StringIO(json.dumps(data))), \
                patch.object(module.subprocess, 'check_output', return_value=b''), \
                patch.object(module.subprocess, 'run') as write, patch('builtins.print'):
            module.main()
        secret = json.loads(write.call_args.kwargs['input'])
        config = json.loads(secret['stringData']['config.json'])['vault']
        self.assertEqual(config['controller_user_id'], owner)
        self.assertEqual(config['organization_id'], org)
        self.assertEqual(config['collection_ids'], [collection])

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
