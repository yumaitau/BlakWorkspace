"""Enroll Drive authority and seed current grants without changing user files."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services/app-roles'))
from access import snapshot
from drive import reconcile
from enrollment import public_origin, read_secret, save_secret, save_app
from http_client import API


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    kube = ['kubectl', '-n', 'blak-micro']
    values = read_secret(kube, 'blak-drive-role-controller')
    if not values:
        values = {'token': secrets.token_urlsafe(48)}
        save_secret(kube, 'blak-drive-role-controller', values)
    if len(values.get('token', '')) < 32:
        raise ValueError('Invalid Drive controller credential')
    reader = read_secret(kube, 'blak-role-reader')
    directory = snapshot(API(reader['base-url'], reader['api-token']), json.loads(reader['subjects.json']))
    if args.prepare_only:
        # The existing pod owns this PVC. Replace only our private authority file,
        # atomically, so the next native image starts with a complete snapshot.
        members = [{'subject': subject, 'active': member['is_active'], 'role': member['roles'].get('drive') or ''}
                   for subject, member in directory.items()]
        data = json.dumps({'updated_at': datetime.now(timezone.utc).isoformat(), 'members': members})
        subprocess.run(kube + ['exec', '-i', 'deploy/opencloud', '--', 'sh', '-c',
            'umask 077; cat > /var/lib/opencloud/.blak-roles-seed && mv /var/lib/opencloud/.blak-roles-seed /var/lib/opencloud/blak-roles.json'],
            input=data.encode(), check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    else:
        settings = {'base': public_origin(ROOT, 'drive'), 'token': values['token']}
        reconcile(API(settings['base'], settings['token']), directory)
        save_app(kube, 'drive', settings)
    print('Native Drive authority configured; credentials omitted')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Drive enrollment failed: ' + type(error).__name__)
        raise SystemExit(1)
