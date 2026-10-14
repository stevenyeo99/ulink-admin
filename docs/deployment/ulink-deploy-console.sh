#!/bin/bash
# Install a ulink-console release into one environment. Lives at /home/ulinkai/bin/ulink-deploy-console, run as ulinkai.
#   ~/bin/ulink-deploy-console uat ~/upload/ulink-console_20261014-0928_7a479f0.tar.gz   # new release
#   ~/bin/ulink-deploy-console uat ulink-console_20261012-0900_9f3c2aa.tar.gz            # rollback: a name in releases/
# Appends one line to /home/ulinkai/<env>/releases/ulink-deploy.log: OK, or FAILED at <step>.
set -Eeuo pipefail
APP=ulink-console
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

STEP=start; SHA=-
log() { printf '%s | %-18s | %s | sha256 %s | by %s | %s\n' "$(date '+%F %T')" "$ENV/$APP" "$F" "$SHA" "$WHO" "$1" >> "$LOG"; }
trap 'log "FAILED at $STEP"; echo "FAILED at $STEP — logged to $LOG" >&2' ERR

if [ ! -e "$REL/$F" ]; then
  STEP=copy; cp "$SRC" "$REL/$F"
  rm -f "$SRC" 2>/dev/null || true               # /tmp file uploaded by another user: sticky bit may refuse
fi
touch "$REL/$F"   # newest = deployed, so prune never drops it
SHA=$(sha256sum "$REL/$F" | cut -c1-12)

STEP=extract; rm -rf "$BASE/ulink-console/dist/"* && tar xzf "$REL/$F" -C "$BASE/ulink-console/dist"

STEP=prune; ls -t "$REL/${APP}"_*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm
log OK
echo "OK — $APP $F"
