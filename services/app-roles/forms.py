"""Send complete app-specific grants to the native Forms role controller."""


def reconcile(api, directory):
    # Forms' native provider uses user_uuid, not the portal's frozen legacy subject aliases.
    members = [{'subject': member['identity'], 'email': member['email'], 'active': member['is_active'],
                'role': member['roles'].get('forms')} for member in directory.values()]
    result = api('POST', '/api/blak/roles/reconcile', members)
    if not isinstance(result, dict) or set(result) != {'created', 'roles', 'disabled', 'activated'}:
        raise ValueError('Invalid native Forms reconciliation result')
    if any(type(value) is not int or value < 0 for value in result.values()):
        raise ValueError('Invalid native Forms reconciliation counts')
    return result
