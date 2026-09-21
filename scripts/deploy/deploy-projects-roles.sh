#!/usr/bin/env bash
# Run on the homelab host from a prepared, committed release.
set -euo pipefail
cd "$(dirname "$0")/../.."
test -f .deployment.json || { echo 'Prepare a domain-specific release first'; exit 1; }
REVISION_FULL=$(python3 -c 'import json; print(json.load(open(".deployment.json"))["revision"])')
REVISION="${REVISION_FULL:0:12}"
export PROJECTS_IMAGE="blak-projects:$REVISION" ROLE_IMAGE="blak-app-roles:$REVISION" SYNC_IMAGE="blak-hermes-sync:$REVISION"
NS=blak-micro
docker info >/dev/null
node scripts/brand/generate.js --check
for service in projects app-roles hermes-sync; do
  docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "blak-$service:$REVISION" "services/$service"
done
docker save "$PROJECTS_IMAGE" "$ROLE_IMAGE" "$SYNC_IMAGE" | sudo k3s ctr images import -
# Save the native database before enrollment changes any app account or role.
mkdir -p .backups
chmod 700 .backups
umask 077
kubectl -n "$NS" exec deploy/postgres -- sh -ec 'pg_dump -U "$POSTGRES_USER" -d kaneo -Fc' > ".backups/projects-$REVISION-$(date +%s).dump"
python3 scripts/deploy/provision-id.py
python3 scripts/deploy/provision-role-reader.py
python3 scripts/deploy/provision-projects-roles.py --prepare-only
python3 - <<'PY' | kubectl -n "$NS" apply -f -
import os,yaml
from pathlib import Path
manifest=next(d for d in yaml.safe_load_all(Path('deploy/k3s/micro/91-kaneo.yaml').read_text()) if d.get('kind')=='Deployment' and d['metadata']['name']=='projects')
next(c for c in manifest['spec']['template']['spec']['containers'] if c['name']=='kaneo')['image']=os.environ['PROJECTS_IMAGE']
print(yaml.safe_dump(manifest))
PY
kubectl -n "$NS" rollout status deploy/projects --timeout=300s
# Upgrade the controller before activating its new configuration format.
kubectl -n "$NS" set image deploy/blak-app-role-sync "roles=$ROLE_IMAGE"
kubectl -n "$NS" rollout status deploy/blak-app-role-sync --timeout=240s
kubectl -n "$NS" set image cronjob/hermes-workspace-sync "sync=$SYNC_IMAGE"
python3 scripts/deploy/provision-projects-roles.py
# Projected Secrets update asynchronously; readiness must reflect the new config.
kubectl -n "$NS" rollout restart deploy/blak-app-role-sync
kubectl -n "$NS" rollout status deploy/blak-app-role-sync --timeout=240s
printf '%s\n' 'Projects native roles deployed; run authenticated role and revocation acceptance tests.'
