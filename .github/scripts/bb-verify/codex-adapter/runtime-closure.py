"""Private genuine Boost runtime dependency for the authorized legacy CI only."""

import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

SONAME = "libboost_system.so.1.83.0"
SOURCE = Path("/usr/lib/x86_64-linux-gnu") / SONAME


def prepare(repo, runner):
    dest = Path(runner) / "codex-session-evidence" / "runtime-closure"
    dest.mkdir(parents=True, exist_ok=True)
    record = {
        "time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source": str(SOURCE),
        "commands": [],
        "functionalPass": False,
    }

    def call(args, env=None):
        p = subprocess.run(args, env=env, capture_output=True, text=True, timeout=60)
        record["commands"].append(
            {
                "args": args,
                "exitCode": p.returncode,
                "stdout": p.stdout,
                "stderr": p.stderr,
            }
        )
        if p.returncode:
            raise RuntimeError("runtime closure command failed: " + repr(args))
        return p.stdout

    try:
        package = call(["dpkg-query", "-S", str(SOURCE)])
        if not package.startswith("libboost-system1.83.0:amd64: "):
            raise RuntimeError("unexpected Boost package source")
        dynamic = call(["readelf", "-d", str(SOURCE)])
        if not re.search(r"\(SONAME\).*\[" + re.escape(SONAME) + r"\]", dynamic):
            raise RuntimeError("Boost SONAME mismatch")
        if "(NEEDED)" in dynamic:
            raise RuntimeError("unexpected additional Boost runtime dependencies")
        digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
        libdir = dest / digest
        libdir.mkdir(exist_ok=True)
        target = libdir / SONAME
        if target.is_symlink():
            raise RuntimeError("private runtime library must be an exact regular file")
        shutil.copyfile(SOURCE, target)
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise RuntimeError("private Boost copy hash mismatch")
        if set(p.name for p in libdir.iterdir()) != {SONAME}:
            raise RuntimeError("private closure contains unexpected libraries")
        record.update(
            package=package.strip(),
            sha256=digest,
            libraryDirectory=str(libdir.resolve()),
        )
        env = dict(os.environ, LD_LIBRARY_PATH=str(libdir.resolve()))
        binary = Path(repo) / "bebop/target/legacy_clamp_v1/release/bebop-bemu"
        if binary.is_file():
            program = call(["readelf", "-l", str(binary)])
            match = re.search(r"Requesting program interpreter: ([^\]]+)", program)
            if not match or not match[1].startswith("/nix/store/"):
                raise RuntimeError("expected actual Nix ELF interpreter")
            proof = call([match[1], "--list", str(binary)], env=env)
            if str(target.resolve()) not in proof or "not found" in proof:
                raise RuntimeError("private Boost closure not proven by actual loader")
            record["loaderResolutionProven"] = True
        else:
            record["loaderResolutionProven"] = False
            record["note"] = (
                "BEMU not built yet; native formal MCP build/sim remains required"
            )
        record["accepted"] = True
        os.environ["LD_LIBRARY_PATH"] = str(libdir.resolve())
        return str(libdir.resolve())
    except Exception as error:
        record.update(accepted=False, error=str(error))
        raise
    finally:
        (dest / "preflight.json").write_text(json.dumps(record, indent=2) + "\n")
