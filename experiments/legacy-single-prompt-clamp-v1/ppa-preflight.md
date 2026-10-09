# PPA preflight (static, actual host)

The SMIC180 process libraries, SRAM CDK and Synopsys tool trees exist. No
synthesis, gate simulation or power analysis has been started. Directory names
are installation evidence, not successful version/license checks.

Direct version probes found real loader blockers: DC needs libpng12.so.0;
LC and PrimeTime need libncurses.so.5; VCS script identifies Q-2020.03 but vcs1
cannot load libelf.so.1 and reports unsupported Ubuntu/kernel. Its driver
returns0 despite the binary error. PrimeTime executable is
`/data2/tools/prime/R-2020.09-SP5-5/bin/pt_shell`; no EDA wrapper exists for it.
FlexNet lmutil itself runs and reports v11.16.4.0 build252457. License env is
unset here; no license checkout or lmstat query was attempted without a server.

Host runner adaptation requirements:
- PATH must expose dc/vcs wrappers plus an equivalent pt_shell wrapper; keep old
  shim LD_LIBRARY_PATH scoped to each EDA tool, not Nix or compiler processes.
- Bind `/data2/smic180` to `/home/bb-runner/Code/eda/D_libraries/SMIC180`, and real
  syn tree to `/home/bb-runner/Code/eda/A_packages/tools/syn/R-2020.09-SP5`.
- Bind LC wrapper to contract absolute lc_shell path; wrapper delegates real
  `/data2/tools/lc/R-2020.09-SP5/bin/lc_shell`.
- Provide the actual legacy PNG/ncurses/ELF libraries, existing libpthread shim,
  LC system libstdc++ swap, and files-only NSS bind where bwrap requires it.
  Current `/home/ROXY/bb-verify/eda-env/lib` contains only libpthread symlink;
  the wrapper's `/nix/store/*-lc-libs/lib` match yielded no usable library paths.
- Supply authorized license env from runner deployment without logging secrets.
  EDA_SESSION_BINDS/SNPSLMD_LICENSE_FILE/LM_LICENSE_FILE are unset in this agent.

The old verify-runner `run-verify.sh` supports semicolon-separated source>dest
EDA_SESSION_BINDS, performs bwrap host mounts, and documents the LC libstdc++/NSS
fixes. PPA must execute inside the prepared verifier environment after functional
acceptance; do not infer usable tools from host tree existence.

Top and report audit: chip config requests `DigitalTop`, not a ClampBall-only
module. Tapeout Scala instantiates this experiment's own generated chip.pb and
full Rocket/Pebble composition. DC analyzes the complete bbdev source list,
elaborates RUN_TOP, preserves hierarchy and SRAM, and emits DigitalTop.v/ddc/sdc.
The 10ns clock/100MHz target is constrained with3ns uncertainty,1ns transition,
7ns input/output delay. It is not achieved frequency. Actual hierarchy must show
one Pebble instance and all eight registered Balls before PPA acceptance.

Gate harness instantiates full DigitalTop. Its UART VPI timestamps are valid only
if VCS compilation and mapped top ports succeed. Counter events alone do not
prove Clamp execution. The chosen workload tests nontrivial saturated outputs,
uses poisoned output and exact independent comparison, and timestamps a bracket
around bb_clamp+completion fence. The bracket includes UART/fence overhead;
reports describe whole-chip activity rather than isolated Ball energy. Missing
markers, lack of numerical PASS, bad bounds or failure exit hard-fail. No fixed
sampling window remains.

Additional static fixes made inside chip: real dc-sim run.env omits TARGET_LIBRARY,
so script resolves it from this chip's config. Real pt step ignores dynamic SRAM
link_dbs and default strip path, so chip PTPX wrapper preserves same-run DC
run.tcl SRAM links and uses GatePowerHarness.dut. This prevents library coverage
and VCD hierarchy from being silently lost without changing shared framework.

Exact artifact locations relative to bbdev analysis_dir are in ppa-preflight.json.
No area/timing/power numbers exist yet. Missing loader/libs/licenses are blocking
facts requiring preparation, not evidence that process PPA is impossible.
