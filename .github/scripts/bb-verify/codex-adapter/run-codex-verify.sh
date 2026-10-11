#!/usr/bin/env bash
set -euo pipefail
: "${BB_VERIFY_ROOT:?}" "${RUNNER_TEMP:?}" "${VERIFY_OUT:?}" "${GITHUB_WORKSPACE:?}"
ADAPTER=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$VERIFY_OUT"
# These generated outputs belong only to the current invocation.
# Prior round evidence is archived independently before another dispatch.
rm -f -- "$VERIFY_OUT/report.md" "$VERIFY_OUT/codex-final.md" \
  "$VERIFY_OUT/verdict.txt" "$VERIFY_OUT/codex-execution.json"
# Fail closed before config/build work if the explicitly authorized CLI is unavailable.
if ! python3 - <<'PYBINARY'
import os,json,subprocess,hashlib,datetime,re
from pathlib import Path
raw=os.environ.get('BB_VERIFY_CODEX_BIN','')
record={'configuredPath':raw,'time':datetime.datetime.now(datetime.timezone.utc).isoformat()}
try:
    binary=Path(raw)
    if not raw or not binary.is_absolute() or not binary.is_file() or not os.access(binary,os.X_OK):
        raise RuntimeError('BB_VERIFY_CODEX_BIN must name an executable absolute official CLI path')
    version=subprocess.run([str(binary),'--version'],capture_output=True,text=True,timeout=30)
    record.update(resolvedPath=str(binary.resolve()),sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),versionExitCode=version.returncode,versionOutput=version.stdout.strip(),versionStderr=version.stderr)
    match=re.search(r'codex-cli (\S+)',version.stdout)
    if version.returncode or not match:
        raise RuntimeError('official Codex CLI version probe failed')
    record['version']=match[1]
    record['accepted']=True
except Exception as error:
    record.update(accepted=False,error=str(error))
finally:
    (Path(os.environ['RUNNER_TEMP'])/'codex-binary.json').write_text(json.dumps(record,indent=2)+'\n')
if not record['accepted']:
    raise SystemExit(1)
PYBINARY
then
  printf 'VERDICT: INFRA\n' > "$VERIFY_OUT/verdict.txt"
  exit 1
fi
# Prove the real service catalog before starting a quota-consuming model session.
if ! python3 "$ADAPTER/check-mcp-startup.py" > "$RUNNER_TEMP/mcp-startup-preflight.log" 2>&1; then
  printf 'VERDICT: INFRA\n' > "$VERIFY_OUT/verdict.txt"
  printf 'VERDICT: INFRA\nhead sha: %s\nRequired MCP capability preflight failed; raw startup evidence: %s/codex-session-evidence/mcp-startup/preflight.json\n' "$RESOLVED_SHA" "$RUNNER_TEMP" > "$VERIFY_OUT/report.md"
  exit 1
fi
PROMPT="$RUNNER_TEMP/codex-verify-prompt.md"
cat "$ADAPTER/legacy-prompts.md" "$GITHUB_WORKSPACE/task-prompt.md" "$ADAPTER/knowledge-fallback.md" "$ADAPTER/evidence-output-guidance.md" > "$PROMPT"
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
Do not edit source, configuration or tracked files. Generated build/log outputs are permitted by the existing legacy CI read-only gate. Do not dispatch, push, consume reset credits or post PR messages. This ref-only channel writes its report through the final answer; the host persists it. Final answer first line must be VERDICT: PASS, VERDICT: FAIL, or VERDICT: INFRA and include head sha: ${RESOLVED_SHA:?}, actual model/provider, UTC times, command/tool identities and terminal exit codes. Never claim formal PASS from tool acceptance or local diagnostics.
EOF
export BB_VERIFY_ROOT
# Use the explicitly frozen official binary; never resolve a mutable route wrapper.
if [ -r "$HOME/.codex/codex-remote-proxy-env.sh" ]; then
  . "$HOME/.codex/codex-remote-proxy-env.sh"
fi
unset OPENAI_API_KEY CODEX_API_KEY DEEPSEEK_API_KEY ALL_PROXY all_proxy
set +e
"$BB_VERIFY_CODEX_BIN" exec --ignore-user-config -m gpt-6.1-sol -c 'model_provider="openai"' \
  -c 'approval_policy="never"' -s danger-full-access -C "$BB_VERIFY_ROOT" \
  -c 'mcp_servers.bbdev.required=true' \
  -c 'mcp_servers.bbdev.startup_timeout_sec=60' \
  -c "mcp_servers.bbdev.command=\"$ADAPTER/run-bbdev-mcp.sh\"" \
  -c "mcp_servers.bbdev.env.BB_VERIFY_ROOT=\"$BB_VERIFY_ROOT\"" \
  -c "mcp_servers.bbdev.env.RUNNER_TEMP=\"$RUNNER_TEMP\"" \
  -c "mcp_servers.bbdev.env.RESOLVED_SHA=\"$RESOLVED_SHA\"" \
  --json -o "$VERIFY_OUT/codex-final.md" - < "$PROMPT" \
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
p=out/'report.md'; final=out/'codex-final.md'
if not p.exists() and final.exists(): p.write_bytes(final.read_bytes())
report=p.read_text() if p.exists() else ''
final_report=final.read_text() if final.exists() else ''
first=report.splitlines()[0] if report else ''
v=first.removeprefix('VERDICT: ') if first.startswith('VERDICT: ') else 'INFRA'
final_first=final_report.splitlines()[0] if final_report else ''
report_conflict=bool(report and final_report and first != final_first)
if report_conflict: v='INFRA'
if v not in ('PASS','FAIL','INFRA') or (v=='PASS' and rc) or rc==97: v='INFRA'
# Optional C API execution has an independently trusted content/infra verdict.
# A missing header/toolchain diagnostic must never be relabelled content FAIL.
audit_path=Path(os.environ['RUNNER_TEMP'])/'codex-bbdev-audit.jsonl'
if audit_path.is_file():
    capi=[json.loads(line)['result'] for line in audit_path.read_text().splitlines() if json.loads(line).get('event')=='c-api-compiler-check']
    if capi and capi[-1].get('verdict') in ('FAIL','INFRA'):
        v=capi[-1]['verdict']
if report_conflict or rc==97: v='INFRA'
(out/'verdict.txt').write_text('VERDICT: '+v+'\n')
(out/'codex-execution.json').write_text(json.dumps({'requestedModel':'gpt-6.1-sol','requestedProvider':'openai','exitCode':rc,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'verdict':v,'reportConflict':report_conflict,'finalAnswerFile':'codex-final.md'},indent=2)+'\n')
sys.exit(0 if v=='PASS' else 1)
PY
