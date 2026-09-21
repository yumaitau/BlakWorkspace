#!/usr/bin/env bash
# Run on the deployment host from a prepared release. No other app is restarted.
set -euo pipefail
cd "$(dirname "$0")/../.."
test -f .deployment.json || { echo 'Prepare a release first'; exit 1; }
REVISION=$(python3 -c 'import json; print(json.load(open(".deployment.json"))["revision"])')
export VAULT_IMAGE="blak-vault:${REVISION:0:12}"
export SHELL_IMAGE="blak-workspace-shell:${REVISION:0:12}"
docker info >/dev/null
docker build --label "org.opencontainers.image.revision=$REVISION" -f services/vault/Dockerfile -t "$VAULT_IMAGE" .
docker build --label "org.opencontainers.image.revision=$REVISION" -t "$SHELL_IMAGE" services/workspace-shell
docker save "$VAULT_IMAGE" "$SHELL_IMAGE" | sudo k3s ctr images import -
python3 scripts/deploy/provision-vault.py
python3 - <<'PY' | kubectl apply -f -
import os
from pathlib import Path
import yaml
for filename in ['96-vault.yaml', '52-workspace-shell.yaml']:
    for doc in yaml.safe_load_all((Path('deploy/k3s/micro') / filename).read_text()):
        if not doc:
            continue
        if doc['kind'] == 'Deployment':
            key = 'VAULT_IMAGE' if doc['metadata']['name'] == 'vault' else 'SHELL_IMAGE'
            doc['spec']['template']['spec']['containers'][0]['image'] = os.environ[key]
        print('---')
        print(yaml.safe_dump(doc))
PY
kubectl -n blak-micro rollout status deploy/vault --timeout=180s
kubectl -n blak-micro rollout status deploy/workspace-shell --timeout=180s
python3 - <<'PY'
import json
import subprocess
metadata = json.load(open('.deployment.json'))
if metadata.get('tailnet'):
    port = metadata['tailnet']['ports']['vault']
    # This route alone; preserve existing Serve routes and the unrelated 8443 app.
    subprocess.run(['sudo', 'tailscale', 'serve', '--bg', '--https='+str(port), 'http://127.0.0.1:18480'], check=True)
PY
echo "Vault deployed from $REVISION; run native acceptance before enabling the launcher."
