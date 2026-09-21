"""Pin a small native authorization patch; preserve upstream source formatting."""
import ast
import hashlib
from pathlib import Path
import sys

file = Path(sys.argv[1])
source = file.read_text()
if hashlib.sha256(file.read_bytes()).hexdigest() != '242898318117c38c29327f9739d6cd751ffee1876d93861d4c0fd089de5b8258':
    raise SystemExit('Unexpected upstream knowledge router; review the permission patch before upgrading')
tree = ast.parse(source)
functions = {node.name: node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)}
lines = source.splitlines(keepends=True)
edits = []
for name in ['update_knowledge_access_by_id', 'delete_knowledge_by_id']:
    function = functions[name]
    missing = [node for node in function.body if isinstance(node, ast.If) and ast.unparse(node.test) == 'not knowledge']
    if len(missing) != 1:
        raise SystemExit('Missing native knowledge lookup guard')
    index = missing[0].end_lineno
    edits.append((index, index, "\n    # Shared editors cannot change membership or delete the managed workspace.\n    if knowledge.user_id != user.id and user.role != 'admin':\n        raise HTTPException(status_code=403, detail='Knowledge administration requires its owner or an app admin')\n"))
function = functions['update_knowledge_by_id']
assignments = [node for node in function.body if isinstance(node, ast.Assign) and ast.unparse(node.targets[0]) == 'form_data.access_grants']
if len(assignments) != 1:
    raise SystemExit('Missing native metadata access-grant update')
node = assignments[0]
original = ''.join(lines[node.lineno - 1:node.end_lineno])
replacement = """    # A metadata edit must not smuggle a membership change through KnowledgeForm.
    if knowledge.user_id != user.id and user.role != 'admin':
        from open_webui.models.access_grants import normalize_access_grants
        if form_data.access_grants is not None:
            order = lambda grant: (grant['principal_type'], grant['principal_id'], grant['permission'])
            requested = sorted(normalize_access_grants(form_data.access_grants), key=order)
            current = sorted(normalize_access_grants(knowledge.access_grants), key=order)
            if requested != current:
                raise HTTPException(status_code=403, detail='Knowledge access changes require its owner or an app admin')
        form_data.access_grants = None
    else:
""" + ''.join('    ' + line if line.strip() else line for line in original.splitlines(keepends=True))
edits.append((node.lineno - 1, node.end_lineno, replacement))
for start, end, replacement in sorted(edits, reverse=True):
    lines[start:end] = [replacement]
patched = ''.join(lines)
compile(patched, str(file), 'exec')
file.write_text(patched)
print('Native knowledge ownership and access-management patch applied')
