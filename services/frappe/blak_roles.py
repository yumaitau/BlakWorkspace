"""Native Frappe integration for the Blak ID role authority."""
import frappe
from crm.blak_role_policy import ROLE_NAMES, directory_members, permission_allowed, rpc_allowed


def controller():
    return frappe.conf.get('blak_role_controller_user')


def role_for(user=None):
    user = user or frappe.session.user
    if not controller() or user == 'Guest':
        return 'unmanaged'
    if user == controller():
        return 'controller'
    if user == 'Administrator':
        return 'operator'
    if not frappe.db.get_value('User', user, 'enabled'):
        return None
    roles = set(frappe.get_all('Has Role', filters={'parent': user, 'parenttype': 'User'}, pluck='role'))
    matches = [role for role, name in ROLE_NAMES.items() if name in roles]
    return matches[0] if len(matches) == 1 else None


def allows(doctype, permission='read', doc=None, user=None):
    user = user or frappe.session.user
    if hasattr(doctype, 'doctype'):
        doc, doctype = doctype, doctype.doctype
    name = doc if isinstance(doc, str) else getattr(doc, 'name', None)
    return permission_allowed(role_for(user), doctype, permission, own_user=doctype == 'User' and name == user)


def authorize_rpc(method):
    if not rpc_allowed(role_for(), method):
        frappe.throw('Blak ID does not grant this CRM operation', frappe.PermissionError)


def resolve_oidc_user(provider, data, email):
    if not controller() or provider != 'blak_id':
        return email
    subject = data.get('sub')
    if not isinstance(subject, str) or not subject:
        raise frappe.AuthenticationError('Blak ID subject required')
    links = frappe.get_all('User Social Login', filters={'provider': 'blak_id', 'userid': subject}, pluck='parent')
    if len(links) != 1:
        raise frappe.AuthenticationError('Blak ID account must be provisioned by its immutable subject')
    return links[0]


def protect_user(user):
    if role_for() in {'unmanaged', 'controller', 'operator'}:
        return
    if user.is_new() or user.name != frappe.session.user:
        frappe.throw('Manage CRM membership in Blak ID', frappe.PermissionError)
    before = frappe.get_doc('User', user.name)
    def authority(document):
        return (bool(document.enabled), document.role_profile_name,
                sorted(row.role for row in document.roles),
                sorted((row.provider, row.userid) for row in document.social_logins))
    if authority(user) != authority(before):
        frappe.throw('Manage CRM membership in Blak ID', frappe.PermissionError)


def require_controller():
    if not controller() or frappe.session.user != controller():
        frappe.throw('Blak ID controller required', frappe.PermissionError)


@frappe.whitelist(methods=['POST'])
def identities():
    require_controller()
    links = frappe.get_all('User Social Login', filters={'provider': 'blak_id'}, fields=['parent', 'userid'])
    by_user, subjects = {}, set()
    for link in links:
        if not link.userid or link.parent in by_user or link.userid in subjects:
            raise ValueError('Ambiguous native CRM identity')
        by_user[link.parent] = link.userid
        subjects.add(link.userid)
    return [{'id': user.name, 'subject': by_user.get(user.name), 'enabled': bool(user.enabled),
             'role': role_for(user.name)}
            for user in frappe.get_all('User', fields=['name', 'enabled'])
            if user.name not in {'Guest', 'Administrator', controller()}]


@frappe.whitelist(methods=['POST'])
def reconcile(members):
    require_controller()
    directory = directory_members(frappe.parse_json(members) if isinstance(members, str) else members)
    native = identities()
    by_subject = {user['subject']: user for user in native if user['subject']}
    creations = []
    for subject, member in directory.items():
        if subject in by_subject or not member['active'] or not member['role']:
            continue
        email = frappe.utils.validate_email_address(member['email'], throw=True).lower()
        if frappe.db.exists('User', email) or any(item[1] == email for item in creations):
            raise ValueError('CRM email collision requires an explicit identity migration')
        creations.append((subject, email))
    counts = {'created': 0, 'roles': 0, 'disabled': 0, 'activated': 0}
    for subject, email in creations:
        user = frappe.get_doc({'doctype': 'User', 'email': email, 'first_name': email.split('@')[0],
                               'enabled': 1, 'send_welcome_email': 0, 'user_type': 'System User', 'default_app': 'crm'})
        user.set_social_login_userid('blak_id', subject)
        user.set('roles', [{'role': ROLE_NAMES['reader']}, {'role': 'Sales User'}])
        user.insert(ignore_permissions=True)
        native.append({'id': user.name, 'subject': subject, 'enabled': True, 'role': 'reader'})
        counts['created'] += 1
    for item in native:
        member = directory.get(item['subject'])
        desired = member['role'] if member and member['active'] else None
        user = frappe.get_doc('User', item['id'])
        roles = [ROLE_NAMES[desired], 'Sales Manager' if desired == 'admin' else 'Sales User'] if desired else []
        enabled = bool(desired)
        roles_changed = set(row.role for row in user.roles) != set(roles) or bool(user.role_profile_name)
        if not roles_changed and bool(user.enabled) == enabled:
            continue
        counts['roles'] += int(roles_changed)
        counts['activated' if enabled else 'disabled'] += int(bool(user.enabled) != enabled)
        user.role_profile_name = ''
        user.set('roles', [{'role': role} for role in roles])
        user.enabled = int(enabled)
        user.save(ignore_permissions=True)
        frappe.clear_cache(user=user.name)
    return counts
