"""Real RISC-V compiler evidence for the explicitly admitted C API fixture suite."""

from __future__ import annotations
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

FIXTURE_ROOT = "examples/balls/clamp/compiler/tests/c_api/"
SPEC = {
    "chip": "legacy_clamp_v1",
    "target": "pebble",
    "positiveFixture": FIXTURE_ROOT + "static_valid.c",
    "negativeFixture": FIXTURE_ROOT + "static_invalid.c",
    "cases": list(range(1, 13)),
    "languages": ["gnu11", "gnu++17"],
    "optimizations": ["O0", "O2"],
}
ARRAY_ERROR = re.compile(r"(?:array[^\n]*negative|negative[^\n]*array)", re.I)
INFRA_ERROR = re.compile(
    r"fatal error:|No such file or directory|cannot find|unrecognized command.line|"
    r"internal compiler error|cannot execute|cannot exec|failed to exec|Killed",
    re.I,
)


def admit(spec: dict) -> None:
    if spec != SPEC or any(type(case) is not int for case in spec.get("cases", [])):
        raise ValueError(
            "unsupported cApiCompilerCheck; the exact 4-positive/48-negative fixture matrix is required"
        )


def rejection_verdict(returncode: int, diagnostic: str) -> str:
    if returncode == 0:
        return "FAIL"
    if returncode < 0 or returncode >= 128 or INFRA_ERROR.search(diagnostic):
        return "INFRA"
    if "BB_CLAMP_STATIC_CHECK" in diagnostic and ARRAY_ERROR.search(diagnostic):
        return "PASS"
    return "INFRA"


def result_passes(result: dict, spec: dict, source_sha: str) -> bool:
    if (
        result.get("verdict") != "PASS"
        or result.get("spec") != spec
        or result.get("sourceSha") != source_sha
        or result.get("positiveCount") != 4
        or result.get("negativeCount") != 48
    ):
        return False
    expected = {
        "positive-" + language + "-" + optimization: None
        for language in SPEC["languages"]
        for optimization in SPEC["optimizations"]
    }
    expected.update(
        {
            "negative-" + language + "-" + optimization + "-case" + str(case): case
            for language in SPEC["languages"]
            for optimization in SPEC["optimizations"]
            for case in SPEC["cases"]
        }
    )
    matrix = result.get("matrix", [])
    if len(matrix) != 52 or {row.get("label") for row in matrix} != set(expected):
        return False
    for row in matrix:
        if row.get("verdict") != "PASS":
            return False
        case = expected[row["label"]]
        if case is None:
            if (
                row.get("exitCode") != 0
                or row.get("realRiscVObject") is not True
                or not re.fullmatch(r"[0-9a-f]{64}", row.get("objectSha256", ""))
            ):
                return False
        elif row.get("case") != case or not 0 < row.get("exitCode", 0) < 128:
            return False
    return True


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def execute(repo: Path, runner: Path, spec: dict) -> dict:
    admit(spec)
    output = runner / "c-api-compiler-check"
    output.mkdir(exist_ok=True)
    evidence = {
        "kind": "real RISC-V C API compiler fixture execution",
        "startedAt": now(),
        "spec": spec,
        "records": [],
        "verdict": "INFRA",
    }

    def invocation(label: str, argv: list[str], timeout: int = 120) -> dict:
        started = now()
        result = subprocess.run(
            argv, cwd=repo, capture_output=True, text=True, timeout=timeout
        )
        log = output / (label + ".log")
        log.write_text(result.stdout + result.stderr)
        record = {
            "label": label,
            "argv": argv,
            "startedAt": started,
            "finishedAt": now(),
            "exitCode": result.returncode,
            "logPath": str(log),
            "logSha256": sha(log),
        }
        evidence["records"].append(record)
        return {"record": record, "stdout": result.stdout, "stderr": result.stderr}

    try:
        head = invocation("source-head", ["git", "rev-parse", "HEAD"])
        if head["record"]["exitCode"]:
            raise RuntimeError("source identity unavailable")
        evidence["sourceSha"] = head["stdout"].strip()
        clean = invocation(
            "frozen-input-diff",
            [
                "git",
                "diff",
                "--quiet",
                "HEAD",
                "--",
                spec["positiveFixture"],
                spec["negativeFixture"],
                "examples/balls/clamp/workloads/isa/clamp.h",
                "compiler/scripts/pb_to_target_registry.py",
                "bb-tests/workloads/lib/bbhw/isa",
            ],
        )
        if clean["record"]["exitCode"]:
            raise RuntimeError(
                "fixture/API/generator source differs from the frozen HEAD"
            )
        expected = os.environ.get("RESOLVED_SHA")
        if expected and expected != evidence["sourceSha"]:
            raise RuntimeError("source SHA differs from frozen CI resolved SHA")
        fixtures = {k: repo / spec[k] for k in ("positiveFixture", "negativeFixture")}
        chip_pb = repo / "examples/chips" / spec["chip"] / "configs/generated/chip.pb"
        generator = repo / "compiler/scripts/pb_to_target_registry.py"
        api = repo / "examples/balls/clamp/workloads/isa/clamp.h"
        required = [
            *fixtures.values(),
            chip_pb,
            generator,
            api,
            repo / "bb-tests/workloads/lib/bbhw/isa/bb_func7.h",
            repo / "bb-tests/workloads/lib/bbhw/isa/isa.h",
        ]
        for path in required:
            if not path.is_file():
                raise RuntimeError(
                    "required real source/generated artifact missing: " + str(path)
                )
        evidence["inputHashes"] = {str(p.relative_to(repo)): sha(p) for p in required}
        isa = output / "generated/isa"
        generated = invocation(
            "generate-real-headers",
            [
                sys.executable,
                str(generator),
                "--repo",
                str(repo),
                "--chip-pb",
                str(chip_pb),
                "--isa-dir",
                str(isa),
                "--print-targets",
            ],
        )
        if generated["record"]["exitCode"]:
            raise RuntimeError("canonical Chip.pb header generation failed")
        headers = [isa / spec["target"] / name for name in ("params.h", "ballISA.h")]
        if not all(p.is_file() for p in headers):
            raise RuntimeError(
                "canonical generator did not emit target params/ISA headers"
            )
        evidence["generatedHeaderHashes"] = {str(p): sha(p) for p in headers}
        compilers = {}
        for language, tool in (
            ("gnu11", "riscv64-unknown-elf-gcc"),
            ("gnu++17", "riscv64-unknown-elf-g++"),
        ):
            resolved = shutil.which(tool)
            if not resolved:
                raise RuntimeError("required actual compiler missing: " + tool)
            compiler = Path(resolved).resolve()
            version = invocation(tool + "-version", [str(compiler), "--version"])
            machine = invocation(tool + "-target", [str(compiler), "-dumpmachine"])
            if (
                version["record"]["exitCode"]
                or machine["record"]["exitCode"]
                or not machine["stdout"].strip().startswith("riscv64")
            ):
                raise RuntimeError(
                    "compiler version/real RISC-V target validation failed: " + tool
                )
            compilers[language] = str(compiler)
            evidence.setdefault("compilers", {})[language] = {
                "path": str(compiler),
                "sha256": sha(compiler),
                "version": version["stdout"],
                "target": machine["stdout"].strip(),
            }
        includes = [
            "-I" + str(isa / spec["target"]),
            "-I" + str(repo / "bb-tests/workloads/lib"),
            "-I" + str(repo / "examples/balls/clamp/workloads"),
        ]
        matrix = []
        for language in spec["languages"]:
            for optimization in spec["optimizations"]:
                base = [
                    compilers[language],
                    "-x",
                    "c" if language == "gnu11" else "c++",
                    "-std=" + language,
                    "-" + optimization,
                    "-march=rv64gc",
                    "-mabi=lp64d",
                    *includes,
                ]
                label = "positive-" + language + "-" + optimization
                object_path = output / (label + ".o")
                compiled = invocation(
                    label,
                    [
                        *base,
                        "-c",
                        str(fixtures["positiveFixture"]),
                        "-o",
                        str(object_path),
                    ],
                )
                rc = compiled["record"]["exitCode"]
                elf = object_path.read_bytes()[:20] if object_path.is_file() else b""
                valid_object = (
                    len(elf) >= 20
                    and elf[:4] == b"\x7fELF"
                    and elf[5] == 1
                    and int.from_bytes(elf[18:20], "little") == 243
                )
                verdict = (
                    "PASS"
                    if rc == 0 and valid_object
                    else (
                        "INFRA"
                        if INFRA_ERROR.search(compiled["stderr"]) or rc < 0
                        else "FAIL"
                    )
                )
                matrix.append(
                    {
                        **compiled["record"],
                        "expected": "object compilation success",
                        "verdict": verdict,
                        "objectPath": str(object_path),
                        "objectSha256": (
                            sha(object_path) if object_path.is_file() else None
                        ),
                        "realRiscVObject": valid_object,
                    }
                )
                for case in spec["cases"]:
                    label = (
                        "negative-"
                        + language
                        + "-"
                        + optimization
                        + "-case"
                        + str(case)
                    )
                    rejected = invocation(
                        label,
                        [
                            *base,
                            "-DCASE=" + str(case),
                            "-fsyntax-only",
                            str(fixtures["negativeFixture"]),
                        ],
                    )
                    matrix.append(
                        {
                            **rejected["record"],
                            "expected": "BB_CLAMP_STATIC_CHECK negative array size",
                            "case": case,
                            "verdict": rejection_verdict(
                                rejected["record"]["exitCode"], rejected["stderr"]
                            ),
                        }
                    )
        evidence["matrix"] = matrix
        evidence["positiveCount"] = sum("case" not in x for x in matrix)
        evidence["negativeCount"] = sum("case" in x for x in matrix)
        evidence["verdict"] = (
            "INFRA"
            if any(x["verdict"] == "INFRA" for x in matrix)
            else "FAIL" if any(x["verdict"] == "FAIL" for x in matrix) else "PASS"
        )
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        evidence["error"] = str(error)
        evidence["verdict"] = "INFRA"
    evidence["finishedAt"] = now()
    evidence_path = output / "evidence.json"
    evidence_path.write_text(json.dumps(evidence, indent=2) + "\n")
    evidence["evidencePath"] = str(evidence_path)
    evidence["evidenceSha256"] = sha(evidence_path)
    return evidence
