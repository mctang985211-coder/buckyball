# Regression adaptation to fork/main

These original-base stems are retired from ordinary lists because current upstream CMake no longer registers them, or their source was renamed/replaced. This does not claim they passed; current replacements are enumerated in workload-inventory.md.

- `legacy_clamp_v1-pebble-ctest-transpose_bank_i8_n1_1024x16_test-baremetal`
- `legacy_clamp_v1-pebble-ctest-transpose_bank_i8_n2_1024x32_test-baremetal`
- `legacy_clamp_v1-pebble-ctest-transpose_bank_i32_n4_1024x16_test-baremetal`
- `legacy_clamp_v1-pebble-ctest-smatmul_single_block_test-baremetal`
- `legacy_clamp_v1-pebble-ctest-matadd_test-baremetal`
- `legacy_clamp_v1-pebble-ctest-matadd_bank_1024x8_i32_test-baremetal`
- `legacy_clamp_v1-pebble-ctest-im2col_matadd_shared_da_test-baremetal`
- `legacy_clamp_v1-pebble-ctest-im2col_matadd_shared_da_pipeline_test-baremetal`
- `legacy_clamp_v1-pebble-ctest-bdb_counter_test-baremetal`
- `legacy_clamp_v1-pebble-mlirtest-bank_transpose_16x16_i8-baremetal`
- `legacy_clamp_v1-pebble-mlirtest-bank_smatmul_bias_accumulate-baremetal`
- `legacy_clamp_v1-pebble-mlirtest-bank_im2col_6x6_k3-baremetal`
- `legacy_clamp_v1-pebble-mlirtest-bank_quant_f32_to_i8-baremetal`
- `legacy_clamp_v1-pebble-mlirtest-bank_quant_i32_to_i8-baremetal`
- `legacy_clamp_v1-pebble-mlirtest-bank_int2fp_4x4-baremetal`
- `legacy_clamp_v1-pebble-mlirtest-bank_int2fp_relu_4x4-baremetal`

New inherited Ball sources and tests remain unmodified. No historical SiLU/LayerNorm tests are imported. New trace MLIR and current geometry-adaptive BankOp templates are included.
