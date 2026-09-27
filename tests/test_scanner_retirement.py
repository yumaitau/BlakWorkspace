import copy
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location('retire', Path(__file__).resolve().parents[1] / 'scripts/deploy/retire-file-guard.py')
retire = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(retire)


def apply(document, patches):
    result = copy.deepcopy(document)
    for patch in patches:
        parts = patch['path'].strip('/').split('/')
        parent = result
        for part in parts[:-1]:
            parent = parent[int(part)] if isinstance(parent, list) else parent[part]
        key = int(parts[-1]) if isinstance(parent, list) else parts[-1]
        if patch['op'] == 'test':
            assert parent[key] == patch['value']
        else:
            del parent[key]
    return result


class RetirementTests(unittest.TestCase):
    def test_removes_old_and_new_sidecars_preserving_drive_and_storage(self):
        for code_volume in ['file-guard-code', 'scanner-code']:
            drive = {'name': 'opencloud', 'image': 'existing', 'env': [{'name': 'OC_URL', 'value': 'https://drive.example.org'}]}
            data = {'name': 'data', 'persistentVolumeClaim': {'claimName': 'opencloud-data'}}
            document = {'kind': 'Deployment', 'metadata': {'name': 'opencloud', 'resourceVersion': '42'}, 'spec': {'template': {'spec': {
                'containers': [{'name': 'file-guard'}, drive],
                'volumes': [data, {'name': 'file-guard-data'}, {'name': code_volume, 'configMap': {'name': 'blak-file-guard-code'}}],
            }}}}
            result = apply(document, retire.retirement_patch(document))
            self.assertEqual(result['spec']['template']['spec'], {'containers': [drive], 'volumes': [data]})
            self.assertEqual(retire.retirement_patch(result), [])

    def test_preserves_portal_origins_and_other_environment(self):
        env = [{'name': 'BLAK_APP_ORIGINS', 'value': '{"drive":"https://drive.example.org"}'}, {'name': 'FILE_GUARD_URL'}, {'name': 'FILE_GUARD_TOKEN'}, {'name': 'CLAMAV_HOST'}]
        document = {'kind': 'Deployment', 'metadata': {'name': 'portal', 'resourceVersion': '42'}, 'spec': {'template': {'spec': {'containers': [{'name': 'portal', 'env': env}]}}}}
        result = apply(document, retire.retirement_patch(document))
        self.assertEqual(result['spec']['template']['spec']['containers'][0]['env'], env[:1])
        self.assertEqual(retire.retirement_patch(result), [])

    def test_preserves_drive_and_docs_ports(self):
        ports = [{'name': 'http', 'port': 9200}, {'name': 'guard', 'port': 8092}, {'name': 'wopi', 'port': 9300}]
        document = {'kind': 'Service', 'metadata': {'name': 'drive', 'resourceVersion': '42'}, 'spec': {'ports': ports}}
        result = apply(document, retire.retirement_patch(document))
        self.assertEqual(result['spec']['ports'], [ports[0], ports[2]])
        self.assertEqual(retire.retirement_patch(result), [])
