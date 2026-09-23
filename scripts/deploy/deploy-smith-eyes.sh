#!/usr/bin/env bash
# Stand up BlakSmith and BlakEyes in blak-micro and publish them on the shell.
# Product images are pulled from public GHCR packages.
# This rebuilds the portal and the shell from this checkout so the catalog,
# icons and sign-out adapters are in the images. It does not apply the rest
# of deploy/k3s/micro.
set -euo pipefail
cd "$(dirname "$0")/../.."
NS="${NS:-blak-micro}"
NS="$NS" scripts/deploy/ensure-secrets.sh
python3 scripts/deploy/provision-smith.py
python3 scripts/deploy/provision-eyes.py
python3 scripts/deploy/provision-id.py
kubectl -n "$NS" apply -f deploy/k3s/micro/99-smith.yaml -f deploy/k3s/micro/99-eyes.yaml
python3 - <<'PY' | kubectl apply -f -
from pathlib import Path
import yaml
for doc in yaml.safe_load_all(Path('deploy/k3s/micro/80-ingress.yaml').read_text()):
    if doc and doc.get('kind') == 'IngressRoute' and doc['metadata']['name'] in {'smith', 'eyes'}:
        print('---')
        print(yaml.safe_dump(doc, sort_keys=False))
PY
rev="$(git rev-parse --short=12 HEAD)"
portal="blak-portal:${rev}"
shell="blak-workspace-shell:${rev}"
docker build -t "$portal" apps/portal
docker build -t "$shell" services/workspace-shell
if command -v k3s >/dev/null 2>&1; then
  docker save "$portal" "$shell" | sudo k3s ctr -n k8s.io images import -
fi
kubectl -n "$NS" set image deploy/portal "portal=docker.io/library/${portal}"
kubectl -n "$NS" set image deploy/workspace-shell "shell=docker.io/library/${shell}"
python3 scripts/deploy/publish-smith-eyes.py
kubectl -n "$NS" rollout status deploy/smith-postgres deploy/smith-redis deploy/smith deploy/smith-api deploy/eyes deploy/portal deploy/workspace-shell --timeout=600s
printf 'BlakSmith and BlakEyes are applied. Assign blak-smith-* and blak-eyes-* groups, then SCIM-provision Smith users before they can sign in.\n'
