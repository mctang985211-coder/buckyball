#!/usr/bin/env python3
"""Real static registration checks when old Cordis audit cannot be loaded."""

import argparse
import json
from pathlib import Path
import tomllib

parser = argparse.ArgumentParser()
parser.add_argument("--require-rtl", action="store_true")
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
registry = repo / "examples/cores/pebble/configs/balldomains/legacy_clamp_v1.toml"
data = tomllib.loads(registry.read_text())
balls, isa = data["ballIdMappings"], data["ballISA"]
expected = [
    "TransposeBall",
    "SMatMulBall",
    "Im2colBall",
    "ToInt8Ball",
    "Int2FpBall",
    "MatAddBall",
    "TraceBall",
    "ClampBall",
]
checks = {}
checks["count"] = data["ballNum"] == len(balls) == 8
checks["contiguous_ids"] = [b["ballId"] for b in balls] == list(range(8))
checks["exact_ball_set"] = [b["ballName"] for b in balls] == expected
checks["unique_names_classes"] = (
    len({b["ballName"] for b in balls}) == len({b["ballClass"] for b in balls}) == 8
)
checks["isa_unique"] = (
    len({i["funct7"] for i in isa}) == len({i["mnemonic"] for i in isa}) == len(isa)
)
checks["isa_bid_coverage"] = {i["bid"] for i in isa} == set(range(8))
checks["legal_codes"] = all(
    0 <= i["funct7"] <= 127 and i["funct7"] not in {0, 1, 5, 16, 32, 33, 34, 35}
    for i in isa
)
checks["config_paths"] = all(
    (registry.parent / b["config"]).resolve().is_file() for b in balls
)
checks["bandwidth"] = (
    all(b["inBW"] > 0 and b["outBW"] > 0 for b in balls)
    and balls[7]["inBW"] == balls[7]["outBW"] == 1
)
checks["new_encoding"] = next(i for i in isa if i["mnemonic"] == "CLAMP") == {
    "mnemonic": "CLAMP",
    "funct7": 60,
    "bid": 7,
}
checks["generated_encoding_only"] = (
    "BB_FUNC7(CLAMP)"
    in (repo / "examples/balls/clamp/workloads/isa/clamp.h").read_text()
)
mem = tomllib.loads(
    (repo / "examples/cores/pebble/configs/memdomains/default.toml").read_text()
)
checks["frozen_geometry"] = {
    k: mem["bank"][k] for k in ["num", "width", "entries", "channel"]
} == {"num": 24, "width": 128, "entries": 64, "channel": 13}
source_paths = {}
for b in balls:
    ball_dir = b["ballClass"].split(".")[2]
    path = repo / "examples/balls" / ball_dir
    source_paths[b["ballName"]] = {
        "emu": (path / "emu/src/lib.rs").is_file(),
        "rtl": (path / "arch/src/main/scala").is_dir(),
        "compiler": len(list((path / "compiler/src/Dialect/Buckyball").glob("*.td")))
        == 1,
    }
checks["source_packages"] = all(
    p["emu"] and p["compiler"] and (p["rtl"] or not args.require_rtl)
    for p in source_paths.values()
)
result = {
    "scope": "static registry, topology memory contract and source identity; no functional PASS",
    "checks": checks,
    "balls": balls,
    "isa": isa,
    "packages": source_paths,
    "requireRtl": args.require_rtl,
}
print(json.dumps(result, indent=2))
raise SystemExit(0 if all(checks.values()) else 1)
