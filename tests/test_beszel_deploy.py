import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts/deploy' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

publish = load('publish-beszel')
provision = load('provision-beszel')


class BeszelDeploymentTests(unittest.TestCase):
    def test_routes_preserve_other_services_and_repeat_safely(self):
        original = "map $host $blak_upstream {\n  default '';\n  drive.example.org drive:9200;\n}\n"
        updated = publish.route(original, 'https://node.example.org:8457')
        self.assertIn('drive.example.org drive:9200;', updated)
        self.assertIn('node.example.org:8457 beszel.blak-micro.svc.cluster.local:8090;', updated)
        self.assertEqual(publish.route(updated, 'https://node.example.org:8457'), updated)

    def test_existing_origin_cannot_be_taken_over(self):
        with self.assertRaises(ValueError):
            publish.route('map $host $blak_upstream {\n  monitor.example.org other:8080;\n}\n', 'https://monitor.example.org')

    def test_origin_rejects_templates_insecure_urls_and_credentials(self):
        self.assertEqual(provision.public_origin('https://monitor.example.org/'), 'https://monitor.example.org')
        for value in ['', 'http://monitor.example.org', 'https://monitoring.workspace.example.com',
                      'https://user:pass@monitor.example.org', 'https://monitor.example.org/path',
                      'https://monitor.example.org/?redirect=elsewhere']:
            with self.assertRaises(ValueError):
                provision.public_origin(value)

    def test_retirement_preserves_other_mounts_and_clears_both_account_fields(self):
        document = {'metadata': {'resourceVersion': '12'}, 'spec': {'template': {'spec': {
            'serviceAccountName': 'portal-monitor', 'serviceAccount': 'portal-monitor',
            'containers': [{'name': 'portal', 'volumeMounts': [{'name': 'data'}, {'name': 'portal-monitor'}]}],
            'volumes': [{'name': 'data'}, {'name': 'portal-monitor'}],
        }}}}
        result = copy.deepcopy(document)
        for item in publish.retire_portal_metrics(document):
            parts = item['path'].strip('/').split('/')
            parent = result
            for part in parts[:-1]:
                parent = parent[int(part)] if isinstance(parent, list) else parent[part]
            key = int(parts[-1]) if isinstance(parent, list) else parts[-1]
            if item['op'] == 'test': self.assertEqual(parent[key], item['value'])
            elif item['op'] == 'remove': del parent[key]
            else: parent[key] = item['value']
        spec = result['spec']['template']['spec']
        self.assertNotIn('serviceAccountName', spec)
        self.assertNotIn('serviceAccount', spec)
        self.assertFalse(spec['automountServiceAccountToken'])
        self.assertEqual(spec['volumes'], [{'name': 'data'}])
        self.assertEqual(spec['containers'][0]['volumeMounts'], [{'name': 'data'}])
