#!/usr/bin/env bash
# Run on the homelab Docker/Kubernetes host from a prepared, committed release.
set -euo pipefail
cd "$(dirname "$0")/../.."
test -f .deployment.json || { echo 'Prepare a domain-specific release first'; exit 1; }
REVISION_FULL=$(python3 -c 'import json; print(json.load(open(".deployment.json"))["revision"])')
REVISION="${REVISION_FULL:0:12}"
export HERMES_IMAGE="blak-hermes:$REVISION" ROLE_IMAGE="blak-app-roles:$REVISION" SYNC_IMAGE="blak-hermes-sync:$REVISION"
NS=blak-micro
docker info >/dev/null
node scripts/brand/generate.js --check
for service in hermes app-roles hermes-sync; do
  docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "blak-$service:$REVISION" "services/$service"
done
docker save "$HERMES_IMAGE" "$ROLE_IMAGE" "$SYNC_IMAGE" | sudo k3s ctr images import -
# Migrate legacy grants once before any controller consumes the new role contract.
python3 scripts/deploy/provision-id.py
python3 scripts/deploy/provision-role-reader.py
python3 scripts/deploy/provision-hermes-roles.py
python3 - <<'PY' | kubectl -n "$NS" apply -f -
import os,yaml
from pathlib import Path
manifest=next(d for d in yaml.safe_load_all(Path('deploy/k3s/micro/92-hermes.yaml').read_text()) if d.get('kind')=='Deployment' and d['metadata']['name']=='hermes')
next(c for c in manifest['spec']['template']['spec']['containers'] if c['name']=='webui')['image']=os.environ['HERMES_IMAGE']
print(yaml.safe_dump(manifest))
PY
kubectl -n "$NS" rollout status deploy/hermes --timeout=300s
kubectl -n "$NS" set image cronjob/hermes-workspace-sync "sync=$SYNC_IMAGE"
for active in $(kubectl -n "$NS" get cronjob hermes-workspace-sync -o jsonpath='{.status.active[*].name}'); do
  kubectl -n "$NS" wait --for=condition=complete "job/$active" --timeout=300s
done
# The successful indexer run writes verified native/Blak ID owner bindings.
JOB="hermes-roles-$REVISION-$(date +%s)"
kubectl -n "$NS" create job "$JOB" --from=cronjob/hermes-workspace-sync
kubectl -n "$NS" wait --for=condition=complete "job/$JOB" --timeout=300s
kubectl -n "$NS" logs "job/$JOB" | grep -q 'Sync complete'
python3 - <<'PY' | kubectl -n "$NS" apply -f -
import os,yaml
from pathlib import Path
manifest=yaml.safe_load(Path('deploy/k3s/micro/97-app-roles.yaml').read_text())
manifest['spec']['replicas']=1
manifest['spec']['template']['spec']['containers'][0]['image']=os.environ['ROLE_IMAGE']
print(yaml.safe_dump(manifest))
PY
kubectl -n "$NS" rollout status deploy/blak-app-role-sync --timeout=240s
printf '%s\n' 'Hermes native roles deployed; run authenticated role and revocation acceptance tests.'
