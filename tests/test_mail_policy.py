import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/mail/check-deployment.py'
spec = importlib.util.spec_from_file_location('mail_policy', SCRIPT)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class MailPolicyTests(unittest.TestCase):
    def setUp(self):
        self.example = json.loads((ROOT / 'deploy/mail/policy/example.json').read_text())
        self.ready = copy.deepcopy(self.example)
        for gate in self.ready['gates'].values():
            gate.update(status='passed', evidence_sha256='a' * 64)

    def test_example_blocks_production_and_synthetic_evidence_can_pass_intent_only(self):
        self.assertEqual(len(policy.validate(self.example)), len(policy.GATES))
        self.assertEqual(policy.validate(self.ready), [])

    def test_every_resource_rejects_foreign_region(self):
        for index in range(len(self.ready['resources'])):
            with self.subTest(index=index):
                config = copy.deepcopy(self.ready)
                config['resources'][index]['region'] = 'ap-southeast-1'
                self.assertTrue(policy.validate(config))

    def test_foreign_arn_cannot_hide_behind_australian_label(self):
        config = copy.deepcopy(self.ready)
        key = next(r for r in config['resources'] if r['kind'] == 'kms')
        key['arn'] = key['arn'].replace('ap-southeast-2', 'us-east-1')
        self.assertTrue(policy.validate(config))

    def test_multiregion_key_rejected(self):
        key = next(r for r in self.ready['resources'] if r['kind'] == 'kms')
        key['arn'] = key['arn'].split('key/')[0] + 'key/mrk-' + 'a' * 32
        self.assertTrue(policy.validate(self.ready))

    def test_missing_cell_and_duplicate_resource_rejected(self):
        config = copy.deepcopy(self.ready)
        config['resources'] = [r for r in config['resources'] if r['region'] == 'ap-southeast-2']
        self.assertTrue(policy.validate(config))
        self.ready['resources'].append(self.ready['resources'][0])
        self.assertTrue(policy.validate(self.ready))

    def test_no_melbourne_ses_or_foreign_fallback_or_implicit_direct_route(self):
        for route in ({'mode': 'ses_api', 'endpoint': 'https://email.ap-southeast-4.amazonaws.com'},
                      {'mode': 'ses_api', 'endpoint': 'https://email.ap-southeast-1.amazonaws.com'},
                      {'mode': 'direct_mx', 'endpoint': None},
                      {'mode': 'direct_mx', 'endpoint': 'https://relay.example.com'}, {}, None):
            with self.subTest(route=route):
                config = copy.deepcopy(self.ready)
                config['outbound']['ap-southeast-4'] = route
                self.assertTrue(policy.validate(config))

    def test_both_regions_require_hold_on_ses_outage(self):
        for region in policy.REGIONS:
            for action in (None, 'discard', 'bounce', 'direct_mx', 'fallback'):
                with self.subTest(region=region, action=action):
                    config = copy.deepcopy(self.ready)
                    config['outbound'][region]['on_unavailable'] = action
                    self.assertTrue(policy.validate(config))
            config = copy.deepcopy(self.ready)
            del config['outbound'][region]['on_unavailable']
            self.assertTrue(policy.validate(config))

    def test_melbourne_can_only_drain_to_sydney_ses(self):
        for endpoint in (None, 'https://email.ap-southeast-4.amazonaws.com',
                         'https://email.us-east-1.amazonaws.com', 'https://relay.example.com'):
            with self.subTest(endpoint=endpoint):
                config = copy.deepcopy(self.ready)
                config['outbound']['ap-southeast-4']['endpoint'] = endpoint
                self.assertTrue(policy.validate(config))

    def test_outage_queue_and_event_evidence_are_required(self):
        for gate in ('outage_queue_recovery', 'event_delivery'):
            with self.subTest(gate=gate):
                config = copy.deepcopy(self.ready)
                config['gates'][gate]['status'] = 'pending'
                self.assertIn('production gate unresolved: ' + gate, policy.validate(config))

    def test_smtp_requires_explicit_port_and_starttls(self):
        for region in policy.REGIONS:
            for field, values in (('port', (None, '587', 465, 587.0)),
                                  ('require_starttls', (None, False, 1, 'true'))):
                for value in values:
                    with self.subTest(region=region, field=field, value=value):
                        config = copy.deepcopy(self.ready)
                        config['outbound'][region][field] = value
                        self.assertTrue(policy.validate(config))
                config = copy.deepcopy(self.ready)
                del config['outbound'][region][field]
                self.assertTrue(policy.validate(config))

    def test_provider_url_cannot_redirect_or_include_credentials(self):
        for endpoint in ('https://email.ap-southeast-2.amazonaws.com.evil.test',
                         'https://secret@email.ap-southeast-2.amazonaws.com',
                         'http://email.ap-southeast-2.amazonaws.com',
                         'https://email.ap-southeast-2.amazonaws.com/?region=us-east-1'):
            self.ready['outbound']['ap-southeast-2']['endpoint'] = endpoint
            self.assertTrue(policy.validate(self.ready))

    def test_unknown_fields_and_missing_evidence_fail_closed(self):
        config = copy.deepcopy(self.ready)
        config['fallback_region'] = 'us-east-1'
        self.assertTrue(policy.validate(config))
        self.ready['gates']['zero_loss_durability']['evidence_sha256'] = ''
        self.assertTrue(policy.validate(self.ready))

    def test_malformed_types_fail_closed_without_crashing(self):
        for value in (None, [], True, 4, 'invalid string!', {}):
            with self.subTest(value=value):
                self.assertTrue(policy.validate(value))
                for field in policy.ROOT_KEYS:
                    config = copy.deepcopy(self.ready)
                    config[field] = value
                    self.assertTrue(policy.validate(config))
                for field in ('kind', 'region', 'arn', 'id'):
                    config = copy.deepcopy(self.ready)
                    config['resources'][0][field] = value
                    self.assertTrue(policy.validate(config))

    def test_cli_rejects_duplicate_json_keys_without_echoing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'bad.json'
            path.write_text('{"secret":"canary-value", "secret":"other"}')
            result = subprocess.run([sys.executable, str(SCRIPT), str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn('canary-value', result.stderr)


if __name__ == '__main__':
    unittest.main()
