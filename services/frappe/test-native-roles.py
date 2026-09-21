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

    def test_alternate_document_methods_and_upload_deny_before_side_effects(self):
        def deny(method):
            self.assertIn(method, ('run_doc_method', 'upload_file'))
            raise PermissionError('role denied')
        self.module.authorize_rpc = deny
        for path, name, arguments in (
            ('api/v1.py', 'execute_doc_method', ('CRM Lead', 'owned', 'mutator')),
            ('api/v2.py', 'execute_doc_method', ('CRM Lead', 'owned', 'mutator')),
            ('api/v2.py', 'run_doc_method', ('mutator', {})),
            ('handler.py', 'upload_file', ()),
        ):
            with self.subTest(path=path, name=name):
                execute = function(path, name, {'Any': object})
                with self.assertRaisesRegex(PermissionError, 'role denied'):
                    execute(*arguments)

    def test_v2_rpc_denies_before_dispatch(self):
        def deny(method):
            self.assertEqual(method, 'crm.api.doc.remove_assignments')
            raise PermissionError('role denied')
        self.module.authorize_rpc = deny
        module = types.ModuleType('frappe.modules.utils')
        module.load_doctype_module = lambda name: None
        from unittest.mock import patch
        with patch.dict(sys.modules, {'frappe.modules.utils': module}):
            execute = function('api/v2.py', 'handle_rpc_call', {'frappe': types.SimpleNamespace(
                override_whitelisted_method=lambda method: method)})
            with self.assertRaisesRegex(PermissionError, 'role denied'):
                execute('crm.api.doc.remove_assignments')

    def test_even_controller_saves_cannot_drop_existing_subject(self):
        def throw(message, error):
            raise error(message)
        frappe = types.SimpleNamespace(get_all=lambda *args, **kwargs: ['original-subject'],
                                       throw=throw, PermissionError=PermissionError)
        protect = function('../../crm/crm/blak_roles.py', 'protect_user',
                           {'frappe': frappe, 'role_for': lambda: 'controller'})
        user = types.SimpleNamespace(is_new=lambda: False, name='native-user', social_logins=[])
        with self.assertRaisesRegex(PermissionError, 'binding cannot be replaced'):
            protect(user)
        user.social_logins = [types.SimpleNamespace(provider='blak_id', userid='original-subject')]
        protect(user)

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
