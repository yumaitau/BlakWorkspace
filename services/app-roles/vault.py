"""Native Vaultwarden membership reconciliation. Never reads/decrypts item bodies.

The API credential belongs to a dedicated organization owner. Its master password
and encryption key are not controller inputs. Account links must come from the
native SSO association, never from an email lookup.
"""
import uuid

ROLES = ('reader', 'writer', 'admin')
NATIVE_TYPES = {'reader': 2, 'writer': 2, 'admin': 1}


def identifier(value):
    return str(uuid.UUID(value))


def role_for(user):
    if not user or not user.get('is_active'):
        return None
    groups = set(user.get('groups', []))
    return next((role for role in reversed(ROLES) if 'blak-vault-' + role in groups), None)


class VaultRoles:
    def __init__(self, api, organization_id, collection_ids, controller_user_id):
        self.api = api
        self.org = identifier(organization_id)
        self.collections = sorted({identifier(value) for value in collection_ids})
        if not self.collections:
            raise ValueError('Choose the shared collections before enabling role reconciliation')
        self.controller = identifier(controller_user_id)
        self.base = '/api/organizations/' + self.org

    def reconcile(self, directory, sso_links):
        """directory: UUID -> active/groups; sso_links: native UUID -> Blak ID UUID.

        The caller must obtain complete, validated snapshots before invoking this
        method. A missing role revokes existing membership. The sole protected
        principal is the explicitly configured controller, not a human admin.
        """
        directory = {identifier(key): value for key, value in directory.items()}
        links = {identifier(key): identifier(value) for key, value in sso_links.items()}
        if len(set(links.values())) != len(links):
            raise ValueError('Ambiguous native SSO account bindings')
        members = self.api('GET', self.base + '/users?includeCollections=true&includeGroups=true')['data']
        controller = next((m for m in members if m.get('userId') == self.controller), None)
        if not controller or controller['type'] != 0 or controller['status'] != 2:
            raise ValueError('A confirmed dedicated owner is required for role administration')
        actual_collections = self.api('GET', self.base + '/collections')['data']
        if not set(self.collections) <= {c['id'] for c in actual_collections}:
            raise ValueError('A configured collection is missing from this organization')
        groups = self.api('GET', self.base + '/groups/details')['data']
        managed = {}
        for role in ROLES:
            external = 'blak-id:vault:' + role
            found = [g for g in groups if g.get('externalId') == external]
            if len(found) > 1:
                raise ValueError('Ambiguous managed Vault group')
            desired_users = sorted(m['id'] for m in members
                if m.get('userId') != self.controller
                and role_for(directory.get(links.get(m.get('userId')))) == role)
            body = {'name': 'Blak Vault ' + role, 'externalId': external,
                    'accessAll': False, 'users': desired_users, 'collections': [
                        {'id': c, 'readOnly': role == 'reader', 'hidePasswords': False,
                         'manage': role == 'admin'} for c in self.collections]}
            if found:
                managed[role] = identifier(found[0]['id'])
                current = found[0]
                current_users = sorted(m['id'] for m in members if managed[role] in m.get('groups', []))
                same = current.get('name') == body['name'] and current.get('accessAll') is False
                same = same and sorted(current.get('collections', []), key=lambda c: c['id']) == body['collections']
                if not same or current_users != desired_users:
                    self.api('PUT', self.base + '/groups/' + managed[role], body)
            else:
                managed[role] = identifier(self.api('POST', self.base + '/groups', body)['id'])

        pending = 0
        applied = 0
        revoked = 0
        for member in members:
            native_id = member.get('userId')
            if native_id == self.controller:
                continue
            member_id = identifier(member['id'])
            role = role_for(directory.get(links.get(native_id)))
            route = self.base + '/users/' + member_id
            if role is None:
                if member['status'] >= 0:
                    self.api('PUT', route + '/revoke')
                    revoked += 1
                continue
            # Native update removes both individual collection grants and any
            # unmanaged group grants, so a stale writer grant cannot defeat reader.
            if (member['type'] != NATIVE_TYPES[role] or member.get('collections')
                    or member.get('groups') != [managed[role]]
                    or bool(member.get('accessAll')) != (role == 'admin')):
                self.api('PUT', route, {'type': NATIVE_TYPES[role], 'collections': [],
                                       'groups': [managed[role]], 'permissions': {}})
            if member['status'] < 0:
                self.api('PUT', route + '/restore')
                member = next(m for m in self.api('GET', self.base + '/users')['data'] if m['id'] == member_id)
            if member['status'] in (0, 1):
                pending += 1  # Native owner must perform encrypted key confirmation.
            else:
                applied += 1

        # Invite only already-linked SSO accounts. The caller supplies verified
        # native account email metadata, not a directory-only email assertion.
        known = {m.get('userId') for m in members}
        for native_id, subject in links.items():
            if native_id in known or native_id == self.controller:
                continue
            role = role_for(directory.get(subject))
            if not role:
                continue
            user = directory[subject]
            email = user.get('native_email')
            if not email or email != user.get('email'):
                raise ValueError('Native and directory email differ; review the existing SSO binding')
            self.api('POST', self.base + '/users/invite', {
                'emails': [email], 'type': NATIVE_TYPES[role], 'collections': [],
                'groups': [managed[role]], 'permissions': {}})
            pending += 1
        return {'applied': applied, 'revoked': revoked, 'pending_confirmation': pending}
