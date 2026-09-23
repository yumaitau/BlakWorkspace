#!/usr/bin/env bash
# Build the pinned Rocket.Chat release with the Blak role patch and import it
# into the local k3s store. Run this on the homelab. From another machine:
#   BLAK_BUILD_HOST=user@homelab scripts/deploy/build-chat.sh
# Pass --roll to point the chat deployment at the new image without changing
# its public URL or other settings.
set -euo pipefail
cd "$(dirname "$0")/../.."
version=$(sed -n 's/^ARG ROCKET_CHAT_VERSION=//p' services/chat/Dockerfile)
test -n "$version"
tag="blak-chat:${version}-blak1"
host="${BLAK_BUILD_HOST:-}"

build() {
  docker build -t "$tag" services/chat
  if command -v k3s >/dev/null 2>&1; then
    docker save "$tag" | sudo k3s ctr -n k8s.io images import -
  fi
}

if [[ -n "$host" ]]; then
  rsync -a --delete services/chat/ "$host:/tmp/blak-chat-src/"
  ssh "$host" "cd /tmp/blak-chat-src && docker build -t '$tag' . && docker save '$tag' | sudo k3s ctr -n k8s.io images import -"
else
  build
fi

if [[ "${1:-}" == "--roll" ]]; then
  kubectl -n "${NS:-blak-micro}" set image deploy/chat "rocketchat=docker.io/library/${tag}"
  kubectl -n "${NS:-blak-micro}" rollout status deploy/chat --timeout=300s
fi
printf 'Built %s\n' "$tag"
