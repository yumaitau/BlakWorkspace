"""Idempotent site provisioning. Executed before application containers start."""
import json
import os
from pathlib import Path
import subprocess

SITE = 'crm.workspace.example.com'
BRAND_LOGO = 'https://portal.workspace.example.com/brand/logo.svg'
SITES = Path('/home/frappe/frappe-bench/sites')
common = SITES / 'common_site_config.json'
config = json.loads(common.read_text()) if common.exists() else {}
config.update(db_host='frappe-db', db_port=3306,
              redis_cache='redis://frappe-cache:6379/0',
              redis_queue='redis://frappe-cache:6379/1',
              redis_socketio='redis://frappe-cache:6379/1', socketio_port=9000,
              default_site=SITE, serve_default_site=True)
common.write_text(json.dumps(config))
(SITES / 'apps.txt').write_text('frappe\ncrm\n')
if not (SITES / SITE / 'site_config.json').exists():
    if any(SITES.glob('*/site_config.json')):
        raise RuntimeError('Existing Frappe site found; set the release CRM site identity before deployment')
    created = subprocess.run(['bench', 'new-site', SITE, '--mariadb-user-host-login-scope=%',
                    '--mariadb-root-password', os.environ['DB_ROOT_PASSWORD'],
                    '--admin-password', os.environ['ADMIN_PASSWORD'],
                    '--install-app', 'crm'])
    if created.returncode:
        raise RuntimeError('CRM site creation failed; credentials omitted')
import frappe

# Keep an exact pre-migration identity journal across failed/retried init containers.
# A migration may update native records, but must never silently drop SSO bindings.
identity_journal = SITES / SITE / '.blak-identity-migration.json'
previous_cwd = Path.cwd()
os.chdir(SITES)
frappe.init(site=SITE, sites_path=str(SITES))
frappe.connect()
try:
    if not identity_journal.exists():
        bindings = frappe.get_all('User Social Login', filters={'provider': 'blak_id'},
                                  fields=['parent', 'userid'])
        with open(identity_journal, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as stream:
            json.dump(bindings, stream)
    bindings = json.loads(identity_journal.read_text())
finally:
    frappe.destroy()
    os.chdir(previous_cwd)
subprocess.run(['bench', '--site', SITE, 'migrate'], check=True)
subprocess.run(['bench', '--site', SITE, 'enable-scheduler'], check=True)

import frappe
os.chdir(SITES)
frappe.init(site=SITE, sites_path=str(SITES))
frappe.connect()
try:
    frappe.set_user('Administrator')
    # CRM 1.84 filters hidden fields from list columns. Framework 15 marks
    # Contact.full_name hidden, which otherwise leaves contacts unnamed.
    from frappe.custom.doctype.property_setter.property_setter import make_property_setter
    make_property_setter('Contact', 'full_name', 'hidden', 0, 'Check')
    settings = frappe.get_single('System Settings')
    settings.update({'country': 'Australia', 'time_zone': 'Australia/Sydney',
                     'language': 'en', 'enable_onboarding': 0})
    settings.save()
    website = frappe.get_single('Website Settings')
    website.update({'app_name': 'Blak CRM', 'home_page': 'login', 'disable_signup': 1,
                    'app_logo': BRAND_LOGO, 'favicon': BRAND_LOGO,
                    'head_html': '<link rel="stylesheet" href="/files/blak-crm.css">'})
    website.save()
    crm = frappe.get_single('FCRM Settings')
    crm.update({'brand_name': 'Blak CRM', 'brand_logo': BRAND_LOGO, 'currency': 'AUD'})
    crm.save()
    provider = frappe.get_doc('Social Login Key', 'blak_id') if frappe.db.exists('Social Login Key', 'blak_id') else frappe.new_doc('Social Login Key')
    provider.update({
        'provider_name': 'Blak ID', 'social_login_provider': 'Custom',
        'enable_social_login': 1, 'client_id': os.environ['OIDC_CLIENT_ID'],
        'client_secret': os.environ['OIDC_CLIENT_SECRET'], 'base_url': 'https://id.workspace.example.com',
        'authorize_url': 'https://id.workspace.example.com/application/o/authorize/', 'access_token_url': 'https://id.workspace.example.com/application/o/token/',
        'api_endpoint': 'https://id.workspace.example.com/application/o/userinfo/',
        'redirect_url': '/api/method/frappe.integrations.oauth2_logins.custom/blak_id',
        'auth_url_data': json.dumps({'response_type': 'code', 'scope': 'openid profile email'}),
        'user_id_property': 'sub', 'sign_ups': 'Deny',
    })
    provider.save()
    for item in ([] if frappe.conf.get('blak_role_controller_user') else json.loads(os.environ['CRM_USERS'])):
        user = frappe.get_doc('User', item['email']) if frappe.db.exists('User', item['email']) else frappe.new_doc('User')
        user.update({'email': item['email'], 'first_name': item['name'] or item['email'],
                     'enabled': 1, 'send_welcome_email': 0, 'user_type': 'System User',
                     'default_app': 'crm'})
        user.save()
        user.add_roles('Sales Manager' if item['manager'] else 'Sales User')
    current_bindings = {(row.parent, row.userid) for row in frappe.get_all('User Social Login',
                        filters={'provider': 'blak_id'}, fields=['parent', 'userid'])}
    if any((row['parent'], row['userid']) not in current_bindings for row in bindings):
        raise RuntimeError('CRM migration changed native Blak ID bindings; restore exact bindings from backup')
    frappe.db.commit()
    identity_journal.unlink()
    frappe.clear_cache()
finally:
    frappe.destroy()
print('CRM provisioning complete')
