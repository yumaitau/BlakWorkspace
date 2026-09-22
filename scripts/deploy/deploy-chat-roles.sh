#!/usr/bin/env bash
# Run from a prepared, committed release on the deployment host.
set -euo pipefail
cd "$(dirname "$0")/../.."
test -f .deployment.json || { echo 'Prepare a domain-specific release first'; exit 1; }
REVISION_FULL=$(python3 -c 'import json; print(json.load(open(".deployment.json"))["revision"])')
REVISION="${REVISION_FULL:0:12}"
NS=blak-micro
export CHAT_IMAGE="blak-chat:$REVISION" ROLE_IMAGE="blak-app-roles:$REVISION"
export PORTAL_IMAGE="blak-portal:$REVISION" SYNC_IMAGE="blak-hermes-sync:$REVISION"
docker info >/dev/null
node scripts/brand/generate.js --check
for service in chat app-roles hermes-sync; do
  docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "blak-$service:$REVISION" "services/$service"
done
docker build --label "org.opencontainers.image.revision=$REVISION_FULL" -t "$PORTAL_IMAGE" apps/portal
docker save "$CHAT_IMAGE" "$ROLE_IMAGE" "$PORTAL_IMAGE" "$SYNC_IMAGE" | sudo k3s ctr images import -
mkdir -p .backups
chmod 700 .backups
umask 077
kubectl -n "$NS" exec deploy/mongo -- mongodump --db rocketchat --archive --gzip > ".backups/chat-$REVISION-$(date +%s).archive.gz"
python3 scripts/deploy/provision-id.py
python3 scripts/deploy/provision-role-reader.py
python3 scripts/deploy/provision-chat-roles.py --prepare-only
python3 - <<'PY' | kubectl -n "$NS" apply -f -
import os,yaml
from pathlib import Path
manifest=next(d for d in yaml.safe_load_all(Path('deploy/k3s/micro/90-rocketchat.yaml').read_text()) if d and d.get('kind')=='Deployment' and d['metadata']['name']=='chat')
manifest['spec']['template']['spec']['containers'][0]['image']=os.environ['CHAT_IMAGE']
print(yaml.safe_dump(manifest))
PY
kubectl -n "$NS" rollout status deploy/chat --timeout=600s
kubectl -n "$NS" set image deploy/blak-app-role-sync "roles=$ROLE_IMAGE"
kubectl -n "$NS" rollout status deploy/blak-app-role-sync --timeout=240s
kubectl -n "$NS" set image deploy/portal "portal=$PORTAL_IMAGE"
kubectl -n "$NS" set image cronjob/hermes-workspace-sync "sync=$SYNC_IMAGE"
kubectl -n "$NS" rollout status deploy/portal --timeout=240s
python3 scripts/deploy/provision-chat-roles.py
kubectl -n "$NS" rollout restart deploy/blak-app-role-sync
kubectl -n "$NS" rollout status deploy/blak-app-role-sync --timeout=240s
printf '%s\n' 'Chat roles deployed; run native SSO, role, websocket and source acceptance.'
