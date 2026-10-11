"""Bound model-facing diagnostics while preserving the complete native response."""

import copy
import hashlib
import json
import re
from pathlib import Path

LIMIT = 8192
DIAGNOSTIC_KEYS = {"error", "log", "logs", "server_log", "stdout", "stderr", "log_tail"}


def model_status(native, evidence_dir):
    raw = (json.dumps(native, ensure_ascii=False) + "\n").encode()
    digest = hashlib.sha256(raw).hexdigest()
    path = Path(evidence_dir).resolve() / "native-status" / (digest + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(raw)
    view = copy.deepcopy(native)
    shortened = []

    def visit(value, fields=()):
        if not isinstance(value, dict):
            return
        for key, item in value.items():
            route = fields + (key,)
            if isinstance(item, dict):
                visit(item, route)
            elif key in DIAGNOSTIC_KEYS and isinstance(item, str) and len(item) > LIMIT:
                lines = item.splitlines()
                first_error = next(
                    (
                        line[:1024]
                        for line in lines
                        if re.search(r"error:|fatal error:", line)
                    ),
                    "",
                )
                if not first_error:
                    first_error = next(
                        (
                            line[:1024]
                            for line in lines
                            if re.search(r"FAILED:|command failed", line)
                        ),
                        "",
                    )
                value[key] = (
                    item[:3072]
                    + "\n[diagnostic truncated; complete native response archived]\n"
                    + first_error
                    + "\n"
                    + item[-3072:]
                )
                shortened.append(
                    {
                        "field": list(route),
                        "originalCharacters": len(item),
                        "firstError": first_error,
                    }
                )

    visit(view)
    if shortened:
        view["adapter_diagnostic_evidence"] = {
            "path": str(path),
            "sha256": digest,
            "encoding": "utf-8 JSON",
            "shortened": shortened,
        }
    return view
