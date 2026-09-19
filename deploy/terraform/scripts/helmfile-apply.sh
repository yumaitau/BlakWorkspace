#!/usr/bin/env bash
set -euo pipefail
: "${OPENDESK_ROOT:?opendesk checkout required}"
: "${NAMESPACE:?}"
: "${MASTER_PASSWORD:?MASTER_PASSWORD required}"
: "${BLAK_VALUES_FILE:?}"
if [ ! -f "${OPENDESK_ROOT}/helmfile.yaml.gotmpl" ]; then
  echo "OPENDESK_ROOT must be openDesk pin checkout (helmfile.yaml.gotmpl missing)" >&2
  exit 1
fi
mkdir -p "${OPENDESK_ROOT}/helmfile/environments/dev"
cp "${BLAK_VALUES_FILE}" "${OPENDESK_ROOT}/helmfile/environments/dev/values.yaml.gotmpl"
export MASTER_PASSWORD DOMAIN="${DOMAIN:-eval.blak.local}"
cd "${OPENDESK_ROOT}"
helmfile apply -e dev -n "${NAMESPACE}" --suppress-diff
