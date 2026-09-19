#!/usr/bin/env bash
# Create missing Opaque secrets in blak-micro. Never prints secret values.
# Does not overwrite existing secrets. Operator-only — not invoked from CI.
set -euo pipefail
NS="${NS:-blak-micro}"
KUBECONFIG="${KUBECONFIG:-${HOME}/.kube/blak-homelab-ts.yaml}"
export KUBECONFIG

have() { kubectl -n "$NS" get secret "$1" >/dev/null 2>&1; }
rand() { openssl rand -base64 32 | tr -d '\n/=+'; }

if ! have blak-core; then
  kubectl -n "$NS" create secret generic blak-core \
    --from-literal=postgres-user=blak \
    --from-literal=postgres-password="$(rand)" \
    --from-literal=minio-root-user=blak \
    --from-literal=minio-root-password="$(rand)" \
    --from-literal=meili-master-key="$(rand)"
fi
if ! have blak-portal; then
  kubectl -n "$NS" create secret generic blak-portal \
    --from-literal=oidc-secret="$(rand)" \
    --from-literal=session-secret="$(rand)"
fi
if ! have blak-idp; then
  kubectl -n "$NS" create secret generic blak-idp \
    --from-literal=secret-key="$(rand)" \
    --from-literal=bootstrap-password="$(rand)" \
    --from-literal=bootstrap-email=admin@blak.local
fi
if ! have blak-sites; then
  kubectl -n "$NS" create secret generic blak-sites \
    --from-literal=secret-key="$(rand)" \
    --from-literal=utils-secret="$(rand)" \
    --from-literal=oidc-secret="$(rand)"
fi
if ! have blak-projects; then
  kubectl -n "$NS" create secret generic blak-projects \
    --from-literal=secret-key-base="$(rand)" \
    --from-literal=oidc-secret="$(rand)"
fi
if ! have blak-hermes; then
  kubectl -n "$NS" create secret generic blak-hermes \
    --from-literal=oidc-secret="$(rand)"
fi
if ! have blak-drive; then
  kubectl -n "$NS" create secret generic blak-drive \
    --from-literal=admin-password="$(rand)"
fi
if ! have blak-docs; then
  kubectl -n "$NS" create secret generic blak-docs \
    --from-literal=admin-password="$(rand)"
fi
echo "ensure-secrets: existing secrets left untouched; missing ones created in $NS"
