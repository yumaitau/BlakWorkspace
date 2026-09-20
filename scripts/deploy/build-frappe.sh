#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
source services/frappe/versions.env
if ! docker image inspect "$FRAPPE_BASE_IMAGE" >/dev/null 2>&1; then
  BUILD=$(mktemp -d)
  trap 'rm -rf "$BUILD"' EXIT
  git clone https://github.com/frappe/frappe_docker "$BUILD"
  git -C "$BUILD" checkout "$FRAPPE_DOCKER_REVISION"
  printf '[{"url":"https://github.com/frappe/crm","branch":"%s"}]' "$CRM_VERSION" > "$BUILD/apps.json"
  docker build --build-arg "FRAPPE_BRANCH=$FRAPPE_VERSION" \
    --build-arg PYTHON_VERSION=3.11 --build-arg NODE_VERSION=22 \
    --build-arg INSTALL_CHROMIUM=false --secret "id=apps_json,src=$BUILD/apps.json" \
    -t "$FRAPPE_BASE_IMAGE" -f "$BUILD/images/custom/Containerfile" "$BUILD"
fi
docker build --build-arg "BASE_IMAGE=$FRAPPE_BASE_IMAGE" -t "$FRAPPE_IMAGE" services/frappe
docker save "$FRAPPE_IMAGE" | sudo k3s ctr images import -
