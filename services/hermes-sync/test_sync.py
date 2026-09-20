import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('sync',Path(__file__).with_name('sync.py'))
sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)
class FakeHermes:
    def __init__(self):self.calls=[];self.counter=0
    def upload(self,name,content):self.counter+=1;self.calls.append(('upload',name,content));return {'id':str(self.counter)}
    def json(self,method,path,data=None):self.calls.append((method,path,data));return {}
class SyncTests(unittest.TestCase):
    def test_public_origin_change_refreshes_unchanged_source_revision(self):
        class Hermes(FakeHermes):
            def json(self, method, path, data=None):
                if path == '/api/v1/auths/': return {'id': 'owner'}
                if path == '/api/v1/knowledge/private': return {'user_id': 'owner', 'access_grants': []}
                return super().json(method, path, data)
        api=Hermes()
        source={'base':'http://portal:3000','public_base':'https://old.example.test'}
        mapping={'hermes':{},'owner_id':'owner','sources':{'draw':source}}
        state={'draw':{'collection':'private','files':{}}}
        def documents(*args):
            return [{'id':'one','name':'one.md','revision':'1','content':source['public_base'].encode()}]
        with patch.object(sync,'API',return_value=api), patch.object(sync,'portal_documents',side_effect=documents), patch.object(sync,'ensure_workspace_model'):
            self.assertEqual(sync.sync_mapping(mapping,state,lambda:None)['draw']['uploaded'],1)
            self.assertEqual(sync.sync_mapping(mapping,state,lambda:None)['draw']['unchanged'],1)
            source['public_base']='https://new.example.test'
            self.assertEqual(sync.sync_mapping(mapping,state,lambda:None)['draw']['uploaded'],1)
        self.assertEqual(api.counter,2)
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
                if 'im.list' in path:return {'ims':[],'total':0}
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


class NewWorkspaceSourcesTests(unittest.TestCase):
    def test_failed_source_does_not_block_others_and_detaches_from_model(self):
        class Hermes:
            def json(self, method, path):
                if path == '/api/v1/auths/': return {'id':'owner'}
                return {'user_id':'owner', 'access_grants':[]}
        mapping={'owner_id':'owner', 'hermes':{'base':'https://hermes.example'},
                 'sources':{'forms':{'base':'https://forms.example'}, 'draw':{'base':'https://portal.example'}}}
        state={name:{'collection':name, 'files':{}} for name in mapping['sources']}
        with patch.object(sync, 'API', return_value=Hermes()), \
             patch.object(sync, 'forms_documents', side_effect=RuntimeError('offline')), \
             patch.object(sync, 'portal_documents', return_value=[]) as reader, \
             patch.object(sync, 'ensure_workspace_model') as model:
            with self.assertRaises(RuntimeError): sync.sync_mapping(mapping, state, lambda:None)
            reader.assert_called_once()
            self.assertEqual(set(model.call_args.args[2]), {'draw'})
            self.assertIn('last_error', state['forms'])
            self.assertIn('last_success', state['draw'])

    def test_crm_requires_matching_identity_before_reading_any_records(self):
        class Source:
            expected_user='alice@example.test'
            def json(self, method, path):
                self_test.assertEqual(path, '/api/method/frappe.auth.get_logged_user')
                return {'message': 'bob@example.test'}
        self_test=self
        with self.assertRaises(ValueError): sync.crm_documents(Source())

    def test_crm_record_pagination_and_content(self):
        class Source:
            expected_user='alice@example.test'; public_base='https://crm.example'
            def json(self, method, path):
                if 'get_logged_user' in path: return {'message':self.expected_user}
                if '/CRM%20Lead?' in path:
                    offset=int(sync.urllib.parse.parse_qs(sync.urllib.parse.urlsplit(path).query)['limit_start'][0])
                    return {'data':[{'name':str(i),'modified':'now'} for i in range(100)] if offset==0 else []}
                if '?' in path:return {'data':[]}
                return {'data':{'name':path.rsplit('/',1)[-1], 'first_name':'Workspace lead'}}
        docs=sync.crm_documents(Source())
        self.assertEqual(len(docs),100)
        self.assertIn(b'Workspace lead',docs[0]['content'])

    def test_forms_errors_never_become_successful_empty_listing(self):
        class Source:
            def json(self,*args):return {'errors':[{'message':'Forbidden'}], 'data':{'teams':[]}}
        with self.assertRaises(RuntimeError):sync.graphql(Source(),'{teams{id}}')

    def test_forms_paginate_responses_and_exclude_password_settings(self):
        class Source:
            expected_user='alice@example.test'; public_base='https://forms.example'
            def json(self, method, path, data):
                query=data['query']; values=data['variables'].get('input',{})
                self_test.assertNotIn('password',query)
                if 'userDetail' in query:return {'data':{'userDetail':{'email':self.expected_user}}}
                if 'teams{' in query:return {'data':{'teams':[{'id':'t','name':'Team','projects':[{'id':'p','name':'Project'}]}]}}
                if 'forms(' in query:return {'data':{'forms':[{'id':'f','name':'Survey'}]}}
                if 'formDetail' in query:return {'data':{'formDetail':{'id':'f','name':'Survey','fields':[]}}}
                page=values['page']; count=30 if page==1 else 1
                return {'data':{'submissions':{'total':31,'submissions':[{'id':str((page-1)*30+i),'answers':[{'value':'answer'}]} for i in range(count)]}}}
        self_test=self
        docs=sync.forms_documents(Source())
        self.assertEqual(len(docs),32)
        self.assertIn(b'answer',docs[-1]['content'])

    def test_portal_export_cannot_be_mapped_to_another_owner(self):
        class Source:
            expected_user='alice'
            def json(self,*args):return {'owner':'bob','documents':[]}
        with self.assertRaises(ValueError):sync.portal_documents(Source(),'draw')

    def test_storage_pagination_and_document_paths(self):
        class Source:
            def request(self, method, path):
                if path=='/':return b'<ListAllMyBucketsResult><Buckets><Bucket><Name>work</Name></Bucket></Buckets></ListAllMyBucketsResult>'
                if 'continuation-token' not in path:return b'<ListBucketResult><Contents><Key>one.txt</Key><Size>3</Size><ETag>1</ETag></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>next</NextContinuationToken></ListBucketResult>'
                return b'<ListBucketResult><Contents><Key>two.pdf</Key><Size>5</Size><ETag>2</ETag></Contents><IsTruncated>false</IsTruncated></ListBucketResult>'
        docs=sync.storage_documents(Source())
        self.assertEqual([d['path'] for d in docs],['/work/one.txt','/work/two.pdf'])

class HealthPublicationTests(unittest.TestCase):
    def test_health_contains_no_credentials_or_document_identifiers(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'health.json'
            mapping={'name':'account','portal_owner':'alice','sources':{'crm':{'token':'secret'}},'credential_metadata':{'crm':{'expires_at':500}}}
            state={'account':{'crm':{'last_success':100,'files':{'sensitive-record-id':{'file_id':'private'}}}}}
            sync.publish_health({'accounts':[mapping]},state,file)
            text=file.read_text()
            self.assertNotIn('secret',text);self.assertNotIn('sensitive-record-id',text);self.assertNotIn('private',text)
            record=sync.json.loads(text)['accounts'][0]['sources'][0]
            self.assertEqual(record['documents'],1);self.assertEqual(record['expires_at'],500)

if __name__ == "__main__":
    unittest.main()
