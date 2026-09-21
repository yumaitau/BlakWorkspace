"""Provision the native role controller's read-only Blak ID credential."""
import importlib.util
from pathlib import Path

path = Path(__file__).with_name('provision-workspace-apps.py')
spec = importlib.util.spec_from_file_location('workspace_provision', path)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)


def main():
    shared.ensure_secret('blak-role-reader', {})
    shared.reconcile_oidc('ak-role-reader.py', 'BLAK_ROLE_READER_CONFIG', 'blak-role-reader')
    print('Blak ID read-only role reader provisioned')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Role reader provisioning failed: ' + type(error).__name__)
        raise SystemExit(1)
