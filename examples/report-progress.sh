#!/usr/bin/env bash
# Report a progress row to claude-statuspane from any shell script.
#   report-progress.sh <id> <label> <percent> [text] [ttl-seconds]
# The row disappears on its own once nothing refreshes it for ttl seconds (default 300).
set -euo pipefail
id=$1 label=$2 percent=$3 text=${4:-} ttl=${5:-300}
dir=${STATUSPANE_PROGRESS_DIR:-$HOME/.claude/statuspane/progress}
mkdir -p "$dir"
tmp=$(mktemp "$dir/.$id.XXXXXX")
python3 -c 'import json,sys; print(json.dumps({"label": sys.argv[1], "percent": float(sys.argv[2]), "text": sys.argv[3], "ttl": int(sys.argv[4])}))' \
  "$label" "$percent" "$text" "$ttl" > "$tmp"
mv "$tmp" "$dir/$id.json"   # atomic: the card never reads half a file
