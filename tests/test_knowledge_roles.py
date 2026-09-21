import copy
from pathlib import Path
import sys
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/app-roles'))
from knowledge import KnowledgeRoles


class Native:
    def __init__(self):
        self.controller, self.person = str(uuid.uuid4()), str(uuid.uuid4())
        self.users = [{'id': self.controller, 'role': 'admin', 'suspended': False, 'subject': None},
                      {'id': self.person, 'role': 'admin', 'suspended': False, 'subject': 'frozen'}]
        self.calls = []

    def __call__(self, method, path, data):
        self.calls.append((method, path, copy.deepcopy(data)))
        if path == '/api/users.blak_identities': return {'data': copy.deepcopy(self.users)}
        user = next(user for user in self.users if user['id'] == data['id'])
        if path.endswith('update_role'): user['role'] = data['role']
        elif path.endswith('suspend'): user['suspended'] = True
        elif path.endswith('activate'): user['suspended'] = False
        else: raise AssertionError(path)
        return {}


class KnowledgeRoleTests(unittest.TestCase):
    def setUp(self):
        self.api = Native()
        self.roles = KnowledgeRoles(self.api, self.api.controller)

    def directory(self, role, active=True):
        return {'frozen': {'roles': {'sites': role}, 'is_active': active}}

    def test_native_reader_writer_and_admin_roles(self):
        for grant, expected in [('reader', 'viewer'), ('writer', 'member'), ('admin', 'admin')]:
            self.roles.reconcile(self.directory(grant))
            self.assertEqual(self.api.users[1]['role'], expected)
            self.assertFalse(self.api.users[1]['suspended'])

    def test_disable_removal_and_cross_app_admin_suspend(self):
        for directory in [self.directory('admin', False), {}, {'frozen': {'roles': {'hermes': 'admin'}, 'is_active': True}}]:
            self.api.users[1].update(role='admin', suspended=False)
            self.api.calls.clear()
            self.roles.reconcile(directory)
            self.assertEqual([call[1] for call in self.api.calls[1:]], ['/api/users.update_role', '/api/users.suspend'])
            self.assertTrue(self.api.users[1]['suspended'])

    def test_restore_happens_after_role_assignment(self):
        self.api.users[1].update(role='viewer', suspended=True)
        self.roles.reconcile(self.directory('writer'))
        self.assertEqual([call[1] for call in self.api.calls[1:]], ['/api/users.update_role', '/api/users.activate'])

    def test_invalid_snapshot_never_mutates(self):
        for change in ['duplicate_subject', 'missing_controller']:
            api = Native()
            if change == 'duplicate_subject': api.users.append({**api.users[1], 'id': str(uuid.uuid4())})
            else: api.users.pop(0)
            with self.assertRaises(ValueError): KnowledgeRoles(api, api.controller).reconcile(self.directory('writer'))
            self.assertEqual(len(api.calls), 1)

    def test_mutable_profile_cannot_relink_a_native_user(self):
        self.api.users[1].update(subject='another-subject', email='frozen@example.invalid')
        self.roles.reconcile(self.directory('admin'))
        self.assertTrue(self.api.users[1]['suspended'])
        self.assertFalse(self.api.users[0]['suspended'])

    def test_unchanged_state_does_not_mutate(self):
        self.roles.reconcile(self.directory('reader'))
        self.api.calls.clear()
        self.roles.reconcile(self.directory('reader'))
        self.assertEqual(len(self.api.calls), 1)
