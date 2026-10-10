stage: chip
phase: slices
round: 2
chip: legacy_clamp_v1

Expected PASS workloads:
- legacy_clamp_v1-pebble-ctest-transpose_i8_16x16_test-baremetal
- legacy_clamp_v1-pebble-ctest-smatmul_1x16x64_test-baremetal
- legacy_clamp_v1-pebble-ctest-im2col_window_test-baremetal
- legacy_clamp_v1-pebble-ctest-quant_f32_to_i8_test-baremetal
- legacy_clamp_v1-pebble-ctest-int2fp_tensor_values_test-baremetal
- legacy_clamp_v1-pebble-ctest-matadd_i32_16row_test-baremetal
- legacy_clamp_v1-pebble-ctest-bdb_counter_start_stop_test-baremetal
- legacy_clamp_v1-pebble-ctest-clamp_test-baremetal

Static audit: own one-tile/one-Pebble include chain; 8 explicit Ball ids 0..7; unchanged 24x64x128 bank geometry/channel13; read11/write8; no default domain import; formal build/simulation remains required.
