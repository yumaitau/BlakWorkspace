"""Operator-only enrollment that preserves unrelated app credentials."""
import base64
import json
import subprocess


def save_app(kube, app, values):
    raw = subprocess.check_output(kube + ['get', 'secret', 'blak-app-roles', '--ignore-not-found', '-o', 'json'], stderr=subprocess.PIPE)
    existing = json.loads(raw) if raw.strip() else {}
    config = json.loads(base64.b64decode(existing.get('data', {}).get('config.json', 'e30=')))
    if not isinstance(config, dict):
        raise ValueError('Invalid native role configuration')
    config[app] = values
    metadata = {'name': 'blak-app-roles', 'namespace': 'blak-micro'}
    if existing:
        metadata['resourceVersion'] = existing['metadata']['resourceVersion']
    resource = {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': metadata,
                'stringData': {'config.json': json.dumps(config)}}
    subprocess.run(kube + ['apply', '-f', '-'], input=json.dumps(resource).encode(), check=True)
