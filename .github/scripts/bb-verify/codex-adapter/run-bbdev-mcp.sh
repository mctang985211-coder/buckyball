#!/usr/bin/env bash
set -euo pipefail
: "${BB_VERIFY_ROOT:?}"
ADAPTER=$(cd "$(dirname "$0")" && pwd)
cd "$BB_VERIFY_ROOT"
export NIX_QUIET=1
exec /nix/var/nix/profiles/default/bin/nix develop "$BB_VERIFY_ROOT" -c python3 -u "$ADAPTER/bbdev-mcp.py"
