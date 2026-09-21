"""Allow only the enrolled native controller to reconcile the primary user role."""
import ast
import hashlib
from pathlib import Path
import sys

file = Path(sys.argv[1])
source = file.read_text()
if hashlib.sha256(file.read_bytes()).hexdigest() != '00ff1e38635a2058befcb92f955da0811ffae7ab85fd6ac50471e4ae55319c41':
    raise SystemExit('Unexpected upstream users router; review controller boundary before upgrading')
lines = source.splitlines(keepends=True)
functions = {node.name: node for node in ast.parse(source).body if isinstance(node, ast.AsyncFunctionDef)}
edits = []
for name in ('update_user_by_id', 'delete_user_by_id'):
    function = functions[name]
    original = ''.join(lines[function.lineno - 1:function.end_lineno])
    if name == 'update_user_by_id':
        expected = 'if user_id == first_user.id:'
        if original.count(expected) != 1:
            raise SystemExit('Missing native primary administrator boundary')
        original = original.replace(expected, "if user_id == first_user.id and session_user.id != os.environ.get('BLAK_ROLE_CONTROLLER_ID'):")
        guard = "    if user_id == os.environ.get('BLAK_ROLE_CONTROLLER_ID') and session_user.id != user_id:\n        raise HTTPException(status_code=403, detail='The directory controller is operator-managed')\n"
    else:
        guard = "    if user_id == os.environ.get('BLAK_ROLE_CONTROLLER_ID'):\n        raise HTTPException(status_code=403, detail='The directory controller is operator-managed')\n"
    offset = function.body[0].lineno - function.lineno
    body = original.splitlines(keepends=True)
    body[offset:offset] = [guard]
    edits.append((function.lineno - 1, function.end_lineno, ''.join(body)))
for start, end, replacement in sorted(edits, reverse=True):
    lines[start:end] = [replacement]
patched = ''.join(lines).replace('import base64\n', 'import os\nimport base64\n', 1)
compile(patched, str(file), 'exec')
file.write_text(patched)
print('Native primary role reconciliation restricted to the enrolled controller')
