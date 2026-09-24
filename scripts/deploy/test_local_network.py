#!/usr/bin/env python3
"""Operator-run DNS/TLS rehearsal on the Docker host; never touches host DNS or live apps."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import time
import uuid

import local_network as network
import local_tls as tls


def run(*args):
    return subprocess.check_output(list(args), text=True, stderr=subprocess.PIPE).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture-image', required=True, help='Pre-cached Node image for the synthetic HTTPS server')
    args = parser.parse_args()
    # Fail before creating resources if offline image preparation was missed.
    for image in (network.IMAGE, args.fixture_image):
        run('docker', 'image', 'inspect', image)
    name = 'blak-dns-check-' + uuid.uuid4().hex[:10]
    containers = []
    created = False
    try:
        run('docker', 'network', 'create', '--internal', name)
        created = True
        details = json.loads(run('docker', 'network', 'inspect', name))[0]
        assert details['Internal'], 'Rehearsal must have no external container routing'
        subnet = ipaddress.ip_network(details['IPAM']['Config'][0]['Subnet'])
        dns_address, app_address, client_address = map(str, (subnet[2], subnet[3], subnet[4]))
        with tempfile.TemporaryDirectory(prefix='blak-dns-check-') as tmp:
            root = Path(tmp)
            settings = network.configuration('workspace.internal', app_address, 'bundled', dns_address,
                                             [str(subnet)], 'fixture')
            bundle = root / 'dns'
            network.write_bundle(bundle, settings)
            authority = root / 'pki'
            tls.create(settings['domain'], authority)
            dns_name, app_name = name + '-dns', name + '-https'
            run('docker', 'run', '-d', '--name', dns_name, '--pull=never', '--network', name, '--ip', dns_address,
                '--user', '65532:65532', '--read-only', '--cap-drop=ALL', '--cap-add=NET_BIND_SERVICE',
                '--security-opt=no-new-privileges', '-v', str(bundle) + ':/etc/coredns:ro',
                network.IMAGE, '-conf', '/etc/coredns/Corefile')
            containers.append(dns_name)
            # Copy only leaf material into the fixture mount: CA key stays on the operator host.
            leaf = root / 'leaf'
            leaf.mkdir(mode=0o700)
            for filename in ('tls.key', 'tls.crt'):
                (leaf / filename).write_bytes((authority / filename).read_bytes())
                (leaf / filename).chmod(0o600)
            server = ("const fs=require('node:fs');require('node:https').createServer({"
                      "key:fs.readFileSync('/tls/tls.key'),cert:fs.readFileSync('/tls/tls.crt')},"
                      "(_q,r)=>r.end('blak-local-tls-ok')).listen(8443,'0.0.0.0')")
            run('docker', 'run', '-d', '--name', app_name, '--pull=never', '--network', name, '--ip', app_address,
                '--user', f'{os.getuid()}:{os.getgid()}',
                '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
                '-v', str(leaf) + ':/tls:ro', '--entrypoint', 'node', args.fixture_image, '-e', server)
            containers.append(app_name)

            def query(host, *options):
                return run('dig', '@' + dns_address, host, 'A', '+time=1', '+tries=1', *options)

            def wait_dns():
                for attempt in range(20):
                    try:
                        if query('portal.workspace.internal', '+short') == app_address:
                            return
                    except subprocess.CalledProcessError:
                        pass
                    time.sleep(0.25)
                raise AssertionError('DNS did not become ready')

            wait_dns()
            assert query('portal.workspace.internal', '+short') == app_address
            assert query('id.workspace.internal', '+tcp', '+short') == app_address
            assert 'status: NXDOMAIN' in query('absent.workspace.internal')
            assert 'status: REFUSED' in query('www.iana.org')
            context = ssl.create_default_context(cafile=str(authority / 'ca.crt'))
            for attempt in range(20):
                try:
                    connection = socket.create_connection((app_address, 8443), timeout=2)
                    break
                except ConnectionRefusedError:
                    time.sleep(0.25)
            with context.wrap_socket(connection, server_hostname='portal.workspace.internal') as secure:
                secure.sendall(b'GET / HTTP/1.0\r\nHost: portal.workspace.internal\r\n\r\n')
                response = b''
                while True:
                    chunk = secure.recv(4096)
                    if not chunk:
                        break
                    response += chunk
                assert b'blak-local-tls-ok' in response
            try:
                with socket.create_connection((app_address, 8443), timeout=2) as connection:
                    ssl.create_default_context().wrap_socket(connection, server_hostname='portal.workspace.internal')
                raise AssertionError('An untrusted CA was accepted')
            except ssl.SSLCertVerificationError:
                pass
            # Restart without external routing; cached images and files must suffice.
            run('docker', 'restart', dns_name)
            wait_dns()
            assert query('drive.workspace.internal', '+short') == app_address
            # Rewrite only the disposable fixture ACL, then test from a denied client.
            denied_settings = dict(settings, clients=[dns_address + '/32', str(subnet[1]) + '/32'])
            (bundle / 'Corefile').write_text(network.corefile(denied_settings))
            run('docker', 'restart', dns_name)
            wait_dns()
            check = ("const {Resolver}=require('node:dns').promises;const r=new Resolver({timeout:1000,tries:1});"
                     f"r.setServers(['{dns_address}']);"
                     "r.resolve4('portal.workspace.internal').then(()=>process.exit(1),"
                     "e=>{if(e.code!=='EREFUSED')throw e;console.log('refused')})")
            assert run('docker', 'run', '--rm', '--pull=never', '--network', name, '--ip', client_address,
                       '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
                       '--entrypoint', 'node', args.fixture_image, '-e', check) == 'refused'
            print(json.dumps({'network': 'internal', 'udp': 'passed', 'tcp': 'passed',
                              'unknown_local_name': 'NXDOMAIN', 'external_name': 'REFUSED',
                              'unlisted_client': 'REFUSED', 'tls_hostname_and_chain': 'passed',
                              'untrusted_ca': 'rejected', 'cached_restart': 'passed'}))
    finally:
        for container in reversed(containers):
            subprocess.run(['docker', 'rm', '-f', container], stdout=subprocess.DEVNULL, check=True)
        if created:
            subprocess.run(['docker', 'network', 'rm', name], stdout=subprocess.DEVNULL, check=True)


if __name__ == '__main__':
    main()
