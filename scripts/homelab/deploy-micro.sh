#!/usr/bin/env bash
# Scoped deployment of the workspace application changes, run on homelab from a clean checkout.
set -euo pipefail
cd "$(dirname "$0")/../.."
git diff --quiet
git diff --cached --quiet
NS="blak-micro"
REVISION=$(git rev-parse --short=12 HEAD)
export PORTAL_IMAGE="blak-portal:$REVISION" SYNC_IMAGE="blak-hermes-sync:$REVISION"
docker info >/dev/null
node scripts/brand/generate.js --check
docker build --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" -t "$PORTAL_IMAGE" apps/portal
docker build --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" -t "$SYNC_IMAGE" services/hermes-sync
docker save "$PORTAL_IMAGE" "$SYNC_IMAGE" | sudo k3s ctr images import -
python3 scripts/homelab/persist-hermes-session-key.py
python3 scripts/homelab/provision-workspace-apps.py
if kubectl -n "$NS" get deploy portal >/dev/null 2>&1; then
  NS="$NS" scripts/homelab/migrate-flow-store.sh
fi
# Apply only changed application Deployments, ConfigMaps, portal/sync PVCs and the sync CronJob.
# Existing workspace databases and unrelated workloads are not reapplied.
# The new Forms/CRM resources are reconciled with persistent volumes retained.
python3 - <<'PY' | kubectl apply -f -
import os
import hashlib
from pathlib import Path
import yaml
selected = {
    '30-portal.yaml': {'portal', 'portal-flow-data'},
    '50-drive-theme.yaml': {'drive-theme'},
    '50-opencloud.yaml': {'opencloud'},
    '51-app-themes.yaml': {'blak-app-themes'},
    '90-rocketchat.yaml': {'chat'},
    '91-kaneo.yaml': {'projects'},
    '92-hermes.yaml': {'hermes'},
    '93-hermes-sync.yaml': {'hermes-sync-state', 'hermes-workspace-sync'},
    '94-forms.yaml': {'forms-cache-data', 'forms-data', 'forms-cache', 'forms'},
    '95-crm.yaml': {'crm-cache-data', 'crm-db-data', 'crm-data', 'crm-db', 'crm-cache', 'crm', 'crm-worker'},
}
for file, names in selected.items():
    for document in yaml.safe_load_all((Path('deploy/k3s/micro') / file).read_text()):
        if not document or document['metadata']['name'] not in names:
            continue
        if document['kind'] == 'Deployment' and document['metadata']['name'] in {'portal', 'opencloud', 'chat', 'projects', 'hermes', 'forms', 'crm'}:
            theme_hash = hashlib.sha256(Path('deploy/k3s/micro/51-app-themes.yaml').read_bytes() + Path('deploy/k3s/micro/50-drive-theme.yaml').read_bytes()).hexdigest()
            document['spec']['template'].setdefault('metadata', {}).setdefault('annotations', {})['blak.workspace/theme-sha'] = theme_hash
        if document['metadata']['name'] == 'portal' and document['kind'] == 'Deployment':
            document['spec']['template']['spec']['containers'][0]['image'] = os.environ['PORTAL_IMAGE']
        if document['kind'] == 'CronJob':
            document['spec']['jobTemplate']['spec']['template']['spec']['containers'][0]['image'] = os.environ['SYNC_IMAGE']
        print('---')
        print(yaml.safe_dump(document, sort_keys=False))
PY
kubectl -n "$NS" exec -i deploy/authentik-server -- ak shell < scripts/homelab/ak-brand.py
# Theme hashes in pod annotations replace subPath consumers when generated themes change.
for app in portal opencloud chat projects hermes forms crm crm-worker; do
  kubectl -n "$NS" rollout status "deploy/$app" --timeout=240s
done
for active in $(kubectl -n "$NS" get cronjob hermes-workspace-sync -o jsonpath='{.status.active[*].name}'); do
  kubectl -n "$NS" wait --for=condition=complete "job/$active" --timeout=900s
done
JOB="hermes-release-$REVISION-$(date +%s)"
kubectl -n "$NS" create job "$JOB" --from=cronjob/hermes-workspace-sync
kubectl -n "$NS" wait --for=condition=complete "job/$JOB" --timeout=900s
kubectl -n "$NS" logs "job/$JOB"
kubectl -n "$NS" logs "job/$JOB" | grep -q 'Sync complete'
printf 'Deployed commit %s\n' "$REVISION"
