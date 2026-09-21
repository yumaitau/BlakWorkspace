#!/usr/bin/env bash
# Run on the homelab host from a prepared, committed release.
set -euo pipefail
cd "$(dirname "$0")/../.."
test -f .deployment.json || { echo 'Prepare a domain-specific release first'; exit 1; }
REVISION_FULL=$(python3 -c 'import json; print(json.load(open(".deployment.json"))["revision"])')
REVISION="${REVISION_FULL:0:12}"
NS=blak-micro
export CRM_IMAGE="blak-frappe:$REVISION" ROLE_IMAGE="blak-app-roles:$REVISION" SYNC_IMAGE="blak-hermes-sync:$REVISION"
export PORTAL_IMAGE="blak-portal:$REVISION"
docker info >/dev/null
node scripts/brand/generate.js --check
scripts/deploy/build-frappe.sh
source services/frappe/versions.env
docker tag "$FRAPPE_IMAGE" "$CRM_IMAGE"
docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "$ROLE_IMAGE" services/app-roles
docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "$SYNC_IMAGE" services/hermes-sync
docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "$PORTAL_IMAGE" apps/portal
docker save "$CRM_IMAGE" "$ROLE_IMAGE" "$SYNC_IMAGE" "$PORTAL_IMAGE" | sudo k3s ctr images import -
mkdir -p .backups
chmod 700 .backups
umask 077
kubectl -n "$NS" exec deploy/frappe-db -- sh -ec 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb-dump -u root --all-databases --single-transaction' > ".backups/crm-$REVISION-$(date +%s).sql"
python3 scripts/deploy/provision-id.py
python3 scripts/deploy/provision-role-reader.py
kubectl -n "$NS" create configmap blak-frappe-setup --from-file=setup.py=services/frappe/setup.py --dry-run=client -o yaml | kubectl apply -f -
python3 - <<'PY' | kubectl -n "$NS" apply -f -
import os,yaml
from pathlib import Path
manifest=next(d for d in yaml.safe_load_all(Path('deploy/k3s/micro/95-crm.yaml').read_text()) if d.get('kind')=='Deployment' and d['metadata']['name']=='frappe-crm')
spec=manifest['spec']['template']['spec']
for container in spec['containers']+spec.get('initContainers',[]):
    if container['image'].startswith('blak-frappe:'):
        container['image']=os.environ['CRM_IMAGE']
print(yaml.safe_dump(manifest))
PY
kubectl -n "$NS" rollout status deploy/frappe-crm --timeout=600s
python3 scripts/deploy/provision-crm-roles.py --prepare-only
kubectl -n "$NS" set image deploy/blak-app-role-sync "roles=$ROLE_IMAGE"
kubectl -n "$NS" rollout status deploy/blak-app-role-sync --timeout=240s
kubectl -n "$NS" set image cronjob/hermes-workspace-sync "sync=$SYNC_IMAGE"
kubectl -n "$NS" set image deploy/portal "portal=$PORTAL_IMAGE"
kubectl -n "$NS" rollout status deploy/portal --timeout=240s
python3 scripts/deploy/provision-crm-roles.py
kubectl -n "$NS" rollout restart deploy/frappe-crm
kubectl -n "$NS" rollout status deploy/frappe-crm --timeout=600s
kubectl -n "$NS" rollout restart deploy/blak-app-role-sync
kubectl -n "$NS" rollout status deploy/blak-app-role-sync --timeout=240s
printf '%s\n' 'CRM native roles deployed; run authenticated permission and restoration acceptance tests.'
