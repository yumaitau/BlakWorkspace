import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('crm_role_policy', Path(__file__).resolve().parents[1] / 'services/frappe/role_policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class CRMRolePolicyTests(unittest.TestCase):
    def test_reader_cannot_write_even_when_owner_or_native_acl_grants_write(self):
        for permission in ('create', 'write', 'delete', 'submit', 'cancel', 'share', 'email'):
            self.assertFalse(policy.permission_allowed('reader', 'CRM Lead', permission))
        self.assertTrue(policy.permission_allowed('reader', 'CRM Lead', 'read'))
        self.assertTrue(policy.permission_allowed('writer', 'CRM Lead', 'write'))

    def test_app_admin_cannot_change_directory_authority(self):
        for doctype in policy.DIRECTORY_TYPES:
            self.assertFalse(policy.permission_allowed('admin', doctype, 'write'))
        self.assertFalse(policy.permission_allowed('admin', 'User', 'write'))
        self.assertTrue(policy.permission_allowed('reader', 'User', 'write', own_user=True))

    def test_rpc_requires_explicit_read_operation_even_for_get_like_names(self):
        self.assertTrue(policy.rpc_allowed('reader', 'crm.api.doc.get_data'))
        for method in ('crm.api.doc.remove_assignments', 'frappe.client.set_value',
                       'frappe.desk.form.run_method', 'custom.get_and_delete_records'):
            self.assertFalse(policy.rpc_allowed('reader', method))
        self.assertFalse(policy.rpc_allowed(None, 'crm.api.doc.get_data'))

    def test_directory_requires_complete_unique_typed_members(self):
        member = {'subject': 'immutable', 'email': 'person@example.invalid', 'role': 'reader', 'active': True}
        self.assertEqual(policy.directory_members([member]), {'immutable': member})
        for members in ([], [member, member], [{**member, 'active': 1}], [{**member, 'role': 'owner'}]):
            with self.assertRaises(ValueError):
                policy.directory_members(members)
