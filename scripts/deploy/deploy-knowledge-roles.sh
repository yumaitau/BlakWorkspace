#!/usr/bin/env bash
# Run on the homelab host from a prepared, committed release.
set -euo pipefail
cd "$(dirname "$0")/../.."
test -f .deployment.json || { echo 'Prepare a domain-specific release first'; exit 1; }
REVISION_FULL=$(python3 -c 'import json; print(json.load(open(".deployment.json"))["revision"])')
REVISION="${REVISION_FULL:0:12}"
export KNOWLEDGE_IMAGE="blak-knowledge:$REVISION" ROLE_IMAGE="blak-app-roles:$REVISION" SYNC_IMAGE="blak-hermes-sync:$REVISION"
export PORTAL_IMAGE="blak-portal:$REVISION"
NS=blak-micro
docker info >/dev/null
node scripts/brand/generate.js --check
for service in knowledge app-roles hermes-sync; do
  docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "blak-$service:$REVISION" "services/$service"
done
docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "$PORTAL_IMAGE" apps/portal
docker save "$KNOWLEDGE_IMAGE" "$ROLE_IMAGE" "$SYNC_IMAGE" "$PORTAL_IMAGE" | sudo k3s ctr images import -
mkdir -p .backups
chmod 700 .backups
umask 077
kubectl -n "$NS" exec deploy/postgres -- sh -ec 'pg_dump -U "$POSTGRES_USER" -d outline -Fc' > ".backups/knowledge-$REVISION-$(date +%s).dump"
python3 scripts/deploy/provision-id.py
python3 scripts/deploy/provision-role-reader.py
kubectl -n "$NS" set image deploy/portal "portal=$PORTAL_IMAGE"
kubectl -n "$NS" rollout status deploy/portal --timeout=240s
python3 - <<'PY' | kubectl -n "$NS" apply -f -
import os,yaml
from pathlib import Path
manifest=next(d for d in yaml.safe_load_all(Path('deploy/k3s/micro/70-outline.yaml').read_text()) if d.get('kind')=='Deployment' and d['metadata']['name']=='outline')
manifest['spec']['template']['spec']['containers'][0]['image']=os.environ['KNOWLEDGE_IMAGE']
print(yaml.safe_dump(manifest))
PY
kubectl -n "$NS" rollout status deploy/outline --timeout=360s
python3 scripts/deploy/provision-knowledge-roles.py --prepare-only
kubectl -n "$NS" rollout restart deploy/outline
kubectl -n "$NS" rollout status deploy/outline --timeout=360s
kubectl -n "$NS" set image deploy/blak-app-role-sync "roles=$ROLE_IMAGE"
kubectl -n "$NS" rollout status deploy/blak-app-role-sync --timeout=240s
kubectl -n "$NS" set image cronjob/hermes-workspace-sync "sync=$SYNC_IMAGE"
python3 scripts/deploy/provision-knowledge-roles.py
kubectl -n "$NS" rollout restart deploy/blak-app-role-sync
kubectl -n "$NS" rollout status deploy/blak-app-role-sync --timeout=240s
printf '%s\n' 'Knowledge native roles deployed; run authenticated role and revocation acceptance tests.'
