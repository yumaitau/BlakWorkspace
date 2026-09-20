#!/usr/bin/env bash
# Scoped deployment of the workspace application changes, run on the deployment host from a prepared release.
set -euo pipefail
cd "$(dirname "$0")/../.."
# Only deploy a release prepared for an explicitly chosen domain.
test -f .deployment.json || { echo 'Run scripts/deploy/prepare-release.py first'; exit 1; }
REVISION_FULL=$(python3 -c 'import json; print(json.load(open(".deployment.json"))["revision"])')
NS="blak-micro"
REVISION="${REVISION_FULL:0:12}"
export SHELL_IMAGE="blak-workspace-shell:$REVISION"
export PORTAL_IMAGE="blak-portal:$REVISION" SYNC_IMAGE="blak-hermes-sync:$REVISION"
docker info >/dev/null
node scripts/brand/generate.js --check
docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "$PORTAL_IMAGE" apps/portal
docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "$SYNC_IMAGE" services/hermes-sync
docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "$SHELL_IMAGE" services/workspace-shell
docker save "$PORTAL_IMAGE" "$SYNC_IMAGE" "$SHELL_IMAGE" | sudo k3s ctr images import -
python3 scripts/deploy/persist-hermes-session-key.py
scripts/deploy/backup-twenty.sh
scripts/deploy/build-frappe.sh
python3 scripts/deploy/polish-identities.py
python3 scripts/deploy/ensure-docs-proof-key.py
python3 scripts/deploy/provision-workspace-apps.py
kubectl -n "$NS" create configmap blak-frappe-setup --from-file=setup.py=services/frappe/setup.py --dry-run=client -o yaml | kubectl apply -f -
if kubectl -n "$NS" get deploy portal >/dev/null 2>&1; then
  NS="$NS" scripts/deploy/migrate-flow-store.sh
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
    '60-collabora.yaml': {'collabora'},
    '70-outline.yaml': {'outline'},
    '52-workspace-shell.yaml': {'workspace-shell'},
    '30-portal.yaml': {'portal', 'portal-flow-data'},
    '50-drive-theme.yaml': {'drive-theme'},
    '50-opencloud.yaml': {'opencloud', 'drive'},
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
kubectl -n "$NS" exec -i deploy/authentik-server -- ak shell < scripts/deploy/ak-brand.py
# Theme hashes in pod annotations replace subPath consumers when generated themes change.
for app in workspace-shell portal collabora opencloud outline chat projects hermes forms frappe-crm; do
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
python3 scripts/deploy/route-workspace-shell.py
if python3 -c 'import json,sys; sys.exit(not bool(json.load(open(".deployment.json")).get("tailnet")))'; then
  python3 scripts/deploy/publish-tailnet.py
fi
(cd e2e && npm ci --ignore-scripts)
node scripts/deploy/connect-hermes-apps.js
python3 scripts/deploy/configure-hermes-tasks.py
for active in $(kubectl -n "$NS" get cronjob hermes-workspace-sync -o jsonpath='{.status.active[*].name}'); do
  kubectl -n "$NS" wait --for=condition=complete "job/$active" --timeout=900s
done
JOB="hermes-release-$REVISION-$(date +%s)"
kubectl -n "$NS" create job "$JOB" --from=cronjob/hermes-workspace-sync
kubectl -n "$NS" wait --for=condition=complete "job/$JOB" --timeout=900s
kubectl -n "$NS" logs "job/$JOB"
kubectl -n "$NS" logs "job/$JOB" | grep -q 'Sync complete'
scripts/deploy/backup/install.sh
printf 'Deployed commit %s\n' "$REVISION"
