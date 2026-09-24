"""Provision the portal's least-privilege Blak ID token for People & access.

Creates secret blak-portal-access when missing and stores the token under key
api-token. Never prints the token. Safe to repeat: the same token is reused.
Each run re-grants object permissions on the app role groups and on team groups
(attributes.blak_team), and revokes them from every other group. Run it again
after identity provisioning adds a new app's role groups.
"""
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]

path = Path(__file__).with_name('provision-workspace-apps.py')
spec = importlib.util.spec_from_file_location('workspace_provision', path)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def main():
    shared.ensure_secret('blak-portal-access', {})
    role_groups = json.loads(subprocess.check_output([
        'node', '-e', "const {INTEGRATIONS}=require('./apps/portal/integration');console.log(JSON.stringify([...new Set(Object.values(INTEGRATIONS).flatMap(app=>app.roleGroups||[]))]))",
    ], cwd=ROOT))
    if not role_groups or not all(isinstance(name, str) and name.startswith('blak-') for name in role_groups):
        raise ValueError('Invalid role group contract')
    shared.reconcile_oidc('ak-access-admin.py', 'BLAK_ACCESS_ADMIN_CONFIG', 'blak-portal-access',
                          prelude='BLAK_ROLE_GROUPS=' + repr(role_groups) + '\n')
    print('Blak ID People & access service account provisioned')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('People & access provisioning failed: ' + type(error).__name__)
        raise SystemExit(1)
