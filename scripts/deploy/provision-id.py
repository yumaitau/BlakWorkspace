"""Reconcile workspace access without changing any application's credentials."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
KUBE = ['kubectl', '-n', 'blak-micro']


def main():
    contract = json.loads(subprocess.check_output([
        'node', '-e', "console.log(JSON.stringify(Object.entries(require('./apps/portal/integration').INTEGRATIONS).map(([id,value])=>({id,...value}))))",
    ], cwd=ROOT))
    metadata = ROOT / '.deployment.json'
    portal = 'https://portal.workspace.example.com'
    if metadata.exists():
        deployment = json.loads(metadata.read_text())
        portal = deployment.get('tailnet', {}).get('origins', {}).get('portal', portal)
    source = 'BLAK_APPS=' + repr(contract) + '\nBLAK_PORTAL_URL=' + repr(portal) + '\n'
    source += 'from authentik.providers.oauth2.models import OAuth2Provider\n'
    source += 'before=list(OAuth2Provider.objects.order_by("pk").values_list("pk","client_id","client_secret","sub_mode"))\n'
    source += Path(__file__).with_name('ak-workspace-contract.py').read_text()
    source += '\nafter=list(OAuth2Provider.objects.order_by("pk").values_list("pk","client_id","client_secret","sub_mode"))\n'
    source += 'assert before == after, "Identity credentials unexpectedly changed"\nprint("BLAK_ID_RECONCILED credentials_unchanged=true")\n'
    result = subprocess.run(KUBE + ['exec', '-i', 'deploy/authentik-server', '--', 'ak', 'shell'],
                            input=('exec(' + repr(source) + ')\n').encode(), capture_output=True, check=True)
    if b'BLAK_ID_RECONCILED credentials_unchanged=true' not in result.stdout:
        raise RuntimeError('Identity reconciliation failed; inspect Authentik events')
    print('Workspace identity and access reconciled; existing credentials unchanged')


if __name__ == '__main__': main()
