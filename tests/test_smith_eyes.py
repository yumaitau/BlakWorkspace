"""BlakSmith and BlakEyes are catalog apps with shell routes and deploy pins."""
import importlib.util
import json
import subprocess
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load_tailnet():
    spec = importlib.util.spec_from_file_location('tailnet', ROOT / 'scripts/deploy/prepare-tailnet.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SmithEyesTests(unittest.TestCase):
    def test_catalog_and_shell_agree(self):
        apps = json.loads(subprocess.check_output(
            ['node', '-e', "console.log(JSON.stringify(require('./apps/portal/catalog.js').APPS))"],
            cwd=ROOT, text=True,
        ))
        by_id = {app['id']: app for app in apps}
        self.assertEqual(by_id['smith']['oidcClient'], 'blaksmith')
        self.assertEqual(by_id['eyes']['oidcClient'], 'blak-eyes')
        self.assertEqual(by_id['smith']['check']['port'], 3000)
        self.assertEqual(by_id['eyes']['check']['port'], 8765)
        self.assertIn('BlakEyes', by_id['eyes']['backend'])
        icons = json.loads(subprocess.check_output(
            ['node', '-e', "console.log(JSON.stringify(Object.keys(require('./apps/portal/brand.js').APP_ICONS)))"],
            cwd=ROOT, text=True,
        ))
        self.assertIn('smith', icons)
        self.assertIn('eyes', icons)
        shell = json.loads((ROOT / 'services/workspace-shell/apps.json').read_text())
        shell_ids = {app['id'] for app in shell}
        self.assertIn('smith', shell_ids)
        self.assertIn('eyes', shell_ids)
        nginx = (ROOT / 'services/workspace-shell/nginx.conf').read_text()
        self.assertIn('smith.workspace.example.com smith.blak-micro.svc.cluster.local:3000;', nginx)
        self.assertIn('eyes.workspace.example.com eyes.blak-micro.svc.cluster.local:8765;', nginx)
        signout = (ROOT / 'services/workspace-shell/signout.js').read_text()
        self.assertIn("case 'smith'", signout)
        self.assertIn("case 'eyes'", signout)
        self.assertIn('X-BlakEyes-CSRF', signout)

    def test_tailnet_ports_follow_cloud(self):
        tailnet = load_tailnet()
        self.assertEqual(tailnet.PORTS['smith'], 8455)
        self.assertEqual(tailnet.PORTS['eyes'], 8456)
        self.assertEqual(tailnet.UPSTREAMS['smith'], 'smith:3000')
        self.assertEqual(tailnet.UPSTREAMS['eyes'], 'eyes:8765')
        self.assertNotIn(8443, tailnet.PORTS.values())

    def test_deploy_pins_and_manifests(self):
        smith_yaml = (ROOT / 'deploy/k3s/micro/99-smith.yaml').read_text()
        eyes_yaml = (ROOT / 'deploy/k3s/micro/99-eyes.yaml').read_text()
        self.assertIn('ghcr.io/yumaitau/blaksmith-postgres:sha-', smith_yaml)
        self.assertEqual(smith_yaml.count('imagePullSecrets: [{ name: ghcr-pull }]'), 3)
        self.assertIn('scripts/bootstrap-workspace.ts', smith_yaml)
        self.assertNotIn('BLAKSMITH_BOOTSTRAP_OWNER_EMAIL', smith_yaml)
        self.assertIn('BLAKSMITH_KEY_PROVIDER', smith_yaml)
        self.assertIn('ghcr.io/yumaitau/blakeyes:sha-', eyes_yaml)
        self.assertIn('imagePullSecrets: [{ name: ghcr-pull }]', eyes_yaml)
        self.assertIn('BLAKEYES_OIDC_ISSUER', eyes_yaml)
        self.assertIn('/application/o/blak-eyes/', eyes_yaml)
        self.assertIn('ghcr-pull', (ROOT / 'scripts/deploy/deploy-smith-eyes.sh').read_text())
        provider = (ROOT / 'scripts/deploy/ak-smith.py').read_text()
        self.assertIn('/api/auth/sso/callback/blak-id', provider)
        self.assertIn("scope_name': 'blaksmith'", provider)
        eyes_provider = (ROOT / 'scripts/deploy/ak-eyes.py').read_text()
        self.assertIn('/api/auth/oidc/callback', eyes_provider)
        self.assertIn("scope_name': 'blakeyes'", eyes_provider)
        self.assertIn('blak-eyes', (ROOT / 'scripts/deploy/ensure-secrets.sh').read_text())
        self.assertIn('provision-eyes.py', (ROOT / 'scripts/deploy/deploy-smith-eyes.sh').read_text())
