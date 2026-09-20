import importlib.util
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('sync',Path(__file__).with_name('sync.py'))
sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)
class FakeHermes:
    def __init__(self):self.calls=[];self.counter=0
    def upload(self,name,content):self.counter+=1;self.calls.append(('upload',name,content));return {'id':str(self.counter)}
    def json(self,method,path,data=None):self.calls.append((method,path,data));return {}
class SyncTests(unittest.TestCase):
    def test_create_unchanged_update_delete(self):
        api=FakeHermes();old={};saves=[]
        doc={'id':'one','name':'one.md','revision':'1','content':b'first'}
        run=lambda docs:sync.reconcile(api,'private',docs,old,lambda d:self.fail('unexpected download'),lambda:saves.append(True))
        self.assertEqual(run([doc])['uploaded'],1)
        self.assertEqual(run([doc])['unchanged'],1)
        self.assertEqual(run([{**doc,'revision':'2','content':b'updated'}])['uploaded'],1)
        self.assertEqual(old['one']['cleanup'],[])
        self.assertEqual(run([])['deleted'],1)
        self.assertEqual(old,{})
        self.assertTrue(any('/file/remove?delete_file=true' in call[1] for call in api.calls))
    def test_failed_upload_keeps_previous_document(self):
        api=FakeHermes();old={'one':{'file_id':'existing','checksum':'abc','revision':'1'}}
        def fail(*args):raise RuntimeError('offline')
        api.upload=fail
        with self.assertRaises(RuntimeError):sync.reconcile(api,'private',[{'id':'one','name':'one.md','revision':'2','content':b'new'}],old,None,lambda:None)
        self.assertEqual(old['one']['file_id'],'existing')
        self.assertEqual(api.calls,[])
    def test_content_hash_avoids_upload_on_metadata_only_change(self):
        api=FakeHermes();old={'one':{'file_id':'1','checksum':sync.hashlib.sha256(b'same').hexdigest(),'revision':'1'}}
        result=sync.reconcile(api,'private',[{'id':'one','name':'one.md','revision':'2','content':b'same'}],old,None,lambda:None)
        self.assertEqual(result['unchanged'],1);self.assertEqual(api.calls,[])
    def test_durable_pending_cleanup_is_retried(self):
        api=FakeHermes();old={'one':{'file_id':'2','checksum':'abc','revision':'1','cleanup':['1']}}
        sync.reconcile(api,'private',[{'id':'one','name':'one.md','revision':'1'}],old,None,lambda:None)
        self.assertEqual(old['one']['cleanup'],[])
    def test_cross_origin_url_rejected_before_credentials_leave(self):
        with self.assertRaises(ValueError):sync.API('https://source.example',token='fake').request('GET','https://other.example/document')
        with self.assertRaises(ValueError):sync.API('https://source.example',token='fake').request('GET','http://source.example/document')
    def test_atomic_state_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'state.json';sync.save_state(file,{'source':{'files':{}}});self.assertEqual(sync.json.loads(file.read_text()),{'source':{'files':{}}});self.assertEqual(file.stat().st_mode & 0o777,0o600)
    def test_outline_pagination_and_archived_filter(self):
        class Source:
            base='https://sites.example'
            def json(self,method,path,data):
                return {'data':[{'id':str(i),'title':'Doc','text':'Body','publishedAt':'date','updatedAt':'date'} for i in range(100)]} if data['offset']==0 else {'data':[{'id':'archived','title':'Hidden','archivedAt':'date','publishedAt':'date'}]}
        self.assertEqual(len(sync.outline_documents(Source())),100)
    def test_failed_listing_never_becomes_empty_corpus(self):
        class Source:
            def json(self,*args):raise RuntimeError('offline')
        with self.assertRaises(RuntimeError):sync.drive_documents(Source())
    def test_duplicate_source_ids_rejected(self):
        with self.assertRaises(ValueError):sync.reconcile(FakeHermes(),'private',[{'id':'x'},{'id':'x'}],{},None,lambda:None)

class WorkspaceDataTests(unittest.TestCase):
    def test_chat_uses_only_joined_rooms_and_ignores_system_messages(self):
        class Chat:
            public_base='https://chat.example'
            def json(self,method,path):
                self_test.assertEqual(method,'GET')
                if 'channels.list.joined' in path:return {'channels':[{'_id':'room','name':'team'}],'total':1}
                if 'groups.list' in path:return {'groups':[],'total':0}
                if 'channels.history' in path:return {'messages':[{'_id':'1','msg':'Hello workspace','ts':'now','u':{'username':'ada'}},{'_id':'2','msg':'joined','t':'uj'}]}
                raise AssertionError('Unexpected endpoint '+path)
        self_test=self
        docs=sync.chat_documents(Chat())
        self.assertEqual(len(docs),1);self.assertIn(b'Hello workspace',docs[0]['content']);self.assertNotIn(b'joined',docs[0]['content'])
    def test_project_boards_paginate_and_exclude_archived_tasks(self):
        class Projects:
            def json(self,method,path):
                if 'organization/list' in path:return [{'id':'workspace','name':'Work'}]
                if '/api/project?' in path:return [{'id':'project','name':'Plan'}]
                page=int(sync.urllib.parse.parse_qs(sync.urllib.parse.urlsplit(path).query)['page'][0])
                return {'data':{'columns':[{'name':'Todo','tasks':[{'id':str(page),'title':'Task '+str(page)}]}],'plannedTasks':[],'archivedTasks':[{'title':'Hidden'}]},'pagination':{'totalPages':2}}
        docs=sync.project_documents(Projects())
        self.assertEqual(len(docs),1);self.assertIn(b'Task 2',docs[0]['content']);self.assertNotIn(b'Hidden',docs[0]['content'])

if __name__ == "__main__":
    unittest.main()
