#!/usr/bin/env python3
"""Create the BlakEyes OIDC client and store its secret on blak-eyes.

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
        shared.KUBECTL + ['get', 'secret', 'blak-eyes', '--ignore-not-found', '-o', 'name'],
        stdout=subprocess.PIPE, check=True,
    )
    if not found.stdout.strip():
        raise SystemExit('Secret blak-eyes is missing. Run scripts/deploy/ensure-secrets.sh first.')
    origin = os.environ.get('BLAK_EYES_PUBLIC_ORIGIN', '').strip()
    prelude = 'import os\nos.environ["BLAK_EYES_PUBLIC_ORIGIN"] = ' + repr(origin) if origin else ''
    shared.reconcile_oidc('ak-eyes.py', 'BLAK_EYES_CONFIG', 'blak-eyes', prelude)
    print('BlakEyes OIDC client reconciled')


if __name__ == '__main__':
    main()
