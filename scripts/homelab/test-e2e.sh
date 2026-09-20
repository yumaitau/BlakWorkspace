#!/usr/bin/env bash
# Run on the homelab host with namespace access. Never prints credentials.
set -euo pipefail
cd "$(dirname "$0")/../.."
NS="${NS:-blak-micro}"
export BLAK_E2E_NAMESPACE="$NS"
export BLAK_E2E_USER="${BLAK_E2E_USER:-akadmin}"
export BLAK_E2E_PASSWORD="$(kubectl -n "$NS" get secret blak-idp -o jsonpath='{.data.bootstrap-password}' | base64 -d)"
export BLAK_E2E_SESSION_SECRET="$(kubectl -n "$NS" get secret blak-portal -o jsonpath='{.data.session-secret}' | base64 -d)"
: "${BLAK_E2E_PASSWORD:?missing IdP credential}"
: "${BLAK_E2E_SESSION_SECRET:?missing portal session secret}"
cd e2e
npm ci --ignore-scripts
npx playwright test "$@"
