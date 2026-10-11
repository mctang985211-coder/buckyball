#!/usr/bin/env python3
"""Explicit child-role/negative extension; never changes legacy five verdict blocks."""

import json, re, os, sys, subprocess, shlex, importlib.util
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
    - {
        "version",
        "ballSubphase",
        "expectedFailures",
        "compilerExpectedFailures",
        "cApiCompilerCheck",
        "topBackendStems",
    }
    or ext.get("version") != 1
):
    raise ValueError("unsupported extension")
child = ext.get("ballSubphase")
backend_stems = ext.get("topBackendStems")
phase = re.search(r"^\s*phase:\s*(\S+)", body, re.M)
stage = re.search(r"^\s*stage:\s*(\S+)", body, re.M)
backend_spec = importlib.util.spec_from_file_location(
    "backend_stems", adapter / "backend-stems.py"
)
backend_admission = importlib.util.module_from_spec(backend_spec)
backend_spec.loader.exec_module(backend_admission)
backend_admission.admit(child, backend_stems, phase[1] if phase else None, repo)
if backend_stems is not None and (not stage or stage[1] != "chip"):
    raise ValueError("topBackendStems requires chip stage")
negatives = ext.get("expectedFailures", [])
if len({case["id"] for case in negatives}) != len(negatives):
    raise ValueError("duplicate expected failure IDs")
plans = []
if child:
    if (
        (set(child) - {"rtlStems"}) != {"ball", "phase", "chip", "stems"}
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
        or phase[1]
        not in (
            ("skeleton",) if child["phase"] == "c-bemu" else ("slices", "integrate")
        )
    ):
        raise ValueError("child requires true chip skeleton/c-bemu or slices/rtl round")
    # Always supplement c-bemu before RTL; this is stricter than trusting an absent prior report.
    for subphase in (["c-bemu", "rtl"] if child["phase"] == "rtl" else ["c-bemu"]):
        inp = {
            "stage": "ball",
            "phase": subphase,
            "chip": child["chip"],
            "stems": (
                child.get("rtlStems", child["stems"])
                if subphase == "rtl"
                else child["stems"]
            ),
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
    if (child and case["binary"] in child["stems"]) or (
        backend_stems
        and any(case["binary"] in stems for stems in backend_stems.values())
    ):
        raise ValueError("negative binary cannot be in pass-required stems")
    re.compile(case["expectedPattern"])
c_api_spec = ext.get("cApiCompilerCheck")
if c_api_spec is not None:
    from c_api_check import admit

    admit(c_api_spec)
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
backend_plans = []
if child or backend_stems:
    injected = (runner / "infer-stage.out").read_text()
    if not re.search(r"^\s*effective:\s*chip\s*$", injected, re.M):
        raise ValueError(
            "extension requires the original injected effective chip stage"
        )
    top_input = {
        "stage": "chip",
        "phase": phase[1],
        "chip": child["chip"] if child else "legacy_clamp_v1",
        "stems": backend_stems["bemu"] if backend_stems else child["stems"],
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
if backend_stems:
    rtl_input = {
        "stage": "ball",
        "phase": "rtl",
        "chip": "legacy_clamp_v1",
        "stems": backend_stems["verilator"],
        "layer": os.environ.get("LAYER", "merge"),
        "compilerTouched": True,
    }
    rtl_result = subprocess.run(
        ["node", str(adapter / "legacy-plan.ts"), json.dumps(rtl_input), str(repo)],
        capture_output=True,
        text=True,
        check=True,
    )
    backend_plans.append(
        {
            "scope": {"stage": "chip", "phase": phase[1], "backend": "verilator"},
            "identity": rtl_input,
            "plan": json.loads(rtl_result.stdout),
        }
    )
prepared = {
    "extension": ext,
    "topPlans": top_plans,
    "backendPlans": backend_plans,
    "childPlans": plans,
}
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
    ordered_plans = (
        top_plans
        + [p for p in plans if p["identity"]["phase"] == "c-bemu"]
        + backend_plans
        + [p for p in plans if p["identity"]["phase"] == "rtl"]
    )
    c_bemu_completion = -1
    for plan in ordered_plans:
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
            if (
                step["command"] == "bebop-verilator"
                and child
                and child["phase"] == "rtl"
            ):
                assert (
                    c_bemu_completion >= 0
                ), "c-bemu prerequisite must finish before RTL"
                preceding_terminal_index = max(
                    preceding_terminal_index, c_bemu_completion
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
                    and terminal.get("failure") is False
                    and terminal.get("processing") is False
                    and terminal.get("returncode") == 0
                ):
                    good = True
                    preceding_terminal_index = terminal_index
                    break
            assert good, f"missing actual successful child gate: {step}"
        if plan in plans and plan["identity"]["phase"] == "c-bemu":
            c_bemu_completion = preceding_terminal_index
    if child and child["phase"] == "rtl":
        assert all(
            audit.index(x) > c_bemu_completion
            for x in submits.values()
            if x["endpoint"].startswith("/bebop/verilator/")
        ), "RTL submitted before same-run c-bemu prerequisite completed"
    for case in negatives:
        good = False
        for row in audit:
            if row["event"] != "expected-failure" or row["case"] != case:
                continue
            result = row["result"]
            status = result.get("status", {})
            body = status.get("body", {})
            trace = row.get("trace_id")
            submission = submits.get(trace, {})
            expected_backend = "bemu" if case["backend"] == "bemu" else "verilator"
            if (
                result.get("matched") is True
                and status.get("failure") is True
                and status.get("success") is False
                and status.get("processing") is False
                and status.get("trace_id") == trace
                and body.get("task") == expected_backend
                and isinstance(body.get("returncode"), int)
                and body["returncode"] != 0
                and result.get("exitCode") == body["returncode"]
                and Path(body.get("binary", "")).name == case["binary"]
                and submission.get("endpoint") == "/bebop/" + expected_backend + "/sim"
                and submission.get("params", {}).get("binary") == case["binary"]
                and submission.get("params", {}).get("chip") == case["chip"]
            ):
                good = True
                break
        assert good, "negative missing/mismatched: " + case["id"]
    for case in compiler_cases:
        assert any(
            x["event"] == "compiler-expected-failure"
            and x["case"] == case
            and x["result"]["matched"] is True
            and isinstance(x["result"].get("exitCode"), int)
            and x["result"]["exitCode"] != 0
            and x["result"].get("argv", [None, None])[1] == str(repo / case["fixture"])
            for x in audit
        ), ("compiler negative missing/mismatched: " + case["id"])
    if c_api_spec is not None:
        c_api_results = [
            x["result"] for x in audit if x["event"] == "c-api-compiler-check"
        ]
        expected_sha = os.environ.get("RESOLVED_SHA") or context.get("headRefOid")
        assert expected_sha, "frozen source SHA required for C API gate"
        from c_api_check import result_passes

        assert any(
            result_passes(x, c_api_spec, expected_sha) for x in c_api_results
        ), "C API compiler matrix missing, mismatched or not passed"
    print("explicit child/negative/compiler/C-API gates satisfied")
else:
    print("[ball-subphase-extension]\n" + json.dumps(prepared, indent=2))
