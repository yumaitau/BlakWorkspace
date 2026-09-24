#!/usr/bin/env python3
"""Create a private local CA and install its TLS certificate on matching K3s routes.

Public-CA deployments can keep their existing certificate workflow. This tool is
opt-in and never overwrites an existing CA, TLS secret or different route binding.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess

from local_network import domain_name, kube


def openssl(*args):
    return subprocess.check_output([os.environ.get('BLAK_OPENSSL', 'openssl'), *map(str, args)], stderr=subprocess.PIPE)


def require_openssl():
    if not openssl('version').startswith(b'OpenSSL 3.'):
        raise ValueError('OpenSSL 3 is required; set BLAK_OPENSSL to its executable (macOS system LibreSSL is unsupported)')


def outside_checkout(path):
    # Local CA material must not be generated inside any Git working tree.
    parent = path.resolve()
    while not parent.exists():
        parent = parent.parent
    result = subprocess.run(['git', '-C', str(parent), 'rev-parse', '--show-toplevel'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode == 0:
        raise ValueError('Generate private CA material outside every Git checkout')


def create(domain, output):
    domain = domain_name(domain)
    require_openssl()
    outside_checkout(output)
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    old_mask = os.umask(0o077)
    try:
        openssl('req', '-x509', '-newkey', 'rsa:3072', '-sha256', '-nodes', '-days', '3650',
                '-subj', '/CN=Blak Workspace Local CA', '-keyout', output / 'ca.key', '-out', output / 'ca.crt',
                '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
                '-addext', 'keyUsage=critical,keyCertSign,cRLSign')
        (output / 'identity.json').write_text(json.dumps({'domain': domain}) + '\n')
        issue(domain, output, output)
    finally:
        os.umask(old_mask)


def issue(domain, authority, output):
    # New leaf keys on every renewal. CA key is never uploaded to Kubernetes.
    openssl('req', '-new', '-newkey', 'rsa:3072', '-sha256', '-nodes', '-subj', '/CN=Blak Workspace',
            '-keyout', output / 'tls.key', '-out', output / 'tls.csr')
    extensions = output / 'extensions.cnf'
    extensions.write_text(f'subjectAltName=DNS:{domain},DNS:*.{domain}\n'
                          'basicConstraints=critical,CA:FALSE\n'
                          'keyUsage=critical,digitalSignature,keyEncipherment\n'
                          'extendedKeyUsage=serverAuth\n')
    openssl('x509', '-req', '-in', output / 'tls.csr', '-CA', authority / 'ca.crt',
            '-CAkey', authority / 'ca.key', '-set_serial', '0x' + os.urandom(16).hex(),
            '-days', '365', '-sha256', '-extfile', extensions, '-out', output / 'tls.crt')
    (output / 'tls.csr').unlink()
    extensions.unlink()
    validate(domain, output)


def validate(domain, state):
    for hostname in (domain, 'portal.' + domain, 'id.' + domain, 'drive.' + domain, 'docs.' + domain):
        openssl('verify', '-CAfile', state / 'ca.crt', '-purpose', 'sslserver', '-verify_hostname', hostname,
                state / 'tls.crt')
    certificate_key = openssl('x509', '-in', state / 'tls.crt', '-pubkey', '-noout')
    private_key = openssl('pkey', '-in', state / 'tls.key', '-pubout')
    if certificate_key != private_key:
        raise ValueError('TLS certificate and private key do not match')
    openssl('x509', '-checkend', '2592000', '-noout', '-in', state / 'tls.crt')


def renewal(authority, output):
    require_openssl()
    domain = domain_name(json.loads((authority / 'identity.json').read_text())['domain'])
    outside_checkout(output)
    # Refuse to issue leaves extending past their authority's remaining validity.
    openssl('x509', '-checkend', '31622400', '-noout', '-in', authority / 'ca.crt')
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    old_mask = os.umask(0o077)
    try:
        (output / 'ca.crt').write_bytes((authority / 'ca.crt').read_bytes())
        (output / 'identity.json').write_text(json.dumps({'domain': domain}) + '\n')
        issue(domain, authority, output)
    finally:
        os.umask(old_mask)


def route_patches(routes, domain):
    changes = []
    for route in routes:
        hosts = []
        for rule in route['spec'].get('routes', []):
            # Only exact Host rules qualify; mixed-domain and regex routes need review.
            match = rule.get('match', '')
            if ('HostRegexp' in match or '||' in match or '!' in match or
                    not re.match(r'^Host\(', match)):
                hosts.append('')
            for group in re.findall(r'Host\(([^)]+)\)', match):
                hosts.extend(re.findall(r'`([^`]+)`|"([^"]+)"', group))
        hosts = [(''.join(host) if isinstance(host, tuple) else host) for host in hosts]
        covered = lambda host: host == domain or (host.endswith('.' + domain) and host.count('.') == domain.count('.') + 1)
        if not hosts or not all(covered(host) for host in hosts):
            continue
        tls = route['spec'].get('tls') or {}
        if tls.get('secretName') not in (None, 'blak-lan-tls') or tls.get('certResolver'):
            raise ValueError('Matching route already uses a different certificate; plan its migration explicitly')
        changes.append((route['metadata']['name'], [
            {'op': 'test', 'path': '/metadata/resourceVersion', 'value': route['metadata']['resourceVersion']},
            {'op': 'add', 'path': '/spec/tls', 'value': dict(tls, secretName='blak-lan-tls')},
            {'op': 'add', 'path': '/spec/entryPoints', 'value': ['websecure']}]))
    if not changes:
        raise ValueError('No exact-domain IngressRoutes found; no TLS resources were changed')
    return changes


def install(state, kubeconfig, rotate=False):
    require_openssl()
    domain = domain_name(json.loads((state / 'identity.json').read_text())['domain'])
    validate(domain, state)
    routes = json.loads(kube(kubeconfig, 'get', 'ingressroute', '-o', 'json'))['items']
    patches = route_patches(routes, domain)
    cert = (state / 'ca.crt').read_text()
    existing_ca = kube(kubeconfig, 'get', 'configmap', 'blak-lan-ca', '--ignore-not-found', '-o', 'json')
    if existing_ca and json.loads(existing_ca).get('data', {}).get('ca.crt') != cert:
        raise ValueError('Refusing to replace the installed CA; this requires device and service trust migration')
    secret_data = {key: base64.b64encode((state / key).read_bytes()).decode() for key in ('tls.crt', 'tls.key')}
    existing = kube(kubeconfig, 'get', 'secret', 'blak-lan-tls', '--ignore-not-found', '-o', 'json')
    if existing:
        old = json.loads(existing)
        if old.get('data') != secret_data:
            if not rotate or not existing_ca or old['metadata'].get('labels', {}).get('blak.workspace/component') != 'local-tls':
                raise ValueError('Refusing to overwrite existing TLS material; use --renew-leaf only with the same installed CA')
    metadata = {'name': 'blak-lan-tls', 'namespace': 'blak-micro', 'labels': {'blak.workspace/component': 'local-tls'}}
    secret = dict(apiVersion='v1', kind='Secret', type='kubernetes.io/tls', metadata=metadata, data=secret_data)
    # Use create/replace, not apply: no second private-key copy in last-applied annotations.
    if existing:
        secret['metadata']['resourceVersion'] = old['metadata']['resourceVersion']
    if not existing or old.get('data') != secret_data:
        kube(kubeconfig, 'replace' if existing else 'create', '-f', '-', data=json.dumps(secret))
    if not existing_ca:
        ca = dict(apiVersion='v1', kind='ConfigMap', metadata=dict(metadata, name='blak-lan-ca'), data={'ca.crt': cert})
        kube(kubeconfig, 'create', '-f', '-', data=json.dumps(ca))
    # Public route snapshot only; never persist Kubernetes Secrets or session data.
    backup = state / 'ingress-before.json'
    if not backup.exists():
        backup.write_text(json.dumps(routes, indent=2) + '\n')
    for name, patch in patches:
        kube(kubeconfig, 'patch', 'ingressroute', name, '--type=json', '-p', json.dumps(patch))
    return len(patches)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    create_parser = sub.add_parser('create')
    create_parser.add_argument('--domain', required=True)
    create_parser.add_argument('--output', required=True, type=Path)
    renew = sub.add_parser('renew')
    renew.add_argument('--authority', required=True, type=Path)
    renew.add_argument('--output', required=True, type=Path)
    deploy = sub.add_parser('install')
    deploy.add_argument('--state', required=True, type=Path)
    deploy.add_argument('--kubeconfig', required=True, type=Path)
    deploy.add_argument('--renew-leaf', action='store_true')
    args = parser.parse_args()
    try:
        if args.command == 'create':
            create(args.domain, args.output)
            print('Local CA and one-year certificate created. Distribute ca.crt only; protect and back up ca.key offline.')
        elif args.command == 'renew':
            renewal(args.authority, args.output)
            print('New leaf certificate created with the existing CA; device trust is unchanged.')
        else:
            count = install(args.state, args.kubeconfig, args.renew_leaf)
            print(f'TLS configured on {count} matching routes. Install CA trust in clients and calling services before use.')
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        # OpenSSL/kubectl arguments contain paths only; private bytes are never emitted.
        parser.exit(1, f'{exc}\n')


if __name__ == '__main__':
    main()
