#!/usr/bin/env python3
"""Export a committed release with explicit public DNS, without changing a cluster."""
import argparse
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

TEMPLATE_DOMAIN = 'workspace.example.com'


def domain_name(value):
    value = value.lower()
    labels = value.split('.')
    if len(value) > 253 or len(labels) < 2 or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in labels):
        raise argparse.ArgumentTypeError('Use a DNS domain without scheme, port or path')
    if value == 'example.com' or value.endswith('.example.com'):
        raise argparse.ArgumentTypeError('Choose the actual deployment domain, not the documentation example')
    return value


def configure_tree(root, domain):
    replacements = [(TEMPLATE_DOMAIN, domain),
                    (TEMPLATE_DOMAIN.replace('.', r'\.'), domain.replace('.', r'\.')),
                    (TEMPLATE_DOMAIN.replace('.', r'\\.'), domain.replace('.', r'\\.'))]
    for path in root.rglob('*'):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            original = path.read_text()
        except UnicodeError:
            continue
        text = original
        for before, after in replacements:
            text = text.replace(before, after)
        if text != original:
            path.write_text(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--domain', required=True, type=domain_name)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if not hasattr(tarfile, 'data_filter'):
        parser.error('Python 3.12 or newer is required for safe archive extraction')
    repo = Path(__file__).resolve().parents[2]
    if args.output.resolve().is_relative_to(repo):
        parser.error('Output must be outside the source checkout')
    if args.output.exists():
        parser.error('Output must not exist; use a new release directory')
    if subprocess.check_output(['git', '-C', str(repo), 'status', '--porcelain']).strip():
        parser.error('Commit or isolate pending changes before preparing a release')
    revision = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    archive = subprocess.check_output(['git', '-C', str(repo), 'archive', 'HEAD'])
    args.output.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(args.output, filter='data')
    configure_tree(args.output, args.domain)
    (args.output / '.deployment.json').write_text(json.dumps({'revision': revision, 'domain': args.domain}, indent=2) + '\n')
    print(f'Prepared {revision[:12]} for {args.domain} at {args.output}')
    print('Review DNS, TLS, storage and target kubeconfig before deployment. No cluster was changed.')


if __name__ == '__main__':
    main()
