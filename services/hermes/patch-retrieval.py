"""Apply native shared-file authorization to both ingestion mutation APIs."""
import ast
import hashlib
from pathlib import Path
import sys

file = Path(sys.argv[1])
source = file.read_text()
if hashlib.sha256(file.read_bytes()).hexdigest() != '070e92ee966be532d3da08d419f8791a387c3a7d1b815c72e18f1b40d5a483ef':
    raise SystemExit('Unexpected upstream retrieval router; review file mutation permissions')
functions = {node.name: node for node in ast.parse(source).body if isinstance(node, ast.AsyncFunctionDef)}
lines = source.splitlines(keepends=True)
function = functions['process_file']
guards = [node for node in function.body if isinstance(node, ast.If) and ast.unparse(node.test) == 'file']
if len(guards) != 1:
    raise SystemExit('Missing native file processing guard')
lines.insert(guards[0].lineno, """        if user.role != 'admin' and not await has_access_to_file(file.id, 'write', user, db=db):
            raise HTTPException(status_code=403, detail='File write access required')
""")
source = ''.join(lines)
old = "if db_file.user_id != user.id and user.role != 'admin':"
if source.count(old) != 1:
    raise SystemExit('Missing native batch file processing guard')
source = source.replace(old, "if user.role != 'admin' and (db_file.user_id != user.id or not await has_access_to_file(db_file.id, 'write', user, db=db)):")
compile(source, str(file), 'exec')
file.write_text(source)
print('Native ingestion now checks shared file write access')
