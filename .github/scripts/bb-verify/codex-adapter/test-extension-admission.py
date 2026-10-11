"""Synthetic admission/gate checks; never functional execution evidence."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import tomllib
import unittest

ADAPTER = Path(__file__).parent
REPO = ADAPTER.resolve().parents[3]
spec = importlib.util.spec_from_file_location(
    "backend_stems", ADAPTER / "backend-stems.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
PREFIX = "legacy_clamp_v1-pebble-"
CHILD = [
    PREFIX + suffix
    for suffix in [
        "ctest-clamp_test-baremetal",
        "ctest-clamp_capacity_test-baremetal",
        "ctest-matadd_clamp_test-baremetal",
        "mlirtest-ball_clamp_4x4-baremetal",
        "mlirtest-bank_clamp_4x4-baremetal",
    ]
]
ROOT = REPO / "examples/chips/legacy_clamp_v1/regression"
SLICES = re.findall(
    r"^- (legacy_clamp_v1-[a-zA-Z0-9_-]+)\s*$",
    (ROOT / "phases/slices.md").read_text(),
    re.M,
)


def extension():
    return {
        "version": 1,
        "ballSubphase": {
            "ball": "ClampBall",
            "phase": "rtl",
            "chip": "legacy_clamp_v1",
            "stems": CHILD,
            "rtlStems": [s for s in CHILD if "capacity" not in s],
        },
        "topBackendStems": {"bemu": SLICES, "verilator": SLICES},
        "expectedFailures": [],
    }


def run_extension(ext, tmp, gate=False):
    body = (
        "stage: chip\nphase: slices\nround: 10\nchip: legacy_clamp_v1\n```legacy-verification-extension\n"
        + json.dumps(ext)
        + "\n```\n"
    )
    (tmp / "context.json").write_text(json.dumps({"body": body}))
    (tmp / "infer-stage.out").write_text("[stage]\n  effective: chip\n")
    return subprocess.run(
        ["python3", str(ADAPTER / "extension.py")] + (["--gate"] if gate else []),
        env=dict(
            os.environ,
            RUNNER_TEMP=str(tmp),
            BB_VERIFY_ROOT=str(REPO),
            GITHUB_WORKSPACE=str(tmp),
            LAYER="merge",
        ),
        capture_output=True,
        text=True,
    )


class Admission(unittest.TestCase):
    def test_backend_inventory_and_capacity(self):
        x = extension()
        module.admit(x["ballSubphase"], x["topBackendStems"], "slices", REPO)
        integration = {
            b: tomllib.loads((ROOT / "batch" / b / "workloads-elf.toml").read_text())[
                "workloads"
            ]["tests"]
            for b in ["bemu", "verilator"]
        }
        self.assertEqual([len(integration[b]) for b in ["bemu", "verilator"]], [55, 54])
        module.admit(x["ballSubphase"], integration, "integrate", REPO)
        for variant in ["missing", "duplicate", "foreign", "negative", "capacity"]:
            bad = copy.deepcopy(x["topBackendStems"])
            if variant == "missing":
                bad["bemu"] = bad["bemu"][:-1]
            if variant == "duplicate":
                bad["bemu"].append(bad["bemu"][0])
            if variant == "foreign":
                bad["bemu"][0] = PREFIX + "ctest-unrelated-baremetal"
            if variant == "negative":
                bad["bemu"][0] = PREFIX + "ctest-clamp_invalid_alias-baremetal"
            if variant == "capacity":
                bad["verilator"].append(CHILD[1])
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                module.admit(x["ballSubphase"], bad, "slices", REPO)
        for change in ["phase", "subset", "capacity"]:
            child = copy.deepcopy(x["ballSubphase"])
            if change == "phase":
                child["phase"] = "c-bemu"
            if change == "subset":
                child["rtlStems"].append(PREFIX + "ctest-unrelated-baremetal")
            if change == "capacity":
                child["rtlStems"].append(CHILD[1])
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.admit(child, None, "slices", REPO)

    def test_original_skeleton_compatible(self):
        child = extension()["ballSubphase"]
        child.pop("rtlStems")
        child["phase"] = "c-bemu"
        module.admit(child, None, "skeleton", REPO)

    def test_real_plans_capacity_and_gate_reuse(self):
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            x = extension()
            p = run_extension(x, tmp)
            self.assertEqual(p.returncode, 0, p.stderr)
            prepared = json.loads((tmp / "verification-extension.json").read_text())
            self.assertEqual(prepared["childPlans"][0]["identity"]["stems"], CHILD)
            self.assertNotIn(CHILD[1], prepared["childPlans"][1]["identity"]["stems"])
            self.assertEqual(prepared["topPlans"][0]["identity"]["stage"], "chip")
            self.assertEqual(prepared["topPlans"][0]["identity"]["phase"], "slices")
            self.assertEqual(
                prepared["backendPlans"][0]["scope"],
                {"stage": "chip", "phase": "slices", "backend": "verilator"},
            )
            audit = []
            available = []
            ordered = (
                prepared["topPlans"]
                + prepared["childPlans"][:1]
                + prepared["backendPlans"]
                + prepared["childPlans"][1:]
            )
            for plan in ordered:
                preceding = -1
                for step in plan["plan"]["steps"]:
                    if step["command"] == "config":
                        continue
                    endpoint = (
                        "/"
                        + step["command"].replace("bebop-", "bebop/").replace("-", "/")
                        + "/"
                        + step["operation"]
                    )
                    tokens = shlex.split(step["args"])
                    params = {}
                    i = 0
                    while i < len(tokens):
                        key = tokens[i][2:]
                        i += 1
                        value = True
                        if i < len(tokens) and not tokens[i].startswith("--"):
                            value = tokens[i]
                            i += 1
                        params[key] = value
                    existing = next(
                        (
                            z
                            for z in available
                            if z["endpoint"] == endpoint
                            and z["params"] == params
                            and z["submitIndex"] > preceding
                        ),
                        None,
                    )
                    if existing:
                        preceding = existing["terminalIndex"]
                        continue
                    trace = "synthetic-" + str(len(available))
                    si = len(audit)
                    audit.extend(
                        [
                            {
                                "event": "submit",
                                "endpoint": endpoint,
                                "params": params,
                                "result": {"trace_id": trace},
                            },
                            {
                                "event": "status",
                                "trace_id": trace,
                                "result": {
                                    "trace_id": trace,
                                    "success": True,
                                    "failure": False,
                                    "processing": False,
                                    "returncode": 0,
                                },
                            },
                        ]
                    )
                    available.append(
                        {
                            "endpoint": endpoint,
                            "params": params,
                            "submitIndex": si,
                            "terminalIndex": si + 1,
                        }
                    )
                    preceding = si + 1
            (tmp / "config-install-execution.json").write_text(
                json.dumps({"exitCode": 0})
            )
            (tmp / "codex-bbdev-audit.jsonl").write_text(
                "\n".join(json.dumps(d) for d in audit)
            )
            p = run_extension(x, tmp, True)
            self.assertEqual(p.returncode, 0, p.stderr)
            case = {
                "id": "negative-rtl",
                "backend": "rtl",
                "chip": "legacy_clamp_v1",
                "binary": PREFIX + "ctest-clamp_invalid_alias-baremetal",
                "expectedPattern": "clamp: banks must be distinct",
            }
            with_negative = copy.deepcopy(x)
            with_negative["expectedFailures"] = [case]
            status = {
                "trace_id": "synthetic-negative",
                "success": False,
                "failure": True,
                "processing": False,
                "body": {
                    "task": "verilator",
                    "returncode": 134,
                    "binary": case["binary"],
                },
            }
            neg_rows = [
                {
                    "event": "submit",
                    "endpoint": "/bebop/verilator/sim",
                    "params": {"chip": case["chip"], "binary": case["binary"]},
                    "result": {"trace_id": "synthetic-negative"},
                },
                {
                    "event": "expected-failure",
                    "case": case,
                    "trace_id": "synthetic-negative",
                    "result": {"matched": True, "exitCode": 134, "status": status},
                },
            ]
            (tmp / "codex-bbdev-audit.jsonl").write_text(
                "\n".join(json.dumps(d) for d in audit + neg_rows)
            )
            self.assertEqual(run_extension(with_negative, tmp, True).returncode, 0)
            for variant in ["backend", "processing", "zero-exit"]:
                wrong = copy.deepcopy(neg_rows)
                if variant == "backend":
                    wrong[-1]["case"]["backend"] = "bemu"
                if variant == "processing":
                    wrong[-1]["result"]["status"]["processing"] = True
                if variant == "zero-exit":
                    wrong[-1]["result"]["status"]["body"]["returncode"] = 0
                (tmp / "codex-bbdev-audit.jsonl").write_text(
                    "\n".join(json.dumps(d) for d in audit + wrong)
                )
                self.assertNotEqual(
                    run_extension(with_negative, tmp, True).returncode, 0
                )
            # Exact compiler/workload and shared Clamp traces cover multiple identities.
            self.assertEqual(
                sum(d.get("endpoint") == "/compiler/build" for d in audit), 1
            )
            missing = [
                d
                for d in audit
                if not (
                    d.get("event") == "status"
                    and d.get("trace_id")
                    == next(
                        d["result"]["trace_id"]
                        for d in audit
                        if d.get("endpoint") == "/bebop/verilator/sim"
                    )
                )
            ]
            (tmp / "codex-bbdev-audit.jsonl").write_text(
                "\n".join(json.dumps(d) for d in missing)
            )
            self.assertNotEqual(run_extension(x, tmp, True).returncode, 0)
            # A terminal RTL before the full BEMU prerequisite must be rejected.
            rtl_index = next(
                i
                for i, d in enumerate(audit)
                if d.get("endpoint") == "/bebop/verilator/clean"
            )
            reordered = (
                audit[rtl_index : rtl_index + 2]
                + audit[:rtl_index]
                + audit[rtl_index + 2 :]
            )
            (tmp / "codex-bbdev-audit.jsonl").write_text(
                "\n".join(json.dumps(d) for d in reordered)
            )
            self.assertNotEqual(run_extension(x, tmp, True).returncode, 0)


class Archive(unittest.TestCase):
    def test_raw_logs_survive_runner_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runner = root / "runner"
            runner.mkdir()
            out = root / "out"
            out.mkdir()
            sessions = root / "codex/sessions"
            sessions.mkdir(parents=True)
            rows = [
                {
                    "type": "session_meta",
                    "payload": {
                        "id": "synthetic-archive",
                        "cli_version": "0.162.1",
                        "model_provider": "openai",
                    },
                },
                {"type": "turn_context", "payload": {"model": "gpt-6.1-sol"}},
            ]
            (sessions / "fixture.jsonl").write_text(
                "\n".join(json.dumps(z) for z in rows)
            )
            (runner / "codex-verify-events.jsonl").write_text(
                json.dumps({"thread_id": "synthetic-archive"})
            )
            (runner / "codex-binary.json").write_text(
                json.dumps({"accepted": True, "version": "0.162.1"})
            )
            for name in ["negative-case.log", "compiler-negative-case.log"]:
                (runner / name).write_text("exact raw diagnostic\n")
            p = subprocess.run(
                ["python3", str(ADAPTER / "archive-session.py")],
                env=dict(
                    os.environ,
                    RUNNER_TEMP=str(runner),
                    VERIFY_OUT=str(out),
                    CODEX_HOME=str(root / "codex"),
                ),
                capture_output=True,
                text=True,
            )
            self.assertEqual(p.returncode, 0, p.stderr)
            for name in ["negative-case.log", "compiler-negative-case.log"]:
                (runner / name).unlink()
                self.assertEqual(
                    (
                        runner / "codex-session-evidence/expected-failure-logs" / name
                    ).read_text(),
                    "exact raw diagnostic\n",
                )
            index = json.loads(
                (
                    runner / "codex-session-evidence/expected-failure-logs/index.json"
                ).read_text()
            )
            self.assertEqual(len(index), 2)


if __name__ == "__main__":
    unittest.main()
