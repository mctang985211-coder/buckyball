#!/usr/bin/env python3
"""Real stdio capability handshake only; no model/build/simulation execution."""

import datetime
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import time

REQUIRED = {
    "buckyball_bbdev_plan",
    "bbdev_compiler_build",
    "bbdev_workload_build",
    "bbdev_bemu_sim",
    "bbdev_bebop_verilator_clean",
    "bbdev_bebop_verilator_verilog",
    "bbdev_bebop_verilator_build",
    "bbdev_bebop_verilator_sim",
    "bbdev_task_status",
    "buckyball_expected_failure_check",
    "buckyball_compiler_expected_failure_check",
    "buckyball_c_api_compiler_check",
}


def probe(command, runner, env=None, timeout=55):
    dest = Path(runner) / "codex-session-evidence" / "mcp-startup"
    dest.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    record = {
        "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "command": command,
        "functionalPass": False,
        "buildSimSubmitted": False,
    }
    requests = []
    lines = []
    process = None
    try:
        with (dest / "preflight.stderr.log").open("w") as stderr:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=stderr,
                env=env,
                text=True,
                start_new_session=True,
            )

            def send(message):
                requests.append(message)
                process.stdin.write(json.dumps(message) + "\n")
                process.stdin.flush()

            send(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {
                            "name": "legacy-ci-capability-preflight",
                            "version": "1",
                        },
                    },
                }
            )
            while time.monotonic() - start < timeout:
                if process.poll() is not None:
                    raise RuntimeError(
                        "MCP exited before complete capability handshake"
                    )
                ready, _, _ = select.select([process.stdout], [], [], 0.5)
                if not ready:
                    continue
                line = process.stdout.readline()
                if not line:
                    raise RuntimeError("MCP stdout closed before tools/list")
                lines.append(line)
                message = json.loads(line)
                if message.get("error"):
                    raise RuntimeError(
                        "MCP protocol error: " + json.dumps(message["error"])
                    )
                if message.get("id") == 1:
                    record["initializeSeconds"] = round(time.monotonic() - start, 3)
                    record["initializeResult"] = message.get("result")
                    send({"jsonrpc": "2.0", "method": "notifications/initialized"})
                    send(
                        {
                            "jsonrpc": "2.0",
                            "id": 2,
                            "method": "tools/list",
                            "params": {},
                        }
                    )
                if message.get("id") == 2:
                    names = {
                        tool["name"]
                        for tool in message.get("result", {}).get("tools", [])
                    }
                    record.update(
                        toolNames=sorted(names),
                        requiredTools=sorted(REQUIRED),
                        missingTools=sorted(REQUIRED - names),
                    )
                    if REQUIRED - names:
                        raise RuntimeError("required actual MCP capabilities missing")
                    record["accepted"] = True
                    return record
            raise TimeoutError("MCP initialize/tools/list timeout")
    except Exception as error:
        record.update(accepted=False, error=str(error))
        return record
    finally:
        if process is not None:
            record["exitCodeBeforeProbeShutdown"] = process.poll()
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=5)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
        if process is not None:
            process.stdin.close()
            process.stdout.close()
        record["elapsedSeconds"] = round(time.monotonic() - start, 3)
        (dest / "preflight.stdout.jsonl").write_text("".join(lines))
        (dest / "preflight.requests.json").write_text(
            json.dumps(requests, indent=2) + "\n"
        )
        record["rawHashes"] = {
            name: hashlib.sha256((dest / name).read_bytes()).hexdigest()
            for name in [
                "preflight.stdout.jsonl",
                "preflight.requests.json",
                "preflight.stderr.log",
            ]
        }
        (dest / "preflight.json").write_text(json.dumps(record, indent=2) + "\n")


if __name__ == "__main__":
    result = probe(
        [str(Path(__file__).with_name("run-bbdev-mcp.sh"))], os.environ["RUNNER_TEMP"]
    )
    print(
        json.dumps(
            {
                "accepted": result["accepted"],
                "elapsedSeconds": result["elapsedSeconds"],
                "toolCount": len(result.get("toolNames", [])),
                "error": result.get("error"),
            }
        )
    )
    raise SystemExit(0 if result["accepted"] else 1)
