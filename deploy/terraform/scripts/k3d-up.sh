#!/usr/bin/env bash
set -euo pipefail
NAME="${CLUSTER_NAME:-blak-eval}"
if ! command -v k3d >/dev/null 2>&1; then
  echo "k3d is required for target=k3s cluster_create. Install https://k3d.io/" >&2
  exit 1
fi
if k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx "$NAME"; then
  echo "k3d cluster ${NAME} already exists"
else
  k3d cluster create "$NAME" \
    --k3s-arg "--disable=traefik@server:0" \
    --port "80:80@loadbalancer" \
    --port "443:443@loadbalancer" \
    --wait
fi
k3d kubeconfig merge "$NAME" --kubeconfig-switch-context >/dev/null
echo "k3d cluster ${NAME} ready"
