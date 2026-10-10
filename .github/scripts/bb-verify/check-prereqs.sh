#!/usr/bin/env bash
# Fail-fast prerequisite probe, before any heavy work: toolchain on PATH,
# local checkouts and one-time bootstrap artifacts present, secret configured,
# optional LLM relay reachable.
set -euo pipefail

for tool in nix gh pnpm node; do
  command -v "$tool" >/dev/null || { echo "::error::$tool not on PATH"; exit 1; }
done
# Record which node/pnpm the job actually resolves — PATH-order bugs here have
# burned us (bare `pnpm dsh` breaks on the flake node; the runner PATH must
# hit ~/.local/bin/node instead).
echo "node at $(command -v node): $(node --version)"
echo "pnpm at $(command -v pnpm): $(pnpm --version)"

for path in \
  "$DSH_DIR" \
  "$CODEX_VERIFY_ADAPTER/run-codex-verify.sh" \
  "$BB_VERIFY_ROOT/.git" \
  "$BB_VERIFY_ROOT/bbdev/api/.venv/bin/motia" \
  "$BB_VERIFY_ROOT/bebop/src/nodes/bemu/native/spike/configure.ac" ; do
  [ -e "$path" ] || {
    echo "::error::missing local path: $path"
    echo "::error::persistent root not bootstrapped or one-time artifacts missing -- run bootstrap-persistent-root.sh once on this host"
    exit 1; }
done

: "${BB_VERIFY_CODEX_BIN:?isolated official Codex verifier path required}"
[ -x "$BB_VERIFY_CODEX_BIN" ] || { echo "::error::Codex verifier binary unavailable"; exit 1; }
[ -x "$(dirname "$BB_VERIFY_CODEX_BIN")/codex-code-mode-host" ] || {
  echo "::error::matching official Codex code-mode host unavailable"; exit 1;
}
"$BB_VERIFY_CODEX_BIN" --version
"$BB_VERIFY_CODEX_BIN" login status
