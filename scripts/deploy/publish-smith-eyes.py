#!/usr/bin/env python3
"""Point the live shell and portal at BlakSmith and BlakEyes.

Inserts missing upstreams into ConfigMap workspace-shell-nginx and adds catalog
origins to the portal BLAK_APP_ORIGINS object. Other keys are left as they are.
Rolls workspace-shell after a ConfigMap edit because a subPath mount does not reload.
"""
import json
import os
import subprocess
from pathlib import Path

NS = ['kubectl', '-n', 'blak-micro']
ROOT = Path(__file__).resolve().parents[2]
UPSTREAMS = {
    'smith': 'smith.blak-micro.svc.cluster.local:3000',
    'eyes': 'eyes.blak-micro.svc.cluster.local:8765',
}
PORTS = {'smith': 8455, 'eyes': 8456}


def kube(*args, input_bytes=None):
    return subprocess.check_output(NS + list(args), input=input_bytes)


def tailnet():
    host = os.environ.get('BLAK_TAILNET_HOST', '').strip()
    if host:
        return {
            'host': host,
            'origins': {name: f'https://{host}:{PORTS[name]}' for name in PORTS},
        }
    path = ROOT / '.deployment.json'
    if not path.exists():
        return None
    return json.loads(path.read_text()).get('tailnet')


def insert_upstreams(text, lines):
    for line in lines:
        if line.strip() in text:
            continue
        start = text.find('map $http_host $blak_upstream')
        if start < 0:
            start = text.find('map $host $blak_upstream')
        if start < 0:
            raise SystemExit('workspace-shell nginx has no upstream map')
        end = text.find('\n}', start)
        if end < 0:
            raise SystemExit('workspace-shell upstream map is not closed')
        text = text[:end] + '\n' + line + text[end:]
    return text


def patch_nginx():
    try:
        raw = kube('get', 'configmap', 'workspace-shell-nginx', '-o', 'json')
    except subprocess.CalledProcessError:
        print('ConfigMap workspace-shell-nginx is absent; the shell image nginx.conf is the route table')
        return False
    data = json.loads(raw)['data']
    key = 'nginx.conf' if 'nginx.conf' in data else next(iter(data))
    lines = [f'  {name}.workspace.example.com {upstream};' for name, upstream in UPSTREAMS.items()]
    meta = tailnet()
    if meta:
        lines += [f"  {meta['host']}:{PORTS[name]} {upstream};" for name, upstream in UPSTREAMS.items()]
    updated = insert_upstreams(data[key], lines)
    if updated == data[key]:
        print('Shell upstreams already include BlakSmith and BlakEyes')
        return False
    patch = json.dumps({'data': {key: updated}}).encode()
    kube('patch', 'configmap', 'workspace-shell-nginx', '--type=merge', '--patch-file=/dev/stdin', input_bytes=patch)
    kube('rollout', 'restart', 'deploy/workspace-shell')
    print('Shell upstreams updated; workspace-shell restarted')
    return True


def merge_origins():
    raw = kube('get', 'deploy', 'portal', '-o', 'json')
    env = json.loads(raw)['spec']['template']['spec']['containers'][0]['env']
    index = next(i for i, item in enumerate(env) if item['name'] == 'BLAK_APP_ORIGINS')
    current = env[index].get('value') or ''
    origins = json.loads(current) if current else {}
    meta = tailnet()
    changed = False
    for name in UPSTREAMS:
        origin = (meta or {}).get('origins', {}).get(name) or f'https://{name}.workspace.example.com'
        if origins.get(name) != origin:
            origins[name] = origin
            changed = True
    if not changed:
        print('Portal origins already include BlakSmith and BlakEyes')
        return
    patch = json.dumps([{
        'op': 'replace',
        'path': f'/spec/template/spec/containers/0/env/{index}/value',
        'value': json.dumps(origins),
    }]).encode()
    kube('patch', 'deploy', 'portal', '--type=json', '--patch-file=/dev/stdin', input_bytes=patch)
    print('Portal origins updated')


def main():
    patch_nginx()
    merge_origins()


if __name__ == '__main__':
    main()
