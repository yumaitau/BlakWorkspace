"""Do not report a failed Chroma permission cleanup as a successful deletion."""
import ast
import hashlib
from pathlib import Path
import sys

file = Path(sys.argv[1])
source = file.read_text()
if hashlib.sha256(file.read_bytes()).hexdigest() != '799a33706afbf74794b60b77aaf49fb560522d27e5015faf85ee689047d74f24':
    raise SystemExit('Unexpected upstream Chroma adapter; review cleanup errors before upgrading')
functions = [node for node in ast.walk(ast.parse(source)) if isinstance(node, ast.FunctionDef) and node.name == 'delete']
if len(functions) != 1:
    raise SystemExit('Ambiguous native vector delete method')
function = functions[0]
lines = source.splitlines(keepends=True)
original = ''.join(lines[function.lineno - 1:function.end_lineno])
if original.count('except Exception as e:') != 1:
    raise SystemExit('Missing native vector exception handler')
lines[function.lineno - 1:function.end_lineno] = [original.replace('except Exception as e:', 'except NotFoundError:')]
patched = ''.join(lines)
compile(patched, str(file), 'exec')
file.write_text(patched)
print('Native vector deletion now propagates failures except an absent collection')
