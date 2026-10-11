"""Admit explicit backend coverage against the frozen chip regression files."""

import re
import tomllib


def validate_stems(values, label):
    if (
        not isinstance(values, list)
        or not values
        or any(
            not isinstance(s, str)
            or not re.fullmatch(r"legacy_clamp_v1-[a-zA-Z0-9_-]+", s)
            or "_invalid_" in s
            for s in values
        )
        or len(values) != len(set(values))
    ):
        raise ValueError("invalid positive stems: " + label)


def admit(child, backend_stems, phase, repo):
    if child:
        validate_stems(child["stems"], "child.stems")
        if "rtlStems" in child:
            validate_stems(child["rtlStems"], "child.rtlStems")
            if child["phase"] != "rtl" or not set(child["rtlStems"]).issubset(
                child["stems"]
            ):
                raise ValueError(
                    "rtlStems requires rtl phase and subset of c-bemu stems"
                )
            if any("clamp_capacity_test" in s for s in child["rtlStems"]):
                raise ValueError("capacity positive is BEMU only")
    if backend_stems is None:
        return
    if (
        phase not in ("slices", "integrate")
        or not isinstance(backend_stems, dict)
        or set(backend_stems) != {"bemu", "verilator"}
    ):
        raise ValueError(
            "topBackendStems requires both backends in chip slices/integrate"
        )
    root = repo / "examples/chips/legacy_clamp_v1/regression"
    slices = re.findall(
        r"^- (legacy_clamp_v1-[a-zA-Z0-9_-]+)\s*$",
        (root / "phases/slices.md").read_text(),
        re.M,
    )
    for backend, stems in backend_stems.items():
        validate_stems(stems, "topBackendStems." + backend)
        inventory = tomllib.loads(
            (root / "batch" / backend / "workloads-elf.toml").read_text()
        )["workloads"]["tests"]
        expected = slices if phase == "slices" else inventory
        if stems != expected or not set(stems).issubset(inventory):
            raise ValueError(
                "backend stems differ from frozen "
                + phase
                + "/"
                + backend
                + " regression"
            )
        if backend == "verilator" and any("clamp_capacity_test" in s for s in stems):
            raise ValueError("capacity positive is BEMU only")
