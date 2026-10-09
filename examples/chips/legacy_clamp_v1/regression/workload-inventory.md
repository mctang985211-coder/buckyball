# Existing Ball workload inventory (static source evidence)

Profile prefix: `legacy_clamp_v1-pebble-`; suffix: `-baremetal`.

## transpose

CMake registered C stems:
- `ctest-transpose_i8_16x16_test`
- `ctest-transpose_i8_16x32_test`
- `ctest-transpose_i32_8x16_test`
- `ctest-transpose_bank_i8_n1_1024x16_test`
- `ctest-transpose_bank_i8_n2_1024x32_test`
- `ctest-transpose_bank_i32_n4_1024x16_test`

MLIR sources:
- `mlirtest-ball_transpose_16x16_i8` ← `examples/balls/transpose/workloads/mlir_tests/ball/transpose_16x16_i8.mlir`
- `mlirtest-bank_transpose_16x16_i8` ← `examples/balls/transpose/workloads/mlir_tests/bank/transpose_16x16_i8.mlir`

## smatmul

CMake registered C stems:
- `ctest-smatmul_bias_accumulate_test`
- `ctest-smatmul_single_block_test`

MLIR sources:
- `mlirtest-ball_smatmul_bias_accumulate` ← `examples/balls/smatmul/workloads/mlir_tests/ball/smatmul_bias_accumulate.mlir`
- `mlirtest-bank_smatmul_bias_accumulate` ← `examples/balls/smatmul/workloads/mlir_tests/bank/smatmul_bias_accumulate.mlir`

## im2col

CMake registered C stems:
- `ctest-im2col_window_test`

MLIR sources:
- `mlirtest-ball_im2col_6x6_k3` ← `examples/balls/im2col/workloads/mlir_tests/ball/im2col_6x6_k3.mlir`
- `mlirtest-bank_im2col_6x6_k3` ← `examples/balls/im2col/workloads/mlir_tests/bank/im2col_6x6_k3.mlir`

## toint8

CMake registered C stems:
- `ctest-quant_f32_to_i8_test`
- `ctest-quant_i32_to_i8_test`

MLIR sources:
- `mlirtest-ball_quant_f32_to_i8` ← `examples/balls/toint8/workloads/mlir_tests/ball/quant_f32_to_i8.mlir`
- `mlirtest-ball_quant_i32_to_i8` ← `examples/balls/toint8/workloads/mlir_tests/ball/quant_i32_to_i8.mlir`
- `mlirtest-bank_quant_f32_to_i8` ← `examples/balls/toint8/workloads/mlir_tests/bank/quant_f32_to_i8.mlir`
- `mlirtest-bank_quant_i32_to_i8` ← `examples/balls/toint8/workloads/mlir_tests/bank/quant_i32_to_i8.mlir`

## int2fp

CMake registered C stems:
- `ctest-int2fp_tensor_values_test`
- `ctest-int2fp_tensor_groups_test`
- `ctest-int2fp_tensor_rows_test`
- `ctest-int2fp_channel_lanes_test`
- `ctest-int2fp_channel_base_test`
- `ctest-int2fp_channel_two_rows_test`

MLIR sources:
- `mlirtest-ball_int2fp_4x4` ← `examples/balls/int2fp/workloads/mlir_tests/ball/int2fp_4x4.mlir`
- `mlirtest-ball_int2fp_relu_4x4` ← `examples/balls/int2fp/workloads/mlir_tests/ball/int2fp_relu_4x4.mlir` (Int2Fp built-in relu flag; supported)
- `mlirtest-bank_int2fp_4x4` ← `examples/balls/int2fp/workloads/mlir_tests/bank/int2fp_4x4.mlir`
- `mlirtest-bank_int2fp_relu_4x4` ← `examples/balls/int2fp/workloads/mlir_tests/bank/int2fp_relu_4x4.mlir` (Int2Fp built-in relu flag; supported)

## matadd

CMake registered C stems:
- `ctest-matadd_test`
- `ctest-matadd_bank_1024x8_i32_test`
- `ctest-matadd_after_smatmul_os_test`
- `ctest-im2col_matadd_shared_da_test`
- `ctest-im2col_matadd_shared_da_pipeline_test`

MLIR sources:
- `mlirtest-bank_matadd_bank_1024x8_i32` ← `examples/balls/matadd/workloads/mlir_tests/bank/matadd_bank_1024x8_i32.mlir` (excluded: hard-coded 1024 rows exceeds Pebble bank entries=64)

## trace

CMake registered C stems:
- `ctest-bdb_counter_test`

MLIR sources:
- none

## clamp (new experimental evidence, not reused Ball evidence)

Ordinary C: `ctest-clamp_test`, `ctest-clamp_capacity_test` (BEMU-only).
MLIR: `mlirtest-ball_clamp_4x4`, `mlirtest-bank_clamp_4x4`.
Nine raw-ISA negative C stems are enumerated in negative-tests.toml.
Compiler expected-rejection fixtures: `examples/balls/clamp/compiler/tests/invalid_*.mlir`;
run standalone through lower-buckyball, requiring compilation failure rather than
adding them to ordinary MLIR workload build inputs.
