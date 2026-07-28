#!/usr/bin/env bash
# Ensure a shape session on the quirks daemon (QK-COMP-003). No second server.
# Usage: start-server.sh [--project-dir <path>] [--open]
#
# Returns JSON: url, screen_dir, state_dir, session_dir.
# Old flags (--host, --url-host, --foreground, --idle-timeout-minutes) are
# accepted as no-ops so existing skill muscle memory does not break.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/start-session.ts" "$@"
