from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/app-roles'))
import drive


class DriveRolesTest(unittest.TestCase):
    def test_complete_snapshot_preserves_subject_and_revokes_ungranted_accounts(self):
        calls = []
        def api(method, path, body):
            calls.append((method, path, body))
            return {'success': True, 'members': 3}
        drive.reconcile(api, {
            'frozen-subject': {'identity': 'uuid', 'is_active': True, 'roles': {'drive': 'reader'}},
            'disabled': {'is_active': False, 'roles': {}},
            'other-app': {'is_active': True, 'roles': {'chat': 'admin'}},
        })
        self.assertEqual(calls, [('POST', '/blak/roles/reconcile', {'members': [
            {'subject': 'frozen-subject', 'active': True, 'role': 'reader'},
            {'subject': 'disabled', 'active': False, 'role': ''},
            {'subject': 'other-app', 'active': True, 'role': ''},
        ]})])

    def test_incomplete_or_unacknowledged_directory_is_rejected(self):
        with self.assertRaises(ValueError):
            drive.reconcile(lambda *args: self.fail('Empty directory must not be published'), {})
        member = {'subject': {'is_active': True, 'roles': {'drive': 'writer'}}}
        for response in ({'success': False}, {'success': True, 'members': True},
                         {'success': True, 'members': 0}, {'success': True, 'members': 2}):
            with self.subTest(response=response), self.assertRaises(ValueError):
                drive.reconcile(lambda *args: response, member)
