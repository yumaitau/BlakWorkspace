"""Reserve native server administration for the enrolled directory controller."""
import ast
import hashlib
from pathlib import Path

path = Path('/app/backend/open_webui/utils/auth.py')
source = path.read_text()
expected = 'b67719dca41439a2a407b6207f89ed127b9e363403cc2ffa30f1148ba7a22f69'
if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
    raise SystemExit('Unexpected native authentication dependency; review before upgrading')
function = next(node for node in ast.parse(source).body
                if isinstance(node, ast.FunctionDef) and node.name == 'get_admin_user')
lines = source.splitlines(keepends=True)
guard = '''    import os
    from open_webui.utils.blak_private import blak_content_admin
    if os.environ.get('BLAK_ROLE_CONTROLLER_ID') and not blak_content_admin(user):
        raise HTTPException(status_code=403, detail='Native identity and server administration is operator-managed')
'''
lines.insert(function.body[0].lineno - 1, guard)
patched = ''.join(lines)
compile(patched, str(path), 'exec')
path.write_text(patched)
