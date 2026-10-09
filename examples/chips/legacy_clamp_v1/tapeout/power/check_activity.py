#!/usr/bin/env python3
"""Extract measured UART-bracketed Clamp activity; no synthetic/default window."""

import re
import sys
from pathlib import Path

log = Path(sys.argv[1]).read_text()
begin = re.findall(r"\[CLAMP_WINDOW\] CLAMP_ACTIVITY_BEGIN (\d+)", log)
end = re.findall(r"\[CLAMP_WINDOW\] CLAMP_ACTIVITY_END (\d+)", log)
if len(begin) != 1 or len(end) != 1 or "matadd_clamp_test PASSED" not in log:
    raise SystemExit("missing unique completed and numerically checked Clamp activity")
start, stop = int(begin[0]), int(end[0])
if not 0 <= start < stop:
    raise SystemExit("invalid measured Clamp activity window")
if re.search(r"workload exit code [1-9]", log):
    raise SystemExit("gate workload failed")
Path(sys.argv[2]).write_text(f"set RUN_START_NS {start}\nset RUN_END_NS {stop}\n")
print(f"measured Clamp window: {start}..{stop} ns (UART command/fence bracket)")
