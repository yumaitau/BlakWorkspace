"""Publish complete current grants using Drive's frozen OIDC subjects."""


def reconcile(api, directory):
    if not directory:
        raise ValueError('Complete Drive directory required')
    members = [{'subject': subject, 'active': member['is_active'],
                'role': member['roles'].get('drive') or ''}
               for subject, member in directory.items()]
    result = api('POST', '/blak/roles/reconcile', {'members': members})
    if (not isinstance(result, dict) or result.get('success') is not True
            or type(result.get('members')) is not int or result['members'] != len(members)):
        raise ValueError('Native Drive directory reconciliation failed')
    return {'members': result['members']}
