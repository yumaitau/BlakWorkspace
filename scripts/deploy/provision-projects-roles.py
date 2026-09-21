"""Enroll an app-local Better Auth controller and a managed Projects workspace."""
import http.cookies
import argparse
import json
from pathlib import Path
import os
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services/app-roles'))
from enrollment import public_origin, read_secret, save_secret, save_app
from http_client import API
KUBE = ['kubectl', '-n', 'blak-micro']
SECRET = 'blak-projects-role-controller'


def bootstrap(origin, ca):
    accounts = json.loads(read_secret(KUBE, 'blak-hermes-sync')['accounts.json'])['accounts']
    requested = os.environ.get('BLAK_CONTROLLER_BOOTSTRAP_ACCOUNT')
    account = next((item for item in accounts if item['name'] == requested), None) if requested else accounts[0] if len(accounts) == 1 else None
    if not account or not account.get('portal_owner'):
        raise ValueError('Select the immutable native administrator mapping for Projects enrollment')
    api = API(origin, ca_data=ca)
    api.headers.update(account['sources']['projects']['headers'])
    api.headers['Origin'] = origin
    session = api('GET', '/api/auth/get-session')
    links = api('GET', '/api/auth/list-accounts')
    if session['user']['role'] != 'admin' or not any(link['providerId'] == 'custom' and link['accountId'] == account['portal_owner'] and link['userId'] == session['user']['id'] for link in links):
        raise ValueError('Projects bootstrap credential does not match the immutable Blak ID administrator')
    return api


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only', action='store_true', help='Prepare native credentials before enabling the new reconciler')
    args = parser.parse_args()
    origin = public_origin(ROOT, 'projects')
    ca = json.loads(subprocess.check_output(KUBE + ['get', 'configmap', 'blak-ca', '-o', 'json']))['data']['rootCA.pem']
    values = read_secret(KUBE, SECRET)
    if not values:
        operator = bootstrap(origin, ca)
        created = operator('POST', '/api/auth/admin/create-user', {
            'name': 'Blak ID role controller', 'email': 'blak-projects-role-' + secrets.token_hex(8) + '@example.invalid',
            'password': secrets.token_urlsafe(48), 'role': 'user',
        })['user']
        status, headers, body = operator.request('POST', '/api/auth/admin/impersonate-user', {'userId': created['id']})
        session = json.loads(body)
        if status != 200 or session['user']['id'] != created['id']:
            raise ValueError('Native controller setup session mismatch')
        cookies = http.cookies.SimpleCookie()
        for cookie in headers.get_all('Set-Cookie', []): cookies.load(cookie)
        if not any('session_token' in key for key in cookies):
            raise ValueError('Native controller setup did not establish its own session')
        controller = API(origin, ca_data=ca)
        controller.headers.update({'Cookie': '; '.join(key + '=' + value.value for key, value in cookies.items()), 'Origin': origin})
        if controller('GET', '/api/auth/get-session')['user']['id'] != created['id']:
            raise ValueError('Refusing to create a key for a different native identity')
        key = controller('POST', '/api/auth/api-key/create', {'name': 'Blak ID role controller'})['key']
        values = {'user-id': created['id'], 'api-key': key, 'bridge-token': secrets.token_urlsafe(48)}
        save_secret(KUBE, SECRET, values)
        operator('POST', '/api/auth/admin/set-role', {'userId': created['id'], 'role': 'admin'})
        operator('POST', '/api/auth/admin/revoke-user-sessions', {'userId': created['id']})
    api = API(origin, ca_data=ca)
    api.headers.update({'x-api-key': values['api-key'], 'Origin': origin})
    profile = api('GET', '/api/auth/get-session')['user']
    if profile['id'] != values['user-id']:
        raise ValueError('Native Projects controller identity mismatch')
    if profile['role'] != 'admin':
        bootstrap(origin, ca)('POST', '/api/auth/admin/set-role', {'userId': profile['id'], 'role': 'admin'})
    if not values.get('workspaces'):
        matches = [item for item in api('GET', '/api/auth/organization/list') if item['slug'] == 'blak-group-projects']
        if len(matches) > 1:
            raise ValueError('Ambiguous managed Projects workspace')
        workspace = matches[0] if matches else api('POST', '/api/auth/organization/create', {'name': 'Blak Group Projects', 'slug': 'blak-group-projects'})
        values['workspaces'] = json.dumps([workspace['id']])
        save_secret(KUBE, SECRET, values)
    for workspace_id in json.loads(values['workspaces']):
        workspace = api('GET', '/api/auth/organization/get-full-organization?organizationId=' + workspace_id)
        if not any(member['userId'] == profile['id'] and member['role'] == 'owner' for member in workspace['members']):
            raise ValueError('Managed Projects workspace belongs to a different owner')
    if not args.prepare_only:
        save_app(KUBE, 'projects', {'base': origin, 'token': values['bridge-token']})
    print('Native Projects controller and managed workspace enrolled; credentials omitted')


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('Projects enrollment failed: ' + type(error).__name__)
        raise SystemExit(1)
