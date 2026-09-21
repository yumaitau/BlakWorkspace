"""Provision only Vault credentials and its native Blak ID provider."""
import importlib.util
import base64
import json
from pathlib import Path
import secrets
import subprocess


def main():
    path = Path(__file__).with_name('provision-workspace-apps.py')
    spec = importlib.util.spec_from_file_location('workspace_provision', path)
    shared = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shared)
    existing = subprocess.check_output(shared.KUBECTL + [
        'get', 'secret', 'blak-vault', '--ignore-not-found', '-o', 'name'])
    operator = subprocess.check_output(shared.KUBECTL + [
        'get', 'secret', 'blak-vault-operator', '--ignore-not-found', '-o', 'json'])
    if existing.strip() and not operator.strip():
        raise RuntimeError('Vault operator credential is missing; recover it before reprovisioning')
    if not existing.strip():
        # The raw operator token is never a vault master password or data key.
        # Preserve it across a partial first provisioning attempt.
        token = base64.b64decode(json.loads(operator)['data']['admin-token']).decode() if operator.strip() else secrets.token_urlsafe(48)
        shared.ensure_secret('blak-vault-operator', {'admin-token': token})
        code = 'import sys; from argon2 import PasswordHasher; print(PasswordHasher(time_cost=3,memory_cost=65536,parallelism=4).hash(sys.stdin.read()))'
        hashed = subprocess.check_output(shared.KUBECTL + [
            'exec', '-i', 'deploy/authentik-server', '--', 'python', '-c', code],
            input=token.encode(), stderr=subprocess.PIPE).decode().strip()
        if not hashed.startswith('$argon2id$'):
            raise RuntimeError('Vault operator token hashing failed')
        shared.ensure_secret('blak-vault', {'admin-token-hash': hashed})
    shared.reconcile_oidc('ak-vault.py', 'BLAK_VAULT_CONFIG', 'blak-vault')
    print('Blak Vault native OIDC and operator credentials provisioned')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Vault provisioning failed:', type(error).__name__)
        raise SystemExit(1)
