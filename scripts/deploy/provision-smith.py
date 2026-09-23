#!/usr/bin/env python3
"""Create the BlakSmith OIDC client and store its secret on blak-smith.

Does not print the secret. Run ensure-secrets.sh first. Run provision-id.py
after this so the portal scope includes the new groups.
"""
import importlib.util
import os
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('provision_workspace_apps', HERE / 'provision-workspace-apps.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def main():
    found = subprocess.run(
        shared.KUBECTL + ['get', 'secret', 'blak-smith', '--ignore-not-found', '-o', 'name'],
        stdout=subprocess.PIPE, check=True,
    )
    if not found.stdout.strip():
        raise SystemExit('Secret blak-smith is missing. Run scripts/deploy/ensure-secrets.sh first.')
    origin = os.environ.get('BLAK_SMITH_PUBLIC_ORIGIN', '').strip()
    prelude = 'import os\nos.environ["BLAK_SMITH_PUBLIC_ORIGIN"] = ' + repr(origin) if origin else ''
    shared.reconcile_oidc('ak-smith.py', 'BLAK_SMITH_CONFIG', 'blak-smith', prelude)
    print('BlakSmith OIDC client reconciled')


if __name__ == '__main__':
    main()
