#!/usr/bin/env bash
# Renders docs/system/flowchart/<NAME>.svg from the Mermaid block in docs/system/flowchart/<NAME>.md, for the API and the
# email case flowcharts (API_CASE_FLOWCHART, EMAIL_CASE_FLOWCHART).
# Claude Code runs it after every Write/Edit (PostToolUse hook in .claude/settings.json): the hook JSON comes on stdin,
# and anything but a flowchart file is ignored. By hand: .claude/hooks/render-api-flowchart.sh --all (both charts).
# Needs mmdc (npm i -g @mermaid-js/mermaid-cli) and a Chromium it can start.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/docs/system/flowchart"
CHARTS="API_CASE_FLOWCHART EMAIL_CASE_FLOWCHART"

if [ "${1:-}" = "--all" ]; then
  names="$CHARTS"
else
  edited="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("tool_input") or {}).get("file_path",""))' 2>/dev/null || true)"
  case "$edited" in
    */docs/system/flowchart/API_CASE_FLOWCHART.md) names="API_CASE_FLOWCHART" ;;
    */docs/system/flowchart/EMAIL_CASE_FLOWCHART.md) names="EMAIL_CASE_FLOWCHART" ;;
    *) exit 0 ;;
  esac
fi

# mmdc lives with the nvm Node; a hook shell may not have it on PATH.
if ! command -v mmdc >/dev/null 2>&1; then
  for bin in "$HOME"/.nvm/versions/node/*/bin; do PATH="$bin:$PATH"; done
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
rendered=""
for name in $names; do
  awk '/^```mermaid$/{f=1;next} /^```$/{f=0} f' "$DIR/$name.md" > "$tmp/$name.mmd"
  if [ ! -s "$tmp/$name.mmd" ]; then
    echo "render-api-flowchart: no mermaid block in $DIR/$name.md" >&2
    exit 1
  fi
  mmdc -q -i "$tmp/$name.mmd" -o "$tmp/$name.svg" -b white
  mv "$tmp/$name.svg" "$DIR/$name.svg"
  rendered="$rendered docs/system/flowchart/$name.svg"
done
echo "{\"systemMessage\": \"rendered:$rendered\"}"
