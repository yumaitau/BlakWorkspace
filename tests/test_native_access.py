import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services/app-roles'))
import access


class NativeAccessTests(unittest.TestCase):
    def setUp(self):
        self.identity = str(uuid.uuid4())
        self.user = {'is_active': True, 'email': 'fixture@example.invalid', 'is_superuser': False, 'groups': ['Team']}
        self.groups = [
            {'pk': 'team', 'name': 'Team', 'parents': ['draw']},
            {'pk': 'draw', 'name': 'blak-draw-reader', 'parents': []},
        ]
    def snapshot(self, aliases=None):
        def api(*args): return {'results': self.groups, 'pagination': {'next': 0}}
        with patch.object(access, 'users', return_value={self.identity: dict(self.user)}):
            return access.snapshot(api, aliases or {})
    def test_nested_group_and_frozen_subject_survive_rename(self):
        result = self.snapshot({self.identity: 'original-login'})['original-login']
        self.assertEqual(result['identity'], self.identity)
        self.assertEqual(result['roles'], {'draw': 'reader'})
        self.assertEqual(result['apps'], ['draw'])
    def test_workspace_administrator_is_admin_in_every_app(self):
        # Blak ID superusers (authentik Admins) are Admin everywhere, even with a lower group role.
        self.user.update(is_superuser=True, groups=['Team'])
        result = self.snapshot()[self.identity]
        role_apps = [app for app, contract in access.CONTRACT.items() if contract.get('roleGroups')]
        # Apps with only a membership group (such as the Proton Mail tile) have no roles.
        group_apps = [app for app, contract in access.CONTRACT.items() if contract.get('group') and not contract.get('roleGroups')]
        self.assertEqual(result['roles'], {app: 'admin' for app in role_apps})
        self.assertEqual(sorted(result['apps']), sorted(role_apps + group_apps))
    def test_disabled_or_unconfirmed_administrator_gets_nothing_extra(self):
        self.user.update(is_superuser=True, is_active=False, groups=[])
        self.assertEqual(self.snapshot()[self.identity]['apps'], [])
        self.user.update(is_superuser='true', is_active=True)  # only a real boolean True counts
        self.assertEqual(self.snapshot()[self.identity]['roles'], {})
    def test_disabled_user_has_no_grants(self):
        self.user['is_active'] = False
        self.assertEqual(self.snapshot()[self.identity]['apps'], [])
    def test_missing_or_cyclic_ancestor_fails_closed(self):
        self.groups[1]['parents'] = ['missing']
        with self.assertRaises(ValueError): self.snapshot()
        self.groups[1]['parents'] = ['team']
        with self.assertRaises(ValueError): self.snapshot()
    def test_incomplete_membership_is_not_empty_access(self):
        self.user['groups'] = ['Unknown']
        with self.assertRaises(ValueError): self.snapshot()
    def test_app_admin_does_not_grant_other_roles(self):
        self.groups[1]['name'] = 'blak-draw-admin'
        self.assertEqual(self.snapshot()[self.identity]['roles'], {'draw': 'admin'})
    def test_drive_and_docs_share_the_same_native_file_role(self):
        self.groups[1]['name'] = 'blak-drive-reader'
        result = self.snapshot()[self.identity]
        self.assertEqual(result['roles'], {'drive': 'reader', 'docs': 'reader'})
        self.assertEqual(set(result['apps']), {'drive', 'docs'})
