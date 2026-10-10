#!/usr/bin/env python3
import json, os, sys, shutil
from pathlib import Path

runner = Path(os.environ["RUNNER_TEMP"])
dest = runner / "codex-session-evidence"
dest.mkdir(exist_ok=True)
events = []
for line in (runner / "codex-verify-events.jsonl").read_text().splitlines():
    try:
        events.append(json.loads(line))
    except ValueError:
        pass
ids = {e.get("thread_id") for e in events if e.get("thread_id")}
root = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "sessions"
binary_path = runner / "codex-binary.json"
binary = json.loads(binary_path.read_text()) if binary_path.is_file() else {}
versions = set()
models = set()
providers = set()
files = []
usages = []
for p in root.rglob("*.jsonl"):
    try:
        with p.open() as f:
            first = json.loads(next(f))
        if first.get("payload", {}).get("id") not in ids:
            continue
        shutil.copy2(p, dest / p.name)
        files.append(p.name)
        for line in p.read_text().splitlines():
            o = json.loads(line)
            payload = o.get("payload", {})
            if o.get("type") == "session_meta" and payload.get("cli_version"):
                versions.add(payload["cli_version"])
            if o.get("type") == "session_meta" and payload.get("model_provider"):
                providers.add(payload["model_provider"])
            if o.get("type") == "turn_context" and payload.get("model"):
                models.add(payload["model"])
            if o.get("type") == "event_msg" and payload.get("type") == "token_count":
                usages.append(payload)
    except (OSError, ValueError, StopIteration):
        continue
metadata = {
    "sessionIds": sorted(ids),
    "binary": binary,
    "actualCliVersions": sorted(versions),
    "actualModels": sorted(models),
    "actualProviders": sorted(providers),
    "sessionFiles": files,
    "rawUsageSnapshots": usages,
    "usageNote": "cumulative snapshots; do not sum; deduplicate by session/request",
}
(dest / "identity-usage.json").write_text(json.dumps(metadata, indent=2) + "\n")
c_api = runner / "c-api-compiler-check"
if c_api.is_dir():
    shutil.copytree(c_api, dest / "c-api-compiler-check", dirs_exist_ok=True)
if binary_path.is_file():
    shutil.copy2(binary_path, dest / binary_path.name)
sys.exit(
    0
    if models == {"gpt-6.1-sol"}
    and providers == {"openai"}
    and binary.get("accepted") is True
    and versions == {binary.get("version")}
    else 1
)

# C API matrix is optional and source-frozen; archive when explicitly executed.
