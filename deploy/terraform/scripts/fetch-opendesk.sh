#!/usr/bin/env bash
# Clone pinned openDesk. Does not apply helmfile.
set -euo pipefail
PIN_TAG="v1.18.2"
PIN_COMMIT="eab2ee774187308f82307f0daaf1471dfe560f34"
DEST="${1:-.cache/opendesk}"
GIT_URL="https://gitlab.opencode.de/bmi/opendesk/deployment/opendesk.git"
mkdir -p "$(dirname "$DEST")"
if [ ! -d "${DEST}/.git" ]; then
  git clone --branch "$PIN_TAG" --depth 1 "$GIT_URL" "$DEST"
fi
cd "$DEST"
HEAD="$(git rev-parse HEAD)"
if [ "$HEAD" != "$PIN_COMMIT" ]; then
  echo "WARNING: checkout HEAD ${HEAD} != pin ${PIN_COMMIT}. Tag ${PIN_TAG} may have moved; use the commit pin." >&2
fi
echo "$DEST"
