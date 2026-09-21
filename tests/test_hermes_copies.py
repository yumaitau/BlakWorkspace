import fcntl
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/app-roles'))
import hermes_copies as copies
from http_client import NativeAPIError


class CopyRevocationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.file = Path(self.temp.name) / 'state.json'
        self.state = {'mapping': {'draw': {'collection': 'collection', 'files': {'document': {'file_id': 'copy'}}}}}
        copies.save(self.file, self.state)
        copies.save(self.file.with_name('owners.json'), {'mapping': {'native_id': 'owner', 'subject': 'frozen'}})
        self.directory = {'frozen': {'is_active': True, 'apps': ['hermes']}}
        self.calls = []
        self.deleted, self.fail_model = False, False
    def api(self, method, path, data=None):
        self.calls.append((method, path, data))
        if path == '/api/v1/users/owner/update': return {}
        if path == '/api/v1/files/copy':
            if method == 'DELETE': self.deleted = True; return {}
            if self.deleted: raise NativeAPIError(404)
            return {'user_id': 'owner'}
        if path.startswith('/api/v1/models/model?id='):
            return {'user_id': 'owner', 'id': 'model', 'name': 'Workspace', 'base_model_id': 'base', 'params': {}, 'access_grants': [], 'is_active': True, 'meta': {'knowledge': [{'id': 'collection'}, {'id': 'unrelated'}]}}
        if path == '/api/v1/models/model/update':
            if self.fail_model: raise NativeAPIError(503)
            self.assertEqual(data['meta']['knowledge'], [{'id': 'unrelated'}]); return {}
        raise AssertionError(path)
    def run_cleanup(self): return copies.reconcile(self.api, self.directory, self.file, 'controller')
    def test_revocation_pauses_token_before_deletion_and_detaches_only_managed_source(self):
        self.assertEqual(self.run_cleanup(), 1)
        self.assertEqual(self.calls[0], ('POST', '/api/v1/users/owner/update', {'role': 'pending'}))
        source = copies.read(self.file)['mapping']['draw']
        self.assertEqual(source['files'], {})
        self.assertNotIn('revocation_pending', source)
    def test_busy_sync_keeps_native_account_pending_and_preserves_state(self):
        with self.file.with_suffix('.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(RuntimeError): self.run_cleanup()
        self.assertFalse(any(method == 'DELETE' for method, _, _ in self.calls))
        self.assertEqual(copies.read(self.file), self.state)
        self.assertEqual(self.calls[0][2], {'role': 'pending'})
    def test_partial_model_failure_remains_durable_after_last_file_deleted(self):
        self.fail_model = True
        with self.assertRaises(NativeAPIError): self.run_cleanup()
        record = copies.read(self.file)['mapping']['draw']
        self.assertEqual(record['files'], {})
        self.assertTrue(record['revocation_pending'])
        self.fail_model = False
        self.assertEqual(self.run_cleanup(), 0)
        self.assertNotIn('revocation_pending', copies.read(self.file)['mapping']['draw'])
    def test_granted_source_is_untouched(self):
        self.directory['frozen']['apps'].append('draw')
        self.assertEqual(self.run_cleanup(), 0)
        self.assertEqual(self.calls, [])
    def test_missing_owner_binding_is_not_a_deletion_authority(self):
        self.file.with_name('owners.json').unlink()
        with self.assertRaises(ValueError): self.run_cleanup()
        self.assertEqual(self.calls, [])
    def test_foreign_file_is_never_deleted(self):
        def api(method, path, data=None):
            if path.startswith('/api/v1/files/'):
                self.assertEqual(method, 'GET')
                return {'user_id': 'other-owner'}
            return self.api(method, path, data)
        with self.assertRaises(ValueError): copies.reconcile(api, self.directory, self.file, 'controller')
        self.assertFalse(self.deleted)
