# Adapt Pebble's real PTPX flow with this run's measured Clamp window.
if {![info exists RUN_CONFIG]} { error "missing RUN_CONFIG" }
source $RUN_CONFIG
# DC adds generated SRAM .db files to run.tcl; preserve them for PTPX linking.
set power_config $RUN_CONFIG
set dc_config [file join [file dirname $RUN_CONFIG] run.tcl]
if {![file exists $dc_config]} { error "missing same-run DC config: $dc_config" }
source $dc_config
set dc_link_library $RUN_LINK_LIBRARY
source $power_config
set window "${RUN_ACTIVITY}.window.tcl"
if {![file exists $window]} { error "missing completed Clamp activity evidence: $window" }
set measured_config "${RUN_CONFIG}.clamp-measured.tcl"
set in [open $RUN_CONFIG r]
set out [open $measured_config w]
puts $out [read $in]
close $in
puts $out "source [list [file normalize $window]]"
puts $out "set RUN_LINK_LIBRARY [list $dc_link_library]"
# The activity dump contains the complete top under the gate harness.
puts $out {set RUN_STRIP_PATH GatePowerHarness.dut}
close $out
set RUN_CONFIG $measured_config
set bbdev_ptpx_script [file normalize [file join [file dirname [info script]] .. .. .. .. .. bbdev api steps dc scripts ptpx.tcl]]
source $bbdev_ptpx_script
