#!/usr/bin/env python3
"""Explicit child-role/negative extension; never changes legacy five verdict blocks."""

import json, re, os, sys, subprocess, shlex
from pathlib import Path

adapter = Path(__file__).parent
runner = Path(os.environ["RUNNER_TEMP"])
repo = Path(os.environ["BB_VERIFY_ROOT"])
context = json.loads(
    (Path(os.environ["GITHUB_WORKSPACE"]) / "context.json").read_text()
)
body = context.get("body", "")
blocks = re.findall(r"```legacy-verification-extension\s*\n(.*?)\n```", body, re.S)
if len(blocks) > 1:
    raise ValueError("multiple extension blocks")
ext = (
    json.loads(blocks[0])
    if blocks
    else {"version": 1, "ballSubphase": None, "expectedFailures": []}
)
if (
    set(ext)
    - {"version", "ballSubphase", "expectedFailures", "compilerExpectedFailures"}
    or ext.get("version") != 1
):
    raise ValueError("unsupported extension")
child = ext.get("ballSubphase")
negatives = ext.get("expectedFailures", [])
plans = []
if child:
    if (
        set(child) != {"ball", "phase", "chip", "stems"}
        or child["ball"] != "ClampBall"
        or child["chip"] != "legacy_clamp_v1"
        or child["phase"] not in ("c-bemu", "rtl")
        or not child["stems"]
    ):
        raise ValueError("unsupported child role")
    stage = re.search(r"^\s*stage:\s*(\S+)", body, re.M)
    phase = re.search(r"^\s*phase:\s*(\S+)", body, re.M)
    if (
        not stage
        or stage[1] != "chip"
        or not phase
        or phase[1] != ("skeleton" if child["phase"] == "c-bemu" else "slices")
    ):
        raise ValueError("child requires true chip skeleton/c-bemu or slices/rtl round")
    # Always supplement c-bemu before RTL; this is stricter than trusting an absent prior report.
    for subphase in (["c-bemu", "rtl"] if child["phase"] == "rtl" else ["c-bemu"]):
        inp = {
            "stage": "ball",
            "phase": subphase,
            "chip": child["chip"],
            "stems": child["stems"],
            "layer": os.environ.get("LAYER", "merge"),
            "compilerTouched": True,
        }
        result = subprocess.run(
            ["node", str(adapter / "legacy-plan.ts"), json.dumps(inp), str(repo)],
            capture_output=True,
            text=True,
            check=True,
        )
        plans.append({"identity": inp, "plan": json.loads(result.stdout)})
for case in negatives:
    if (
        set(case) != {"id", "backend", "chip", "binary", "expectedPattern"}
        or case["backend"] not in ("bemu", "rtl")
        or case["chip"] != "legacy_clamp_v1"
        or not case["binary"].startswith("legacy_clamp_v1-")
        or not case["expectedPattern"].startswith("clamp: ")
    ):
        raise ValueError("unsupported expected failure declaration")
    if child and case["binary"] in child["stems"]:
        raise ValueError("negative binary cannot be in pass-required stems")
    re.compile(case["expectedPattern"])
compiler_cases = ext.get("compilerExpectedFailures", [])
for case in compiler_cases:
    if (
        set(case) != {"id", "fixture", "expectedPattern"}
        or not re.fullmatch(
            r"examples/balls/clamp/compiler/tests/invalid_[a-z_]+\.mlir",
            case["fixture"],
        )
        or not case["expectedPattern"].startswith("Clamp ")
    ):
        raise ValueError("unsupported compiler rejection fixture")
    if not (repo / case["fixture"]).is_file():
        raise ValueError("compiler rejection fixture missing")
    re.compile(case["expectedPattern"])

top_plans = []
if child:
    injected = (runner / "infer-stage.out").read_text()
    if not re.search(r"^\s*effective:\s*chip\s*$", injected, re.M):
        raise ValueError(
            "extension requires the original injected effective chip stage"
        )
    top_input = {
        "stage": "chip",
        "phase": phase[1],
        "chip": child["chip"],
        "stems": child["stems"],
        "layer": os.environ.get("LAYER", "merge"),
        "compilerTouched": True,
    }
    top_result = subprocess.run(
        ["node", str(adapter / "legacy-plan.ts"), json.dumps(top_input), str(repo)],
        capture_output=True,
        text=True,
        check=True,
    )
    top_plans.append({"identity": top_input, "plan": json.loads(top_result.stdout)})
prepared = {"extension": ext, "topPlans": top_plans, "childPlans": plans}
(runner / "verification-extension.json").write_text(
    json.dumps(prepared, indent=2) + "\n"
)
if len(sys.argv) > 1 and sys.argv[1] == "--gate":
    audit = (
        [
            json.loads(x)
            for x in (runner / "codex-bbdev-audit.jsonl").read_text().splitlines()
        ]
        if (runner / "codex-bbdev-audit.jsonl").exists()
        else []
    )
    submits = {
        x["result"].get("trace_id"): x
        for x in audit
        if x["event"] == "submit" and x["result"].get("trace_id")
    }
    terminals = {
        x["trace_id"]: x["result"]
        for x in audit
        if x["event"] == "status" and not x["result"].get("processing", True)
    }
    for plan in top_plans + plans:
        preceding_terminal_index = -1
        for step in plan["plan"]["steps"]:
            if step["command"] == "config":
                proof = json.loads(
                    (runner / "config-install-execution.json").read_text()
                )
                assert proof["exitCode"] == 0
                continue
            endpoint = (
                "/"
                + step["command"].replace("bebop-", "bebop/").replace("-", "/")
                + "/"
                + step["operation"]
            )
            args = shlex.split(step["args"])
            required = {}
            i = 0
            while i < len(args):
                key = args[i].removeprefix("--")
                i += 1
                value = True
                if i < len(args) and not args[i].startswith("--"):
                    value = args[i]
                    i += 1
                required[key] = value
            good = False
            for trace, submit in submits.items():
                submit_index = audit.index(submit)
                terminal_indices = [
                    j
                    for j, row in enumerate(audit)
                    if row["event"] == "status"
                    and row.get("trace_id") == trace
                    and not row["result"].get("processing", True)
                ]
                terminal_index = terminal_indices[-1] if terminal_indices else -1
                actual = submit["params"]
                terminal = terminals.get(trace, {})
                if (
                    submit_index > preceding_terminal_index
                    and terminal_index > submit_index
                    and submit["endpoint"] == endpoint
                    and all(str(actual.get(k)) == str(v) for k, v in required.items())
                    and terminal.get("success") is True
                    and terminal.get("returncode", 0) == 0
                ):
                    good = True
                    preceding_terminal_index = terminal_index
                    break
            assert good, f"missing actual successful child gate: {step}"
    for case in negatives:
        assert any(
            x["event"] == "expected-failure"
            and x["case"]["id"] == case["id"]
            and x["result"]["matched"] is True
            for x in audit
        ), ("negative missing/mismatched: " + case["id"])
    for case in compiler_cases:
        assert any(
            x["event"] == "compiler-expected-failure"
            and x["case"]["id"] == case["id"]
            and x["result"]["matched"] is True
            for x in audit
        ), ("compiler negative missing/mismatched: " + case["id"])
    print("explicit child/negative/compiler gates satisfied")
else:
    print("[ball-subphase-extension]\n" + json.dumps(prepared, indent=2))
