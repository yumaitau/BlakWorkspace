"""Directory push plans for BlakSmith and BlakEyes."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_sync():
    spec = importlib.util.spec_from_file_location('sync_directory', ROOT / 'scripts/deploy/sync-directory.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DirectorySyncTests(unittest.TestCase):
    def test_highest_role_is_the_only_group(self):
        sync = load_sync()
        directory = sync.plan([
            {
                'id': 'user-1',
                'email': 'Ranger@Example.test',
                'name': 'Field Ranger',
                'active': True,
                'groups': ['blak-smith-reader', 'blak-smith-admin', 'blak-eyes-writer'],
            },
            {'id': 'user-2', 'email': '', 'name': 'No mail', 'groups': ['blak-eyes-admin']},
        ])
        smith = directory['products']['smith']
        eyes = directory['products']['eyes']
        self.assertEqual(smith['users'][0]['userName'], 'ranger@example.test')
        self.assertEqual(smith['users'][0]['externalId'], 'user-1')
        admin = next(group for group in smith['groups'] if group['externalId'] == 'admin')
        reader = next(group for group in smith['groups'] if group['externalId'] == 'reader')
        self.assertEqual(admin['members'], [{'value': 'user-1'}])
        self.assertEqual(reader['members'], [])
        writer = next(group for group in eyes['groups'] if group['externalId'] == 'writer')
        self.assertEqual(writer['members'], [{'value': 'user-1'}])
        self.assertEqual(directory['skipped'], ['user-2'])

    def test_workspace_admin_is_admin_everywhere(self):
        sync = load_sync()
        directory = sync.plan([
            {'id': 'boss', 'email': 'boss@example.test', 'name': 'Boss', 'groups': [], 'superuser': True},
        ])
        for product in ('smith', 'eyes'):
            admin = next(group for group in directory['products'][product]['groups'] if group['externalId'] == 'admin')
            self.assertEqual(admin['members'], [{'value': 'boss'}])

    def test_listing_follows_team_groups(self):
        sync = load_sync()
        self.assertIn('user.all_groups()', sync.LISTING)
        self.assertIn("'superuser': bool(user.is_superuser)", sync.LISTING)

    def test_apply_creates_then_replaces(self):
        sync = load_sync()
        directory = sync.plan([
            {'id': 'user-1', 'email': 'ranger@example.test', 'name': 'Field Ranger', 'groups': ['blak-eyes-reader']},
        ])
        store = {'users': {}, 'groups': {}}
        calls = []

        def send(method, path, body=None):
            calls.append((method, path.split('?', 1)[0]))
            if method == 'GET' and path.startswith('/Users'):
                return {'Resources': []}
            if method == 'GET' and path.startswith('/Groups'):
                return {'Resources': []}
            if method == 'POST' and path == '/Users':
                store['users'][body['externalId']] = {**body, 'id': 'local-user'}
                return store['users'][body['externalId']]
            if method == 'POST' and path == '/Groups':
                store['groups'][body['externalId']] = {**body, 'id': 'local-' + body['externalId']}
                return store['groups'][body['externalId']]
            raise AssertionError(method + ' ' + path)

        sync.apply_product(send, directory['products']['eyes'])
        self.assertEqual(store['users']['user-1']['userName'], 'ranger@example.test')
        self.assertEqual(store['groups']['reader']['members'], [{'value': 'user-1'}])
        self.assertIn(('POST', '/Users'), calls)
        self.assertIn(('POST', '/Groups'), calls)

    def test_smith_lookup_uses_user_name_and_ignores_other_groups(self):
        sync = load_sync()
        directory = sync.plan([
            {'id': 'user-1', 'email': 'ranger@example.test', 'name': 'Field Ranger', 'groups': ['blak-smith-admin']},
        ])
        calls = []

        def send(method, path, body=None):
            calls.append(path)
            if method == 'GET' and path.startswith('/Users'):
                self.assertIn('userName%20eq%20', path)
                return {'Resources': []}
            if method == 'GET' and path.startswith('/Groups'):
                return {'Resources': [
                    {'id': 'other', 'externalId': 'reader'},
                    {'id': 'local-admin', 'externalId': 'admin'},
                ]}
            if method == 'POST' and path == '/Users':
                return {'id': 'local-user'}
            if method == 'POST' and path == '/Groups':
                return {'id': 'local-new'}
            if method == 'PUT' and path.startswith('/Groups/'):
                return {}
            raise AssertionError(method + ' ' + path)

        sync.apply_product(send, directory['products']['smith'], 'userName')
        self.assertTrue(any(path.startswith('/Users?filter=userName') for path in calls))
        self.assertIn('/Groups/local-admin', calls)


if __name__ == '__main__':
    unittest.main()
