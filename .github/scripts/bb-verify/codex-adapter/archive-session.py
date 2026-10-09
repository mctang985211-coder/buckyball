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
    "actualModels": sorted(models),
    "actualProviders": sorted(providers),
    "sessionFiles": files,
    "rawUsageSnapshots": usages,
    "usageNote": "cumulative snapshots; do not sum; deduplicate by session/request",
}
(dest / "identity-usage.json").write_text(json.dumps(metadata, indent=2) + "\n")
sys.exit(0 if models == {"gpt-6.1-sol"} and providers == {"openai"} else 1)
