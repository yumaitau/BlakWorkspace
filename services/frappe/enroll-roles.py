"""Operator-only native enrollment. Never exposed as an HTTP endpoint."""
import json
import os
from pathlib import Path
import sys
import uuid
import frappe
from frappe.utils.password import get_decrypted_password

SITE = 'crm.workspace.example.com'
SITES = Path('/home/frappe/frappe-bench/sites')
data = json.load(sys.stdin)
os.chdir(SITES)
frappe.init(site=SITE, sites_path=str(SITES))
frappe.connect()
try:
    frappe.set_user('Administrator')
    configured = frappe.conf.get('blak_role_controller_user')
    requested = data.get('userId')
    if configured and requested and configured != requested:
        raise ValueError('CRM controller identity changed')
    user_id = configured or requested
    if not user_id:
        user_id = 'blak-role-controller-' + uuid.uuid4().hex + '@example.invalid'
        user = frappe.get_doc({'doctype': 'User', 'email': user_id, 'first_name': 'Blak ID role controller',
                              'enabled': 1, 'send_welcome_email': 0, 'user_type': 'System User'})
        user.append('roles', {'role': 'System Manager'})
        user.insert(ignore_permissions=True)
    else:
        user = frappe.get_doc('User', user_id)
        if not user.enabled or not user_id.startswith('blak-role-controller-') or not user_id.endswith('@example.invalid') or set(row.role for row in user.roles) != {'System Manager'}:
            raise ValueError('Native CRM controller mismatch')
    for name in ('Blak CRM Reader', 'Blak CRM Writer', 'Blak CRM Admin'):
        if not frappe.db.exists('Role', name):
            frappe.get_doc({'doctype': 'Role', 'role_name': name, 'desk_access': 1}).insert(ignore_permissions=True)
    secret = get_decrypted_password('User', user.name, 'api_secret', raise_exception=False)
    if not user.api_key:
        user.api_key = frappe.generate_hash(length=32)
    if not secret:
        secret = frappe.generate_hash(length=48)
        user.api_secret = secret
    user.save(ignore_permissions=True)
    frappe.db.commit()
    if data.get('activate'):
        path = SITES / 'common_site_config.json'
        config = json.loads(path.read_text())
        config['blak_role_controller_user'] = user.name
        temporary = path.with_suffix('.blak-roles.tmp')
        temporary.write_text(json.dumps(config))
        temporary.chmod(0o600)
        temporary.replace(path)
    print('BLAK_ENROLLED=' + json.dumps({'userId': user.name, 'apiKey': user.api_key, 'apiSecret': secret}))
finally:
    frappe.destroy()
