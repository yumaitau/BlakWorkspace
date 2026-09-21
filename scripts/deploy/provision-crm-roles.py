"""Enroll the native CRM controller and activate its directory reconciliation."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services/app-roles'))
from enrollment import public_origin, read_secret, save_secret, save_app

KUBE = ['kubectl', '-n', 'blak-micro']
SECRET = 'blak-crm-role-controller'


def native(data):
    result = subprocess.run(KUBE + ['exec', '-i', 'deploy/frappe-crm', '-c', 'backend', '--',
                                   '/home/frappe/frappe-bench/env/bin/python', '/tmp/blak-enroll-roles.py'],
                            input=json.dumps(data).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Native CRM enrollment failed; credentials omitted')
    lines = [line.removeprefix('BLAK_ENROLLED=') for line in result.stdout.decode().splitlines() if line.startswith('BLAK_ENROLLED=')]
    if len(lines) != 1:
        raise ValueError('Native enrollment did not return one verified result')
    return json.loads(lines[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    values = read_secret(KUBE, SECRET)
    result = native({'userId': values.get('user-id')})
    if values and result['userId'] != values['user-id']:
        raise ValueError('Native CRM controller identity changed')
    values = {'user-id': result['userId'], 'api-key': result['apiKey'], 'api-secret': result['apiSecret']}
    save_secret(KUBE, SECRET, values)
    if not args.prepare_only:
        save_app(KUBE, 'crm', {'base': public_origin(ROOT, 'crm'), 'controller_user_id': values['user-id'],
                              'api_key': values['api-key'], 'api_secret': values['api-secret']})
        native({'userId': values['user-id'], 'activate': True})
    print('Native CRM controller enrolled; credentials omitted')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('CRM enrollment failed: ' + type(error).__name__)
        raise SystemExit(1)
