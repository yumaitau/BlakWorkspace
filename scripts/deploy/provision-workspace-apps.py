"""Reconcile app secrets and native OIDC providers without logging credentials."""
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


def reconcile_oidc(script, marker, secret):
    # ak shell is interactive: execute the complete module so compound statements
    # cannot be split or silently discarded by its REPL parser.
    source = Path(__file__).with_name(script).read_text()
    result = subprocess.run(
        KUBECTL + ['exec', '-i', 'deploy/authentik-server', '--', 'ak', 'shell'],
        input=('exec(' + repr(source) + ')\n').encode(),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    )
    match = re.search(re.escape(marker.encode()) + rb'=(\{[^\n]+\})', result.stdout)
    if not match:
        raise RuntimeError(f'{secret} OIDC setup failed; credentials omitted')
    subprocess.run(
        KUBECTL + ['patch', 'secret', secret, '--type=merge', '--patch-file=/dev/stdin'],
        input=json.dumps({'stringData': json.loads(match.group(1))}).encode(), check=True,
    )


ensure_secret('blak-forms', {
    'session-key': secrets.token_urlsafe(48),
    'encryption-key': secrets.token_urlsafe(48),
})
ensure_secret('blak-frappe', {
    'database-password': secrets.token_hex(32),
    'admin-password': secrets.token_urlsafe(28),
})
reconcile_oidc('ak-forms.py', 'BLAK_FORMS_CONFIG', 'blak-forms')
reconcile_oidc('ak-crm.py', 'BLAK_CRM_CONFIG', 'blak-frappe')
