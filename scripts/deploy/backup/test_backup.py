import base64
import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('backup',Path(__file__).with_name('workspace-backup.py'))
backup=importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

class BackupFailureTests(unittest.TestCase):
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
