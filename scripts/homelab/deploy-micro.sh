#!/usr/bin/env bash
# Scoped deployment of the workspace application changes, run on homelab from a clean checkout.
set -euo pipefail
cd "$(dirname "$0")/../.."
git diff --quiet
git diff --cached --quiet
NS="blak-micro"
REVISION=$(git rev-parse --short=12 HEAD)
export SHELL_IMAGE="blak-workspace-shell:$REVISION"
export PORTAL_IMAGE="blak-portal:$REVISION" SYNC_IMAGE="blak-hermes-sync:$REVISION"
docker info >/dev/null
node scripts/brand/generate.js --check
docker build --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" -t "$PORTAL_IMAGE" apps/portal
docker build --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" -t "$SYNC_IMAGE" services/hermes-sync
docker build --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" -t "$SHELL_IMAGE" services/workspace-shell
docker save "$PORTAL_IMAGE" "$SYNC_IMAGE" "$SHELL_IMAGE" | sudo k3s ctr images import -
python3 scripts/homelab/persist-hermes-session-key.py
scripts/homelab/backup-twenty.sh
scripts/homelab/build-frappe.sh
python3 scripts/homelab/polish-identities.py
python3 scripts/homelab/provision-workspace-apps.py
kubectl -n "$NS" create configmap blak-frappe-setup --from-file=setup.py=services/frappe/setup.py --dry-run=client -o yaml | kubectl apply -f -
if kubectl -n "$NS" get deploy portal >/dev/null 2>&1; then
  NS="$NS" scripts/homelab/migrate-flow-store.sh
fi
# Apply only changed application Deployments, ConfigMaps, portal/sync PVCs and the sync CronJob.
# Existing workspace databases and unrelated workloads are not reapplied.
# The new Forms/CRM resources are reconciled with persistent volumes retained.
python3 - <<'PY' | kubectl apply -f -
import os
import hashlib
import subprocess
from pathlib import Path
import yaml
selected = {
    '52-workspace-shell.yaml': {'workspace-shell'},
    '30-portal.yaml': {'portal', 'portal-flow-data'},
    '50-drive-theme.yaml': {'drive-theme'},
    '50-opencloud.yaml': {'opencloud'},
    '51-app-themes.yaml': {'blak-app-themes'},
    '90-rocketchat.yaml': {'chat', 'mongo'},
    '91-kaneo.yaml': {'projects'},
    '92-hermes.yaml': {'hermes'},
    '93-hermes-sync.yaml': {'hermes-sync-state', 'hermes-workspace-sync'},
    '94-forms.yaml': {'forms-cache-data', 'forms-data', 'forms-cache', 'forms'},
    '95-crm.yaml': {'frappe-cache-data', 'frappe-db-data', 'frappe-sites', 'frappe-db', 'frappe-cache', 'frappe-crm'},
}
for file, names in selected.items():
    for document in yaml.safe_load_all((Path('deploy/k3s/micro') / file).read_text()):
        if not document or document['metadata']['name'] not in names:
            continue
        if document['kind'] == 'Deployment' and document['metadata']['name'] in {'portal', 'opencloud', 'chat', 'projects', 'hermes', 'forms', 'frappe-crm'}:
            theme_hash = hashlib.sha256(Path('deploy/k3s/micro/51-app-themes.yaml').read_bytes() + Path('deploy/k3s/micro/50-drive-theme.yaml').read_bytes()).hexdigest()
            document['spec']['template'].setdefault('metadata', {}).setdefault('annotations', {})['blak.workspace/theme-sha'] = theme_hash
        if document['metadata']['name'] == 'frappe-crm' and document['kind'] == 'Deployment':
            secret_version = subprocess.check_output(['kubectl', '-n', 'blak-micro', 'get', 'secret', 'blak-frappe', '-o', 'jsonpath={.metadata.resourceVersion}'])
            setup_hash = hashlib.sha256(Path('services/frappe/setup.py').read_bytes() + secret_version).hexdigest()
            document['spec']['template']['metadata']['annotations']['blak.workspace/setup-sha'] = setup_hash
        if document['metadata']['name'] == 'portal' and document['kind'] == 'Deployment':
            document['spec']['template']['spec']['containers'][0]['image'] = os.environ['PORTAL_IMAGE']
        if document['metadata']['name'] == 'workspace-shell' and document['kind'] == 'Deployment':
            document['spec']['template']['spec']['containers'][0]['image'] = os.environ['SHELL_IMAGE']
        if document['kind'] == 'CronJob':
            document['spec']['jobTemplate']['spec']['template']['spec']['containers'][0]['image'] = os.environ['SYNC_IMAGE']
        print('---')
        print(yaml.safe_dump(document, sort_keys=False))
PY
kubectl -n "$NS" exec -i deploy/authentik-server -- ak shell < scripts/homelab/ak-brand.py
# Theme hashes in pod annotations replace subPath consumers when generated themes change.
for app in workspace-shell portal opencloud chat projects hermes forms frappe-crm; do
  kubectl -n "$NS" rollout status "deploy/$app" --timeout=900s
done
# Switch routing only after the new CRM is healthy. Keep Twenty storage for rollback.
python3 - <<'PY_CUTOVER' | kubectl apply -f -
from pathlib import Path
import yaml
for doc in yaml.safe_load_all(Path('deploy/k3s/micro/95-crm.yaml').read_text()):
    if doc and (doc['kind'] == 'IngressRoute' or (doc['kind'] == 'Service' and doc['metadata']['name'] == 'crm')):
        print('---')
        print(yaml.safe_dump(doc))
PY_CUTOVER
for old in crm crm-worker; do
  if kubectl -n "$NS" get deploy "$old" >/dev/null 2>&1; then
    kubectl -n "$NS" scale "deploy/$old" --replicas=0
  fi
done
python3 scripts/homelab/route-workspace-shell.py
(cd e2e && npm ci --ignore-scripts)
node scripts/homelab/connect-hermes-apps.js
for active in $(kubectl -n "$NS" get cronjob hermes-workspace-sync -o jsonpath='{.status.active[*].name}'); do
  kubectl -n "$NS" wait --for=condition=complete "job/$active" --timeout=900s
done
JOB="hermes-release-$REVISION-$(date +%s)"
kubectl -n "$NS" create job "$JOB" --from=cronjob/hermes-workspace-sync
kubectl -n "$NS" wait --for=condition=complete "job/$JOB" --timeout=900s
kubectl -n "$NS" logs "job/$JOB"
kubectl -n "$NS" logs "job/$JOB" | grep -q 'Sync complete'
printf 'Deployed commit %s\n' "$REVISION"
