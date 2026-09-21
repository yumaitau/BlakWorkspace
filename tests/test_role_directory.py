import importlib.util
from pathlib import Path
import unittest
import uuid

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('role_directory',ROOT/'services/app-roles/directory.py')
directory=importlib.util.module_from_spec(spec)
spec.loader.exec_module(directory)


class DirectoryTests(unittest.TestCase):
    def record(self):
        return {'uuid':str(uuid.uuid4()),'is_active':True,'email':'test@example.invalid','groups_obj':[{'name':'blak-vault-reader'}]}

    def test_reads_all_pages(self):
        a,b=self.record(),self.record()
        pages=iter([{'results':[a],'pagination':{'next':2}},{'results':[b],'pagination':{'next':0}}])
        result=directory.users(lambda *args:next(pages))
        self.assertEqual(set(result),{a['uuid'],b['uuid']})
        self.assertEqual(result[a['uuid']]['groups'],['blak-vault-reader'])

    def test_partial_failure_is_not_empty_success(self):
        count=0
        def api(*args):
            nonlocal count
            count+=1
            if count==1:return {'results':[self.record()],'pagination':{'next':2}}
            raise RuntimeError('Directory unavailable')
        with self.assertRaises(RuntimeError):directory.users(api)

    def test_duplicate_identity_rejected(self):
        user=self.record()
        with self.assertRaises(ValueError):directory.users(lambda *args:{'results':[user,user],'pagination':{'next':0}})

    def test_pagination_loop_rejected(self):
        with self.assertRaises(ValueError):directory.users(lambda *args:{'results':[],'pagination':{'next':1}})

    def test_missing_group_snapshot_rejected(self):
        user=self.record();del user['groups_obj']
        with self.assertRaises(KeyError):directory.users(lambda *args:{'results':[user],'pagination':{'next':0}})
