"""Provision the portal's least-privilege Blak ID token for People & access.

Creates secret blak-portal-access when missing and stores the token under key
api-token. Never prints the token. Safe to repeat: the same token is reused.
"""
import importlib.util
from pathlib import Path

path = Path(__file__).with_name('provision-workspace-apps.py')
spec = importlib.util.spec_from_file_location('workspace_provision', path)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def main():
    shared.ensure_secret('blak-portal-access', {})
    shared.reconcile_oidc('ak-access-admin.py', 'BLAK_ACCESS_ADMIN_CONFIG', 'blak-portal-access')
    print('Blak ID People & access service account provisioned')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('People & access provisioning failed: ' + type(error).__name__)
        raise SystemExit(1)
