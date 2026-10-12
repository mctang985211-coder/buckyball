"""Enforce the frozen ref-mode slices prerequisite; never execute a native task."""

import hashlib
import json
import re
import shlex
import subprocess
from pathlib import Path


def command(step):
    endpoint = (
        "/"
        + step["command"].replace("bebop-", "bebop/").replace("-", "/")
        + "/"
        + step["operation"]
    )
    tokens = shlex.split(step["args"])
    params = {}
    while tokens:
        key = tokens.pop(0).removeprefix("--")
        params[key] = (
            tokens.pop(0) if tokens and not tokens[0].startswith("--") else True
        )
    return endpoint, params


def matches(step, endpoint, params):
    wanted_endpoint, wanted = command(step)
    return endpoint == wanted_endpoint and all(
        str(params.get(k)) == str(v) for k, v in wanted.items()
    )


def successful(result):
    return (
        result.get("success") is True
        and result.get("failure") is False
        and result.get("processing") is False
        and result.get("returncode") == 0
    )


def progress(plan, rows, floor=-1):
    """Match original plan order; successful shared build traces may be reused."""
    preceding = -1
    traces = []
    for step in plan["plan"]["steps"]:
        if step["command"] == "config":
            continue
        if step["command"] == "bebop-verilator":
            if floor < 0:
                return step, preceding, traces
            preceding = max(preceding, floor)
        found = None
        for i, row in enumerate(rows):
            if (
                row.get("event") != "submit"
                or i <= preceding
                or not matches(step, row["endpoint"], row["params"])
            ):
                continue
            trace = row["result"].get("trace_id")
            terminal = next(
                (
                    j
                    for j, status in enumerate(rows)
                    if j > i
                    and status.get("event") == "status"
                    and status.get("trace_id") == trace
                    and successful(status["result"])
                ),
                None,
            )
            if terminal is not None:
                found = (terminal, trace)
                break
        if found is None:
            return step, preceding, traces
        preceding, trace = found
        traces.append(trace)
    return None, preceding, traces


def prepare(context, prepared, repo, adapter, resolved_sha):
    body = context.get("body", "")

    def field(name):
        match = re.search(r"^\s*" + name + r":\s*(\S+)", body, re.M)
        return match[1] if match else None

    if (field("stage"), field("phase"), field("chip")) != (
        "chip",
        "integrate",
        "legacy_clamp_v1",
    ):
        return None
    script = adapter.parent / "legacy-runner/scripts/slices-verify.mjs"
    js = (
        "import {slicesVerify} from "
        + json.dumps(script.as_uri())
        + "; console.log(JSON.stringify(slicesVerify(JSON.parse((await import('node:fs')).readFileSync(0, 'utf8')))))"
    )
    lookup = json.loads(
        subprocess.check_output(
            ["node", "--input-type=module", "-e", js],
            input=json.dumps(context),
            text=True,
        )
    )
    if lookup["found"]:
        return None
    child = next(
        (p for p in prepared["childPlans"] if p["identity"]["phase"] == "c-bemu"), None
    )
    if child is None or len(child["identity"]["stems"]) != 5:
        raise ValueError(
            "legacy integrate self-run requires all five c-bemu prerequisites"
        )
    stems = re.findall(
        r"^- (legacy_clamp_v1-[a-zA-Z0-9_-]+)\s*$",
        (
            repo / "examples/chips/legacy_clamp_v1/regression/phases/slices.md"
        ).read_text(),
        re.M,
    )
    if len(stems) != 8:
        raise ValueError("frozen legacy slices must declare eight Balls")
    plans = []
    for backend in ["bemu", "verilator"]:
        identity = dict(
            stage="chip" if backend == "bemu" else "ball",
            phase="slices" if backend == "bemu" else "rtl",
            chip="legacy_clamp_v1",
            layer=child["identity"]["layer"],
            compilerTouched=True,
            stems=stems,
        )
        result = subprocess.check_output(
            ["node", str(adapter / "legacy-plan.ts"), json.dumps(identity), str(repo)],
            text=True,
        )
        plans.append(
            {
                "scope": {"stage": "chip", "phase": "slices", "backend": backend},
                "identity": identity,
                "plan": json.loads(result),
            }
        )
    if not resolved_sha or not context.get("headRefOid"):
        raise ValueError("source and resolved temp SHA required for phase protocol")
    source_match = re.search(r"Frozen source SHA:\s*([0-9a-f]{40})", body)
    source_sha = source_match[1] if source_match else context["headRefOid"]
    return {
        "version": 1,
        "lookup": lookup,
        "sourceSha": source_sha,
        "contextHeadSha": context["headRefOid"],
        "resolvedSha": resolved_sha,
        "plannerSha256": hashlib.sha256(
            (adapter / "legacy-plan.ts").read_bytes()
        ).hexdigest(),
        "childPrerequisite": child,
        "selfRunPlans": plans,
    }


def state(protocol, rows):
    child_step, child_end, _ = progress(protocol["childPrerequisite"], rows)
    bemu_step, bemu_end, _ = progress(protocol["selfRunPlans"][0], rows)
    rtl_floor = (
        max(child_end, bemu_end) if child_step is None and bemu_step is None else -1
    )
    rtl_step, rtl_end, _ = progress(protocol["selfRunPlans"][1], rows, rtl_floor)
    return child_step, bemu_step, rtl_step, max(child_end, bemu_end, rtl_end)


def check_submission(protocol, rows, endpoint, params):
    child, bemu, rtl, _ = state(protocol, rows)
    if endpoint.startswith("/bebop/verilator/") and (
        child is not None or bemu is not None
    ):
        raise RuntimeError(
            "phase protocol: finish all five c-bemu positives and BEMU slices before any RTL"
        )
    if child is None and bemu is None and rtl is None:
        return
    allowed = [step for step in (child, bemu, rtl) if step is not None]
    if not any(matches(step, endpoint, params) for step in allowed):
        names = [command(step) for step in allowed]
        raise RuntimeError(
            "phase protocol: complete original self-run slices before integrate; next allowed: "
            + json.dumps(names)
        )


def verify(protocol, rows):
    starts = [x for x in rows if x.get("event") == "phase-session-start"]
    if (
        len(starts) != 1
        or starts[0]["resolvedSha"] != protocol["resolvedSha"]
        or starts[0]["sourceSha"] != protocol["sourceSha"]
    ):
        raise AssertionError("phase protocol session/SHA binding missing")
    binding = starts[0]["binding"]
    if not binding.get("servicePort") or not binding.get("sessionId"):
        raise AssertionError("actual service binding missing")
    boundaries = [
        i
        for i, row in enumerate(rows)
        if row.get("event") == "slices-prerequisite-complete"
    ]
    if len(boundaries) != 1:
        raise AssertionError("self-run slices phase boundary missing or duplicated")
    boundary = boundaries[0]
    for i, row in enumerate(rows):
        if (
            row.get("event") in ("submit", "status", "slices-prerequisite-complete")
            and row.get("phaseBinding") != binding
        ):
            raise AssertionError(
                "different service/session evidence cannot satisfy phase protocol"
            )
        if row.get("event") == "submit" and i < boundary:
            if all(step is None for step in state(protocol, rows[:i])[:3]):
                raise AssertionError(
                    "integrate submission precedes actual slices phase boundary"
                )
            check_submission(protocol, rows[:i], row["endpoint"], row["params"])
    child, bemu, rtl, end = state(protocol, rows[:boundary])
    if any(step is not None for step in (child, bemu, rtl)) or end >= boundary:
        raise AssertionError("self-run slices not complete before phase boundary")
    return boundary
