#!/bin/bash
# Build release tarballs for the AWS server (run in WSL, from anywhere).
#   pack-release.sh ulink-api | ulink-console | both
# Output: ulink-admin/release/<api|console>/<app>_<YYYYMMDD-HHMM>_<commit>.tar.gz (git-ignored) — then upload.
# ulink-api = committed code only (git archive: no .env, node_modules, data/, logs).
set -euo pipefail
cd "$(dirname "$0")/../.."                       # ulink-admin
OUT=${OUT:-$PWD/release}; mkdir -p "$OUT/api" "$OUT/console"
TS=$(date +%Y%m%d-%H%M)
REV=$(git rev-parse --short HEAD)

if [ -n "$(git status --porcelain -- src/)" ] && [ "${ALLOW_DIRTY:-}" != 1 ]; then
  echo "Uncommitted changes in src/ — commit first so the release matches commit $REV (or ALLOW_DIRTY=1)."
  exit 1
fi

pack_api() {
  local f=$OUT/api/ulink-api_${TS}_${REV}.tar.gz
  git archive --format=tar.gz -o "$f" HEAD:src/ulink-api
  echo "$f"
}

pack_console() {
  local f=$OUT/console/ulink-console_${TS}_${REV}.tar.gz
  (cd src/ulink-console && VITE_API_BASE_URL= npm run build >&2 && tar czf "$f" -C dist .)
  echo "$f"
}

case ${1:-} in
  ulink-api)     pack_api ;;
  ulink-console) pack_console ;;
  both)          pack_api; pack_console ;;
  *) echo "usage: $0 ulink-api|ulink-console|both"; exit 1 ;;
esac
echo "Upload (WinSCP as admin) to /home/ulinkai/upload/, then on the server as ulinkai: ~/bin/ulink-deploy-console|ulink-deploy-api ~/upload/<file>" >&2
