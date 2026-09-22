"""Exercise a task-owned local OpenCloud instance, never the production service.

Pass the private runtime env file used to create the isolated container. Only
status summaries are printed; credentials and document bodies stay in memory.
"""
import base64
import json
from pathlib import Path
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

settings = dict(line.split('=', 1) for line in Path(sys.argv[1]).read_text().splitlines())
base = 'https://127.0.0.1:49200'
context = ssl._create_unverified_context()  # Isolated instance's generated certificate.
basic = 'Basic ' + base64.b64encode(('admin:' + settings['IDM_ADMIN_PASSWORD']).encode()).decode()
controller = 'Bearer ' + settings['BLAK_DRIVE_ROLE_TOKEN']


def request(path, method='GET', body=None, auth=basic):
    if isinstance(body, dict):
        body = json.dumps(body).encode()
    req = urllib.request.Request(base + path, method=method, data=body,
                                 headers={'Authorization': auth, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, context=context, timeout=20) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def grant(role, active=True):
    status, _ = request('/blak/roles/reconcile', 'POST', {'members': [
        {'subject': 'admin', 'active': active, 'role': role}]}, controller)
    assert status == 200, ('directory reconcile', status)


grant('writer')
status, body = request('/graph/v1.0/me')
assert status == 200, ('native profile', status)
identity = json.loads(body)['id']
status, body = request('/graph/v1.0/drives')
assert status == 200, ('native drives', status)
personal = next(d for d in json.loads(body)['value'] if d['driveType'] == 'personal')
path = urllib.parse.urlsplit(personal['root']['webDavUrl']).path + '/blak-roles-' + uuid.uuid4().hex + '.txt'
original = b'Isolated native role fixture'
try:
    assert request(path, 'PUT', original)[0] in (200, 201, 204), 'writer upload denied'
    grant('reader')
    assert request(path) == (200, original), 'reader lost owned file'
    for method, data in [('PUT', b'forbidden'), ('DELETE', None), ('PROPPATCH', b'')]:
        assert request(path, method, data)[0] == 403, ('reader retained write', method)
    assert request(path) == (200, original), 'reader denial changed file'
    grant('admin')
    for target in ['/graph/v1.0/users', '/graph/v1.0/groups', '/api/v0/settings/assignments-add']:
        assert request(target, 'POST', {})[0] == 403, ('app admin gained directory writes', target)
    assert request('/blak/roles/reconcile', 'POST', {'members': []})[0] == 403, 'human can reconcile roles'
    assert json.loads(request('/graph/v1.0/me')[1])['id'] == identity, 'role change replaced native user'
    grant('', False)
    assert request(path)[0] in (401, 403), 'disabled account retained file access'
    grant('writer')
    assert request(path) == (200, original), 'restored account lost content'
    assert request(path, 'PUT', b'Restored writer')[0] in (200, 201, 204), 'writer restoration failed'
    print('PASS: native identity, owned-file downgrade, scoped admin, disabled access, restoration')
finally:
    grant('writer')
    status, _ = request(path, 'DELETE')
    assert status in (200, 204, 404), ('fixture cleanup', status)
