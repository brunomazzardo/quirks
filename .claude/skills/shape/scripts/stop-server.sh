#!/usr/bin/env bash
# End the shape session on the quirks daemon. Does not kill the daemon.
# Usage: stop-server.sh <session_dir>

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -z "${1:-}" ]]; then
  echo '{"error": "Usage: stop-server.sh <session_dir>"}'
  exit 1
fi

exec node "$SCRIPT_DIR/stop-session.ts" "$1"
