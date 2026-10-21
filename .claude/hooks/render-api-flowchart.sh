#!/usr/bin/env bash
# Renders docs/system/flowchart/API_CASE_FLOWCHART.svg from the Mermaid block in docs/system/flowchart/API_CASE_FLOWCHART.md.
# Claude Code runs it after every Write/Edit (PostToolUse hook in .claude/settings.json): the hook JSON comes on stdin,
# and anything but the flowchart file is ignored. By hand: .claude/hooks/render-api-flowchart.sh --all
# Needs mmdc (npm i -g @mermaid-js/mermaid-cli) and a Chromium it can start.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MD="$ROOT/docs/system/flowchart/API_CASE_FLOWCHART.md"
SVG="$ROOT/docs/system/flowchart/API_CASE_FLOWCHART.svg"

if [ "${1:-}" != "--all" ]; then
  edited="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("tool_input") or {}).get("file_path",""))' 2>/dev/null || true)"
  case "$edited" in
    */docs/system/flowchart/API_CASE_FLOWCHART.md) ;;
    *) exit 0 ;;
  esac
fi

# mmdc lives with the nvm Node; a hook shell may not have it on PATH.
if ! command -v mmdc >/dev/null 2>&1; then
  for bin in "$HOME"/.nvm/versions/node/*/bin; do PATH="$bin:$PATH"; done
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
awk '/^```mermaid$/{f=1;next} /^```$/{f=0} f' "$MD" > "$tmp/flow.mmd"
if [ ! -s "$tmp/flow.mmd" ]; then
  echo "render-api-flowchart: no mermaid block in $MD" >&2
  exit 1
fi
mmdc -q -i "$tmp/flow.mmd" -o "$tmp/flow.svg" -b white
mv "$tmp/flow.svg" "$SVG"
echo '{"systemMessage": "docs/system/flowchart/API_CASE_FLOWCHART.svg rendered"}'
