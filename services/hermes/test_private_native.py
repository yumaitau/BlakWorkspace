"""Run actual native content functions with app-admin and controller identities."""
import os
import sys
from types import SimpleNamespace as NS
import unittest
from unittest.mock import AsyncMock, patch
from test_native import HTTPError, native_function


class PrivateAdminTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.admin = NS(id='app-admin', role='admin')
        self.knowledge = NS(id='private-kb', user_id='other-owner', access_grants=[],
                            model_dump=lambda: {'id': 'private-kb', 'user_id': 'other-owner'})
        self.grants = AsyncMock(return_value=False)
        self.env = dict(Knowledges=NS(get_knowledge_by_id=AsyncMock(return_value=self.knowledge)),
                        AccessGrants=NS(has_access=self.grants),
                        HTTPException=HTTPError, BYPASS_ADMIN_ACCESS_CONTROL=True,
                        KnowledgeFilesResponse=lambda **value: value,
                        ERROR_MESSAGES=NS(ACCESS_PROHIBITED='denied', NOT_FOUND='missing'),
                        status=NS(HTTP_401_UNAUTHORIZED=401, HTTP_400_BAD_REQUEST=400, HTTP_404_NOT_FOUND=404))

    async def test_app_admin_cannot_read_another_private_knowledge_or_its_files(self):
        for name in ('get_knowledge_by_id', 'get_knowledge_files_by_id'):
            with self.subTest(route=name):
                call = native_function('routers/knowledge.py', name, self.env.copy())
                with self.assertRaises(HTTPError):
                    await call(id='private-kb', user=self.admin, db=None)
        self.assertEqual(self.grants.await_count, 2)

    async def test_explicit_read_grant_and_owner_keep_native_access(self):
        call = native_function('routers/knowledge.py', 'get_knowledge_by_id', self.env.copy())
        self.grants.return_value = True
        self.assertEqual((await call('private-kb', self.admin, None))['id'], 'private-kb')
        self.grants.return_value = False
        self.knowledge.user_id = self.admin.id
        self.assertEqual((await call('private-kb', self.admin, None))['id'], 'private-kb')

    async def test_only_enrolled_controller_retains_content_bypass(self):
        call = native_function('routers/knowledge.py', 'get_knowledge_by_id', self.env.copy())
        with patch.dict(os.environ, {'BLAK_ROLE_CONTROLLER_ID': 'controller'}):
            result = await call('private-kb', NS(id='controller', role='admin'), None)
            self.assertEqual(result['id'], 'private-kb')
            self.grants.assert_not_awaited()

    async def test_vector_collections_still_require_owner_or_native_grant_for_admin(self):
        access = AsyncMock(side_effect=lambda name, *args, **kwargs: name == 'own-kb')
        call = native_function('retrieval/utils.py', 'filter_accessible_collections', dict(
            _is_safe_collection_name=lambda value: True, ENABLE_RETRIEVAL_UNSCOPED_COLLECTIONS=False,
            Knowledges=NS(check_access_by_user_id=access), has_access_to_file=AsyncMock(return_value=False)))
        self.assertEqual(await call({'other-kb', 'own-kb', 'file-other', 'knowledge-bases'}, self.admin), {'own-kb'})
        self.assertEqual(access.await_count, 2)

    async def test_global_destructive_operations_reject_app_admin_before_storage(self):
        for path, name in (('routers/files.py', 'delete_all_files'),
                           ('routers/retrieval.py', 'reset_vector_db'),
                           ('routers/retrieval.py', 'reset_upload_dir'),
                           ('routers/knowledge.py', 'reindex_knowledge_files'),
                           ('routers/knowledge.py', 'reindex_knowledge_base_metadata_embeddings')):
            with self.subTest(route=name):
                call = native_function(path, name, {'HTTPException': HTTPError})
                with self.assertRaises(HTTPError) as error:
                    await call(request=None, user=self.admin)
                self.assertEqual(error.exception.status_code, 403)

    async def test_database_export_rejects_app_admin(self):
        call = native_function('routers/utils.py', 'download_db', {'HTTPException': HTTPError})
        with self.assertRaises(HTTPError) as error:
            await call(user=self.admin)
        self.assertEqual(error.exception.status_code, 403)

    async def test_native_file_read_does_not_bypass_acl_for_app_admin(self):
        for name in ('get_file_by_id', 'get_file_data_content_by_id'):
            with self.subTest(route=name):
                call = native_function('routers/files.py', name, dict(
                    Files=NS(get_file_by_id=AsyncMock(return_value=NS(id='other', user_id='other-owner'))),
                    has_access_to_file=AsyncMock(return_value=False), HTTPException=HTTPError,
                    ERROR_MESSAGES=NS(ACCESS_PROHIBITED='denied', NOT_FOUND='missing'),
                    status=NS(HTTP_401_UNAUTHORIZED=401, HTTP_400_BAD_REQUEST=400, HTTP_404_NOT_FOUND=404)))
                with self.assertRaises(HTTPError):
                    await call(id='other', user=self.admin, db=None)

    async def test_native_knowledge_listing_filters_private_content_for_admin(self):
        search = AsyncMock(return_value=NS(items=[], total=0))
        call = native_function('routers/knowledge.py', 'get_knowledge_bases', dict(
            PAGE_ITEM_COUNT=30, BYPASS_ADMIN_ACCESS_CONTROL=True,
            Groups=NS(get_groups_by_member_id=AsyncMock(return_value=[])),
            Knowledges=NS(search_knowledge_bases=search),
            AccessGrants=NS(get_accessible_resource_ids=AsyncMock(return_value=set())),
            KnowledgeAccessListResponse=lambda **value: value))
        await call(page=1, user=self.admin, db=None)
        self.assertEqual(search.await_args.kwargs['filter'], {'user_id': self.admin.id})

    async def test_shared_writer_metadata_update_works_without_request_database_session(self):
        env = self.env.copy()
        env.update(Knowledges=NS(get_knowledge_by_id=AsyncMock(return_value=self.knowledge),
                                update_knowledge_by_id=AsyncMock(return_value=self.knowledge),
                                get_file_metadatas_by_id=AsyncMock(return_value=[])),
                   embed_knowledge_base_metadata=AsyncMock(), publish_event=AsyncMock(),
                   EVENTS=NS(KNOWLEDGE_UPDATED='updated'))
        self.knowledge.name, self.knowledge.description = 'fixture', 'fixture'
        self.grants.return_value = True
        call = native_function('routers/knowledge.py', 'update_knowledge_by_id', env)
        module = NS(normalize_access_grants=lambda value: value)
        with patch.dict(sys.modules, {'open_webui.models.access_grants': module}):
            result = await call(None, 'private-kb', NS(access_grants=None), NS(id='shared-writer', role='user'))
        self.assertEqual(result['id'], 'private-kb')

    async def test_knowledge_export_checks_native_access_before_reading_files(self):
        call = native_function('routers/knowledge.py', 'export_knowledge_by_id', dict(
            HTTPException=HTTPError, Knowledges=NS(check_access_by_user_id=AsyncMock(return_value=False))))
        with self.assertRaises(HTTPError) as error:
            await call('other-kb', self.admin, None)
        self.assertEqual(error.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
