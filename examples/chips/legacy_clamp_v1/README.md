# legacy_clamp_v1

Independent single-tile, single Pebble architecture instance. Core selection:
`examples/cores/pebble/configs/legacy_clamp_v1.toml`; no default domain import.
Selected Balls: Transpose, SMatMul, Im2col, ToInt8, Int2Fp, MatAdd, Trace, Clamp.

The unchanged private bank geometry is 24 banks × 64 rows × 128 bits. A single
group contains four INT32 per row; Clamp accepts N=4..256 in multiples of four.
The MatAdd→Clamp workload uses four simultaneously allocated single-group banks,
64 values, 16 rows, and compares every output to an independent INT64 CPU sum
followed by signed clamping. No CPU arithmetic can overflow in that workload.

Configuration installation must produce `configs/generated/chip.pb`; generated
files are deliberately absent from source. Reuse the real project install/build
entry points. Workload profile remains `pebble` because the core package is Pebble.
MLIRTest's repository CMake automatically adds configured Ball MLIR directories.
Regression lists contain only expected-success workloads. Negative cases and
capacity/optional-operation exclusions are separate, with explicit reasons.

This is an operator experiment; graph slicing/model binding are not applicable.
CI still runs skeleton→slices→integrate, with operator slices listed again in the
integrate round. Static inspection is not a functional PASS.
