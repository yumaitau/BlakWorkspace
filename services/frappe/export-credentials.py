"""Operator-only: issue/reuse the mapped CRM user's API key; capture stdout privately."""
import json
import os
import sys
import frappe
from frappe.utils.password import get_decrypted_password

email = json.loads(sys.stdin.readline())['email']
os.chdir('/home/frappe/frappe-bench/sites')
frappe.init(site='crm.homelab.local')
frappe.connect()
try:
    frappe.set_user('Administrator')
    user = frappe.get_doc('User', email)
    if not user.enabled or email == 'Administrator' or not set(frappe.get_roles(email)) & {'Sales User', 'Sales Manager'}:
        raise ValueError('Mapped CRM user must be an enabled CRM account')
    api_secret = get_decrypted_password('User', email, 'api_secret', raise_exception=False)
    if not user.api_key:
        user.api_key = frappe.generate_hash(length=20)
    if not api_secret:
        api_secret = frappe.generate_hash(length=40)
        user.api_secret = api_secret
    user.save()
    frappe.db.commit()
    print(json.dumps({'api_key': user.api_key, 'api_secret': api_secret}))
finally:
    frappe.destroy()
