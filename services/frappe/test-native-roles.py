"""Execute the patched upstream entry points, not replacement implementations."""
import ast
import copy
import os
from pathlib import Path
import sys
import types
import unittest

ROOT = Path(os.environ.get('FRAPPE_NATIVE_ROOT', '/home/frappe/frappe-bench/apps/frappe/frappe'))


def function(path, name, namespace=None, parent=None):
    tree = ast.parse((ROOT / path).read_text())
    nodes = tree.body
    if parent:
        nodes = next(node for node in nodes if isinstance(node, ast.ClassDef) and node.name == parent).body
    node = next(node for node in nodes if isinstance(node, ast.FunctionDef) and node.name == name)
    node.decorator_list = []
    scope = namespace or {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(ROOT / path), 'exec'), scope)
    return scope[name]


class NativeRoleTests(unittest.TestCase):
    def setUp(self):
        self.module = types.ModuleType('crm.blak_roles')
        self.module.allows = lambda *args, **kwargs: False
        self.before = sys.modules.get('crm.blak_roles')
        sys.modules['crm.blak_roles'] = self.module

    def tearDown(self):
        if self.before is None:
            del sys.modules['crm.blak_roles']
        else:
            sys.modules['crm.blak_roles'] = self.before

    def test_native_permission_cap_runs_before_owner_or_share_permissions(self):
        check = function('permissions.py', 'has_permission', {'frappe': types.SimpleNamespace(session=types.SimpleNamespace(user='reader'))})
        self.assertFalse(check('CRM Lead', 'write', doc='owned-document'))

    def test_ignore_permissions_does_not_bypass_managed_document_cap(self):
        check = function('model/document.py', 'has_permission', parent='Document')
        document = types.SimpleNamespace(doctype='CRM Lead', flags=types.SimpleNamespace(ignore_permissions=True))
        self.assertFalse(check(document, 'write'))

    def test_native_serialized_permissions_cannot_advertise_owner_write_access(self):
        self.module.allows = lambda doctype, permission, *args: permission == 'read'
        meta = types.SimpleNamespace(is_submittable=0, allow_import=0)
        frappe = types.SimpleNamespace(session=types.SimpleNamespace(user='reader'), get_meta=lambda name: meta)
        check = function('permissions.py', 'get_doc_permissions', {'frappe': frappe, 'copy': copy,
            'has_controller_permissions': lambda *args, **kwargs: True,
            'get_role_permissions': lambda *args, **kwargs: {'read': 1, 'write': 1},
            'has_user_permission': lambda *args, **kwargs: True, 'cint': int,
            'rights': ('read', 'write', 'submit', 'import')})
        doc = types.SimpleNamespace(doctype='CRM Lead', get=lambda name: 'reader')
        result = check(doc)
        self.assertEqual(result['read'], 1)
        self.assertEqual(result['write'], 0)

    def test_native_rpc_is_denied_before_server_scripts_and_dispatch(self):
        def deny(method):
            self.assertEqual(method, 'crm.api.doc.remove_assignments')
            raise PermissionError('role denied')
        self.module.authorize_rpc = deny
        execute = function('handler.py', 'execute_cmd', {'frappe': types.SimpleNamespace(override_whitelisted_method=lambda method: method)})
        with self.assertRaisesRegex(PermissionError, 'role denied'):
            execute('crm.api.doc.remove_assignments')

    def test_native_oidc_login_uses_immutable_account_instead_of_incoming_email(self):
        signed_in = []
        self.module.resolve_oidc_user = lambda provider, data, email: 'original@example.invalid'
        frappe = types.SimpleNamespace(local=types.SimpleNamespace(
            login_manager=types.SimpleNamespace(login_as=signed_in.append), response={}),
            db=types.SimpleNamespace(commit=lambda: None), utils=types.SimpleNamespace(cint=int))
        login = function('utils/oauth.py', 'login_oauth_user', {'frappe': frappe,
            'consume_oauth_state': lambda state: '/crm', 'get_email': lambda data: data['email'],
            'update_oauth_user': lambda user, data, provider: self.assertEqual(user, 'original@example.invalid'),
            'redirect_post_login': lambda **kwargs: None})
        login({'email': 'changed@example.invalid', 'sub': 'immutable'}, provider='blak_id', state='validated')
        self.assertEqual(signed_in, ['original@example.invalid'])


if __name__ == '__main__':
    unittest.main()
