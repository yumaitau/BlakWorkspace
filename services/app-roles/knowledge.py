"""Map immutable Blak ID subjects to Outline's native user roles and suspension."""
import uuid

ROLES = {'reader': 'viewer', 'writer': 'member', 'admin': 'admin'}


class KnowledgeRoles:
    def __init__(self, api, controller):
        self.api = api
        self.controller = controller

    def reconcile(self, directory):
        users = self.api('POST', '/api/users.blak_identities', {})['data']
        identities, subjects = set(), set()
        for user in users:
            if str(uuid.UUID(user['id'])) != user['id'] or user['id'] in identities:
                raise ValueError('Invalid native Knowledge identity')
            identities.add(user['id'])
            if user['role'] not in {'admin', 'member', 'viewer', 'guest'} or not isinstance(user['suspended'], bool):
                raise ValueError('Invalid native Knowledge authority')
            if user.get('subject'):
                if user['subject'] in subjects:
                    raise ValueError('Duplicate native Knowledge subject')
                subjects.add(user['subject'])
        controller = next((user for user in users if user['id'] == self.controller), None)
        if not controller or controller['role'] != 'admin' or controller['suspended']:
            raise ValueError('Native Knowledge controller missing or inactive')
        counts = {'roles': 0, 'suspended': 0, 'activated': 0}
        for user in users:
            if user['id'] == self.controller:
                continue
            member = directory.get(user.get('subject'))
            grant = member['roles'].get('sites') if member and member['is_active'] else None
            role = ROLES.get(grant, 'viewer')
            if user['role'] != role:
                self.api('POST', '/api/users.update_role', {'id': user['id'], 'role': role})
                counts['roles'] += 1
            if grant not in ROLES and not user['suspended']:
                self.api('POST', '/api/users.suspend', {'id': user['id']})
                counts['suspended'] += 1
            elif grant in ROLES and user['suspended']:
                # Permission updates must finish before restoring an account.
                self.api('POST', '/api/users.activate', {'id': user['id']})
                counts['activated'] += 1
        return counts
