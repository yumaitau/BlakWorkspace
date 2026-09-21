#!/usr/bin/env python3
"""Exercise live native ACLs using disposable, already confirmed vault accounts.

The role setter is an executable which accepts one role argument and changes only
the fixture's Blak ID groups. Credentials stay in mode-0600 fixture files. This
test never needs the master password or decrypted item contents.
"""
import argparse
import json
from pathlib import Path
import stat
import subprocess
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'services/app-roles'))
from http_client import API


def fixture(path):
    path = Path(path)
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError('Fixture file must be private')
    value = json.loads(path.read_text())
    if not value['username'].startswith('e2e-vault-') or not value['email'].endswith('@example.invalid'):
        raise ValueError('Only disposable vault acceptance accounts are permitted')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True)
    parser.add_argument('--owner-fixture', required=True)
    parser.add_argument('--member-fixture', required=True)
    parser.add_argument('--role-setter', required=True)
    parser.add_argument('--convergence-seconds', type=int, default=100)
    args = parser.parse_args()
    owner, member = fixture(args.owner_fixture), fixture(args.member_fixture)
    api = API(args.origin)
    api.login_api_key('user.' + member['userId'], member['apiKey'])
    item_path = '/api/ciphers/' + owner['itemId']
    org_path = '/api/organizations/' + owner['organizationId']
    encrypted_item = api('GET', item_path)

    def denied(method, path, data=None):
        try:
            api(method, path, data)
        except RuntimeError as error:
            # Vaultwarden also uses 401 for role denial. Verify the same token
            # still opens the account profile so expiration cannot pass this check.
            if not any('HTTP ' + str(code) in str(error) for code in (400, 401, 403, 404)):
                raise
            assert api('GET', '/api/accounts/profile')['id'] == member['userId']
            return True
        return False

    def set_role(role, check):
        subprocess.run([args.role_setter, role], check=True, stdout=subprocess.DEVNULL)
        started = time.monotonic()
        while time.monotonic() - started < args.convergence_seconds:
            if check():
                print(role + ': native existing-token permissions converged in ' + str(round(time.monotonic() - started, 1)) + 's', flush=True)
                return
            time.sleep(3)
        raise AssertionError(role + ' did not converge')

    def can_write():
        return not denied('PUT', item_path, encrypted_item)

    def manage_group():
        try:
            group = api('POST', org_path + '/groups', {
                'name': 'e2e-vault-role-' + str(uuid.uuid4()), 'accessAll': False,
                'collections': [], 'users': [],
            })
        except RuntimeError as error:
            if not any('HTTP ' + str(code) in str(error) for code in (400, 401, 403, 404)):
                raise
            assert api('GET', '/api/accounts/profile')['id'] == member['userId']
            return False
        api('DELETE', org_path + '/groups/' + group['id'])
        return True

    try:
        set_role('reader', lambda: not can_write())
        assert api('GET', item_path)['id'] == owner['itemId']
        assert denied('DELETE', item_path)
        assert not manage_group()
        assert denied('POST', org_path + '/users/invite', {
            'emails': ['never-send@example.invalid'], 'type': 1, 'groups': [], 'collections': [],
        })
        set_role('writer', can_write)
        assert not manage_group()
        set_role('admin', manage_group)
        set_role('reader', lambda: not can_write() and not manage_group())
        for role in ('none', 'cross-app', 'disabled'):
            if role != 'none':
                set_role('reader', lambda: not denied('GET', item_path))
            set_role(role, lambda: denied('GET', item_path))
        print('PASS: reader, writer, admin, downgrade, removal, cross-app isolation and disabled account', flush=True)
    finally:
        set_role('reader', lambda: not denied('GET', item_path))


if __name__ == '__main__':
    main()
