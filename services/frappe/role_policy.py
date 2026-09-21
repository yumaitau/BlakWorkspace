"""Upper bounds for native Frappe policies and named RPC operations.

Object permissions still apply. These limits never grant access and never infer
whether an RPC is read-only from its HTTP method or its function-name prefix.
"""
ROLE_NAMES = {'reader': 'Blak CRM Reader', 'writer': 'Blak CRM Writer', 'admin': 'Blak CRM Admin'}
READ_PERMISSIONS = {'read', 'select', 'print', 'export', 'report'}
DIRECTORY_TYPES = {'Role', 'Role Profile', 'Has Role', 'User Social Login', 'Social Login Key',
                   'DocPerm', 'Custom DocPerm', 'System Settings', 'Server Script'}
READ_METHODS = frozenset({
    'frappe.auth.get_logged_user',
    'frappe.client.get_doc_permissions', 'frappe.onboarding.get_onboarding_status',
    'frappe.apps.get_apps', 'crm.api.notifications.get_notifications',
    'crm.api.activities.get_activities', 'crm.api.contact.search_emails',
    'crm.api.get_user_signature', 'crm.api.whatsapp.is_whatsapp_installed',
    'crm.api.whatsapp.is_whatsapp_enabled', 'crm.integrations.api.is_call_integration_enabled',
    # Native read tracking checks document read permission before updating only _seen.
    'crm.api.doc.add_seen', 'frappe.client.get', 'frappe.client.get_list',
    'frappe.realtime.get_user_info', 'frappe.realtime.can_subscribe_doc', 'frappe.realtime.can_subscribe_doctype',
    'frappe.client.get_count', 'frappe.client.get_value', 'frappe.client.get_single_value',
    'frappe.desk.form.load.getdoc', 'frappe.desk.form.load.getdoctype',
    'frappe.desk.search.search_link', 'frappe.desk.search.search_widget',
    'frappe.desk.reportview.get', 'frappe.desk.reportview.get_count',
    'frappe.desk.query_report.run', 'frappe.desk.query_report.get_script',
    'crm.api.session.get_users', 'crm.api.session.get_user_info', 'crm.api.session.get_organizations',
    'crm.api.doc.sort_options', 'crm.api.doc.get_filterable_fields', 'crm.api.doc.get_group_by_fields',
    'crm.api.doc.get_quick_filters', 'crm.api.doc.get_data', 'crm.api.doc.get_assigned_users',
    'crm.api.doc.get_fields', 'crm.api.doc.get_linked_docs_of_document',
    'crm.api.views.get_views',
    'crm.fcrm.doctype.crm_fields_layout.crm_fields_layout.get_fields_layout',
    'crm.fcrm.doctype.crm_fields_layout.crm_fields_layout.get_sidepanel_sections',
})


def permission_allowed(role, doctype, permission, *, own_user=False):
    if role in {'controller', 'operator', 'unmanaged'}:
        return True
    if role not in ROLE_NAMES:
        return False
    if doctype in DIRECTORY_TYPES and permission not in READ_PERMISSIONS:
        return False
    if doctype == 'User' and permission not in READ_PERMISSIONS:
        return own_user and permission == 'write'
    return role != 'reader' or permission in READ_PERMISSIONS


def rpc_allowed(role, method):
    if role in {'controller', 'operator', 'unmanaged'}:
        return True
    if method == 'logout':
        return True
    if role not in ROLE_NAMES:
        return False
    return role != 'reader' or method in READ_METHODS


def directory_members(value):
    if not isinstance(value, list) or not value or len(value) > 10000:
        raise ValueError('Invalid CRM directory snapshot')
    result = {}
    for member in value:
        if not isinstance(member, dict) or set(member) != {'subject', 'email', 'role', 'active'}:
            raise ValueError('Invalid CRM member')
        subject = member['subject']
        if not isinstance(subject, str) or not subject or len(subject) > 256 or subject in result:
            raise ValueError('Ambiguous CRM subject')
        if type(member['active']) is not bool or member['role'] not in (*ROLE_NAMES, None):
            raise ValueError('Invalid CRM role')
        if not isinstance(member['email'], str):
            raise ValueError('Invalid CRM email metadata')
        result[subject] = member
    return result
