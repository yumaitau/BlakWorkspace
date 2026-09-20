#!/usr/bin/env bash
# Run on the homelab host with namespace access. Never prints credentials.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
NS="${NS:-blak-micro}"
export BLAK_E2E_NAMESPACE="$NS"
export BLAK_E2E_USER="${BLAK_E2E_USER:-akadmin}"
export BLAK_E2E_PASSWORD="$(kubectl -n "$NS" get secret blak-idp -o jsonpath='{.data.bootstrap-password}' | base64 -d)"
export BLAK_E2E_SESSION_SECRET="$(kubectl -n "$NS" get secret blak-portal -o jsonpath='{.data.session-secret}' | base64 -d)"
: "${BLAK_E2E_PASSWORD:?missing IdP credential}"
: "${BLAK_E2E_SESSION_SECRET:?missing portal session secret}"
ROOT=$(pwd)
cd e2e
npm ci --ignore-scripts
if [[ "${BLAK_E2E_NATIVE:-0}" == 1 ]]; then
  exec npx playwright test "$@"
fi
# Isolate Chromium from host CNI route/interface changes (ERR_NETWORK_CHANGED).
# The browser still reaches the real homelab and fixtures use the same namespace.
docker info >/dev/null
VERSION=$(node -p "require('./package.json').devDependencies['@playwright/test']")
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"
CONFIG=$(mktemp)
trap 'rm -f "$CONFIG"' EXIT
kubectl config view --raw --minify > "$CONFIG"
python3 - "$CONFIG" <<'PY_CONFIG'
import sys, yaml
from urllib.parse import urlsplit, urlunsplit
path=sys.argv[1]
with open(path) as f: config=yaml.safe_load(f)
for cluster in config['clusters']:
    endpoint=urlsplit(cluster['cluster']['server'])
    if endpoint.hostname in {'localhost','127.0.0.1'}:
        cluster['cluster']['server']=urlunsplit((endpoint.scheme,'192.168.1.19:'+str(endpoint.port or 6443),endpoint.path,'',''))
with open(path,'w') as f:yaml.safe_dump(config,f)
PY_CONFIG
HOSTS=()
for app in portal id drive docs sites projects forms crm chat hermes; do
  HOSTS+=(--add-host "$app.homelab.local:192.168.1.19")
done
docker run --rm --init --shm-size=1g --memory=6g --cpus=4 \
  --user "$(id -u):$(id -g)" "${HOSTS[@]}" \
  -e BLAK_E2E_NAMESPACE -e BLAK_E2E_USER -e BLAK_E2E_PASSWORD -e BLAK_E2E_SESSION_SECRET \
  -e BLAK_E2E_REPORT -e BLAK_E2E_OUTPUT -e BLAK_E2E_BASE_URL \
  -e KUBECONFIG=/tmp/blak-kubeconfig -e HOME=/tmp/blak-playwright-home \
  -v "$ROOT:/workspace" -v "$CONFIG:/tmp/blak-kubeconfig:ro" \
  -v "$(readlink -f "$(command -v kubectl)"):/usr/local/bin/kubectl:ro" \
  -w /workspace/e2e "$IMAGE" npx playwright test "$@"
