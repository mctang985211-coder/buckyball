stage: chip
phase: slices
round: 2
chip: legacy_clamp_v1

Expected PASS workloads:
- legacy_clamp_v1-pebble-ctest-transpose_i8_16x16_test-baremetal
- legacy_clamp_v1-pebble-ctest-smatmul_single_block_test-baremetal
- legacy_clamp_v1-pebble-ctest-im2col_window_test-baremetal
- legacy_clamp_v1-pebble-ctest-quant_f32_to_i8_test-baremetal
- legacy_clamp_v1-pebble-ctest-int2fp_tensor_values_test-baremetal
- legacy_clamp_v1-pebble-ctest-matadd_test-baremetal
- legacy_clamp_v1-pebble-ctest-bdb_counter_test-baremetal
- legacy_clamp_v1-pebble-ctest-matadd_clamp_test-baremetal

Static audit: single tile/core include chain exists; simulation classes globally unique; eight contiguous Ball ids and unique ISA funct7 values; all Ball config paths exist; Pebble 24x64x128 geometry; logical Ball read11/write8 and bank channel13. Generated configuration requires project install.
