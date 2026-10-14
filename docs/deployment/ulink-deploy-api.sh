#!/bin/bash
# Install a ulink-api release into one environment. Lives at /home/ulinkai/bin/ulink-deploy-api, run as ulinkai
# (in the docker group). Container ulink-api-<env>; port = PORT in <env>/ulink-api/.env (uat 3088, prod 3089).
#   ~/bin/ulink-deploy-api uat ~/upload/ulink-api_20261013-1530_a41af1d.tar.gz      # new release
#   ~/bin/ulink-deploy-api uat ulink-api_20261012-0900_9f3c2aa.tar.gz               # rollback: a name in releases/
#   MIGRATE=1 ~/bin/ulink-deploy-api uat ~/upload/<file>                           # also run db:migrate
# Migrations are NOT run by default (owner's choice 2026-10-14: uat shares the dev database, migrated by hand);
# the deploy only reports how many are pending. Nothing is ever seeded.
# Appends one line to /home/ulinkai/<env>/releases/ulink-deploy.log: OK, or FAILED at <step>.
set -Eeuo pipefail
APP=ulink-api
ENV=${1:-}
case $ENV in uat|prod) ;; *) echo "usage: $0 uat|prod <${APP}_YYYYMMDD-HHMM_commit.tar.gz>"; exit 1 ;; esac
BASE=/home/ulinkai/$ENV
LOG=$BASE/releases/ulink-deploy.log
KEEP=5                                           # tarballs kept

[ "$(id -un)" = ulinkai ] || { echo "run as ulinkai (su - ulinkai)"; exit 1; }
SRC=${2:-}; F=$(basename "$SRC")
[[ $F =~ ^${APP}_[0-9]{8}-[0-9]{4}(_[0-9a-f]+)?\.tar\.gz$ ]] || { echo "usage: $0 $ENV ${APP}_<YYYYMMDD-HHMM>_<commit>.tar.gz"; exit 1; }
REL=$BASE/releases/$APP
WHO=$(logname 2>/dev/null || echo ulinkai)       # the SSH login behind `su - ulinkai`
if [ "$ENV" = prod ]; then read -rp "Deploy $F to PROD? type prod: " OKAY; [ "$OKAY" = prod ] || exit 1; fi
# npm ci / migrate use the same image as this env's running container, so a new runtime image (new Linux library)
# can be tried on uat while prod stays on the old one. Before the container exists: the default image.
# (docker inspect prints an empty line for a missing container, so the fallback replaces its output, not appends)
IMAGE=$(docker inspect -f '{{.Config.Image}}' "ulink-api-$ENV" 2>/dev/null) || IMAGE=ulink-api-runtime:22
in_node() { docker run --rm --user "$(id -u):$(id -g)" --network host -v "$BASE/ulink-api:/app" -w /app -e npm_config_cache=/tmp/.npm "$IMAGE" "$@"; }

STEP=start; SHA=-
log() { printf '%s | %-18s | %s | sha256 %s | by %s | %s\n' "$(date '+%F %T')" "$ENV/$APP" "$F" "$SHA" "$WHO" "$1" >> "$LOG"; }
trap 'log "FAILED at $STEP"; echo "FAILED at $STEP — logged to $LOG" >&2' ERR

[ -f "$BASE/ulink-api/.env" ] || { STEP=no-env; false; }
PORT=$(sed -n 's/^PORT=//p' "$BASE/ulink-api/.env" | tr -d '\r "')
[ -n "$PORT" ] || { STEP=no-port; false; }
if [ ! -e "$REL/$F" ]; then
  STEP=copy; cp "$SRC" "$REL/$F"
  rm -f "$SRC" 2>/dev/null || true               # /tmp file uploaded by another user: sticky bit may refuse
fi
touch "$REL/$F"   # newest = deployed, so prune never drops it
SHA=$(sha256sum "$REL/$F" | cut -c1-12)

# ponytail: extracts over the old code (keeps .env, data/, logs/, node_modules); files deleted upstream linger —
# switch to fresh per-release dirs + symlink if that ever bites.
STEP=extract; tar xzf "$REL/$F" -C "$BASE/ulink-api"
STEP=npm-ci;  in_node npm ci --no-audit --no-fund
if [ "${MIGRATE:-}" = 1 ]; then
  STEP=migrate; in_node npm run db:migrate
else
  STEP=migrate-status; PENDING=$(in_node npx sequelize-cli db:migrate:status 2>/dev/null | grep -c '^down' || true)
  [ "$PENDING" = 0 ] || echo "WARNING: $PENDING migration(s) pending — not run. Migrate first, or rerun with MIGRATE=1." >&2
fi
STEP=restart; docker restart "ulink-api-$ENV" >/dev/null
STEP=health;  curl -sf -o /dev/null --retry 10 --retry-connrefused --retry-delay 2 "http://localhost:$PORT/api/docs"

STEP=prune; ls -t "$REL/${APP}"_*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm
log OK
echo "OK — $APP $F"
