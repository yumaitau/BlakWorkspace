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
HOMELAB_ADDRESS="${BLAK_HOMELAB_ADDRESS:-192.168.1.19}"
HOSTS=()
for app in portal id drive docs sites projects forms crm chat hermes; do
  HOSTS+=(--add-host "$app.homelab.local:$HOMELAB_ADDRESS")
done
# Only browsers run in Docker. Namespace fixtures and secrets stay on the host.
BROWSER_CONTAINER=$(docker run -d --rm --init --shm-size=1g --memory=6g --cpus=4 \
  "${HOSTS[@]}" -p 127.0.0.1::3000 \
  -v "$ROOT/e2e/node_modules:/work/node_modules:ro" -w /work \
  "$IMAGE" node node_modules/playwright/cli.js run-server --host 0.0.0.0 --port 3000)
trap 'docker stop --time 5 "$BROWSER_CONTAINER" >/dev/null 2>&1 || true' EXIT
BROWSER_PORT=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "$BROWSER_CONTAINER")
export PLAYWRIGHT_WS_ENDPOINT="ws://127.0.0.1:$BROWSER_PORT/"
for attempt in $(seq 1 30); do
  if curl --max-time 1 -s -o /dev/null "http://127.0.0.1:$BROWSER_PORT/"; then break; fi
  sleep 1
done
npx playwright test "$@"
