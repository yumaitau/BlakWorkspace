"""Patch the pinned native permission and identity entry points, fail on drift."""
import ast
import hashlib
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/home/frappe/frappe-bench/apps/frappe/frappe')


def patch(path, digest, replacements, python_source=True):
    target = root / path
    source = target.read_text()
    if hashlib.sha256(source.encode()).hexdigest() != digest:
        raise ValueError('Unexpected pinned Frappe source: ' + path)
    for before, after in replacements:
        if source.count(before) != 1:
            raise ValueError('Ambiguous native Frappe patch: ' + path)
        source = source.replace(before, after)
    if python_source:
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
     '\t\tfrom crm.blak_roles import allows, protect_user\n'
     '\t\tif self.doctype == \"User\" and permtype == \"write\":\n\t\t\tprotect_user(self)\n'
     '\t\tif not allows(self.doctype, permtype, self, user):\n\t\t\treturn False\n\n\t\tif self.flags.ignore_permissions:\n\t\t\treturn True'),
])
patch('handler.py', '2be0178117dedc70eca3d0249beed62b325db6bd956a9ad70f69cff06f74541b', [
    ('\tcmd = frappe.override_whitelisted_method(cmd)',
     '\tcmd = frappe.override_whitelisted_method(cmd)\n\tfrom crm.blak_roles import authorize_rpc\n\tauthorize_rpc(cmd)'),
    ('def upload_file():\n', 'def upload_file():\n\tfrom crm.blak_roles import authorize_rpc\n\tauthorize_rpc("upload_file")\n'),
])
patch('api/v1.py', 'fee2b7523a88dfbf049fd352396815c3fdf47a6a1e4883345c9c1990ccb16ee5', [
    ('\tmethod = method or frappe.form_dict.pop("run_method")',
     '\tfrom crm.blak_roles import authorize_rpc\n\tauthorize_rpc("run_doc_method")\n\tmethod = method or frappe.form_dict.pop("run_method")'),
])
patch('api/v2.py', '9bddd2585230f60c1bd2854d14205e3458d37190127cd262e950a5537b6ac78a', [
    ('\tmethod = frappe.override_whitelisted_method(method)',
     '\tmethod = frappe.override_whitelisted_method(method)\n\tfrom crm.blak_roles import authorize_rpc\n\tauthorize_rpc(method)'),
    ('\tmethod = method or frappe.form_dict.pop("run_method")',
     '\tfrom crm.blak_roles import authorize_rpc\n\tauthorize_rpc("run_doc_method")\n\tmethod = method or frappe.form_dict.pop("run_method")'),
    ('\tif isinstance(document, str):',
     '\tfrom crm.blak_roles import authorize_rpc\n\tauthorize_rpc("run_doc_method")\n\tif isinstance(document, str):'),
])
patch('utils/oauth.py', 'b13d3e33804773b5293313f761f8891eff00db2fa236bd6c8ad9b78eeadf6924', [
    ('\tuser = get_email(data).lower()',
     '\tuser = get_email(data).lower()\n\tfrom crm.blak_roles import resolve_oidc_user\n\tuser = resolve_oidc_user(provider, data, user)'),
])
patch('core/doctype/user/user.py', '2426e52dd9a820f606a055ba64859b3691d33fd856d95ffed59c133324ff3962', [
    ('\tdef validate(self):\n', '\tdef validate(self):\n\t\tfrom crm.blak_roles import protect_user\n\t\tprotect_user(self)\n'),
])
patch('../realtime/index.js', '821c1d26404b02fae63fa8c6676c6c10188fdf3fd0c85a149c454e0934ab11a0', [
    ('\t\tlet namespace = "/" + message.namespace;',
     '\t\tlet namespace = "/" + message.namespace;\n'
     '\t\tif (message.event === "blak_roles_changed" && typeof message.room === "string" && message.room.startsWith("user:")) {\n'
     '\t\t\tio.of(namespace).to(message.room).emit(message.event, message.message);\n'
     '\t\t\tio.of(namespace).in(message.room).disconnectSockets(true);\n'
     '\t\t\treturn;\n\t\t}'),
], python_source=False)
patch('../../crm/frontend/src/socket.js', '3948f12b3e868f89fc111baf946ff1fc90e43d16648c64d4132c542ad0dd41c2', [
    ('  let url = `${protocol}://${host}${port}/${siteName}`',
     '  let url = `${protocol}://${host}${port}/${siteName}`\n'
     '  if (!import.meta.env.DEV) url = `${window.location.origin}/${siteName}`'),
    ("  socket.on('refetch_resource', (data) => {",
     "  socket.on('blak_roles_changed', () => window.location.reload())\n"
     "  socket.on('disconnect', (reason) => {\n"
     "    if (reason === 'io server disconnect') window.location.reload()\n"
     "  })\n"
     "  socket.on('refetch_resource', (data) => {"),
], python_source=False)
patch('../../crm/crm/fcrm/doctype/crm_fields_layout/crm_fields_layout.py', '717461f4ac96a778e06f87b8f18bcccf5c5350847867e100e6d66083e2408443', [
    ('def get_field_obj(field):\n',
     'def get_field_obj(field):\n\tfrom crm.blak_roles import role_for\n'
     '\tif role_for() == "reader":\n\t\tfield = frappe._dict(field)\n\t\tfield.read_only = 1\n'),
])
# CRM's current telemetry plugin calls APIs absent from the pinned Frappe 15.
patch('../../crm/frontend/src/main.js', 'e8c0cc577d1c855aa6db2361287a6de31567652e26e3e80e823480b3c143b412', [
    ("import { telemetryPlugin } from 'frappe-ui/frappe'\n", ''),
    ("app.use(telemetryPlugin, { app_name: 'crm' })\n", ''),
], python_source=False)
print('Native CRM identity and role limits installed')
