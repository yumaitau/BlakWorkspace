import base64
import contextlib
import importlib.util
import io
import json
import shutil
import subprocess
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

class FullRestoreTests(unittest.TestCase):
    def test_secret_restore_keeps_agent_token_and_service_tokens(self):
        items=[{'kind':'Secret','type':'Opaque','metadata':{'name':'blak-core','resourceVersion':'9','uid':'u'},'data':{'k':'dg=='}},
               {'kind':'Secret','type':'Opaque','metadata':{'name':'blak-backup-agent'},'data':{'token':'dA=='}},
               {'kind':'Secret','type':'kubernetes.io/service-account-token','metadata':{'name':'sa'},'data':{}},
               {'kind':'Deployment','metadata':{'name':'portal'}}]
        restored=backup.restorable_secrets(items)
        self.assertEqual(list(restored),['blak-core'])
        self.assertEqual(restored['blak-core']['metadata'],{'name':'blak-core','namespace':backup.NS,'labels':{}})

    def test_unfinished_restore_puts_live_data_and_secrets_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);live=root/'pvc-a';aside=root/'pvc-a.pre-restore-X'
            aside.mkdir();(aside/'db').write_text('live')
            live.mkdir();(live/'db').write_text('from backup')
            missing=root/'pvc-b'
            backup.atomic(root/'restore-journal.json',{'swapped':[{'path':str(live),'aside':str(aside)},{'path':str(missing),'aside':str(root/'pvc-b.pre-restore-X')}],
                                                      'secrets':{'blak-core':{'kind':'Secret'}},'secrets_changed':True})
            with patch.object(backup,'put_secrets') as put,contextlib.redirect_stdout(io.StringIO()):backup.rollback_restore(root)
            self.assertEqual((live/'db').read_text(),'live')
            self.assertFalse(aside.exists())
            put.assert_called_once_with({'blak-core':{'kind':'Secret'}})
            self.assertFalse((root/'restore-journal.json').exists())

    def test_restore_refuses_names_outside_the_backup_folder(self):
        with self.assertRaises(RuntimeError):backup.restore(Path('/unused'),Path('/unused'),'../key')

    def test_place_failures_are_recorded_without_host_detail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);places=root/'places.json'
            backup_places=backup.backup_places
            backup_places.save(places,[{'id':'aaaa0001','kind':'s3','name':'R2'},{'id':'aaaa0002','kind':'s3','name':'B2'}])
            def fail(place):
                if place['id']=='aaaa0001':raise backup_places.PlaceError('Bucket not found')
                raise OSError('/secret/host/path')
            with patch.object(backup_places,'open_place',side_effect=fail),contextlib.redirect_stdout(io.StringIO()):
                backup.send_to_places(root,root/'workspace-20260925T173000Z.tar.gpg',places)
            result=json.loads((root/'places-status.json').read_text())
            self.assertEqual(result['aaaa0001']['error'],'Bucket not found')
            self.assertEqual(result['aaaa0002']['error'],'Copy failed (OSError)')

@unittest.skipUnless(shutil.which('gpg') and shutil.which('tar'),'needs gpg and tar')
class RestorePipelineTests(unittest.TestCase):
    def make_archive(self,root,key,volumes,secrets):
        stage=root/'stage';(stage/'volumes').mkdir(parents=True)
        for name,content in volumes.items():
            (stage/'volumes'/name).mkdir();(stage/'volumes'/name/'data').write_text(content)
        (stage/'volumes/portal-flow-data').mkdir();(stage/'volumes/portal-flow-data/sessions.enc').write_text('old sessions')
        backup.atomic(stage/'resources.json',{'items':secrets})
        checks={str(p.relative_to(stage)):backup.digest(p) for p in stage.rglob('*') if p.is_file()}
        backup.atomic(stage/'manifest.json',{'volumes':sorted(list(volumes)+['portal-flow-data']),'sha256':checks})
        archive=root/'workspace-20260925T173000Z.tar.gpg'
        tar=subprocess.Popen(['tar','-C',str(stage),'-cf','-','.'],stdout=subprocess.PIPE)
        subprocess.run(['gpg','--batch','--yes','--pinentry-mode','loopback','--passphrase-file',str(key),'--symmetric','--output',str(archive)],stdin=tar.stdout,check=True,stderr=subprocess.DEVNULL)
        tar.stdout.close();tar.wait();shutil.rmtree(stage)

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.key=self.root/'key';self.key.write_text('test passphrase')
        self.live=self.root/'storage';self.live.mkdir()
        for name in ('pvc-a','pvc-portal'):(self.live/name).mkdir();(self.live/name/'data').write_text('live')
        self.paths={'a-data':str(self.live/'pvc-a'),'portal-flow-data':str(self.live/'pvc-portal')}
        old={'kind':'Secret','type':'Opaque','metadata':{'name':'blak-core'},'data':{'k':'b2xk'}}
        self.make_archive(self.root,self.key,{'a-data':'from backup','gone-data':'app removed since'},[old])
    def tearDown(self):self.tmp.cleanup()

    def restore(self,put_secrets=None):
        live={'items':[{'kind':'Secret','type':'Opaque','metadata':{'name':'blak-core'},'data':{'k':'bmV3'}}]}
        with patch.object(backup,'kube',return_value=json.dumps(live)),patch.object(backup,'volume_paths',return_value=self.paths),\
             patch.object(backup,'quiesce'),patch.object(backup,'put_secrets',side_effect=put_secrets) as put,\
             patch.object(backup.shutil,'disk_usage',return_value=type('U',(),{'free':1<<50})()),contextlib.redirect_stdout(io.StringIO()):
            backup.restore(self.root,self.key,'workspace-20260925T173000Z.tar.gpg')
        return put

    def test_restore_swaps_volumes_and_secrets_and_keeps_the_old_data(self):
        put=self.restore()
        self.assertEqual((self.live/'pvc-a/data').read_text(),'from backup')
        self.assertFalse((self.live/'pvc-portal/sessions.enc').exists())
        kept=[p.name for p in self.live.iterdir() if '.pre-restore-' in p.name]
        self.assertEqual(sorted(k.split('.pre-restore-')[0] for k in kept),['pvc-a','pvc-portal'])
        self.assertEqual(put.call_args.args[0]['blak-core']['data'],{'k':'b2xk'})
        self.assertEqual(json.loads((self.root/'last-restore.json').read_text())['volumes'],2)
        self.assertFalse((self.root/'restore-journal.json').exists())

    def test_failed_restore_puts_everything_back(self):
        calls=[]
        with patch.object(backup,'move',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):self.restore(calls.append)
        self.assertEqual((self.live/'pvc-a/data').read_text(),'live')
        self.assertEqual([p.name for p in self.live.iterdir() if '.pre-restore-' in p.name],[])
        self.assertEqual(calls[-1]['blak-core']['data'],{'k':'bmV3'})
        self.assertFalse((self.root/'restore-journal.json').exists())

if __name__=='__main__':unittest.main()
