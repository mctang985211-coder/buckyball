"""Synthetic protocol tests using real frozen planners; no build/simulation."""

import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ADAPTER = Path(__file__).parent.resolve()
REPO = ADAPTER.parents[3]
spec = importlib.util.spec_from_file_location(
    "phase_protocol", ADAPTER / "phase-protocol.py"
)
protocol = importlib.util.module_from_spec(spec)
spec.loader.exec_module(protocol)
backend_spec = importlib.util.spec_from_file_location(
    "backend_stems", ADAPTER / "backend-stems.py"
)
backend = importlib.util.module_from_spec(backend_spec)
backend_spec.loader.exec_module(backend)


class Protocol(unittest.TestCase):
    def setUp(self):
        import tomllib

        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        prefix = "legacy_clamp_v1-pebble-"
        child = [
            prefix + suffix
            for suffix in [
                "ctest-clamp_test-baremetal",
                "ctest-clamp_capacity_test-baremetal",
                "ctest-matadd_clamp_test-baremetal",
                "mlirtest-ball_clamp_4x4-baremetal",
                "mlirtest-bank_clamp_4x4-baremetal",
            ]
        ]
        ext = {
            "version": 1,
            "ballSubphase": {
                "ball": "ClampBall",
                "phase": "rtl",
                "chip": "legacy_clamp_v1",
                "stems": child,
                "rtlStems": [x for x in child if "capacity" not in x],
            },
            "topBackendStems": {
                b: tomllib.loads(
                    (
                        REPO
                        / "examples/chips/legacy_clamp_v1/regression/batch"
                        / b
                        / "workloads-elf.toml"
                    ).read_text()
                )["workloads"]["tests"]
                for b in ["bemu", "verilator"]
            },
            "expectedFailures": [],
        }
        body = (
            "stage: chip\nphase: integrate\nround: 15\nchip: legacy_clamp_v1\n```legacy-verification-extension\n"
            + json.dumps(ext)
            + "\n```\n"
        )
        self.context = {
            "body": body,
            "headRefOid": "fixture-source",
            "comments": [],
            "reviews": [],
        }
        (self.root / "context.json").write_text(json.dumps(self.context))
        (self.root / "infer-stage.out").write_text("[stage]\n  effective: chip\n")
        (self.root / "config-install-execution.json").write_text(
            json.dumps({"exitCode": 0})
        )
        self.env = dict(
            os.environ,
            RUNNER_TEMP=str(self.root),
            GITHUB_WORKSPACE=str(self.root),
            BB_VERIFY_ROOT=str(REPO),
            RESOLVED_SHA="fixture-temp",
            LAYER="merge",
        )
        done = subprocess.run(
            ["python3", str(ADAPTER / "extension.py")],
            env=self.env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.prepared = json.loads(
            (self.root / "verification-extension.json").read_text()
        )
        self.p = self.prepared["phaseProtocol"]
        self.binding = {"sessionId": "synthetic-only", "servicePort": 5192}
        self.rows = [
            {
                "event": "phase-session-start",
                "sourceSha": "fixture-source",
                "resolvedSha": "fixture-temp",
                "binding": self.binding,
            }
        ]

    def tearDown(self):
        self.tmp.cleanup()

    def submit(self, step, guard=True):
        endpoint, params = protocol.command(step)
        if guard:
            protocol.check_submission(self.p, self.rows, endpoint, params)
        trace = "fixture-" + str(len(self.rows))
        self.rows.extend(
            [
                {
                    "event": "submit",
                    "endpoint": endpoint,
                    "params": params,
                    "result": {"trace_id": trace},
                    "phaseBinding": self.binding,
                },
                {
                    "event": "status",
                    "trace_id": trace,
                    "result": {
                        "success": True,
                        "failure": False,
                        "processing": False,
                        "returncode": 0,
                    },
                    "phaseBinding": self.binding,
                },
            ]
        )

    def prerequisites(self):
        for plan in [self.p["childPrerequisite"]] + self.p["selfRunPlans"]:
            while True:
                child_step, child_end, _ = protocol.progress(
                    self.p["childPrerequisite"], self.rows
                )
                bemu_step, bemu_end, _ = protocol.progress(
                    self.p["selfRunPlans"][0], self.rows
                )
                floor = (
                    max(child_end, bemu_end)
                    if child_step is None and bemu_step is None
                    else -1
                )
                step, _, _ = protocol.progress(plan, self.rows, floor)
                if step is None:
                    break
                self.submit(step)
        self.rows.append(
            {"event": "slices-prerequisite-complete", "phaseBinding": self.binding}
        )

    def gate(self):
        (self.root / "codex-bbdev-audit.jsonl").write_text(
            "".join(json.dumps(x) + "\n" for x in self.rows)
        )
        return subprocess.run(
            ["python3", str(ADAPTER / "extension.py"), "--gate"],
            env=self.env,
            capture_output=True,
            text=True,
        )

    def test_reject_real_round14_order_and_missing_slices(self):
        top = self.prepared["topPlans"][0]
        for step in top["plan"]["steps"]:
            if step["command"] == "config":
                continue
            if "transpose_i8_16x32" in step["args"]:
                with self.assertRaisesRegex(RuntimeError, "self-run slices"):
                    self.submit(step)
                self.submit(step, guard=False)
                break
            self.submit(step)
        self.rows.append(
            {"event": "slices-prerequisite-complete", "phaseBinding": self.binding}
        )
        with self.assertRaises(RuntimeError):
            protocol.verify(self.p, self.rows)
        self.rows.pop()
        self.assertNotEqual(self.gate().returncode, 0)

    def test_accept_full_sequence_and_reject_early_integrate_reuse(self):
        self.prerequisites()
        boundary = protocol.verify(self.p, self.rows)
        self.assertGreater(boundary, 0)
        compiler_submits = [
            x for x in self.rows if x.get("endpoint") == "/compiler/build"
        ]
        self.assertEqual(
            len(compiler_submits), 1
        )  # shared native build, not another truth table
        early = self.gate()
        self.assertNotEqual(early.returncode, 0)
        self.assertIn("missing actual successful child gate", early.stderr)
        for plan in (
            self.prepared["topPlans"]
            + self.prepared["backendPlans"]
            + [
                x
                for x in self.prepared["childPlans"]
                if x["identity"]["phase"] == "rtl"
            ]
        ):
            for step in plan["plan"]["steps"]:
                if step["command"] != "config":
                    self.submit(step)
        done = self.gate()
        self.assertEqual(done.returncode, 0, done.stderr)
        evidence = os.environ.get("BB_PROTOCOL_TEST_EVIDENCE")
        if evidence:
            dest = Path(evidence)
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "real-planner-generated-protocol.json").write_text(
                json.dumps(self.prepared, indent=2) + "\n"
            )
            (dest / "synthetic-accepted-audit.jsonl").write_text(
                "".join(json.dumps(x) + "\n" for x in self.rows)
            )
            (dest / "synthetic-gate-result.log").write_text(done.stdout + done.stderr)
        altered = copy.deepcopy(self.rows)
        altered[2]["phaseBinding"] = {"sessionId": "other-run", "servicePort": 5192}
        with self.assertRaisesRegex(AssertionError, "different service/session"):
            protocol.verify(self.p, altered)

    def test_reject_rtl_before_all_five_child_and_bemu_slices(self):
        rtl = next(
            x
            for x in self.p["selfRunPlans"][1]["plan"]["steps"]
            if x["command"] == "bebop-verilator"
        )
        with self.assertRaisesRegex(RuntimeError, "five c-bemu"):
            self.submit(rtl)


if __name__ == "__main__":
    unittest.main()
