"""Startup protocol checks only; no model/build/simulation execution."""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ADAPTER = Path(__file__).parent
spec = importlib.util.spec_from_file_location(
    "startup", ADAPTER / "check-mcp-startup.py"
)
startup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(startup)


class Startup(unittest.TestCase):
    def test_missing_capabilities_fail_with_raw_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.py"
            fixture.write_text("""import json,sys
for line in sys.stdin:
 m=json.loads(line)
 if m.get('id')==1:
  result={'protocolVersion':'2024-11-05','capabilities':{},
          'serverInfo':{'name':'synthetic','version':'1'}}
  print(json.dumps({'jsonrpc':'2.0','id':1,'result':result}),flush=True)
 if m.get('id')==2:
  result={'tools':[{'name':'buckyball_bbdev_plan'}]}
  print(json.dumps({'jsonrpc':'2.0','id':2,'result':result}),flush=True)
""")
            result = startup.probe([sys.executable, str(fixture)], root, timeout=3)
            self.assertFalse(result["accepted"])
            self.assertIn("bbdev_task_status", result["missingTools"])
            dest = root / "codex-session-evidence/mcp-startup"
            self.assertTrue((dest / "preflight.stdout.jsonl").read_text())
            requests = json.loads((dest / "preflight.requests.json").read_text())
            self.assertEqual(
                [r["method"] for r in requests],
                ["initialize", "notifications/initialized", "tools/list"],
            )
            self.assertFalse(result["buildSimSubmitted"])

    def test_process_error_and_timeout_fail_closed(self):
        for kind in ["exit", "timeout"]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                fixture = root / "fixture.py"
                fixture.write_text(
                    'import sys; print("deliberate startup failure",file=sys.stderr); sys.exit(3)'
                    if kind == "exit"
                    else "import time; time.sleep(30)"
                )
                result = startup.probe(
                    [sys.executable, str(fixture)], root, timeout=0.2
                )
                self.assertFalse(result["accepted"])
                self.assertFalse(result["functionalPass"])
                if kind == "exit":
                    self.assertIn(
                        "deliberate startup failure",
                        (
                            root
                            / "codex-session-evidence/mcp-startup/preflight.stderr.log"
                        ).read_text(),
                    )


if __name__ == "__main__":
    unittest.main()
