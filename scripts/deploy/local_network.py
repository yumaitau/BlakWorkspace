#!/usr/bin/env python3
"""Generate an opt-in LAN DNS bundle, or records for an existing DNS service.

No application origins, router settings, DHCP or cluster DNS are changed.
"""
import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import socket
import subprocess

import yaml

APPS = ('portal', 'id', 'drive', 'docs', 'sites', 'projects', 'forms', 'crm',
        'chat', 'hermes', 'vault', 'cloud', 'smith', 'eyes')
IMAGE = 'coredns/coredns:1.14.7@sha256:7efd3c635b03efd68c4e8398fc45f0d993d0e9ab016f72c1cefb0fd6d01aa286'
OWNER = {'blak.workspace/component': 'local-dns'}


def domain_name(value):
    value = value.lower().rstrip('.')
    if (len(value) > 253 or len(value.split('.')) < 2 or
            any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label)
                for label in value.split('.'))):
        raise ValueError('Use a DNS domain without a scheme, port or path')
    if value == 'local' or value.endswith('.local'):
        raise ValueError('.local is reserved for multicast DNS; choose a unicast DNS domain')
    if value == 'example.com' or value.endswith('.example.com'):
        raise ValueError('Choose an installation domain, not example.com')
    return value


def unicast_address(value):
    address = ipaddress.ip_address(value)
    if address.is_unspecified or address.is_multicast or address.is_loopback or address.is_link_local:
        raise ValueError('Use a routable unicast address, not a wildcard, loopback or link-local address')
    return str(address)


def configuration(domain, address, mode, listen=None, clients=(), node=None, upstreams=(), apex_only=False):
    domain = domain_name(domain)
    address = unicast_address(address)
    if mode not in ('bundled', 'external'):
        raise ValueError('DNS mode must be bundled or external')
    settings = dict(domain=domain, address=address, mode=mode, apex_only=apex_only)
    if mode == 'external':
        if listen or clients or node or upstreams:
            raise ValueError('Listener, clients, node and upstreams apply only to bundled DNS')
        return settings
    listen = unicast_address(listen or address)
    listener = ipaddress.ip_address(listen)
    private_lans = [ipaddress.ip_network(cidr) for cidr in
                    ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7')]
    if not any(listener in lan for lan in private_lans):
        raise ValueError('DNS must bind to an RFC1918 or IPv6 ULA LAN address')
    networks = [ipaddress.ip_network(value, strict=True) for value in clients]
    if not networks or any(n.prefixlen == 0 for n in networks):
        raise ValueError('Explicit client CIDRs required; unrestricted /0 is forbidden')
    if not any(listener in network for network in networks):
        raise ValueError('Client CIDRs must include the DNS server for local health checks')
    if not node or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?', node):
        raise ValueError('Bundled DNS requires the target Kubernetes node name')
    upstreams = [unicast_address(value) for value in upstreams]
    if listen in upstreams:
        raise ValueError('DNS cannot forward to itself')
    settings.update(listen=listen, clients=[str(n) for n in networks], node=node, upstreams=upstreams)
    return settings


def records(settings):
    names = [settings['domain']]
    if not settings['apex_only']:
        names += [app + '.' + settings['domain'] for app in APPS]
    kind = 'A' if ipaddress.ip_address(settings['address']).version == 4 else 'AAAA'
    return [dict(name=name, type=kind, value=settings['address'], ttl=60) for name in names]


def zone(settings):
    domain = settings['domain']
    # Content-derived serial is stable for a bundle; ConfigMap hash restarts pods on change.
    rows = records(settings)
    serial = int(hashlib.sha256(json.dumps(rows).encode()).hexdigest()[:8], 16) or 1
    text = (f'$ORIGIN {domain}.\n$TTL 60\n'
            f'@ IN SOA ns.{domain}. hostmaster.{domain}. ({serial} 3600 600 86400 60)\n'
            f'@ IN NS ns.{domain}.\n')
    nameserver = settings.get('listen', settings['address'])
    kind = 'A' if ipaddress.ip_address(nameserver).version == 4 else 'AAAA'
    text += f'ns IN {kind} {nameserver}\n'
    return text + ''.join(f"{r['name']}. IN {r['type']} {r['value']}\n" for r in rows)


def corefile(settings, port=53):
    bind = settings['listen']
    acl = '    acl {\n        allow net ' + ' '.join(settings['clients']) + '\n        block\n    }\n'
    # Local zone never falls through to an external resolver, including unknown names.
    local = (f"{settings['domain']}:{port} {{\n    bind {bind}\n" + acl +
             f"    file /etc/coredns/db.workspace {settings['domain']}\n    errors\n}}\n")
    # An empty upstream list is deliberate offline mode, with immediate refusal.
    outside = ('    forward . ' + ' '.join(settings['upstreams']) + ' {\n        max_concurrent 100\n    }\n'
               '    cache 300\n' if settings['upstreams'] else
               '    template ANY ANY {\n        rcode REFUSED\n    }\n')
    return local + f'.:{port} {{\n    bind {bind}\n' + acl + outside + '    errors\n}\n'


def manifests(settings):
    data = {'Corefile': corefile(settings), 'db.workspace': zone(settings)}
    checksum = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
    meta = dict(name='blak-lan-dns', namespace='blak-micro', labels=OWNER)
    return [dict(apiVersion='v1', kind='ConfigMap', metadata=meta, data=data),
            dict(apiVersion='apps/v1', kind='Deployment', metadata=meta, spec={
                'replicas': 1, 'strategy': {'type': 'Recreate'},
                'selector': {'matchLabels': OWNER},
                'template': {'metadata': {'labels': OWNER, 'annotations': {'blak.workspace/config-sha': checksum}},
                             'spec': {
                                 'nodeName': settings['node'], 'hostNetwork': True, 'dnsPolicy': 'Default',
                                 'automountServiceAccountToken': False,
                                 'securityContext': {'runAsNonRoot': True, 'runAsUser': 65532,
                                                     'seccompProfile': {'type': 'RuntimeDefault'}},
                                 'containers': [{
                                     'name': 'dns', 'image': IMAGE, 'imagePullPolicy': 'IfNotPresent',
                                     'args': ['-conf', '/etc/coredns/Corefile'],
                                     'securityContext': {'allowPrivilegeEscalation': False, 'readOnlyRootFilesystem': True,
                                                         'capabilities': {'drop': ['ALL'], 'add': ['NET_BIND_SERVICE']}},
                                     'resources': {'requests': {'cpu': '25m', 'memory': '32Mi'},
                                                   'limits': {'cpu': '500m', 'memory': '128Mi'}},
                                     'readinessProbe': {'tcpSocket': {'host': settings['listen'], 'port': 53},
                                                        'initialDelaySeconds': 2, 'periodSeconds': 10},
                                     'volumeMounts': [{'name': 'config', 'mountPath': '/etc/coredns', 'readOnly': True}]}],
                                 'volumes': [{'name': 'config', 'configMap': {'name': 'blak-lan-dns'}}]}}})]


def write_bundle(output, settings):
    output.mkdir(parents=True, exist_ok=False)
    (output / 'network.json').write_text(json.dumps(settings, indent=2) + '\n')
    (output / 'records.json').write_text(json.dumps(records(settings), indent=2) + '\n')
    (output / 'db.workspace').write_text(zone(settings))
    if settings['mode'] == 'bundled':
        (output / 'Corefile').write_text(corefile(settings))
        (output / 'dns.yaml').write_text(yaml.safe_dump_all(manifests(settings), sort_keys=False))
    (output / 'README.txt').write_text(
        'Generated DNS only. Application URLs and TLS are unchanged.\n'
        'Reserve the LAN address in your router or configure a static address.\n'
        'Bundled: run check-host on the target node, then install with an explicit kubeconfig.\n'
        'Existing DNS: add records.json entries to your existing zone; db.workspace is a zone-file reference.\n'
        'Configure clients through your router DHCP DNS option or a conditional forwarder.\n'
        'DHCP is never installed or modified by this bundle.\n'
        'All advertised DNS servers must know this local zone; a public secondary can break local lookups.\n'
        'Review secure-DNS browser/device policies: external DoH can bypass local DNS.\n'
        'Pre-cache the pinned image before a WAN outage. No public DNS is required for local records.\n'
        'See docs/runbooks/local-network.md for TLS, trust, rotation, rollback and acceptance.\n')


def check_host(settings):
    if settings['mode'] != 'bundled':
        raise ValueError('Host preflight applies only to bundled DNS')
    family = socket.AF_INET6 if ':' in settings['listen'] else socket.AF_INET
    # Bind both sockets concurrently. Never kill a conflicting resolver.
    with socket.socket(family, socket.SOCK_STREAM) as tcp, socket.socket(family, socket.SOCK_DGRAM) as udp:
        tcp.bind((settings['listen'], 53))
        udp.bind((settings['listen'], 53))


def kube(kubeconfig, *args, data=None):
    return subprocess.check_output(['kubectl', '--kubeconfig', str(kubeconfig), '-n', 'blak-micro', *args],
                                   input=data, text=True)


def install(settings, kubeconfig):
    if settings['mode'] != 'bundled':
        raise ValueError('External DNS mode exports records; it does not install a resolver')
    node = json.loads(kube(kubeconfig, 'get', 'node', settings['node'], '-o', 'json'))
    addresses = [entry['address'] for entry in node.get('status', {}).get('addresses', [])]
    if settings['listen'] not in addresses:
        raise ValueError('Listener must be a reported address of the chosen Kubernetes node')
    running = False
    for kind in ('configmap', 'deployment'):
        existing = kube(kubeconfig, 'get', kind, 'blak-lan-dns', '--ignore-not-found', '-o', 'json')
        if existing and json.loads(existing)['metadata'].get('labels', {}).get('blak.workspace/component') != 'local-dns':
            raise ValueError('Refusing to replace an unrelated resource named blak-lan-dns')
        if existing and kind == 'deployment':
            previous = json.loads(existing)
            if previous['spec']['template']['spec']['nodeName'] != settings['node']:
                raise ValueError('Moving DNS between nodes requires a planned migration')
            running = bool(previous.get('status', {}).get('readyReplicas'))
    if not running:
        check_host(settings)
    kube(kubeconfig, 'apply', '-f', '-', data=yaml.safe_dump_all(manifests(settings), sort_keys=False))
    kube(kubeconfig, 'rollout', 'status', 'deployment/blak-lan-dns', '--timeout=120s')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('prepare')
    source = prepare.add_mutually_exclusive_group(required=True)
    source.add_argument('--release', type=Path, help='Prepared release; domain and canonical tailnet hostname are read from metadata')
    source.add_argument('--domain', help='Existing deployment domain; no application URLs are changed')
    prepare.add_argument('--address', required=True, help='Ingress address returned for applications')
    prepare.add_argument('--mode', choices=('bundled', 'external'), required=True)
    prepare.add_argument('--listen', help='LAN address for DNS; defaults to the ingress address')
    prepare.add_argument('--client-network', action='append', default=[])
    prepare.add_argument('--node', help='Kubernetes node hosting the LAN address')
    prepare.add_argument('--upstream', action='append', default=[], help='Optional resolver IP; omit for local-zone-only DNS')
    prepare.add_argument('--apex-only', action='store_true', help='Existing single-host deployment; do not generate app subdomains')
    prepare.add_argument('--output', required=True, type=Path)
    for command in ('check-host', 'install'):
        sub = commands.add_parser(command)
        sub.add_argument('--bundle', required=True, type=Path)
        if command == 'install':
            sub.add_argument('--kubeconfig', required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'prepare':
            domain, apex_only = args.domain, args.apex_only
            if args.release:
                metadata = json.loads((args.release / '.deployment.json').read_text())
                domain = metadata.get('tailnet', {}).get('host', metadata['domain'])
                apex_only = bool(metadata.get('tailnet')) or apex_only
            settings = configuration(domain, args.address, args.mode, args.listen, args.client_network,
                                     args.node, args.upstream, apex_only)
            write_bundle(args.output, settings)
            print(f"Prepared {args.mode} DNS for {domain}; no network or cluster changed")
        else:
            saved = json.loads((args.bundle / 'network.json').read_text())
            settings = configuration(saved['domain'], saved['address'], saved['mode'], saved.get('listen'),
                                     saved.get('clients', []), saved.get('node'), saved.get('upstreams', []), saved['apex_only'])
            if args.command == 'check-host':
                check_host(settings)
                print('LAN address exists; TCP and UDP port 53 are available')
            else:
                install(settings, args.kubeconfig)
                print('LAN DNS deployed; configure router/client DNS explicitly, then run acceptance checks')
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f'{exc}\n')


if __name__ == '__main__':
    main()
