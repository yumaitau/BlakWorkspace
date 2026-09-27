#!/usr/bin/env python3
"""Provision native Blak ID OIDC. Never print credentials."""
import importlib.util
import base64
import json
import subprocess
import os
from pathlib import Path
import secrets
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('shared', HERE / 'provision-workspace-apps.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def public_origin(value):
    url = urlsplit(value)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/') or url.hostname.endswith('example.com'):
        raise ValueError('BLAK_MONITORING_URL must be a real HTTPS origin')
    return value.rstrip('/')


if __name__ == '__main__':
    origin = public_origin(os.environ.get('BLAK_MONITORING_URL', ''))
    shared.ensure_secret('blak-beszel', {'recovery-password': secrets.token_urlsafe(48)})
    current = json.loads(subprocess.check_output(shared.KUBECTL + ['get', 'secret', 'blak-beszel', '-o', 'json']))
    operator = base64.b64decode(current.get('data', {}).get('operator-email', '')).decode()
    prelude = 'import os\nos.environ["BLAK_MONITORING_URL"] = ' + repr(origin)
    if operator:
        prelude += '\nos.environ["BLAK_MONITORING_OPERATOR_EMAIL"] = ' + repr(operator)
    shared.reconcile_oidc('ak-beszel.py', 'BLAK_BESZEL_CONFIG', 'blak-beszel', prelude)
    print('Beszel native OIDC provisioned; existing recovery password preserved')
