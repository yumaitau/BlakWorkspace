"""Delegate membership changes to Better Auth's native server-side APIs."""


def reconcile(api, directory):
    members = [{'subject': subject, 'active': member['is_active'],
                'role': member['roles'].get('projects')} for subject, member in directory.items()]
    return api('POST', '/api/blak/roles/reconcile', members)
