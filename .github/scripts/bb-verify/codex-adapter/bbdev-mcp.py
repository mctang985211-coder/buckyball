#!/usr/bin/env python3
"""Same-process bbdev lifecycle plus the unchanged legacy deterministic plan."""

import os, sys, subprocess, json, importlib.util, uuid
from pathlib import Path

repo = Path(os.environ["BB_VERIFY_ROOT"])
runtime_spec = importlib.util.spec_from_file_location(
    "runtime_closure", Path(__file__).with_name("runtime-closure.py")
)
runtime_closure = importlib.util.module_from_spec(runtime_spec)
runtime_spec.loader.exec_module(runtime_closure)
runtime_closure.prepare(repo, Path(os.environ["RUNNER_TEMP"]))
sys.path.insert(0, str(repo / "bbdev/mcp"))
import common, datetime, re

AUDIT = Path(os.environ["RUNNER_TEMP"]) / "codex-bbdev-audit.jsonl"


def audit(data):
    data["time"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with AUDIT.open("a") as f:
        f.write(json.dumps(data) + "\n")


spec = importlib.util.spec_from_file_location(
    "status_evidence", Path(__file__).with_name("status-evidence.py")
)
status_evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(status_evidence)

original_submit = common.submit
original_status = common.task_status
submitted = {}
active = set()
phase_spec = importlib.util.spec_from_file_location(
    "phase_protocol", Path(__file__).with_name("phase-protocol.py")
)
phase_protocol = importlib.util.module_from_spec(phase_spec)
phase_spec.loader.exec_module(phase_protocol)
prepared_path = Path(os.environ["RUNNER_TEMP"]) / "verification-extension.json"
protocol = (
    json.loads(prepared_path.read_text()).get("phaseProtocol")
    if prepared_path.exists()
    else None
)
phase_rows = []
phase_binding = None
phase_complete = False
if protocol:
    actual_head = subprocess.check_output(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True
    ).strip()
    if actual_head != protocol["resolvedSha"]:
        raise RuntimeError(
            "phase protocol: actual checkout differs from frozen resolved SHA"
        )
    if subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "merge-base",
            "--is-ancestor",
            protocol["sourceSha"],
            actual_head,
        ],
        capture_output=True,
    ).returncode:
        raise RuntimeError(
            "phase protocol: frozen source is not an ancestor of actual temp SHA"
        )


def phase_record(row):
    if protocol:
        row["phaseBinding"] = phase_binding
        phase_rows.append(row)
    audit(row)


def bind_phase_service():
    global phase_binding
    if not protocol:
        return
    port = common._port
    if phase_binding is None:
        phase_binding = {"sessionId": str(uuid.uuid4()), "servicePort": port}
        audit(
            {
                "event": "phase-session-start",
                "binding": phase_binding,
                "sourceSha": protocol["sourceSha"],
                "resolvedSha": protocol["resolvedSha"],
            }
        )
    elif phase_binding["servicePort"] != port:
        raise RuntimeError("phase protocol: native service changed during run")


def observed_submit(endpoint, params):
    if active:
        raise RuntimeError("serialize bbdev tasks; an earlier trace is still active")
    common._ensure()
    bind_phase_service()
    if protocol and not phase_complete:
        try:
            phase_protocol.check_submission(protocol, phase_rows, endpoint, params)
        except RuntimeError as error:
            phase_record(
                {
                    "event": "phase-submission-rejected",
                    "endpoint": endpoint,
                    "params": params,
                    "error": str(error),
                }
            )
            raise
    log_stat = common.LOG.stat()
    result = original_submit(endpoint, params)
    if result.get("trace_id"):
        submitted[result["trace_id"]] = {
            "endpoint": endpoint,
            "params": params,
            "serverLogOffset": log_stat.st_size,
            "serverLogInode": log_stat.st_ino,
        }
        active.add(result["trace_id"])
    phase_record(
        {"event": "submit", "endpoint": endpoint, "params": params, "result": result}
    )
    return result


def observed_status(trace_id, model_view=True):
    if protocol and trace_id not in submitted:
        raise RuntimeError("phase protocol: status must belong to this service session")
    result = original_status(trace_id)
    if not result.get("processing", True):
        active.discard(trace_id)
        task = submitted.get(trace_id)
        if (
            task
            and "serverLogSlice" not in task
            and common.LOG.stat().st_ino == task["serverLogInode"]
        ):
            with common.LOG.open("rb") as f:
                f.seek(task["serverLogOffset"])
                task["serverLogSlice"] = f.read().decode(errors="replace")
    global phase_complete
    phase_record({"event": "status", "trace_id": trace_id, "result": result})
    if protocol and not phase_complete:
        child_step, bemu_step, rtl_step, completion = phase_protocol.state(
            protocol, phase_rows
        )
        if child_step is None and bemu_step is None and rtl_step is None:
            phase_complete = True
            phase_record(
                {"event": "slices-prerequisite-complete", "completionIndex": completion}
            )
    view = status_evidence.model_status(
        result, Path(os.environ["RUNNER_TEMP"]) / "codex-session-evidence"
    )
    return view if model_view else result


common.submit = observed_submit
common.task_status = observed_status
from server import mcp


@mcp.tool()
def buckyball_expected_failure_check(case_id: str, trace_id: str) -> str:
    prepared = json.loads(
        (Path(os.environ["RUNNER_TEMP"]) / "verification-extension.json").read_text()
    )
    cases = [
        c
        for c in prepared["extension"].get("expectedFailures", [])
        if c["id"] == case_id
    ]
    if len(cases) != 1:
        raise ValueError("unknown negative case")
    case = cases[0]
    task = submitted.get(trace_id)
    endpoint = (
        "/bebop/" + ("bemu" if case["backend"] == "bemu" else "verilator") + "/sim"
    )
    if (
        not task
        or task["endpoint"] != endpoint
        or task["params"].get("binary") != case["binary"]
        or task["params"].get("chip") != case["chip"]
    ):
        raise ValueError("trace is not the declared negative simulation")
    status = observed_status(trace_id, model_view=False)
    body = status.get("body", {})
    if isinstance(body, dict) and isinstance(body.get("body"), dict):
        body = body["body"]
    if (
        not status.get("failure")
        or status.get("processing")
        or not isinstance(body, dict)
        or not body.get("returncode")
        or body.get("task") not in ("bemu", "verilator")
    ):
        raise ValueError("not an actual terminal simulation failure")
    logdir = Path(body.get("log_dir", "")).resolve()
    if not logdir.is_relative_to((repo / "log").resolve()):
        raise ValueError("missing trace-bound log directory")
    logs = [p for p in (logdir / "stdout.log", logdir / "stderr.log") if p.is_file()]
    text = "\n".join(p.read_text(errors="replace") for p in logs)
    if not text:
        text = task.get("serverLogSlice", "")
        slice_path = Path(os.environ["RUNNER_TEMP"]) / ("negative-" + case_id + ".log")
        slice_path.write_text(text)
        logs.append(slice_path)
    runtime_failure = (
        "panicked at" in text
        if case["backend"] == "bemu"
        else ("Assertion failed" in text or "%Error" in text)
    )
    matched = runtime_failure and bool(re.search(case["expectedPattern"], text))
    result = {
        "matched": matched,
        "exitCode": body["returncode"],
        "logDir": str(logdir),
        "logFiles": [str(p) for p in logs],
        "status": status,
    }
    audit(
        {
            "event": "expected-failure",
            "case": case,
            "trace_id": trace_id,
            "result": result,
        }
    )
    if not matched:
        raise ValueError(
            "expected panic/assert absent from trace-bound logs; infrastructure failure cannot satisfy negative"
        )
    return json.dumps(result)


@mcp.tool()
def buckyball_compiler_expected_failure_check(case_id: str) -> str:
    import hashlib

    prepared = json.loads(
        (Path(os.environ["RUNNER_TEMP"]) / "verification-extension.json").read_text()
    )
    cases = [
        c
        for c in prepared["extension"].get("compilerExpectedFailures", [])
        if c["id"] == case_id
    ]
    if len(cases) != 1:
        raise ValueError("unknown compiler fixture")
    case = cases[0]
    executable = (
        repo / "compiler/thirdparty/buddy-mlir/build/legacy_clamp_v1/bin/buddy-opt"
    )
    if not executable.is_file():
        raise ValueError("compiled buddy-opt missing; cannot prove rejection")
    fixture = repo / case["fixture"]
    argv = [
        str(executable),
        str(fixture),
        "--target=pebble",
        "--lower-buckyball=stable=true",
    ]
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    done = subprocess.run(argv, cwd=repo, capture_output=True, text=True, timeout=120)
    # A compiler process crash or an unknown pass/tool error is never an expected diagnostic.
    matched = 0 < done.returncode < 128 and bool(
        re.search(case["expectedPattern"], done.stderr)
    )
    output = Path(os.environ["RUNNER_TEMP"]) / ("compiler-negative-" + case_id + ".log")
    output.write_text(done.stdout + done.stderr)
    result = {
        "matched": matched,
        "exitCode": done.returncode,
        "argv": argv,
        "startedAt": started,
        "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "fixtureSha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
        "executableSha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
        "logPath": str(output),
    }
    audit({"event": "compiler-expected-failure", "case": case, "result": result})
    if not matched:
        raise ValueError(
            "compiler did not reject with the exact declared diagnostic: " + done.stderr
        )
    return json.dumps(result)


@mcp.tool()
def buckyball_c_api_compiler_check() -> str:
    """Run the admitted real RISC-V GCC/G++ 4-positive/48-negative C API matrix."""
    from c_api_check import execute

    prepared = json.loads(
        (Path(os.environ["RUNNER_TEMP"]) / "verification-extension.json").read_text()
    )
    spec = prepared["extension"].get("cApiCompilerCheck")
    if spec is None:
        raise ValueError("C API compiler check not admitted by this frozen manifest")
    if active:
        raise RuntimeError(
            "wait for the active bbdev trace before C API compiler fixture execution"
        )
    result = execute(repo, Path(os.environ["RUNNER_TEMP"]), spec)
    audit({"event": "c-api-compiler-check", "result": result})
    if result["verdict"] != "PASS":
        raise RuntimeError(
            "C API fixture matrix "
            + result["verdict"]
            + "; evidence: "
            + result["evidencePath"]
        )
    return json.dumps(result)


@mcp.tool()
def buckyball_bbdev_plan(
    stage: str,
    chip: str,
    phase: str | None = None,
    layer: str = "merge",
    stems: list[str] | None = None,
    compilerTouched: bool = False,
    models: list[str] | None = None,
    probes: list[dict] | None = None,
    probeBudget: int = 3,
    perf: str | None = None,
) -> str:
    args = {
        "stage": stage,
        "chip": chip,
        "layer": layer,
        "compilerTouched": compilerTouched,
    }
    if phase is not None:
        args["phase"] = phase
    if stems is not None:
        args["stems"] = stems
    if models is not None:
        args["models"] = models
    if probes is not None:
        args["probes"] = probes
    args["probeBudget"] = probeBudget
    if perf is not None:
        args["perf"] = perf
    done = subprocess.run(
        [
            "node",
            str(Path(__file__).with_name("legacy-plan.ts")),
            json.dumps(args),
            str(repo),
        ],
        capture_output=True,
        text=True,
    )
    if done.returncode:
        raise RuntimeError(done.stderr)
    return done.stdout


mcp.run(transport="stdio")
