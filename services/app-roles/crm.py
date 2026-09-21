"""Send a complete immutable directory snapshot to the native CRM controller."""


def reconcile(api, directory, controller):
    profile = api('GET', '/api/method/frappe.auth.get_logged_user')
    if profile.get('message') != controller:
        raise ValueError('Native CRM controller identity mismatch')
    members = [{'subject': subject, 'email': member['email'], 'active': member['is_active'],
                'role': member['roles'].get('crm')} for subject, member in directory.items()]
    result = api('POST', '/api/method/crm.blak_roles.reconcile', {'members': members})
    counts = result.get('message')
    if not isinstance(counts, dict) or set(counts) != {'created', 'roles', 'disabled', 'activated'}:
        raise ValueError('Invalid native CRM reconciliation result')
    if any(type(value) is not int or value < 0 for value in counts.values()):
        raise ValueError('Invalid native CRM reconciliation counts')
    return counts
