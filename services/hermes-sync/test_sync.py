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
    def test_collection_branding_migration_requires_private_owner(self):
        class Hermes(FakeHermes):
            owner = 'owner'
            def json(self, method, path, data=None):
                if path == '/api/v1/auths/': return {'id': 'owner'}
                if path == '/api/v1/knowledge/private':
                    return {'user_id': self.owner, 'access_grants': [], 'name': 'Blak Workspace · Outline', 'description': 'Private source'}
                return super().json(method, path, data)
        api = Hermes()
        mapping = {'owner_id': 'owner', 'hermes': {}, 'sources': {'outline': {'base': 'https://example.test'}}}
        with patch.object(sync, 'API', return_value=api), patch.object(sync, 'outline_documents', return_value=[]), patch.object(sync, 'ensure_workspace_model'):
            sync.sync_mapping(mapping, {'outline': {'collection': 'private', 'files': {}}}, lambda: None, {'outline'})
            self.assertIn(('POST', '/api/v1/knowledge/private/update', {'name': 'Blak Workspace · Knowledge', 'description': 'Private source', 'access_grants': []}), api.calls)
            api.owner = 'someone-else'
            api.calls.clear()
            with self.assertRaises(RuntimeError):
                sync.sync_mapping(mapping, {'outline': {'collection': 'private', 'files': {}}}, lambda: None, {'outline'})
            self.assertFalse(any(call[0] == 'POST' for call in api.calls))
    def test_model_cache_refresh_failure_is_retried_without_source_changes(self):
        class Hermes:
            refreshes=0
            def json(self,method,path,data=None):
                if path=='/api/v1/auths/':return {'id':'owner'}
                if path=='/api/models':
                    self.refreshes+=1
                    if self.refreshes==1:raise RuntimeError('catalog unavailable')
                    return {'data':[]}
                raise AssertionError(path)
        api=Hermes()
        mapping={'owner_id':'owner','hermes':{},'sources':{}}
        with patch.object(sync,'API',return_value=api), patch.object(sync,'ensure_workspace_model'):
            with self.assertRaisesRegex(RuntimeError,'catalog unavailable'):
                sync.sync_mapping(mapping,{},lambda:None,set(mapping['sources']))
            self.assertEqual(sync.sync_mapping(mapping,{},lambda:None,set(mapping['sources'])),{})
        self.assertEqual(api.refreshes,2)
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
            self.assertEqual(sync.sync_mapping(mapping,state,lambda:None,set(mapping['sources']))['draw']['uploaded'],1)
            self.assertEqual(sync.sync_mapping(mapping,state,lambda:None,set(mapping['sources']))['draw']['unchanged'],1)
            source['public_base']='https://new.example.test'
            self.assertEqual(sync.sync_mapping(mapping,state,lambda:None,set(mapping['sources']))['draw']['uploaded'],1)
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
    def test_drive_processing_upload_does_not_block_committed_documents(self):
        class Source:
            status = 'HTTP/1.1 425 TOO EARLY'
            collection = ''
            def request(self, *args, **kwargs):
                return f'''<d:multistatus xmlns:d="DAV:">
                  <d:response><d:href>/dav/root/pending.txt</d:href><d:propstat>
                    <d:status>{self.status}</d:status><d:prop><d:resourcetype>{self.collection}</d:resourcetype></d:prop>
                  </d:propstat></d:response>
                  <d:response><d:href>/dav/root/ready.txt</d:href><d:propstat>
                    <d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>ready</d:getetag></d:prop>
                  </d:propstat></d:response></d:multistatus>'''.encode()
        source = Source()
        self.assertEqual([d['name'] for d in sync.drive_documents(source, ['/dav/root'])], ['ready.txt'])
        source.status = 'HTTP/1.1 200 OK'
        self.assertEqual(len(sync.drive_documents(source, ['/dav/root'])), 2)
        for status in ['HTTP/1.1 500 Internal Server Error', 'HTTP/1.1 403 Forbidden', '']:
            source.status = status
            with self.assertRaises(RuntimeError): sync.drive_documents(source, ['/dav/root'])
        source.status = 'HTTP/1.1 425 TOO EARLY'
        source.collection = '<d:collection/>'
        with self.assertRaises(RuntimeError): sync.drive_documents(source, ['/dav/root'])

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
                 'sources':{'crm':{'base':'https://crm.example'}, 'draw':{'base':'https://portal.example'}}}
        state={name:{'collection':name, 'files':{}} for name in mapping['sources']}
        with patch.object(sync, 'API', return_value=Hermes()), \
             patch.object(sync, 'crm_documents', side_effect=RuntimeError('offline')), \
             patch.object(sync, 'portal_documents', return_value=[]) as reader, \
             patch.object(sync, 'ensure_workspace_model') as model:
            with self.assertRaises(RuntimeError): sync.sync_mapping(mapping, state, lambda:None,set(mapping['sources']))
            reader.assert_called_once()
            self.assertEqual(set(model.call_args.args[2]), {'draw'})
            self.assertIn('last_error', state['crm'])
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


class SearchTests(unittest.TestCase):
    def test_structured_exports_have_readable_previews(self):
        doc = {'id': 'project', 'name': 'export.json', 'content': b'{"project":{"name":"Team feedback","id":"opaque-id","fields":[{"title":["What should we improve?"],"kind":"short_text"}]},"source":"https://projects.example/project"}'}
        result = sync.search_document(None, 'owner', 'ada', 'projects', {'public_base': 'https://projects.example'}, doc, {})
        self.assertEqual(result['title'], 'Team feedback')
        self.assertEqual(result['content'], 'Team feedback\nWhat should we improve?')
        self.assertEqual(result['url'], 'https://projects.example/project')
    def test_private_owner_title_url_and_expiry(self):
        doc={'id':'one','name':'one.md','content':b'# A project\nSource: https://docs.example/doc/one\nPrivate plan'}
        result=sync.search_document(None,'hermes-owner','ada','outline',{'public_base':'https://docs.example'},doc,{})
        self.assertEqual(result['allowedUsers'],['ada'])
        self.assertEqual(result['visibility'],'private')
        self.assertEqual(result['title'],'A project')
        self.assertEqual(result['url'],'https://docs.example/doc/one')
        self.assertGreater(result['expiresAt'],sync.time.time())
        other=sync.search_document(None,'other','bob','outline',{'public_base':'https://docs.example'},doc,{})
        self.assertNotEqual(result['id'],other['id'])
    def test_extracted_file_owner_is_verified(self):
        class Files:
            def json(self,*args):return {'user_id':'someone-else','data':{'content':'private'}}
        with self.assertRaises(ValueError):
            sync.search_document(Files(),'owner','ada','drive',{'public_base':'https://drive.example'},{'id':'x','name':'x.pdf'},{'file_id':'file'})
    def test_external_source_link_is_not_published(self):
        result=sync.search_document(None,'owner','ada','outline',{'public_base':'https://docs.example'},{'id':'x','name':'x','content':b'# X\nSource: https://attacker.example/x'},{})
        self.assertEqual(result['url'],'https://docs.example')
    def test_replacement_is_scoped_and_tasks_must_complete(self):
        class API:
            def __init__(self):self.calls=[]
            def json(self,method,path,data=None):
                self.calls.append((method,path,data))
                return {'status':'succeeded'} if path.startswith('/tasks/') else {'taskUid':1}
        api=API();index=sync.SearchIndex(api)
        index.replace_owner('ada',[])
        delete=next(call for call in api.calls if call[1].endswith('/documents/delete'))
        self.assertEqual(delete[2],{'filter':'owner = "ada"'})
        with self.assertRaises(ValueError):index.replace_owner('',[])
        with self.assertRaises(ValueError):index.replace_owner('ada',[{'owner':'bob','allowedUsers':['bob']}])
    def test_failed_index_task_is_not_success(self):
        class API:
            def json(self,*args):return {'status':'failed','taskUid':1}
        with self.assertRaises(RuntimeError):sync.SearchIndex(API())

class SourceRevocationTests(unittest.TestCase):
    def test_missing_owner_rejected_before_any_native_mutation(self):
        import access
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'accounts.json'
            state = root / 'state.json'
            config.write_text(sync.json.dumps({'accounts': [{'name': 'legacy', 'owner_id': 'owner', 'hermes': {}, 'sources': {'draw': {}}}]}))
            original = {'legacy': {'draw': {'files': {'doc': {'file_id': 'preserve'}}}}}
            state.write_text(sync.json.dumps(original))
            (root / 'base-url').write_text('https://directory.example')
            (root / 'api-token').write_text('fixture')
            (root / 'subjects.json').write_text('{}')
            with patch.dict(sync.os.environ, {'SYNC_CONFIG': str(config), 'SYNC_STATE': str(state), 'BLAK_DIRECTORY_PATH': str(root)}), patch.object(access, 'snapshot', return_value={}), patch.object(sync, 'sync_mapping') as mutate:
                self.assertEqual(sync.main(), 1)
            mutate.assert_not_called()
            self.assertEqual(sync.json.loads(state.read_text()), original)

    def test_transient_processing_error_preserves_authorized_copy_but_explicit_denial_revokes(self):
        class Hermes:
            def __init__(self): self.deleted = []
            def json(self, method, path, data=None):
                if method == 'DELETE': self.deleted.append(path)
                if path == '/api/v1/auths/': return {'id': 'owner'}
                return {'user_id': 'owner', 'access_grants': []}
        for code in (500, 403):
            with self.subTest(code=code):
                api = Hermes()
                mapping = {'owner_id': 'owner', 'hermes': {}, 'sources': {'draw': {}}}
                state = {'draw': {'collection': 'private', 'files': {'doc': {'file_id': 'copy'}}}}
                error = sync.urllib.error.HTTPError('https://fixture.test', code, 'fixture failure', {}, None)
                with patch.object(sync, 'API', return_value=api), patch.object(sync, 'portal_documents', return_value=[]), patch.object(sync, 'reconcile', side_effect=error), patch.object(sync, 'ensure_workspace_model') as model:
                    with self.assertRaises(RuntimeError): sync.sync_mapping(mapping, state, lambda: None, {'draw'})
                self.assertEqual(bool(api.deleted), code == 403)
                self.assertEqual(bool(state['draw']['files']), code == 500)
                self.assertIn('last_error', state['draw'])
                self.assertEqual(model.call_args.args[2], {})

    def test_hermes_and_source_grants_both_required(self):
        mapping = {'portal_owner': 'frozen-subject'}
        self.assertEqual(sync.permitted_sources(mapping, {}), set())
        self.assertEqual(sync.permitted_sources(mapping, {'frozen-subject': {'apps': ['draw']}}), set())
        self.assertEqual(sync.permitted_sources(mapping, {'frozen-subject': {'apps': ['hermes', 'draw', 'vault']}}), {'draw'})

    def test_revoked_source_never_uses_saved_source_credential(self):
        class Hermes(FakeHermes):
            def json(self, method, path, data=None):
                self.calls.append((method, path, data))
                if path == '/api/v1/auths/': return {'id': 'owner'}
                if path.startswith('/api/v1/files/') and method == 'GET': return {'user_id': 'owner'}
                return {}
        api = Hermes()
        mapping = {'owner_id': 'owner', 'hermes': {}, 'sources': {'draw': {'base': 'http://unused'}}}
        state = {'draw': {'collection': 'private', 'files': {'doc': {'file_id': 'copy', 'cleanup': ['old-copy']}}}}
        with patch.object(sync, 'API', return_value=api) as factory, patch.object(sync, 'portal_documents') as read, patch.object(sync, 'ensure_workspace_model') as model:
            result = sync.sync_mapping(mapping, state, lambda: None, set())
        read.assert_not_called()
        factory.assert_called_once_with()
        self.assertEqual(result['draw']['deleted'], 2)
        self.assertEqual(state['draw']['files'], {})
        self.assertTrue(state['draw']['access_revoked'])
        self.assertEqual(model.call_args.args[2], {})
        self.assertIn(('DELETE', '/api/v1/files/copy', None), api.calls)

    def test_foreign_owner_copy_is_never_deleted(self):
        api = FakeHermes()
        api.json = lambda *args: {'user_id': 'other'}
        record = {'files': {'doc': {'file_id': 'other-copy'}}}
        with self.assertRaises(ValueError): sync.revoke_source(api, 'owner', record, lambda: None)
        self.assertIn('doc', record['files'])

    def test_interrupted_deletion_retries_missing_file_without_losing_other_work(self):
        class Hermes:
            def json(self, method, path, data=None):
                raise sync.urllib.error.HTTPError(path, 404, 'not found', {}, None)
        record = {'files': {'doc': {'file_id': 'already-deleted'}}}
        sync.revoke_source(Hermes(), 'owner', record, lambda: None)
        self.assertEqual(record['files'], {})


class RetiredFormsTests(unittest.TestCase):
    def test_retired_forms_never_connect_and_remove_only_owned_tracked_copies(self):
        class Hermes(FakeHermes):
            def json(self, method, path, data=None):
                if path == '/api/v1/auths/': return {'id': 'owner'}
                if method == 'GET' and path.startswith('/api/v1/files/'):
                    return {'user_id': 'owner'}
                return super().json(method, path, data)
        for configured in (True, False):
            with self.subTest(configured=configured):
                api = Hermes()
                mapping = {'owner_id': 'owner', 'hermes': {},
                           'sources': {'forms': {'base': 'https://forms.invalid'}} if configured else {}}
                state = {'forms': {'collection': 'old-forms', 'files': {
                    'response': {'file_id': 'tracked', 'cleanup': ['old']}}}}
                with patch.object(sync, 'API', return_value=api) as client, \
                     patch.object(sync, 'ensure_workspace_model') as model:
                    result = sync.sync_mapping(mapping, state, lambda: None, {'forms'})
                    client.assert_called_once_with()
                    self.assertEqual(result['forms']['deleted'], 2)
                    self.assertEqual(state['forms']['files'], {})
                    self.assertTrue(state['forms']['access_revoked'])
                    self.assertEqual(model.call_args.args[2], {})
                    self.assertIn(('DELETE', '/api/v1/files/tracked', None), api.calls)
                    self.assertEqual(sync.sync_mapping(mapping, state, lambda: None, {'forms'})['forms']['deleted'], 0)

    def test_retired_forms_cannot_delete_another_owners_file(self):
        class Hermes(FakeHermes):
            def json(self, method, path, data=None):
                if path == '/api/v1/auths/': return {'id': 'owner'}
                if path == '/api/v1/files/foreign': return {'user_id': 'someone-else'}
                return super().json(method, path, data)
        api = Hermes()
        state = {'forms': {'files': {'response': {'file_id': 'foreign'}}}}
        with patch.object(sync, 'API', return_value=api), patch.object(sync, 'ensure_workspace_model'):
            with self.assertRaises(RuntimeError):
                sync.sync_mapping({'owner_id': 'owner', 'hermes': {}, 'sources': {}}, state, lambda: None, set())
        self.assertFalse(any(call[0] == 'DELETE' for call in api.calls))
        self.assertIn('response', state['forms']['files'])

    def test_retired_forms_excluded_from_grants_and_health(self):
        mapping = {'name': 'account', 'portal_owner': 'subject', 'sources': {'forms': {}}}
        self.assertNotIn('forms', sync.permitted_sources(mapping, {'subject': {'apps': ['hermes', 'forms']}}))
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'health.json'
            sync.publish_health({'accounts': [mapping]}, {}, file)
            self.assertEqual(sync.json.loads(file.read_text())['accounts'][0]['sources'], [])

if __name__ == "__main__":
    unittest.main()
