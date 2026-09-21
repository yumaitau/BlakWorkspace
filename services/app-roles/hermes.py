"""Reconcile Blak ID roles through Open WebUI's native user/group APIs."""
import uuid

ROLES = ('reader', 'writer', 'admin')


def identifier(value):
    return str(uuid.UUID(value))


def native_users(api):
    users, page, total = {}, 1, None
    while total is None or len(users) < total:
        response = api('GET', '/api/v1/users/?page=' + str(page))
        if type(response['total']) is not int or response['total'] < 0:
            raise ValueError('Invalid native user count')
        if total is not None and total != response['total']:
            raise ValueError('Native users changed during pagination; retry')
        total = response['total']
        if not response['users'] and len(users) < total:
            raise ValueError('Incomplete native users')
        for user in response['users']:
            key = identifier(user['id'])
            if key in users:
                raise ValueError('Duplicate native Hermes user')
            users[key] = user
        page += 1
    return users


class HermesRoles:
    def __init__(self, api, controller, collection_ids):
        self.api = api
        self.controller = identifier(controller)
        self.collections = [identifier(value) for value in collection_ids]

    def reconcile(self, directory):
        api = self.api
        profile = api('GET', '/api/v1/auths/')
        if profile['id'] != self.controller or profile['role'] != 'admin':
            raise ValueError('Hermes controller credential identity or role mismatch')
        users = native_users(api)
        if self.controller not in users:
            raise ValueError('Hermes controller missing from complete native snapshot')
        seen_subjects = set()
        for user in users.values():
            if user['role'] not in ('admin', 'user', 'pending') or not isinstance(user['group_ids'], list):
                raise ValueError('Invalid native role metadata')
            for group_id in user['group_ids']:
                identifier(group_id)
            subject = ((user.get('oauth') or {}).get('oidc') or {}).get('sub')
            if subject:
                if not isinstance(subject, str) or subject in seen_subjects:
                    raise ValueError('Duplicate or invalid native Hermes OIDC subject')
                seen_subjects.add(subject)
        # Native group permissions are additive. Deny write capabilities by
        # default; only the writer/admin managed group grants these capabilities.
        defaults = api('GET', '/api/v1/users/default/permissions')
        desired_defaults = {key: dict(value) for key, value in defaults.items()}
        for section, names in {'workspace': ['knowledge', 'models', 'prompts', 'tools', 'skills'],
                               'sharing': ['public_knowledge', 'public_models', 'public_prompts'],
                               'features': ['api_keys']}.items():
            for name in names:
                desired_defaults.setdefault(section, {})[name] = False
        if desired_defaults != defaults:
            api('POST', '/api/v1/users/default/permissions', desired_defaults)
        groups = api('GET', '/api/v1/groups/')
        managed = {}
        for role in ROLES:
            marker = {'blak_id_app': 'hermes', 'blak_id_role': role}
            matches = [group for group in groups if all((group.get('data') or {}).get(k) == v for k, v in marker.items())]
            if len(matches) > 1:
                raise ValueError('Ambiguous managed Hermes group')
            permissions = {'workspace': {key: role != 'reader' for key in ['knowledge', 'models', 'prompts']},
                           'features': {'api_keys': role != 'reader'}}
            body = {'name': 'Blak Hermes ' + role, 'description': 'Managed by Blak ID; changes are reconciled.',
                    'permissions': permissions, 'data': {**(matches[0].get('data') or {} if matches else {}), **marker}}
            if matches:
                group = matches[0]
                if group['name'] != body['name'] or group.get('permissions') != permissions:
                    api('POST', '/api/v1/groups/id/' + group['id'] + '/update', body)
            else:
                group = api('POST', '/api/v1/groups/create', body)
            managed[role] = identifier(group['id'])
        counts = {'roles': 0, 'removed_groups': 0, 'added_groups': 0}
        seen_subjects = set()
        for native_id, user in users.items():
            if native_id == self.controller:
                continue  # Explicit native operator account, never an implicit superuser bypass.
            oauth = user.get('oauth') or {}
            subject = (oauth.get('oidc') or {}).get('sub')
            if subject:
                if subject in seen_subjects:
                    raise ValueError('Duplicate native Hermes OIDC subject')
                seen_subjects.add(subject)
            member = directory.get(subject)
            role = member.get('roles', {}).get('hermes') if member and member['is_active'] else None
            if role not in ROLES:
                role = None
            desired = 'admin' if role == 'admin' else 'user' if role else 'pending'
            current_role = user['role']
            # Remove admin authority before changing groups during a downgrade.
            if current_role == 'admin' and desired != 'admin':
                api('POST', '/api/v1/users/' + native_id + '/update', {'role': desired})
                current_role = desired
                counts['roles'] += 1
            wanted = {managed[role]} if role else set()
            existing = set(user['group_ids'])
            for group_id in sorted(existing - wanted):
                api('POST', '/api/v1/groups/id/' + identifier(group_id) + '/users/remove', {'user_ids': [native_id]})
                counts['removed_groups'] += 1
            for group_id in sorted(wanted - existing):
                api('POST', '/api/v1/groups/id/' + group_id + '/users/add', {'user_ids': [native_id]})
                counts['added_groups'] += 1
            if current_role != desired:
                api('POST', '/api/v1/users/' + native_id + '/update', {'role': desired})
                counts['roles'] += 1
        grants = [{'principal_type': 'group', 'principal_id': managed[role], 'permission': 'read' if role == 'reader' else 'write'} for role in ROLES]
        for collection_id in self.collections:
            collection = api('GET', '/api/v1/knowledge/' + collection_id)
            if collection['user_id'] != self.controller:
                raise ValueError('Managed Hermes collection has a different owner')
            actual = [{key: grant[key] for key in ('principal_type', 'principal_id', 'permission')} for grant in collection['access_grants']]
            order = lambda grant: (grant['principal_type'], grant['principal_id'], grant['permission'])
            if sorted(actual, key=order) != sorted(grants, key=order):
                api('POST', '/api/v1/knowledge/' + collection_id + '/access/update', {'access_grants': grants})
        return counts
