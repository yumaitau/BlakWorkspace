"""Provision an app-local native role controller and dedicated shared knowledge."""
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services/app-roles'))
from http_client import API
from enrollment import save_app
KUBE = ['kubectl', '-n', 'blak-micro']
SECRET = 'blak-hermes-role-controller'


def secret(name):
    raw = subprocess.check_output(KUBE + ['get', 'secret', name, '--ignore-not-found', '-o', 'json'], stderr=subprocess.PIPE)
    document = json.loads(raw) if raw.strip() else {}
    return {key: base64.b64decode(value).decode() for key, value in document.get('data', {}).items()}


def save(values):
    resource = {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': SECRET, 'namespace': 'blak-micro'}, 'stringData': values}
    subprocess.run(KUBE + ['apply', '-f', '-'], input=json.dumps(resource).encode(), check=True)


def main():
    # Only Kubernetes and authenticated native metadata enter this enrollment.
    deployment = json.loads((ROOT / '.deployment.json').read_text())
    origin = deployment.get('tailnet', {}).get('origins', {}).get('hermes') or 'https://hermes.' + deployment['domain']
    from urllib.parse import urlsplit
    parsed = urlsplit(origin)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or parsed.path not in ('', '/'):
        raise ValueError('Hermes controller requires a verified HTTPS origin')
    ca = json.loads(subprocess.check_output(KUBE + ['get', 'configmap', 'blak-ca', '-o', 'json']))['data']['rootCA.pem']
    values = secret(SECRET)
    accounts = json.loads(secret('blak-hermes-sync')['accounts.json'])['accounts']
    if not values:
        requested = os.environ.get('BLAK_CONTROLLER_BOOTSTRAP_ACCOUNT')
        account = next((account for account in accounts if account['name'] == requested), None) if requested else accounts[0] if len(accounts) == 1 else None
        if not account:
            raise ValueError('Select the existing native administrator mapping for controller enrollment')
        operator = API(origin, account['hermes']['token'], ca_data=ca)
        profile = operator('GET', '/api/v1/auths/')
        if profile['id'] != account['owner_id'] or profile['role'] != 'admin':
            raise ValueError('Bootstrap credential does not belong to the expected native admin')
        created = operator('POST', '/api/v1/auths/add', {
            'name': 'Blak ID role controller', 'email': 'blak-role-' + secrets.token_hex(8) + '@example.invalid',
            'password': secrets.token_urlsafe(48), 'role': 'admin',
        })
        controller = API(origin, created['token'], ca_data=ca)
        key = controller('POST', '/api/v1/auths/api_key')['api_key']
        values = {'user-id': created['id'], 'api-key': key}
        save(values)
    api = API(origin, values['api-key'], ca_data=ca)
    profile = api('GET', '/api/v1/auths/')
    if profile['id'] != values['user-id'] or profile['role'] != 'admin':
        raise ValueError('Enrolled native controller identity mismatch')
    if not values.get('collection-id'):
        collection = api('POST', '/api/v1/knowledge/create', {
            'name': 'Blak Group Knowledge', 'description': 'Shared group knowledge. Membership and access are managed by Blak ID.', 'access_grants': [],
        })
        values['collection-id'] = collection['id']
        save(values)
    collection = api('GET', '/api/v1/knowledge/' + values['collection-id'])
    if collection['user_id'] != profile['id']:
        raise ValueError('Shared collection is not owned by the native controller')
    save_app(KUBE, 'hermes', {'base': origin, 'controller_user_id': profile['id'],
                            'token': values['api-key'], 'collection_ids': [collection['id']],
                            'model_ids': sorted({account.get('model', 'qwen2.5:1.5b') for account in accounts})})
    print('Native Hermes controller and shared collection enrolled; credentials omitted')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Hermes role enrollment failed: ' + type(error).__name__)
        raise SystemExit(1)
