#!/usr/bin/env bash
set -euo pipefail
: "${BB_VERIFY_ROOT:?}" "${RUNNER_TEMP:?}" "${VERIFY_OUT:?}" "${GITHUB_WORKSPACE:?}"
ADAPTER=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$VERIFY_OUT"
PROMPT="$RUNNER_TEMP/codex-verify-prompt.md"
cat "$ADAPTER/legacy-prompts.md" "$GITHUB_WORKSPACE/task-prompt.md" > "$PROMPT"
if grep -qE '^[[:space:]]*PRE-FAIL:' "$GITHUB_WORKSPACE/task-prompt.md"; then
  { printf 'VERDICT: FAIL\n'; cat "$GITHUB_WORKSPACE/task-prompt.md"; } > "$VERIFY_OUT/report.md"
  printf 'VERDICT: FAIL\n' > "$VERIFY_OUT/verdict.txt"
  exit 1
fi
python3 "$ADAPTER/extension.py" >> "$PROMPT"
# Exact legacy config step, executed by the host because it has no MCP tool.
if python3 -c 'import json,os; from pathlib import Path; exit(0 if json.loads((Path(os.environ["RUNNER_TEMP"])/"verification-extension.json").read_text())["childPlans"] else 1)'; then
  set +e
  (cd "$BB_VERIFY_ROOT" && nix develop -c bbdev config --install) > "$RUNNER_TEMP/config-install.log" 2>&1
  CONFIG_RC=$?
  set -e
  python3 - "$CONFIG_RC" <<'PYCONFIG'
import json,sys,os,datetime
from pathlib import Path
(Path(os.environ['RUNNER_TEMP'])/'config-install-execution.json').write_text(json.dumps({'exitCode':int(sys.argv[1]),'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':'nix develop -c bbdev config --install'})+'\n')
PYCONFIG
  if [ "$CONFIG_RC" -ne 0 ]; then printf 'VERDICT: FAIL\n' > "$VERIFY_OUT/verdict.txt"; cp "$RUNNER_TEMP/config-install.log" "$VERIFY_OUT/report.md"; exit 1; fi
fi
cat >> "$PROMPT" <<EOF

# Authorized Codex adapter (legacy verification role)
Use the old deterministic verdict block and old buckyball_bbdev_plan. This adapter uses the official bbdev MCP execution tools in place of the DSH submit/status/cancel wrapper. Config install is the sole CLI operation allowed; other build/simulation operations use bbdev MCP. Keep each trace_id in this same service instance and poll to an actual terminal result. Translate each unchanged planned command to its matching bbdev MCP tool; if no exact equivalent exists, report INFRA instead of inventing a command. The legacy event guidance above is supplied statically because Codex has no DSH inbox event router. Treat event sections as conditional on actual tool results.
The explicit [ball-subphase-extension] block adds independent old Ball child plans while retaining the original chip effective stage and all five blocks. Execute every listed child plan; config install has already run with host evidence. Before RTL execute the listed c-bemu prerequisite. Ordinary positive stems must succeed. Separately execute each expectedFailures binary on its declared backend and call buckyball_expected_failure_check(case_id,trace_id); only that exact terminal simulation failure and panic/assert match satisfies a negative. Unsupported scope/missing evidence is INFRA. Execute each compilerExpectedFailures fixture via buckyball_compiler_expected_failure_check(case_id); its host-verified nonzero compiler exit plus exact diagnostic is required. If cApiCompilerCheck is explicitly present, call buckyball_c_api_compiler_check after real config/compiler/workload completion. It generates headers from actual frozen Chip.pb and runs the exact 4-success/48-rejection RISC-V compiler matrix; no replacement macros or geometry are permitted. Missing headers/toolchain/unrelated diagnostics are INFRA. Final report must separate each child phase identity, command and actual terminal result. Top PASS requires original chip gates and all child and negative gates.
Do not edit source, configuration or tracked files. Generated build/log outputs are permitted by the existing legacy CI read-only gate. Do not dispatch, push, consume reset credits or post PR messages. This ref-only channel writes its report through the final answer; the host persists it. Final answer first line must be VERDICT: PASS or VERDICT: FAIL and include head sha: ${RESOLVED_SHA:?}, actual model/provider, UTC times, command/tool identities and terminal exit codes. Never claim formal PASS from tool acceptance or local diagnostics.
EOF
export BB_VERIFY_ROOT
# Use the installed official binary directly; ~/bin/codex is a mutable route wrapper.
if [ -r "$HOME/.codex/codex-remote-proxy-env.sh" ]; then
  . "$HOME/.codex/codex-remote-proxy-env.sh"
fi
unset OPENAI_API_KEY CODEX_API_KEY DEEPSEEK_API_KEY ALL_PROXY all_proxy
set +e
/home/ROXY/.local/bin/codex exec --ignore-user-config -m gpt-6.1-sol -c 'model_provider="openai"' \
  -c 'approval_policy="never"' -s danger-full-access -C "$BB_VERIFY_ROOT" \
  -c "mcp_servers.bbdev.command=\"$ADAPTER/run-bbdev-mcp.sh\"" \
  -c "mcp_servers.bbdev.env.BB_VERIFY_ROOT=\"$BB_VERIFY_ROOT\"" \
  -c "mcp_servers.bbdev.env.RUNNER_TEMP=\"$RUNNER_TEMP\"" \
  -c "mcp_servers.bbdev.env.RESOLVED_SHA=\"$RESOLVED_SHA\"" \
  --json -o "$VERIFY_OUT/report.md" - < "$PROMPT" \
  > "$RUNNER_TEMP/codex-verify-events.jsonl" 2> "$RUNNER_TEMP/codex-verify-stderr.log"
RC=$?
python3 "$ADAPTER/archive-session.py"
IDENTITY_RC=$?
python3 "$ADAPTER/extension.py" --gate > "$RUNNER_TEMP/extension-gate.log" 2>&1
EXTENSION_RC=$?
set -e
if [ "$EXTENSION_RC" -ne 0 ]; then RC=98; fi
if [ "$IDENTITY_RC" -ne 0 ]; then RC=97; fi
# Official CLI auth is inherited; no API key, relay or DeepSeek provider is set.
# Keep CLI exit and verdict distinct, as required by the legacy protocol.
python3 - "$VERIFY_OUT" "$RC" <<'PY'
import sys,json,datetime,os
from pathlib import Path
out=Path(sys.argv[1]); rc=int(sys.argv[2])
p=out/'report.md'; report=p.read_text() if p.exists() else ''
first=report.splitlines()[0] if report else ''
v=first.removeprefix('VERDICT: ') if first.startswith('VERDICT: ') else 'INFRA'
if v not in ('PASS','FAIL') or (v=='PASS' and rc): v='INFRA'
# Optional C API execution has an independently trusted content/infra verdict.
# A missing header/toolchain diagnostic must never be relabelled content FAIL.
audit_path=Path(os.environ['RUNNER_TEMP'])/'codex-bbdev-audit.jsonl'
if audit_path.is_file():
    capi=[json.loads(line)['result'] for line in audit_path.read_text().splitlines() if json.loads(line).get('event')=='c-api-compiler-check']
    if capi and capi[-1].get('verdict') in ('FAIL','INFRA'):
        v=capi[-1]['verdict']
(out/'verdict.txt').write_text('VERDICT: '+v+'\n')
(out/'codex-execution.json').write_text(json.dumps({'requestedModel':'gpt-6.1-sol','requestedProvider':'openai','exitCode':rc,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'verdict':v},indent=2)+'\n')
sys.exit(0 if v=='PASS' else 1)
PY
