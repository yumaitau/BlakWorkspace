"""Create new app secrets and configure HeyForm OIDC without logging credentials."""
import json
from pathlib import Path
import re
import secrets
import subprocess

KUBECTL = ['kubectl', '-n', 'blak-micro']


def ensure_secret(name, values):
    existing = subprocess.run(
        KUBECTL + ['get', 'secret', name, '--ignore-not-found', '-o', 'name'],
        stdout=subprocess.PIPE, check=True,
    )
    if existing.stdout.strip():
        return
    resource = {
        'apiVersion': 'v1', 'kind': 'Secret',
        'metadata': {'name': name, 'namespace': 'blak-micro'},
        'stringData': values,
    }
    subprocess.run(KUBECTL + ['create', '-f', '-'],
                   input=json.dumps(resource).encode(), check=True)


ensure_secret('blak-forms', {
    'session-key': secrets.token_urlsafe(48),
    'encryption-key': secrets.token_urlsafe(48),
})
ensure_secret('blak-crm', {
    'database-password': secrets.token_hex(32),
    'app-secret': secrets.token_urlsafe(48),
    'encryption-key': secrets.token_hex(32),
    'admin-password': secrets.token_urlsafe(28),
})
result = subprocess.run(
    KUBECTL + ['exec', '-i', 'deploy/authentik-server', '--', 'ak', 'shell'],
    input=Path(__file__).with_name('ak-forms.py').read_bytes(),
    stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
)
match = re.search(rb'BLAK_FORMS_CONFIG=(\{[^\n]+\})', result.stdout)
if not match:
    raise RuntimeError('Forms OIDC setup failed; no credentials logged')
values = json.loads(match.group(1))
subprocess.run(
    KUBECTL + ['patch', 'secret', 'blak-forms', '--type=merge', '--patch-file=/dev/stdin'],
    input=json.dumps({'stringData': values}).encode(), check=True,
)
