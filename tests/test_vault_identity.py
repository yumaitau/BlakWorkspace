import importlib.util
from pathlib import Path
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('vault_identity', ROOT / 'services/app-roles/vault_identity.py')
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)


class VaultIdentityTests(unittest.TestCase):
    def setUp(self):
        self.native, self.subject = str(uuid.uuid4()), str(uuid.uuid4())
        self.issuer = 'https://id.example.invalid/application/o/vault/'

    def table(self, binding=None):
        parser = identity.SsoTable()
        value = binding if binding is not None else self.issuer + '/' + self.subject
        parser.feed('<table id="users-table"><thead><tr><th>User</th><th>SSO Identifier</th></tr></thead><tbody><tr><td><span data-vw-user-uuid="' + self.native + '">email@example.invalid</span></td><td>' + value + '</td></tr></tbody></table>')
        return parser

    def test_uses_immutable_subject_not_email(self):
        self.assertEqual(self.table().links(self.issuer, {self.native: {}}), {self.native: self.subject})

    def test_foreign_issuer_rejected(self):
        with self.assertRaises(ValueError): self.table('https://evil.invalid/' + self.subject).links(self.issuer, {self.native: {}})

    def test_missing_native_account_snapshot_rejected(self):
        with self.assertRaises(ValueError): self.table().links(self.issuer, {})

    def test_unlinked_account_never_falls_back_to_email(self):
        self.assertEqual(self.table('').links(self.issuer, {self.native: {'email':'email@example.invalid'}}), {})

    def test_changed_upstream_table_fails_closed(self):
        parser = identity.SsoTable()
        parser.feed('<table><tr><td>not the SSO table</td></tr></table>')
        with self.assertRaises(ValueError): parser.links(self.issuer, {})

    def test_non_uuid_subject_rejected(self):
        with self.assertRaises(ValueError): self.table(self.issuer + '/email@example.invalid').links(self.issuer, {self.native: {}})
