"""Send complete app-specific grants to the native Forms role controller."""


def reconcile(api, directory):
    members = [{'subject': subject, 'email': member['email'], 'active': member['is_active'],
                'role': member['roles'].get('forms')} for subject, member in directory.items()]
    result = api('POST', '/api/blak/roles/reconcile', members)
    if not isinstance(result, dict) or set(result) != {'created', 'roles', 'disabled', 'activated'}:
        raise ValueError('Invalid native Forms reconciliation result')
    if any(type(value) is not int or value < 0 for value in result.values()):
        raise ValueError('Invalid native Forms reconciliation counts')
    return result
