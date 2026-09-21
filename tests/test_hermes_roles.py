import copy
from pathlib import Path
import sys
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/app-roles'))
from hermes import HermesRoles, native_users


def uid(): return str(uuid.uuid4())


class Native:
    def __init__(self):
        self.controller, self.user, self.collection = uid(), uid(), uid()
        self.calls = []
        self.users = [
            {'id': self.controller, 'role': 'admin', 'oauth': {}, 'group_ids': []},
            {'id': self.user, 'role': 'admin', 'oauth': {'oidc': {'sub': 'frozen'}}, 'group_ids': [uid()]},
        ]
        self.defaults = {'workspace': {'knowledge': True}, 'sharing': {}, 'features': {}}
        self.groups, self.grants = [], []
    def __call__(self, method, path, data=None):
        self.calls.append((method, path, copy.deepcopy(data)))
        if path == '/api/v1/auths/': return {'id': self.controller, 'role': 'admin'}
        if path.startswith('/api/v1/users/?page='): return {'users': copy.deepcopy(self.users), 'total': len(self.users)}
        if path == '/api/v1/users/default/permissions':
            if method == 'POST': self.defaults = data
            return copy.deepcopy(self.defaults)
        if path == '/api/v1/groups/': return copy.deepcopy(self.groups)
        if path == '/api/v1/groups/create':
            group = {'id': uid(), **data}; self.groups.append(group); return group
        if '/groups/id/' in path:
            group_id = path.split('/')[5]
            if path.endswith('/update'):
                next(group for group in self.groups if group['id'] == group_id).update(data)
            else:
                user = next(user for user in self.users if user['id'] == data['user_ids'][0])
                if path.endswith('/add'): user['group_ids'].append(group_id)
                else: user['group_ids'].remove(group_id)
            return {}
        if path.startswith('/api/v1/users/') and path.endswith('/update'):
            next(user for user in self.users if user['id'] == path.split('/')[4])['role'] = data['role']
            return {}
        if path == '/api/v1/knowledge/' + self.collection:
            return {'user_id': self.controller, 'access_grants': copy.deepcopy(self.grants)}
        if path.endswith('/access/update'):
            self.grants = data['access_grants']; return {}
        raise AssertionError(path)


class HermesRoleTests(unittest.TestCase):
    def setUp(self):
        self.api = Native()
        self.roles = HermesRoles(self.api, self.api.controller, [self.api.collection])
    def directory(self, role=None, active=True):
        return {'frozen': {'is_active': active, 'roles': {'hermes': role} if role else {}}}
    def test_downgrade_removes_native_admin_and_unmanaged_groups(self):
        result = self.roles.reconcile(self.directory('reader'))
        user = self.api.users[1]
        self.assertEqual(user['role'], 'user')
        self.assertEqual(len(user['group_ids']), 1)
        group = next(group for group in self.api.groups if group['id'] in user['group_ids'])
        self.assertEqual(group['data']['blak_id_role'], 'reader')
        self.assertFalse(group['permissions']['workspace']['knowledge'])
        self.assertEqual(result['removed_groups'], 1)
        self.assertEqual(self.api.users[0]['role'], 'admin')
    def test_writer_then_admin_then_removal_and_disabled(self):
        for role, active, expected in [('writer', True, 'user'), ('admin', True, 'user'), (None, True, 'pending'), ('reader', False, 'pending')]:
            self.roles.reconcile(self.directory(role, active))
            self.assertEqual(self.api.users[1]['role'], expected)
    def test_human_app_admin_is_demoted_before_group_administration(self):
        self.roles.reconcile(self.directory('admin'))
        changes = [call for call in self.api.calls if call[0] == 'POST' and
                   (call[1].endswith('/update') or '/users/' in call[1])]
        user_update = next(i for i, call in enumerate(changes) if call[1] == '/api/v1/users/' + self.api.user + '/update')
        group_change = next(i for i, call in enumerate(changes) if '/groups/id/' in call[1])
        self.assertLess(user_update, group_change)
        self.assertEqual(self.api.users[1]['role'], 'user')
        group = next(group for group in self.api.groups if group['id'] in self.api.users[1]['group_ids'])
        self.assertEqual(group['data']['blak_id_role'], 'admin')
        self.assertEqual(self.api.users[0]['role'], 'admin')
    def test_cross_app_admin_does_not_grant_hermes(self):
        self.roles.reconcile({'frozen': {'is_active': True, 'roles': {'vault': 'admin'}}})
        self.assertEqual(self.api.users[1]['role'], 'pending')
    def test_unchanged_pass_does_not_mutate_native_state(self):
        self.roles.reconcile(self.directory('writer'))
        self.api.calls.clear()
        self.roles.reconcile(self.directory('writer'))
        self.assertFalse([call for call in self.api.calls if call[0] != 'GET'])
    def test_duplicate_subject_rejected_before_any_mutation(self):
        self.api.users.append({**self.api.users[1], 'id': uid()})
        with self.assertRaises(ValueError): self.roles.reconcile(self.directory('reader'))
        self.assertFalse([call for call in self.api.calls if call[0] != 'GET'])
    def test_email_or_name_never_relinks_a_native_user(self):
        self.api.users[1].update(email='changed@example.invalid', name='Changed', oauth={'oidc': {'sub': 'foreign'}})
        self.roles.reconcile(self.directory('admin'))
        self.assertEqual(self.api.users[1]['role'], 'pending')
