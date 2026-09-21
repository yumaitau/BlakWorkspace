"""Enroll Projects through operator-only native Better Auth server APIs."""
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
KUBE = ['kubectl', '-n', 'blak-micro']
SECRET = 'blak-projects-role-controller'


def native(data):
    result = subprocess.run(KUBE + ['exec', '-i', 'deploy/projects', '-c', 'kaneo', '--',
        'node', '/app/apps/api/dist/blak-enroll.mjs'], input=json.dumps(data).encode(),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Native Projects enrollment failed; credentials omitted')
    lines = [line.removeprefix('BLAK_ENROLLED=') for line in result.stdout.decode().splitlines() if line.startswith('BLAK_ENROLLED=')]
    if len(lines) != 1:
        raise ValueError('Native enrollment did not return one verified result')
    return json.loads(lines[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only', action='store_true', help='Prepare native credentials before enabling the new reconciler')
    args = parser.parse_args()
    origin = public_origin(ROOT, 'projects')
    values = read_secret(KUBE, SECRET)
    if not values:
        accounts = json.loads(read_secret(KUBE, 'blak-hermes-sync')['accounts.json'])['accounts']
        requested = os.environ.get('BLAK_CONTROLLER_BOOTSTRAP_ACCOUNT')
        account = next((item for item in accounts if item['name'] == requested), None) if requested else accounts[0] if len(accounts) == 1 else None
        if not account or not account.get('portal_owner'):
            raise ValueError('Select the immutable native administrator mapping for Projects enrollment')
        created = native({'bootstrapSubject': account['portal_owner']})
        values = {'user-id': created['userId'], 'bridge-token': secrets.token_urlsafe(48)}
        save_secret(KUBE, SECRET, values)
    result = native({'userId': values['user-id'], 'apiKey': values.get('api-key')})
    if result['userId'] != values['user-id']:
        raise ValueError('Native controller identity changed')
    values.update({'api-key': result['apiKey'], 'workspaces': json.dumps(result['workspaces'])})
    save_secret(KUBE, SECRET, values)
    if not args.prepare_only:
        save_app(KUBE, 'projects', {'base': origin, 'token': values['bridge-token']})
    print('Native Projects controller and managed workspace enrolled; credentials omitted')


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('Projects enrollment failed: ' + type(error).__name__)
        raise SystemExit(1)
