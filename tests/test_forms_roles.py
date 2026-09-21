import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('forms_roles', Path(__file__).parents[1] / 'services/app-roles/forms.py')
forms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(forms)


class FormsRolesTest(unittest.TestCase):
    def test_complete_snapshot_preserves_disabled_and_unrelated_app_members(self):
        calls = []
        counts = {'created': 0, 'roles': 1, 'disabled': 1, 'activated': 0}
        def api(method, path, body):
            calls.append((method, path, body))
            return counts
        directory = {
            'reader': {'email': 'reader@example.com', 'is_active': True, 'roles': {'forms': 'reader'}},
            'disabled': {'email': 'disabled@example.com', 'is_active': False, 'roles': {}},
            'other': {'email': 'other@example.com', 'is_active': True, 'roles': {'search': 'admin'}},
        }
        self.assertEqual(forms.reconcile(api, directory), counts)
        self.assertEqual(calls, [('POST', '/api/blak/roles/reconcile', [
            {'subject': 'reader', 'email': 'reader@example.com', 'active': True, 'role': 'reader'},
            {'subject': 'disabled', 'email': 'disabled@example.com', 'active': False, 'role': None},
            {'subject': 'other', 'email': 'other@example.com', 'active': True, 'role': None},
        ])])

    def test_partial_or_invalid_native_result_is_not_success(self):
        for result in ({}, None, {'created': 0, 'roles': 0, 'disabled': 0, 'activated': True},
                       {'created': 0, 'roles': -1, 'disabled': 0, 'activated': 0}):
            with self.subTest(result=result), self.assertRaises(ValueError):
                forms.reconcile(lambda *args: result, {})


if __name__ == '__main__':
    unittest.main()
