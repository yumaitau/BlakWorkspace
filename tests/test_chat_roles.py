from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/app-roles'))
import chat


class ChatRolesTest(unittest.TestCase):
    def test_native_binding_uses_frozen_subject_and_complete_revocation_snapshot(self):
        calls = []
        def api(method, path, body):
            calls.append((method, path, body))
            return {'success': True, 'created': 0, 'roles': 1, 'disabled': 1, 'activated': 0}
        chat.reconcile(api, {'legacy-subject': {'identity': 'directory-uuid', 'email': 'renamed@example.invalid', 'is_active': False, 'roles': {}}})
        self.assertEqual(calls[0], ('POST', '/api/v1/blak.roles.reconcile', {'members': [
            {'subject': 'legacy-subject', 'email': 'renamed@example.invalid', 'active': False, 'role': None}]}))

    def test_invalid_native_success_and_counts_are_rejected(self):
        for response in ({'success': False}, {'success': True, 'created': True, 'roles': 0, 'disabled': 0, 'activated': 0}):
            with self.subTest(response=response), self.assertRaises(ValueError):
                chat.reconcile(lambda *args: response, {})
