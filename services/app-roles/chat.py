"""Reconcile Rocket.Chat native roles against frozen Blak ID OIDC subjects."""


def reconcile(api, directory):
    members = [{'subject': subject, 'email': member['email'], 'active': member['is_active'],
                'role': member['roles'].get('chat')} for subject, member in directory.items()]
    result = api('POST', '/api/v1/blak.roles.reconcile', {'members': members})
    if not isinstance(result, dict) or result.get('success') is not True:
        raise ValueError('Native Chat role reconciliation failed')
    counts = {key: value for key, value in result.items() if key != 'success'}
    if set(counts) != {'created', 'roles', 'disabled', 'activated'} or any(type(value) is not int or value < 0 for value in counts.values()):
        raise ValueError('Invalid native Chat reconciliation counts')
    return counts
