"""Keep native deletion metadata until storage and every vector cleanup succeed."""
import ast
import hashlib
from pathlib import Path
import sys

file = Path(sys.argv[1])
source = file.read_text()
if hashlib.sha256(file.read_bytes()).hexdigest() != '5c3860d1f39450f16398a9e42662a7884e87fecf6b9c475c8f3b2e92f2a0921d':
    raise SystemExit('Unexpected upstream files router; review deletion ordering before upgrading')
function = next(node for node in ast.parse(source).body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'delete_file_by_id')
lines = source.splitlines(keepends=True)
original = ''.join(lines[function.lineno - 1:function.end_lineno])
patched = original
remove = '            await Knowledges.remove_file_from_knowledge_by_id(knowledge.id, id, db=db)\n'
if patched.count(remove) != 1:
    raise SystemExit('Missing native file membership removal')
patched = patched.replace(remove, '')
old = """            except Exception as e:
                log.debug('KB embedding cleanup for %s: %s', knowledge.id, e)
"""
new = """            except Exception as e:
                raise HTTPException(status_code=503, detail='Knowledge vector cleanup failed; retry deletion') from e
            await Knowledges.remove_file_from_knowledge_by_id(knowledge.id, id, db=db)
"""
if patched.count(old) != 1:
    raise SystemExit('Missing native vector cleanup error path')
patched = patched.replace(old, new)
start = patched.index('        result = await Files.delete_file_by_id')
end = patched.index('            await publish_event(', start)
patched = patched[:start] + """        # Keep the file record until both idempotent storage operations succeed.
        # A failed request can then retry with its owner and KB metadata intact.
        try:
            if file.path:
                await asyncio.to_thread(Storage.delete_file, file.path)
            if await ASYNC_VECTOR_DB_CLIENT.has_collection(collection_name=f'file-{id}'):
                await ASYNC_VECTOR_DB_CLIENT.delete_collection(collection_name=f'file-{id}')
        except Exception as e:
            raise HTTPException(status_code=503, detail='File storage cleanup failed; retry deletion') from e
        result = await Files.delete_file_by_id(id, db=db)
        if result:
""" + patched[end:]
lines[function.lineno - 1:function.end_lineno] = [patched]
result = ''.join(lines)
owner_bypass = "file.user_id == user.id or user.role == 'admin' or await has_access_to_file(id, 'write', user, db=db)"
if result.count(owner_bypass) != 3:
    raise SystemExit('Unexpected native file write guards; review all mutation routes')
result = result.replace(owner_bypass, "user.role == 'admin' or await has_access_to_file(id, 'write', user, db=db)")
compile(result, str(file), 'exec')
file.write_text(result)
print('Native file deletion now preserves retryable metadata on cleanup failure')
