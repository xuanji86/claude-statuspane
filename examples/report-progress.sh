#!/usr/bin/env bash
# Report a progress row to claude-statuspane from any shell script.
#   report-progress.sh <id> <label> [percent] [text] [ttl-seconds]
# The row disappears on its own once nothing refreshes it for ttl seconds (default 300).
# Needs python3; the work (checks, atomic write, cleanup on failure) is done by report_progress.py.
set -euo pipefail
exec python3 "$(cd "$(dirname "$0")" && pwd)/report_progress.py" "$@"
