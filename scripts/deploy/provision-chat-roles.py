"""Enroll the native Chat controller without exposing its credential."""
import argparse
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services/app-roles'))
from enrollment import public_origin, read_secret, save_secret, save_app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    kube = ['kubectl', '-n', 'blak-micro']
    values = read_secret(kube, 'blak-chat-role-controller')
    if not values:
        values = {'token': secrets.token_urlsafe(48)}
        save_secret(kube, 'blak-chat-role-controller', values)
    if len(values.get('token', '')) < 32:
        raise ValueError('Invalid Chat controller token')
    if not args.prepare_only:
        save_app(kube, 'chat', {'base': public_origin(ROOT, 'chat'), 'token': values['token']})
    print('Native Chat controller configured; credential omitted')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Chat enrollment failed: ' + type(error).__name__)
        raise SystemExit(1)
