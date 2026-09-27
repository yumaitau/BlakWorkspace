#!/usr/bin/env python3
"""Replace the old portal metrics view with native Beszel on an existing workspace."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
KUBE = ['kubectl', '-n', os.environ.get('NS', 'blak-micro')]


def kube(*args, data=None):
    return subprocess.check_output(KUBE + list(args), input=data, text=True)


def route(text, origin):
    host = urlsplit(origin).netloc
    text = text.replace('map $host $blak_upstream', 'map $http_host $blak_upstream')
    start = text.index('map $http_host $blak_upstream')
    end = text.index('\n}', start)
    line = '  ' + host + ' beszel.blak-micro.svc.cluster.local:8090;'
    for existing in text[start:end].splitlines():
        fields = existing.strip().split()
        if fields and fields[0] == host and existing.strip() != line.strip():
            raise ValueError('Monitoring origin already routes to another service')
    if line not in text[start:end]:
        text = text[:end] + '\n' + line + text[end:]
    return text


def patch_map(name, update):
    document = json.loads(kube('get', 'configmap', name, '-o', 'json'))
    data = update(document['data'])
    patch = [{'op': 'test', 'path': '/metadata/resourceVersion', 'value': document['metadata']['resourceVersion']},
             {'op': 'replace', 'path': '/data', 'value': data}]
    kube('patch', 'configmap', name, '--type=json', '--patch-file=/dev/stdin', data=json.dumps(patch, ensure_ascii=False))


def retire_portal_metrics(document):
    spec = document['spec']['template']['spec']
    patch = [{'op': 'test', 'path': '/metadata/resourceVersion', 'value': document['metadata']['resourceVersion']}]
    for field in ('serviceAccountName', 'serviceAccount'):
        if spec.get(field) == 'portal-monitor':
            patch.append({'op': 'remove', 'path': '/spec/template/spec/' + field})
    patch.append({'op': 'add', 'path': '/spec/template/spec/automountServiceAccountToken', 'value': False})
    for i, container in enumerate(spec['containers']):
        for j in reversed(range(len(container.get('volumeMounts', [])))):
            if container['volumeMounts'][j]['name'] == 'portal-monitor':
                patch.append({'op': 'remove', 'path': f'/spec/template/spec/containers/{i}/volumeMounts/{j}'})
    for i in reversed(range(len(spec.get('volumes', [])))):
        if spec['volumes'][i]['name'] == 'portal-monitor':
            patch.append({'op': 'remove', 'path': f'/spec/template/spec/volumes/{i}'})
    return patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True)
    args = parser.parse_args()
    origin = args.origin.rstrip('/')
    url = urlsplit(origin)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.path or url.query or url.fragment or url.hostname.endswith('example.com'):
        raise ValueError('Use a real HTTPS monitoring origin')
    patch_map('workspace-shell-nginx', lambda data: {key: route(value, origin) for key, value in data.items()})
    def apps(data):
        records = [a for a in json.loads(data['apps.json']) if a['id'] != 'monitoring']
        records.append({'id': 'monitoring', 'name': 'Blak Monitoring', 'url': origin + '/', 'backend': 'Powered by Beszel'})
        return {**data, 'apps.json': json.dumps(records)}
    patch_map('workspace-shell-apps', apps)
    patch_map('blak-shell-js', lambda data: {**data, 'shell.js': (ROOT / 'services/workspace-shell/shell.js').read_text()})
    patch_map('blak-portal-runtime', lambda data: {**data, 'server.js': (ROOT / 'apps/portal/server.js').read_text()})
    document = json.loads(kube('get', 'deployment', 'portal', '-o', 'json'))
    patch = retire_portal_metrics(document)
    containers = document['spec']['template']['spec']['containers']
    index = next(i for i, c in enumerate(containers) if c['name'] == 'portal')
    env = containers[index].get('env', [])
    existing = next((i for i, item in enumerate(env) if item['name'] == 'BLAK_MONITORING_URL'), None)
    patch.append({'op': 'add' if existing is None else 'replace',
                  'path': f'/spec/template/spec/containers/{index}/env/' + ('-' if existing is None else str(existing)),
                  'value': {'name': 'BLAK_MONITORING_URL', 'value': origin}})
    kube('patch', 'deploy', 'portal', '--type=json', '--patch-file=/dev/stdin', data=json.dumps(patch))
    for name in ['portal', 'workspace-shell']:
        kube('rollout', 'restart', 'deploy/' + name)
        print(kube('rollout', 'status', 'deploy/' + name, '--timeout=180s').strip())
    for kind, name in [('clusterrolebinding', 'blak-portal-monitor'), ('clusterrole', 'blak-portal-monitor'),
                       ('serviceaccount', 'portal-monitor'), ('configmap', 'portal-monitor')]:
        kube('delete', kind, name, '--ignore-not-found')
    print('Beszel published; custom metrics code mount and node-reading permissions removed')


if __name__ == '__main__':
    main()
