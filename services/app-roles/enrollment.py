"""Operator-only enrollment that preserves unrelated app credentials."""
import base64
import json
import subprocess
from urllib.parse import urlsplit


def public_origin(root, app):
    deployment = json.loads((root / '.deployment.json').read_text())
    origin = deployment.get('tailnet', {}).get('origins', {}).get(app) or 'https://' + app + '.' + deployment['domain']
    parsed = urlsplit(origin)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or parsed.path not in ('', '/'):
        raise ValueError('Native controller requires a verified HTTPS origin')
    return origin.rstrip('/')


def read_secret(kube, name):
    raw = subprocess.check_output(kube + ['get', 'secret', name, '--ignore-not-found', '-o', 'json'], stderr=subprocess.PIPE)
    resource = json.loads(raw) if raw.strip() else {}
    return {key: base64.b64decode(value).decode() for key, value in resource.get('data', {}).items()}


def save_secret(kube, name, values):
    resource = {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': name, 'namespace': 'blak-micro'}, 'stringData': values}
    subprocess.run(kube + ['apply', '-f', '-'], input=json.dumps(resource).encode(), check=True)


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
