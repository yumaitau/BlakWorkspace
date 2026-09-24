import base64
import contextlib
import importlib.util
import io
import sqlite3
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('backup',Path(__file__).with_name('workspace-backup.py'))
backup=importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class BackupFailureTests(unittest.TestCase):
    def test_smith_restore_requires_matching_volume_and_recovery_key(self):
        deployment={'kind':'Deployment','metadata':{'name':'smith-postgres'}}
        key={'kind':'Secret','metadata':{'name':'blak-smith'},'data':{'kek':base64.b64encode(b'test-only-key').decode()}}
        plan=backup.restore_database_plan([deployment,key],['smith-pgdata'])
        self.assertIn(('smith-postgres','smith-pgdata','/var/lib/postgresql'),plan)
        self.assertNotIn('smith-postgres',[item[0] for item in backup.restore_database_plan([],[])])
        for resources,volumes in [([deployment,key],[]),([],['smith-pgdata']),([deployment],['smith-pgdata'])]:
            with self.assertRaises(RuntimeError):backup.restore_database_plan(resources,volumes)

    def test_eyes_restore_does_not_create_a_missing_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            self.assertIsNone(backup.check_eyes_database(root,[]))
            with self.assertRaises(RuntimeError):backup.check_eyes_database(root,['eyes-data'])
            self.assertFalse((root/'volumes/eyes-data/blakeyes.sqlite3').exists())

    def test_eyes_restore_checks_integrity_and_foreign_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);db=root/'volumes/eyes-data/blakeyes.sqlite3';db.parent.mkdir(parents=True)
            with sqlite3.connect(db) as con:
                con.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY)')
                con.execute('CREATE TABLE child (id INTEGER REFERENCES parent(id))')
            self.assertIn('ok',backup.check_eyes_database(root,['eyes-data']))
            with sqlite3.connect(db) as con:con.execute('INSERT INTO child VALUES (42)')
            with self.assertRaisesRegex(RuntimeError,'foreign key'):backup.check_eyes_database(root,['eyes-data'])

    def test_unrelated_binary_secret_is_not_decoded(self):
        resources=[{'kind':'Secret','metadata':{'name':'binary'},'data':{'key':base64.b64encode(b'\xff\xfe').decode()}},
                   {'kind':'Secret','metadata':{'name':'blak-core'},'data':{'postgres-user':base64.b64encode(b'postgres').decode()}}]
        self.assertEqual(backup.secret_text(resources,'blak-core','postgres-user'),'postgres')

    def test_snapshot_error_survives_recovery_failure_without_details(self):
        original=ValueError('private snapshot detail')
        output=io.StringIO()
        with patch.object(backup,'recover',side_effect=RuntimeError('private recovery detail')),contextlib.redirect_stdout(output):
            with self.assertRaises(ValueError) as raised:backup.recover_after_snapshot(Path('/unused'),original)
        self.assertIs(raised.exception,original)
        self.assertNotIn('private',output.getvalue())
        self.assertIn('workspace-backup.py recover',output.getvalue())

    def test_recovery_failure_after_success_is_not_hidden(self):
        with patch.object(backup,'recover',side_effect=RuntimeError):
            with self.assertRaises(RuntimeError):backup.recover_after_snapshot(Path('/unused'),None)

    def test_cleanup_only_removes_labelled_containers(self):
        with patch.object(backup,'run',side_effect=[b'owned-a\nowned-b\n',b'']) as run:
            backup.cleanup_restore()
        self.assertEqual(run.call_args_list[0].args,('docker','ps','-aq','--filter','label='+backup.RESTORE_LABEL))
        self.assertEqual(run.call_args_list[1].args,('docker','rm','-f','owned-a','owned-b'))

    def test_cleanup_empty_inventory_is_noop(self):
        with patch.object(backup,'run',return_value=b'') as run:backup.cleanup_restore()
        self.assertEqual(run.call_count,1)

if __name__=='__main__':unittest.main()
