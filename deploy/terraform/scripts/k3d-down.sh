#!/usr/bin/env bash
set -euo pipefail
NAME="${CLUSTER_NAME:-blak-eval}"
if command -v k3d >/dev/null 2>&1 && k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx "$NAME"; then
  k3d cluster delete "$NAME"
fi
