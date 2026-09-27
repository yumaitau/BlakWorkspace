#!/usr/bin/env python3
"""Remove the retired scanner without changing app URLs or deleting stored files."""
import json
import os
import subprocess

NS = os.environ.get('NS', 'blak-micro')
SCANNER_ENV = {'FILE_GUARD_URL', 'FILE_GUARD_TOKEN', 'FILE_GUARD_DIR',
               'SCAN_ROOT', 'SCAN_EVERY_MS', 'CLAMAV_HOST', 'CLAMAV_PORT'}


def retirement_patch(document):
    """JSON patches touch owned fields only, with an optimistic concurrency check."""
    patches = []

    def remove_matches(items, path, predicate):
        for index in range(len(items) - 1, -1, -1):
            if predicate(items[index]):
                patches.append({'op': 'remove', 'path': f'{path}/{index}'})

    name = document['metadata']['name']
    if document['kind'] == 'Deployment':
        spec = document['spec']['template']['spec']
        base = '/spec/template/spec'
        containers = spec['containers']
        if name == 'opencloud':
            remove_matches(containers, base + '/containers', lambda c: c['name'] == 'file-guard')
            remove_matches(spec.get('volumes', []), base + '/volumes',
                           lambda v: v['name'] in {'file-guard-data', 'file-guard-code'} or
                           v.get('configMap', {}).get('name') == 'blak-file-guard-code')
        elif name == 'portal':
            for index, container in enumerate(containers):
                if container['name'] == 'portal':
                    remove_matches(container.get('env', []), f'{base}/containers/{index}/env',
                                   lambda e: e['name'] in SCANNER_ENV)
    elif document['kind'] == 'Service' and name == 'drive':
        remove_matches(document['spec'].get('ports', []), '/spec/ports',
                       lambda p: p.get('port') == 8092 or p.get('name') == 'guard')
    if patches:
        patches.insert(0, {'op': 'test', 'path': '/metadata/resourceVersion',
                           'value': document['metadata']['resourceVersion']})
    return patches


def retire():
    prefix = ['kubectl', '-n', NS]
    for kind, name in [('deployment', 'opencloud'), ('deployment', 'portal'), ('service', 'drive')]:
        raw = subprocess.check_output(prefix + ['get', kind, name, '-o', 'json', '--ignore-not-found'], text=True)
        if not raw.strip():
            continue
        patch = retirement_patch(json.loads(raw))
        if patch:
            subprocess.run(prefix + ['patch', kind, name, '--type=json', '-p', json.dumps(patch)], check=True)
    for kind, name in [('deployment', 'clamav'), ('service', 'clamav'), ('configmap', 'blak-file-guard-code')]:
        subprocess.run(prefix + ['delete', kind, name, '--ignore-not-found'], check=True)
    print('Scanner retired. Persistent volumes and existing held files retained; no files released or deleted.')


if __name__ == '__main__':
    retire()
