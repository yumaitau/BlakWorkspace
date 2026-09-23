#!/usr/bin/env bash
# Create missing Opaque secrets in blak-micro. Never prints secret values.
# Does not overwrite existing secrets. Operator-only — not invoked from CI.
set -euo pipefail
NS="${NS:-blak-micro}"
# Uses the explicitly selected kubectl context or KUBECONFIG.

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
if ! have blak-chat; then
  kubectl -n "$NS" create secret generic blak-chat \
    --from-literal=oidc-secret="$(rand)" \
    --from-literal=admin-password="$(rand)"
fi
if ! have blak-kaneo; then
  kubectl -n "$NS" create secret generic blak-kaneo \
    --from-literal=oidc-secret="$(rand)" \
    --from-literal=auth-secret="$(rand)$(rand)"
fi
if ! have blak-hermes; then
  kubectl -n "$NS" create secret generic blak-hermes \
    --from-literal=oidc-secret="$(rand)" \
    --from-literal=session-secret="$(rand)"
fi
if ! have blak-smith; then
  smith_pg="$(rand)"
  smith_app="$(rand)"
  kubectl -n "$NS" create secret generic blak-smith \
    --from-literal=postgres-password="$smith_pg" \
    --from-literal=app-password="$smith_app" \
    --from-literal=database-url="postgres://blaksmith:${smith_pg}@smith-postgres:5432/blaksmith" \
    --from-literal=app-database-url="postgres://blaksmith_app:${smith_app}@smith-postgres:5432/blaksmith" \
    --from-literal=better-auth-secret="$(rand)$(rand)" \
    --from-literal=scim-secret="$(rand)$(rand)" \
    --from-literal=kek="$(rand)$(rand)" \
    --from-literal=organization-id="$(openssl rand -hex 16)" \
    --from-literal=controller-id="blaksmith-controller"
fi
if ! have blak-eyes; then
  kubectl -n "$NS" create secret generic blak-eyes \
    --from-literal=scim-secret="$(rand)$(rand)" \
    --from-literal=organization-id="$(openssl rand -hex 16)"
fi
if ! have blak-file-guard; then
  kubectl -n "$NS" create secret generic blak-file-guard \
    --from-literal=token="$(rand)"
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
