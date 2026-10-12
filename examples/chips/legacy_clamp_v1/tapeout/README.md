# legacy_clamp_v1 tapeout adaptation

Reuses Pebble DigitalTop, real DC and PTPX entry points, 100 MHz/10 ns timing
constraint, and SMIC180 SRAM/standard-cell contracts. Library paths are runner
requirements, not evidence that tools/licences/libraries exist. `ip/` files are
existing process MDFs. Generated SRAM shapes must be checked against the emitted
FIRRTL memory manifest; the contract inventory is not a post-elaboration audit.

`power_sim.sh` requires the built `matadd_clamp_test` ELF through `WORKLOAD`.
Its chip-local DPI adapter timestamps completed UART markers using VPI simulator
precision. BEGIN is printed after MatAdd completes, before Clamp; END follows
Clamp's completion fence. The entire measured bracket therefore includes Clamp
and some UART/fence overhead; it is not isolated per-instruction power.
The gate run must print exactly one BEGIN and END and a successful independent
output comparison. Missing activity, truncation, duplicate markers, nonzero SCU
exit, or missing numerical PASS stops the flow. A pure timeout is not PASS.

Simulation writes `<activity>.window.tcl`; PTPX refuses to run without it and
reads its measured bounds instead of a default sampling interval. Simulation
horizon may be adjusted with `CLAMP_SIM_TIMEOUT_NS`; it is separate from measured
power bounds. Keep `run.log`, VCD, window file, generated gate harness, exact ELF,
netlist, timing/area/power reports, process corner and tool versions together.

Shared PTPX reports standard-cell power; SRAM or DRAM coverage and leakage must
be reported separately when available. Target frequency is not achieved timing.
No PPA result has been produced by this static chip-lead task.
