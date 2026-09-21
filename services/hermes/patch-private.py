"""Restrict pinned native content bypasses to the enrolled operator controller."""
import ast
import hashlib
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/app/backend/open_webui')
pins = {
    'routers/utils.py': '48e8de8488f7d5fe4cdf216801e1bf5b3328a7d837dc788f1e1eb25820c65058',
    'routers/knowledge.py': 'dbd21761182f5ab84064ad047d4682f5867d8a120703b5ec92f74eb2145d899b',
    'routers/files.py': '831cf03b96b22f4ec61d910df54a0c4419e6451a6459a953896d8f60066847c1',
    'routers/retrieval.py': '71c5d12d632e184d96ea1dba563f4693c5b36669958907a24308acb838789862',
    'utils/access_control/files.py': 'f0225e3ada96e1747f67a9f47159265bf85896912c1c973a081b765f383a390f',
    'retrieval/utils.py': '52931317535f2f311679154693c70cb03a582eceb83da59f72a0a47558a5e0fc',
}
# Creating one's own content and enabling web search remain app capabilities.
keep_app_admin = {'create_new_knowledge', 'process_web_search'}
operator_only = {'download_db', 'delete_all_files', 'reset_vector_db', 'reset_upload_dir',
                 'reindex_knowledge_files', 'reindex_knowledge_base_metadata_embeddings'}
for relative, digest in pins.items():
    path = root / relative
    source = path.read_text()
    if hashlib.sha256(source.encode()).hexdigest() != digest:
        raise SystemExit('Unexpected native private-content source: ' + relative)
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    functions = [node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
    future_end = max((node.end_lineno for node in tree.body if isinstance(node, ast.ImportFrom) and node.module == '__future__'), default=0)
    edits = [(offsets[future_end], offsets[future_end], 'from open_webui.utils.blak_private import blak_content_admin, blak_knowledge_admin\n')]
    for node in ast.walk(tree):
        if not isinstance(node, ast.Compare) or len(node.ops) != 1:
            continue
        if ast.unparse(node.left) != 'user.role' or ast.unparse(node.comparators[0]) != "'admin'":
            continue
        if not isinstance(node.ops[0], (ast.Eq, ast.NotEq)):
            continue
        enclosing = [fn for fn in functions if fn.lineno <= node.lineno <= fn.end_lineno]
        if any(fn.name in keep_app_admin for fn in enclosing):
            continue
        scoped = next((fn for fn in enclosing if fn.name in {'update_knowledge_by_id', 'update_knowledge_access_by_id', 'delete_knowledge_by_id'}), None)
        database = 'db' if scoped and any(arg.arg == 'db' for arg in scoped.args.args) else 'None'
        check = '(await blak_knowledge_admin(user, knowledge, ' + database + '))' if scoped else 'blak_content_admin(user)'
        text = check if isinstance(node.ops[0], ast.Eq) else 'not ' + check
        edits.append((offsets[node.lineno - 1] + node.col_offset,
                      offsets[node.end_lineno - 1] + node.end_col_offset, text))
    for function in functions:
        guard = None
        if function.name in operator_only:
            guard = "    if not blak_content_admin(user):\n        raise HTTPException(status_code=403, detail='Operator controller required')\n"
        elif function.name == 'export_knowledge_by_id':
            guard = "    if not blak_content_admin(user) and not await Knowledges.check_access_by_user_id(id, user.id, permission='read', db=db):\n        raise HTTPException(status_code=403, detail='Knowledge read access required')\n"
        elif function.name == 'delete_entries_from_collection':
            guard = "    await _validate_collection_access([form_data.collection_name], user, access_type='write')\n    if not blak_content_admin(user) and not await has_access_to_file(form_data.file_id, 'write', user, db=db):\n        raise HTTPException(status_code=403, detail='File write access required')\n"
        if guard:
            at = offsets[function.body[0].lineno - 1]
            edits.append((at, at, guard))
    for start, end, replacement in sorted(edits, reverse=True):
        source = source[:start] + replacement + source[end:]
    compile(source, str(path), 'exec')
    path.write_text(source)
print('Native private content follows ownership and explicit grants for app administrators')
