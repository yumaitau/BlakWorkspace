#!/usr/bin/env python3
"""Configure a local Beszel port-forward and export one host agent environment."""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import urllib.parse
import urllib.request


def request(base, path, body=None, token='', method=None):
    req = urllib.request.Request(base.rstrip('/') + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Authorization': token}, method=method)
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api', default='http://127.0.0.1:18790')
    parser.add_argument('--issuer', required=True)
    parser.add_argument('--host', required=True, help='Host address reachable from the Beszel pod')
    parser.add_argument('--name', required=True)
    parser.add_argument('--agent-env', required=True, type=Path)
    args = parser.parse_args()
    api_url = urllib.parse.urlsplit(args.api)
    if api_url.hostname not in ('127.0.0.1', 'localhost'):
        raise ValueError('Use a loopback port-forward for privileged setup')
    if urllib.parse.urlsplit(args.issuer).scheme != 'https':
        raise ValueError('Issuer must use HTTPS')
    raw = subprocess.check_output(['kubectl', '-n', os.environ.get('NS', 'blak-micro'), 'get', 'secret', 'blak-beszel', '-o', 'json'])
    secret = {k: base64.b64decode(v).decode() for k, v in json.loads(raw)['data'].items()}
    api = lambda path, body=None, token='', method=None: request(args.api, path, body, token, method)
    auth = api('/api/collections/_superusers/auth-with-password', {'identity': secret['operator-email'], 'password': secret['recovery-password']})
    token = auth['token']
    discovery = request(args.issuer, '/.well-known/openid-configuration')
    provider = {'name': 'oidc', 'displayName': 'Blak ID', 'clientId': secret['client-id'],
                'clientSecret': secret['oidc-secret'], 'authURL': discovery['authorization_endpoint'],
                'tokenURL': discovery['token_endpoint'], 'userInfoURL': discovery['userinfo_endpoint']}
    api('/api/collections/users', {'oauth2': {'enabled': True, 'providers': [provider]},
                                 'passwordAuth': {'enabled': False}}, token, 'PATCH')
    users = api('/api/collections/users/records?perPage=500', token=token)['items']
    operator = next(u for u in users if u['email'] == secret['operator-email'])
    api('/api/collections/users/records/' + operator['id'], {'role': 'admin'}, token, 'PATCH')
    systems = api('/api/collections/systems/records?perPage=500', token=token)['items']
    system = next((s for s in systems if s['name'] == args.name), None)
    if system is None:
        system = api('/api/collections/systems/records', {'name': args.name, 'host': args.host,
                     'port': '45876', 'users': [operator['id']]}, token)
    elif system['host'] != args.host or system['port'] != '45876':
        raise ValueError('Existing system address differs; review it before changing the agent')
    fingerprint_path = '/api/collections/fingerprints/records'
    fingerprints = api(fingerprint_path + '?perPage=500', token=token)['items']
    fingerprint = next((f for f in fingerprints if f['system'] == system['id']), None)
    if fingerprint is None:
        fingerprint = api(fingerprint_path, {'system': system['id'], 'token': secrets.token_urlsafe(24)}, token)
    key = api('/api/beszel/info', token=token)['key']
    values = {'KEY': key, 'TOKEN': fingerprint['token'], 'LISTEN': args.host + ':45876',
              'DATA_DIR': '/var/lib/beszel-agent'}
    # The output is a secret; exclusive creation prevents following links or replacing another host's file.
    fd = os.open(str(args.agent_env), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(''.join(k + '=' + json.dumps(v) + '\n' for k, v in values.items()))
    print('Native OIDC configured; system registered; private agent environment written')


if __name__ == '__main__':
    main()
