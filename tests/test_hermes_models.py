import copy
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/app-roles'))
import hermes_models
from http_client import NativeAPIError


class RuntimeAPI:
    def __init__(self):
        self.models = {}
        self.calls = []
        self.error = 404

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, copy.deepcopy(body)))
        if path == '/api/models':
            return {'data': [{'id': name, 'owned_by': 'ollama'} for name in ('small:1b', 'other:2b')]}
        if method == 'GET':
            model_id = parse_qs(urlsplit(path).query)['id'][0]
            if model_id not in self.models:
                raise NativeAPIError(self.error)
            return copy.deepcopy(self.models[model_id])
        self.models[body['id']] = {'user_id': 'controller', 'base_model_id': None, 'access_grants': body['access_grants']}
        return self.models[body['id']]


class RuntimeGrantsTest(unittest.TestCase):
    def setUp(self):
        self.api = RuntimeAPI()
        self.groups = {'reader': 'r', 'writer': 'w', 'admin': 'a'}

    def reconcile(self, models=('small:1b',)):
        hermes_models.reconcile(self.api, 'controller', models, self.groups)

    def test_missing_runtime_created_with_group_read_only_and_idempotent(self):
        self.reconcile()
        grants = self.api.models['small:1b']['access_grants']
        self.assertEqual({grant['principal_id'] for grant in grants}, {'r', 'w', 'a'})
        self.assertEqual({grant['permission'] for grant in grants}, {'read'})
        self.api.calls.clear()
        self.reconcile()
        self.assertFalse(any(call[0] == 'POST' for call in self.api.calls))

    def test_repairs_runtime_grants_without_touching_private_preset(self):
        private = {'user_id': 'human', 'base_model_id': 'small:1b', 'access_grants': []}
        self.api.models['private'] = copy.deepcopy(private)
        self.api.models['small:1b'] = {'user_id': 'controller', 'access_grants': []}
        self.reconcile()
        self.assertEqual(self.api.models['private'], private)
        self.assertEqual(len(self.api.models['small:1b']['access_grants']), 3)

    def test_rejects_foreign_owner_and_presets_before_any_mutation(self):
        for model in ({'user_id': 'human'}, {'user_id': 'controller', 'base_model_id': 'private'}):
            with self.subTest(model=model):
                self.api.models['other:2b'] = model
                self.api.calls.clear()
                with self.assertRaises(ValueError):
                    self.reconcile(('small:1b', 'other:2b'))
                self.assertFalse(any(call[0] == 'POST' for call in self.api.calls))

    def test_unavailable_runtime_and_non_404_fail_closed(self):
        with self.assertRaises(ValueError):
            self.reconcile(('missing',))
        self.api.error = 403
        with self.assertRaises(NativeAPIError):
            self.reconcile()
        self.assertFalse(any(call[0] == 'POST' for call in self.api.calls))
