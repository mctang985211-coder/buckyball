#!/usr/bin/env bash
set -euo pipefail
: "${BB_VERIFY_ROOT:?}" "${RUNNER_TEMP:?}"
ADAPTER=$(cd "$(dirname "$0")" && pwd)
cd "$BB_VERIFY_ROOT"
export NIX_QUIET=1
mkdir -p "$RUNNER_TEMP/codex-session-evidence/mcp-startup"
exec /nix/var/nix/profiles/default/bin/nix develop "$BB_VERIFY_ROOT" -c python3 -u "$ADAPTER/bbdev-mcp.py" \
  2> >(tee -a "$RUNNER_TEMP/codex-session-evidence/mcp-startup/service.stderr.log" >&2)
