import copy
import importlib.util
from pathlib import Path
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('vault_roles', ROOT / 'services/app-roles/vault.py')
vault = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vault)


def uid():
    return str(uuid.uuid4())


class NativeAPI:
    def __init__(self):
        self.org, self.owner, self.collection, self.user, self.subject = [uid() for _ in range(5)]
        self.members = [
            {'id': uid(), 'userId': self.owner, 'type': 0, 'status': 2, 'groups': [], 'collections': [], 'accessAll': True},
            {'id': uid(), 'userId': self.user, 'type': 1, 'status': 2, 'groups': ['stale-write-group'], 'collections': [{'id':self.collection,'readOnly':False}], 'accessAll': True},
        ]
        self.groups = []
        self.writes = []
        self.fail = False

    def __call__(self, method, path, data=None):
        route = path.split('?')[0]
        if method == 'GET':
            if route.endswith('/users'):
                return {'data': copy.deepcopy(self.members)}
            if route.endswith('/collections'):
                return {'data': [{'id': self.collection}]}
            if route.endswith('/groups/details'):
                return {'data': copy.deepcopy(self.groups)}
        if self.fail:
            raise RuntimeError('Native failure')
        self.writes.append((method, path, copy.deepcopy(data)))
        if route.endswith('/groups') and method == 'POST':
            result = {'id': uid(), **data}
            self.groups.append(copy.deepcopy(result))
            return result
        if '/groups/' in route:
            group = next(g for g in self.groups if g['id'] == route.split('/')[-1])
            group.update(copy.deepcopy(data))
            for member in self.members:
                member['groups'] = [g for g in member['groups'] if g != group['id']]
                if member['id'] in data['users']:
                    member['groups'].append(group['id'])
            return group
        member = next(m for m in self.members if m['id'] in path)
        if route.endswith('/revoke'):
            member['status'] = -1
        elif route.endswith('/restore'):
            member['status'] = 2
        else:
            member.update(data)
            member['accessAll'] = data['type'] in (0, 1)


class VaultRolesTests(unittest.TestCase):
    def setUp(self):
        self.api = NativeAPI()
        self.roles = vault.VaultRoles(self.api, self.api.org, [self.api.collection], self.api.owner)
        self.directory = {self.api.subject: {'is_active': True, 'groups': ['blak-vault-reader']}}
        self.links = {self.api.user: self.api.subject}

    def test_reader_downgrade_removes_stale_admin_and_direct_writer_grants(self):
        self.roles.reconcile(self.directory, self.links)
        member = self.api.members[1]
        self.assertEqual(member['type'], 2)
        self.assertFalse(member['accessAll'])
        self.assertEqual(member['collections'], [])
        group = next(g for g in self.api.groups if g['id'] == member['groups'][0])
        self.assertEqual(group['externalId'], 'blak-id:vault:reader')
        self.assertTrue(group['collections'][0]['readOnly'])
        self.assertFalse(group['collections'][0]['manage'])

    def test_unchanged_roles_do_not_write_or_generate_audit_churn(self):
        self.roles.reconcile(self.directory, self.links)
        self.api.writes.clear()
        self.roles.reconcile(self.directory, self.links)
        self.assertEqual(self.api.writes, [])

    def test_cross_app_admin_does_not_grant_vault_access(self):
        self.directory[self.api.subject]['groups'] = ['blak-crm-admin']
        result = self.roles.reconcile(self.directory, self.links)
        self.assertEqual(result['revoked'], 1)
        self.assertEqual(self.api.members[1]['status'], -1)
        self.assertEqual(self.api.members[0]['status'], 2)

    def test_disabled_identity_revokes_membership(self):
        self.directory[self.api.subject]['is_active'] = False
        self.assertEqual(self.roles.reconcile(self.directory, self.links)['revoked'], 1)

    def test_removed_identity_revokes_membership(self):
        self.assertEqual(self.roles.reconcile({}, self.links)['revoked'], 1)

    def test_multiple_roles_select_highest_for_vault_only(self):
        self.directory[self.api.subject]['groups'] += ['blak-vault-writer', 'blak-crm-admin']
        self.roles.reconcile(self.directory, self.links)
        member = self.api.members[1]
        group = next(g for g in self.api.groups if g['id'] == member['groups'][0])
        self.assertEqual(group['externalId'], 'blak-id:vault:writer')
        self.assertFalse(group['collections'][0]['manage'])

    def test_missing_controller_owner_fails_before_any_mutation(self):
        self.api.members[0]['type'] = 1
        with self.assertRaises(ValueError): self.roles.reconcile(self.directory, self.links)
        self.assertEqual(self.api.writes, [])

    def test_ambiguous_subject_mapping_fails_before_any_mutation(self):
        self.links[uid()] = self.api.subject
        with self.assertRaises(ValueError): self.roles.reconcile(self.directory, self.links)
        self.assertEqual(self.api.writes, [])

    def test_missing_collection_does_not_silently_widen_access(self):
        self.roles.collections = [uid()]
        with self.assertRaises(ValueError): self.roles.reconcile(self.directory, self.links)
        self.assertEqual(self.api.writes, [])

    def test_native_failure_is_not_reported_as_applied(self):
        self.api.fail = True
        with self.assertRaises(RuntimeError): self.roles.reconcile(self.directory, self.links)

    def test_unlinked_native_account_is_not_matched_by_email(self):
        result = self.roles.reconcile(self.directory, {})
        self.assertEqual(result['revoked'], 1)

    def test_restored_reader_loses_stale_writer_grants_before_restore(self):
        self.api.members[1]['status'] = -1
        self.roles.reconcile(self.directory, self.links)
        member = self.api.members[1]
        self.assertEqual(member['status'], 2)
        self.assertEqual(member['type'], 2)
        self.assertEqual(member['collections'], [])
        paths = [path for _, path, _ in self.api.writes]
        self.assertLess(paths.index(self.roles.base + '/users/' + member['id']), paths.index(self.roles.base + '/users/' + member['id'] + '/restore'))
