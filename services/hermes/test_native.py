"""Exercise patched upstream functions with failing native storage and ACL backends."""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import AsyncMock
import os
import importlib.util

ROOT = Path(os.environ.get('HERMES_BACKEND', '/app/backend/open_webui'))


class HTTPError(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)


def native_function(path, name, namespace):
    helper = ROOT / 'utils/blak_private.py'
    if helper.exists():
        spec = importlib.util.spec_from_file_location('blak_private', helper)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        namespace.setdefault('blak_content_admin', module.blak_content_admin)
    node = next(n for n in ast.parse((ROOT / path).read_text()).body
                if isinstance(n, ast.AsyncFunctionDef) and n.name == name)
    node.decorator_list = []
    node.returns = None
    for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
        arg.annotation = None
    node.args.defaults = [ast.Constant(None) for _ in node.args.defaults]
    node.args.kw_defaults = [ast.Constant(None) for _ in node.args.kw_defaults]
    module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    exec(compile(module, path, 'exec'), namespace)
    return namespace[name]


class NativeDeletionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.events = []
        self.fail = None
        self.present = True
        self.linked = True
        self.vector = True
        self.file = NS(id='copy', user_id='owner', hash='digest', path='/fixture/copy', filename='copy')
        async def get_file(*args, **kwargs): return self.file if self.present else None
        async def delete_file(*args, **kwargs):
            self.events.append('metadata'); self.present = False; return True
        async def knowledges(*args, **kwargs): return [NS(id='kb')] if self.linked else []
        async def unlink(*args, **kwargs):
            self.events.append('unlink'); self.linked = False
        async def delete_vectors(**kwargs):
            self.events.append('kb-vectors')
            self.assertEqual(kwargs['collection_name'], 'kb')
            if self.fail == 'kb': raise OSError('fixture unavailable')
        async def has_collection(**kwargs): return self.vector
        async def delete_collection(**kwargs):
            self.events.append('file-vectors')
            self.assertEqual(kwargs['collection_name'], 'file-copy')
            if self.fail == 'file': raise OSError('fixture unavailable')
            self.vector = False
        def storage(path):
            self.assertEqual(path, '/fixture/copy'); self.events.append('storage')
            if self.fail == 'storage': raise OSError('fixture unavailable')
        self.permission = AsyncMock(return_value=True)
        env = dict(HTTPException=HTTPError, asyncio=asyncio,
                   Files=NS(get_file_by_id=get_file, delete_file_by_id=delete_file),
                   Knowledges=NS(get_knowledges_by_file_id=knowledges, remove_file_from_knowledge_by_id=unlink),
                   ASYNC_VECTOR_DB_CLIENT=NS(delete=delete_vectors, has_collection=has_collection, delete_collection=delete_collection),
                   Storage=NS(delete_file=storage), publish_event=AsyncMock(), EVENTS=NS(FILE_DELETED='deleted'),
                   has_access_to_file=self.permission, status=NS(HTTP_404_NOT_FOUND=404, HTTP_400_BAD_REQUEST=400),
                   ERROR_MESSAGES=NS(NOT_FOUND='missing', DEFAULT=lambda text: text))
        self.delete = native_function('routers/files.py', 'delete_file_by_id', env)
        self.owner = NS(id='owner', role='user')
    async def attempt(self): return await self.delete(None, 'copy', self.owner, None)
    async def test_knowledge_failure_preserves_file_and_membership_for_retry(self):
        self.fail = 'kb'
        with self.assertRaises(HTTPError) as error: await self.attempt()
        self.assertEqual(error.exception.status_code, 503)
        self.assertTrue(self.present); self.assertTrue(self.linked)
        self.fail = None
        await self.attempt()
        self.assertFalse(self.present); self.assertFalse(self.vector)
        self.assertEqual(self.events[-1], 'metadata')
    async def test_file_vectors_failure_keeps_metadata_and_retries_after_unlink(self):
        self.fail = 'file'
        with self.assertRaises(HTTPError): await self.attempt()
        self.assertTrue(self.present); self.assertFalse(self.linked)
        self.fail = None
        await self.attempt()
        self.assertFalse(self.vector); self.assertFalse(self.present)
    async def test_storage_failure_keeps_metadata(self):
        self.fail = 'storage'
        with self.assertRaises(HTTPError): await self.attempt()
        self.assertTrue(self.present)
    async def test_file_owner_cannot_skip_native_write_permission(self):
        self.permission.return_value = False
        with self.assertRaises(HTTPError): await self.attempt()
        self.assertTrue(self.present); self.assertEqual(self.events, [])
        self.permission.assert_awaited_once()


class NativeFileAccessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.file = NS(id='copy', user_id='owner', meta={})
        self.knowledge = [NS(id='shared', user_id='controller')]
        async def get_file(*args, **kwargs): return self.file
        async def get_knowledge(*args, **kwargs): return self.knowledge
        self.grant = AsyncMock(return_value=False)
        self.env = dict(Files=NS(get_file_by_id=get_file),
                        Knowledges=NS(get_knowledges_by_file_id=get_knowledge),
                        Groups=NS(get_groups_by_member_id=AsyncMock(return_value=[])),
                        AccessGrants=NS(has_access=self.grant),
                        log=NS(debug=lambda *args: None))
        self.access = native_function('utils/access_control/files.py', 'has_access_to_file', self.env)
        self.owner = NS(id='owner', role='user')
    async def test_downgraded_owner_cannot_modify_shared_knowledge_file(self):
        self.assertFalse(await self.access('copy', 'write', self.owner))
    async def test_writer_can_modify_own_upload_with_current_shared_write_grant(self):
        self.grant.return_value = True
        self.assertTrue(await self.access('copy', 'write', self.owner))
    async def test_personal_file_owner_keeps_personal_write(self):
        self.knowledge = []
        self.assertTrue(await self.access('copy', 'write', self.owner))
    async def test_all_shared_workspaces_must_allow_file_mutation(self):
        self.knowledge.append(NS(id='second', user_id='other'))
        self.grant.side_effect = [True, False]
        self.assertFalse(await self.access('copy', 'write', self.owner))
    async def test_shared_reader_keeps_read_access_to_own_upload(self):
        self.assertTrue(await self.access('copy', 'read', self.owner))


if __name__ == '__main__': unittest.main()
