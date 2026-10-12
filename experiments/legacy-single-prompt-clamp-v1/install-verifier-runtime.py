#!/usr/bin/env python3
"""Install the official, pinned verifier beside its matching code-mode host.

Uses existing authentication separately at runtime. Never changes global Codex,
account state, model/provider, or rate limits. Binary archives stay outside git.
"""

import argparse
import hashlib
from pathlib import Path
import subprocess
import tarfile

VERSION = "0.162.1"
ASSETS = {
    "codex-x86_64-unknown-linux-musl": (
        "86f268d81b898f3e144c5ecff2ad2fda2c5802e042d6195b72538fe0fa125057"
    ),
    "codex-code-mode-host-x86_64-unknown-linux-musl": (
        "458239ea45c1fc508d89695f180ab352f2834709a8a46929a4466f4f04399ada"
    ),
}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output-dir", type=Path, required=True)
parser.add_argument("--proxy", help="Optional existing network proxy for curl")
args = parser.parse_args()
destination = args.output_dir.resolve()
destination.mkdir(parents=True, exist_ok=True)

for binary, expected in ASSETS.items():
    archive = destination / (binary + ".tar.gz")
    valid = (
        archive.exists()
        and hashlib.sha256(archive.read_bytes()).hexdigest() == expected
    )
    if not valid:
        command = ["curl", "--fail", "--location", "--max-time", "600"]
        if args.proxy:
            command += ["--proxy", args.proxy]
        command += [
            "--output",
            str(archive),
            f"https://github.com/openai/codex/releases/download/rust-v{VERSION}/{archive.name}",
        ]
        subprocess.run(command, check=True)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise RuntimeError(f"Official release digest mismatch: {archive.name}")
    with tarfile.open(archive) as contents:
        contents.extractall(destination, filter="data")
    (destination / binary).chmod(0o755)

alias = destination / "codex-code-mode-host"
if not alias.exists():
    alias.symlink_to("codex-code-mode-host-x86_64-unknown-linux-musl")
if alias.resolve() != destination / "codex-code-mode-host-x86_64-unknown-linux-musl":
    raise RuntimeError(
        "Existing code-mode-host path does not match this pinned installation"
    )
subprocess.run(
    [str(destination / "codex-x86_64-unknown-linux-musl"), "--version"], check=True
)
