"""Patch the pinned native permission and identity entry points, fail on drift."""
import ast
import hashlib
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/home/frappe/frappe-bench/apps/frappe/frappe')


def patch(path, digest, replacements):
    target = root / path
    source = target.read_text()
    if hashlib.sha256(source.encode()).hexdigest() != digest:
        raise ValueError('Unexpected pinned Frappe source: ' + path)
    for before, after in replacements:
        if source.count(before) != 1:
            raise ValueError('Ambiguous native Frappe patch: ' + path)
        source = source.replace(before, after)
    ast.parse(source)
    target.write_text(source)


patch('permissions.py', '2656a118fe0c344bafed21231fee2e4932cddab0d2690ba861f630ddddf2427e', [
    ('\tif user == "Administrator":\n\t\tdebug and _debug_log("Allowed everything because user is Administrator")',
     '\tfrom crm.blak_roles import allows\n\tif not allows(doctype, ptype, doc, user):\n\t\treturn False\n\n\tif user == "Administrator":\n\t\tdebug and _debug_log("Allowed everything because user is Administrator")'),
    ('\treturn permissions\n\n\ndef get_role_permissions',
     '\tfrom crm.blak_roles import allows\n\tfor permission in rights:\n\t\tif not allows(doc.doctype, permission, doc, user):\n\t\t\tpermissions[permission] = 0\n\treturn permissions\n\n\ndef get_role_permissions'),
])
patch('model/document.py', 'df0926c92a95130c427ab425ee2f4eb726601d29cc0976f735f1f2ed1ac426ef', [
    ('\t\tif self.flags.ignore_permissions:\n\t\t\treturn True',
     '\t\tfrom crm.blak_roles import allows\n\t\tif not allows(self.doctype, permtype, self, user):\n\t\t\treturn False\n\n\t\tif self.flags.ignore_permissions:\n\t\t\treturn True'),
])
patch('handler.py', '2be0178117dedc70eca3d0249beed62b325db6bd956a9ad70f69cff06f74541b', [
    ('\tcmd = frappe.override_whitelisted_method(cmd)',
     '\tcmd = frappe.override_whitelisted_method(cmd)\n\tfrom crm.blak_roles import authorize_rpc\n\tauthorize_rpc(cmd)'),
])
patch('utils/oauth.py', 'b13d3e33804773b5293313f761f8891eff00db2fa236bd6c8ad9b78eeadf6924', [
    ('\tuser = get_email(data).lower()',
     '\tuser = get_email(data).lower()\n\tfrom crm.blak_roles import resolve_oidc_user\n\tuser = resolve_oidc_user(provider, data, user)'),
])
patch('core/doctype/user/user.py', '2426e52dd9a820f606a055ba64859b3691d33fd856d95ffed59c133324ff3962', [
    ('\tdef validate(self):\n', '\tdef validate(self):\n\t\tfrom crm.blak_roles import protect_user\n\t\tprotect_user(self)\n'),
])
print('Native CRM identity and role limits installed')
