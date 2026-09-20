import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('tailnet',ROOT/'scripts/deploy/prepare-tailnet.py')
tailnet=importlib.util.module_from_spec(spec)
spec.loader.exec_module(tailnet)


class TailnetReleaseTests(unittest.TestCase):
    def test_rejects_unrelated_host_before_touching_release(self):
        with self.assertRaises(ValueError):tailnet.configure(Path('/missing'),'bad.example.net','100.64.0.1')

    def test_origins_remain_distinct_and_preserve_site_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'.deployment.json').write_text(json.dumps({'domain':'workspace.example.com','revision':'test'}))
            (root/'deploy/k3s/micro').mkdir(parents=True)
            (root/'services/workspace-shell').mkdir(parents=True)
            (root/'services/workspace-shell/nginx.conf').write_text((ROOT/'services/workspace-shell/nginx.conf').read_text())
            (root/'e2e').mkdir()
            fixture=root/'e2e/probe.js'
            fixture.write_text("u.hostname === 'crm.workspace.example.com'; u.hostname === \"forms.workspace.example.com\"; const url='https://crm.workspace.example.com'; Domain=workspace.example.com")
            site=root/'site.py';site.write_text("SITE='crm.workspace.example.com'\nURL='https://crm.workspace.example.com'")
            origins=tailnet.configure(root,'demo.tail123.ts.net','100.64.0.1')
            self.assertEqual(origins['portal'],'https://demo.tail123.ts.net')
            self.assertEqual(len(set(origins.values())),len(origins))
            self.assertNotIn(8443,tailnet.PORTS.values())
            self.assertIn("u.host === 'demo.tail123.ts.net:8450'",fixture.read_text())
            self.assertIn('u.host === "demo.tail123.ts.net:8449"',fixture.read_text())
            self.assertIn('Domain=demo.tail123.ts.net',fixture.read_text())
            self.assertIn("SITE='crm.workspace.example.com'",site.read_text())
            gateway=(root/'services/workspace-shell/nginx.conf').read_text()
            self.assertIn('map $http_host $blak_upstream',gateway)
            self.assertIn('demo.tail123.ts.net:8444 authentik-server.blak-micro.svc.cluster.local:9000;',gateway)
            self.assertIn('portal.workspace.example.com portal.blak-micro.svc.cluster.local:3000;',gateway)
            with self.assertRaises(ValueError):tailnet.configure(root,'demo.tail123.ts.net','100.64.0.1')
