# Formal legacy experiment round 13
stage: chip
phase: integrate
round: 13
chip: legacy_clamp_v1

## Changes
- .github/scripts/bb-verify/check-prereqs.sh
- .github/scripts/bb-verify/codex-adapter/README.md
- .github/scripts/bb-verify/codex-adapter/archive-session.py
- .github/scripts/bb-verify/codex-adapter/backend-stems.py
- .github/scripts/bb-verify/codex-adapter/bbdev-mcp.py
- .github/scripts/bb-verify/codex-adapter/c_api_check.py
- .github/scripts/bb-verify/codex-adapter/check-mcp-startup.py
- .github/scripts/bb-verify/codex-adapter/evidence-output-guidance.md
- .github/scripts/bb-verify/codex-adapter/extension.py
- .github/scripts/bb-verify/codex-adapter/knowledge-fallback.md
- .github/scripts/bb-verify/codex-adapter/legacy-plan.ts
- .github/scripts/bb-verify/codex-adapter/legacy-prompts.md
- .github/scripts/bb-verify/codex-adapter/phase-protocol.py
- .github/scripts/bb-verify/codex-adapter/run-bbdev-mcp.sh
- .github/scripts/bb-verify/codex-adapter/run-codex-verify.sh
- .github/scripts/bb-verify/codex-adapter/runtime-closure.py
- .github/scripts/bb-verify/codex-adapter/status-evidence.py
- .github/scripts/bb-verify/codex-adapter/test-extension-admission.py
- .github/scripts/bb-verify/codex-adapter/test-mcp-startup.py
- .github/scripts/bb-verify/codex-adapter/test-phase-protocol.py
- .github/scripts/bb-verify/legacy-runner/scripts/bb-verify-watchdog.sh
- .github/scripts/bb-verify/legacy-runner/scripts/binding-check.mjs
- .github/scripts/bb-verify/legacy-runner/scripts/ci-dispatch.mjs
- .github/scripts/bb-verify/legacy-runner/scripts/infer-stage.mjs
- .github/scripts/bb-verify/legacy-runner/scripts/manifest.mjs
- .github/scripts/bb-verify/legacy-runner/scripts/probe-loop-check.mjs
- .github/scripts/bb-verify/legacy-runner/scripts/ref-context.mjs
- .github/scripts/bb-verify/legacy-runner/scripts/runner-orphan-sweep.sh
- .github/scripts/bb-verify/legacy-runner/scripts/selftest-deterministic.mjs
- .github/scripts/bb-verify/legacy-runner/scripts/slices-verify.mjs
- .github/scripts/bb-verify/legacy-runner/scripts/validate-manifest.mjs
- .github/scripts/bb-verify/legacy-runner/src/prompts/0-hints.prompts.ts
- .github/scripts/bb-verify/legacy-runner/src/prompts/1.0-run-succeeded.prompts.ts
- .github/scripts/bb-verify/legacy-runner/src/prompts/1.1-run-failed.prompts.ts
- .github/scripts/bb-verify/legacy-runner/src/prompts/1.2-input-rejected.prompts.ts
- .github/scripts/bb-verify/legacy-runner/src/prompts/1.3-probe-evidence-missing.prompts.ts
- .github/scripts/bb-verify/legacy-runner/src/prompts/1.4-post-back-failed.prompts.ts
- .github/scripts/bb-verify/legacy-runner/src/prompts/2-verify.prompts.ts
- .github/scripts/bb-verify/legacy-runner/src/prompts/core.prompts.ts
- .github/scripts/bb-verify/prepare.sh
- .github/workflows/bb-verify.yml
- bb-tests/workloads/CMakeLists.txt
- compiler/src/Target/BuckyballTargetRegistry.cpp
- examples/balls/clamp/arch/src/main/scala/Clamp.scala
- examples/balls/clamp/arch/src/main/scala/ClampBall.scala
- examples/balls/clamp/compiler/src/Conversion/LowerBuckyball/AssignPhysicalBankPatterns.cpp
- examples/balls/clamp/compiler/src/Dialect/Buckyball/ClampBall.td
- examples/balls/clamp/compiler/src/Dialect/Buckyball/Transforms/LegalizeForLLVMExport.cpp
- examples/balls/clamp/compiler/tests/c_api/README.md
- examples/balls/clamp/compiler/tests/c_api/static_invalid.c
- examples/balls/clamp/compiler/tests/c_api/static_valid.c
- examples/balls/clamp/compiler/tests/invalid_alias.mlir
- examples/balls/clamp/compiler/tests/invalid_bank_range.mlir
- examples/balls/clamp/compiler/tests/invalid_bounds_range.mlir
- examples/balls/clamp/compiler/tests/invalid_dynamic_mset_config.mlir
- examples/balls/clamp/compiler/tests/invalid_dynamic_mset_id.mlir
- examples/balls/clamp/compiler/tests/invalid_lo_gt_hi.mlir
- examples/balls/clamp/compiler/tests/invalid_misaligned_n.mlir
- examples/balls/clamp/compiler/tests/invalid_multigroup.mlir
- examples/balls/clamp/compiler/tests/invalid_over_capacity.mlir
- examples/balls/clamp/compiler/tests/invalid_unallocated.mlir
- examples/balls/clamp/compiler/tests/invalid_unknown_call.mlir
- examples/balls/clamp/compiler/tests/invalid_zero_n.mlir
- examples/balls/clamp/configs/default.toml
- examples/balls/clamp/contract.md
- examples/balls/clamp/emu/src/clamp.rs
- examples/balls/clamp/emu/src/lib.rs
- examples/balls/clamp/workloads/ctests/CMakeLists.txt
- examples/balls/clamp/workloads/ctests/clamp_capacity_test.c
- examples/balls/clamp/workloads/ctests/clamp_invalid_alias.c
- examples/balls/clamp/workloads/ctests/clamp_invalid_bank_range.c
- examples/balls/clamp/workloads/ctests/clamp_invalid_lo_gt_hi.c
- examples/balls/clamp/workloads/ctests/clamp_invalid_misaligned_n.c
- examples/balls/clamp/workloads/ctests/clamp_invalid_multigroup.c
- examples/balls/clamp/workloads/ctests/clamp_invalid_over_capacity.c
- examples/balls/clamp/workloads/ctests/clamp_invalid_reserved.c
- examples/balls/clamp/workloads/ctests/clamp_invalid_unallocated.c
- examples/balls/clamp/workloads/ctests/clamp_invalid_zero_n.c
- examples/balls/clamp/workloads/ctests/clamp_test.c
- examples/balls/clamp/workloads/isa/clamp.h
- examples/balls/clamp/workloads/mlir_tests/CMakeLists.txt
- examples/balls/clamp/workloads/mlir_tests/ball/CMakeLists.txt
- examples/balls/clamp/workloads/mlir_tests/ball/clamp_4x4.mlir
- examples/balls/clamp/workloads/mlir_tests/ball/clamp_4x4_main.cpp
- examples/balls/clamp/workloads/mlir_tests/bank/CMakeLists.txt
- examples/balls/clamp/workloads/mlir_tests/bank/clamp_4x4.mlir
- examples/balls/clamp/workloads/mlir_tests/bank/clamp_4x4_main.cpp
- examples/balls/smatmul/arch/src/main/scala/Array.scala
- examples/balls/smatmul/compiler/src/Conversion/LowerTileToBuckyball/TileMatMulPatterns.cpp
- examples/chips/legacy_clamp_v1/README.md
- examples/chips/legacy_clamp_v1/arch/src/main/scala/CustomConfigs.scala
- examples/chips/legacy_clamp_v1/arch/src/main/scala/sims/p2e/TargetConfigs.scala
- examples/chips/legacy_clamp_v1/arch/src/main/scala/sims/tapeout/TargetConfigs.scala
- examples/chips/legacy_clamp_v1/arch/src/main/scala/sims/verilator/TargetConfigs.scala
- examples/chips/legacy_clamp_v1/configs/chip.toml
- examples/chips/legacy_clamp_v1/configs/designs/legacy_clamp_v1.toml
- examples/chips/legacy_clamp_v1/configs/designs/tiles/default.toml
- examples/chips/legacy_clamp_v1/regression/batch/bemu/workloads-elf.toml
- examples/chips/legacy_clamp_v1/regression/batch/bemu/workloads-pk.toml
- examples/chips/legacy_clamp_v1/regression/batch/p2e/workloads-elf.toml
- examples/chips/legacy_clamp_v1/regression/batch/p2e/workloads-pk.toml
- examples/chips/legacy_clamp_v1/regression/batch/verilator/workloads-elf.toml
- examples/chips/legacy_clamp_v1/regression/batch/verilator/workloads-pk.toml
- examples/chips/legacy_clamp_v1/regression/candidate-static-audit.md
- examples/chips/legacy_clamp_v1/regression/exclusions.toml
- examples/chips/legacy_clamp_v1/regression/negative-tests.toml
- examples/chips/legacy_clamp_v1/regression/phases/integrate.md
- examples/chips/legacy_clamp_v1/regression/phases/skeleton.md
- examples/chips/legacy_clamp_v1/regression/phases/slices.md
- examples/chips/legacy_clamp_v1/regression/stem-migration.md
- examples/chips/legacy_clamp_v1/regression/workload-inventory.md
- examples/chips/legacy_clamp_v1/tapeout/README.md
- examples/chips/legacy_clamp_v1/tapeout/area/.gitignore
- examples/chips/legacy_clamp_v1/tapeout/area/constraints.sdc
- examples/chips/legacy_clamp_v1/tapeout/area/dc.tcl
- examples/chips/legacy_clamp_v1/tapeout/config.toml
- examples/chips/legacy_clamp_v1/tapeout/ip/smic180_sram_library.mdf.json
- examples/chips/legacy_clamp_v1/tapeout/ip/tsmc28_sram_library.mdf.json
- examples/chips/legacy_clamp_v1/tapeout/power/check_activity.py
- examples/chips/legacy_clamp_v1/tapeout/power/gate_dpi.cc
- examples/chips/legacy_clamp_v1/tapeout/power/power.tcl
- examples/chips/legacy_clamp_v1/tapeout/power/power_sim.sh
- examples/chips/legacy_clamp_v1/workloads/CMakeLists.txt
- examples/chips/legacy_clamp_v1/workloads/ctests/CMakeLists.txt
- examples/chips/legacy_clamp_v1/workloads/ctests/matadd_clamp_test.c
- examples/cores/pebble/compiler/src/CMakeLists.txt
- examples/cores/pebble/compiler/src/Conversion/LowerBuckyball/CMakeLists.txt
- examples/cores/pebble/compiler/src/Conversion/LowerBuckyball/MegaKernelToBankSSAPatterns.cpp
- examples/cores/pebble/compiler/src/Conversion/LowerBuckyball/ResidentConvRegionToBankSSAPatterns.cpp
- examples/cores/pebble/compiler/src/Dialect/Buckyball/Transforms/CMakeLists.txt
- examples/cores/pebble/configs/balldomains/legacy_clamp_v1.toml
- examples/cores/pebble/configs/legacy_clamp_v1.toml
- experiments/legacy-single-prompt-clamp-v1/README.md
- experiments/legacy-single-prompt-clamp-v1/audit-registry.py
- experiments/legacy-single-prompt-clamp-v1/ball-designer.md
- experiments/legacy-single-prompt-clamp-v1/chip-lead.md
- experiments/legacy-single-prompt-clamp-v1/dependencies/flake.lock.generated
- experiments/legacy-single-prompt-clamp-v1/environment.json
- experiments/legacy-single-prompt-clamp-v1/host-tools.json
- experiments/legacy-single-prompt-clamp-v1/install-verifier-runtime.py
- experiments/legacy-single-prompt-clamp-v1/isa-occupancy.json
- experiments/legacy-single-prompt-clamp-v1/original-prompt-v2.md
- experiments/legacy-single-prompt-clamp-v1/ppa-preflight.json
- experiments/legacy-single-prompt-clamp-v1/ppa-preflight.md
- experiments/legacy-single-prompt-clamp-v1/verifier-runtime.json

## Expected tests
Run the actual complete positive backend inventories: 55 BEMU and 54 Verilator stems, exactly the checked-in workloads-elf TOMLs. Both cover all eight Balls and MatAdd→Clamp; capacity positive is BEMU only. Retain the unchanged original chip/integrate BEMU plan and explicit unchanged ball/rtl-generated backend coverage plan, with their real identities recorded.

The current ref-only legacy context has comments=[] and reviews=[]; therefore the real slices-gate remains applicable=true found=false and the original integrate self-run branch is mandatory. Do not claim that a saved previous artifact changed this injected block. This manifest admits the full BEMU inventory for that original self-run sequence, followed by the original BEMU batch step; preserve actual generated plan order and record its execution cost. Before any Verilator operation, the complete independent Ball/ClampBall/c-bemu five-positive prerequisite must have actual success at this same readonly SHA. Child RTL uses four small positives, excluding capacity. Exact same-run trace reuse is allowed only where the original generated order matches.

Prior Round 10 run 38119838400 is still awaiting terminal verification at preparation time. Before dispatching this draft, independently audit its actual artifact and compare source commit b1d4ba91b008fa01985e2fc169b179f86f64c7d9, resolved temp SHA, parent/tree binding, real slices coverage, model/provider and readonly evidence. Previous Round 10 report is independent stage readiness evidence only: a different temp head and empty ref history cannot manufacture found=true. No slices PASS is claimed here.

All nine BEMU and nine observable RTL expected failures remain separate from positive inventories, with exact implemented panic/assert diagnostics and trace binding. Preserve all 12 real MLIR diagnostic rejects and the real C API 4-object/48-reject matrix. Dependency failures never count as expected rejection. Missing or invalid evidence prevents PASS.

```legacy-verification-extension
{
  "version": 1,
  "ballSubphase": {
    "ball": "ClampBall",
    "phase": "rtl",
    "chip": "legacy_clamp_v1",
    "stems": [
      "legacy_clamp_v1-pebble-ctest-clamp_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-clamp_capacity_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-matadd_clamp_test-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_clamp_4x4-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_clamp_4x4-baremetal"
    ],
    "rtlStems": [
      "legacy_clamp_v1-pebble-ctest-clamp_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-matadd_clamp_test-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_clamp_4x4-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_clamp_4x4-baremetal"
    ]
  },
  "expectedFailures": [
    {
      "id": "clamp_invalid_lo_gt_hi",
      "backend": "bemu",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_lo_gt_hi-baremetal",
      "expectedPattern": "clamp: lo must not exceed hi"
    },
    {
      "id": "clamp_invalid_zero_n",
      "backend": "bemu",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_zero_n-baremetal",
      "expectedPattern": "clamp: N must be positive"
    },
    {
      "id": "clamp_invalid_misaligned_n",
      "backend": "bemu",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_misaligned_n-baremetal",
      "expectedPattern": "clamp: N must be a multiple of 4"
    },
    {
      "id": "clamp_invalid_over_capacity",
      "backend": "bemu",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_over_capacity-baremetal",
      "expectedPattern": "clamp: N exceeds bank capacity"
    },
    {
      "id": "clamp_invalid_bank_range",
      "backend": "bemu",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_bank_range-baremetal",
      "expectedPattern": "clamp: input bank out of range"
    },
    {
      "id": "clamp_invalid_unallocated",
      "backend": "bemu",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_unallocated-baremetal",
      "expectedPattern": "clamp: bank 0 not allocated"
    },
    {
      "id": "clamp_invalid_multigroup",
      "backend": "bemu",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_multigroup-baremetal",
      "expectedPattern": "clamp: bank 0 must be single group"
    },
    {
      "id": "clamp_invalid_alias",
      "backend": "bemu",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_alias-baremetal",
      "expectedPattern": "clamp: banks must be distinct"
    },
    {
      "id": "clamp_invalid_reserved",
      "backend": "bemu",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_reserved-baremetal",
      "expectedPattern": "clamp: reserved BANK1 must be zero"
    },
    {
      "id": "clamp_invalid_lo_gt_hi_rtl",
      "backend": "rtl",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_lo_gt_hi-baremetal",
      "expectedPattern": "clamp: lo must not exceed hi"
    },
    {
      "id": "clamp_invalid_zero_n_rtl",
      "backend": "rtl",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_zero_n-baremetal",
      "expectedPattern": "clamp: N must be positive"
    },
    {
      "id": "clamp_invalid_misaligned_n_rtl",
      "backend": "rtl",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_misaligned_n-baremetal",
      "expectedPattern": "clamp: N must be a multiple of 4"
    },
    {
      "id": "clamp_invalid_over_capacity_rtl",
      "backend": "rtl",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_over_capacity-baremetal",
      "expectedPattern": "clamp: N exceeds bank capacity"
    },
    {
      "id": "clamp_invalid_bank_range_rtl",
      "backend": "rtl",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_bank_range-baremetal",
      "expectedPattern": "GlobalDecoder: bank0 is outside configured ranges"
    },
    {
      "id": "clamp_invalid_unallocated_rtl",
      "backend": "rtl",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_unallocated-baremetal",
      "expectedPattern": "clamp: input bank not allocated"
    },
    {
      "id": "clamp_invalid_multigroup_rtl",
      "backend": "rtl",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_multigroup-baremetal",
      "expectedPattern": "clamp: input bank must be single group"
    },
    {
      "id": "clamp_invalid_alias_rtl",
      "backend": "rtl",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_alias-baremetal",
      "expectedPattern": "clamp: banks must be distinct"
    },
    {
      "id": "clamp_invalid_reserved_rtl",
      "backend": "rtl",
      "chip": "legacy_clamp_v1",
      "binary": "legacy_clamp_v1-pebble-ctest-clamp_invalid_reserved-baremetal",
      "expectedPattern": "clamp: reserved BANK1 must be zero"
    }
  ],
  "compilerExpectedFailures": [
    {
      "id": "compiler_invalid_alias",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_alias.mlir",
      "expectedPattern": "Clamp banks must be distinct"
    },
    {
      "id": "compiler_invalid_bank_range",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_bank_range.mlir",
      "expectedPattern": "Clamp bank IDs must be constants within the target bank range"
    },
    {
      "id": "compiler_invalid_bounds_range",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_bounds_range.mlir",
      "expectedPattern": "Clamp bounds must be signed INT32 constants with lo <= hi"
    },
    {
      "id": "compiler_invalid_dynamic_mset_config",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_dynamic_mset_config.mlir",
      "expectedPattern": "Clamp cannot prove allocation across dynamic MSET configuration"
    },
    {
      "id": "compiler_invalid_dynamic_mset_id",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_dynamic_mset_id.mlir",
      "expectedPattern": "Clamp cannot prove allocation across dynamic MSET bank ID"
    },
    {
      "id": "compiler_invalid_lo_gt_hi",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_lo_gt_hi.mlir",
      "expectedPattern": "Clamp bounds must be signed INT32 constants with lo <= hi"
    },
    {
      "id": "compiler_invalid_misaligned_n",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_misaligned_n.mlir",
      "expectedPattern": "Clamp N must be a positive constant multiple of 4 within capacity"
    },
    {
      "id": "compiler_invalid_multigroup",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_multigroup.mlir",
      "expectedPattern": "Clamp requires an allocated single-group bank"
    },
    {
      "id": "compiler_invalid_over_capacity",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_over_capacity.mlir",
      "expectedPattern": "Clamp N must be a positive constant multiple of 4 within capacity"
    },
    {
      "id": "compiler_invalid_unallocated",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_unallocated.mlir",
      "expectedPattern": "Clamp bank allocation must be statically provable in the same block"
    },
    {
      "id": "compiler_invalid_unknown_call",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_unknown_call.mlir",
      "expectedPattern": "Clamp cannot prove allocation across unknown call"
    },
    {
      "id": "compiler_invalid_zero_n",
      "fixture": "examples/balls/clamp/compiler/tests/invalid_zero_n.mlir",
      "expectedPattern": "Clamp N must be a positive constant multiple of 4 within capacity"
    }
  ],
  "cApiCompilerCheck": {
    "chip": "legacy_clamp_v1",
    "target": "pebble",
    "positiveFixture": "examples/balls/clamp/compiler/tests/c_api/static_valid.c",
    "negativeFixture": "examples/balls/clamp/compiler/tests/c_api/static_invalid.c",
    "cases": [
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12
    ],
    "languages": [
      "gnu11",
      "gnu++17"
    ],
    "optimizations": [
      "O0",
      "O2"
    ]
  },
  "topBackendStems": {
    "bemu": [
      "legacy_clamp_v1-pebble-ctest-transpose_i8_16x16_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-transpose_i8_16x32_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-transpose_i32_8x16_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_bias_accumulate_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_1x16x64_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_8x16_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_16x16_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_16x16x32_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_nondefault_banks_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_window_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k1_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k3_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k3_pad_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k3_asym_pad_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k3_partial_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k5_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k7_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-quant_f32_to_i8_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-quant_i32_to_i8_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-toint8_i8_rounding_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-toint8_i8_rows_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-toint8_i8_scale_rows_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-toint8_i8_signed_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_tensor_values_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_tensor_groups_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_tensor_rows_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_channel_lanes_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_channel_base_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_channel_two_rows_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-matadd_i32_16row_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-bdb_counter_start_stop_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-bdb_counter_read_active_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-bdb_counter_nested_pair_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-bdb_counter_multi_id_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-clamp_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-clamp_capacity_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-matadd_clamp_test-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_transpose_16x16_i8-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_transpose_i8_packed_matrix-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_smatmul_bias_accumulate-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_smatmul_bias_two_terms-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_im2col_6x6_k3-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_im2col_k3_padded_bank_windows-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_quant_f32_to_i8-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_quant_i32_to_i8-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_quant_i32_pack16-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_quant_f32_pack16-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_int2fp_4x4-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_int2fp_relu_4x4-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_int2fp_unit_scale-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_matadd_i32-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_matadd_i32_elementwise-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_bdb_counter_start_read_stop-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_clamp_4x4-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_clamp_4x4-baremetal"
    ],
    "verilator": [
      "legacy_clamp_v1-pebble-ctest-transpose_i8_16x16_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-transpose_i8_16x32_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-transpose_i32_8x16_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_bias_accumulate_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_1x16x64_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_8x16_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_16x16_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_16x16x32_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-smatmul_nondefault_banks_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_window_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k1_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k3_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k3_pad_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k3_asym_pad_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k3_partial_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k5_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-im2col_k7_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-quant_f32_to_i8_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-quant_i32_to_i8_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-toint8_i8_rounding_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-toint8_i8_rows_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-toint8_i8_scale_rows_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-toint8_i8_signed_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_tensor_values_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_tensor_groups_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_tensor_rows_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_channel_lanes_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_channel_base_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-int2fp_channel_two_rows_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-matadd_i32_16row_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-bdb_counter_start_stop_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-bdb_counter_read_active_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-bdb_counter_nested_pair_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-bdb_counter_multi_id_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-clamp_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-matadd_clamp_test-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_transpose_16x16_i8-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_transpose_i8_packed_matrix-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_smatmul_bias_accumulate-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_smatmul_bias_two_terms-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_im2col_6x6_k3-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_im2col_k3_padded_bank_windows-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_quant_f32_to_i8-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_quant_i32_to_i8-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_quant_i32_pack16-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_quant_f32_pack16-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_int2fp_4x4-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_int2fp_relu_4x4-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_int2fp_unit_scale-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_matadd_i32-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_matadd_i32_elementwise-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_bdb_counter_start_read_stop-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-ball_clamp_4x4-baremetal",
      "legacy_clamp_v1-pebble-mlirtest-bank_clamp_4x4-baremetal"
    ]
  }
}
```

The complete final report must contain the unchanged five blocks, actual stage/backend/child identities, exact resolved head sha and real session identity/usage, full terminal coverage and raw diagnostic paths. Integrate/full functional PASS is required before PPA; no PPA or prior slices PASS is asserted by this preparation.

Preparation status: ready for dispatch after round12 real terminal PASS and independent review at this exact source SHA. Frozen source SHA: cb502ab3ad518a7730ed61c4c85e348115ced8c5

Ref-mode comments/reviews remain empty; slices-gate applicable=true found=false is expected and must not be bypassed by inserting round12 evidence as comments/history. The unchanged frozen prompt requires this integrate run to self-run slices before integrate. Obtain the real chip/slices planner with the eight BEMU stems below, and the unchanged ball/rtl planner with the eight RTL stems below, separately from the 55/54 integrate plans. Retain both planner identities, ordered submissions and successful terminal statuses in this run; the self-run sequences are supplemental obligations, not automatically enforced by the existing integrate extension gate. The verifier must inspect and report them explicitly. A prior run trace cannot fulfill this obligation. Same-run identical-command current-SHA successful trace reuse is allowed only where it preserves every required planner order. First complete all five child BEMU prerequisites before any RTL.

Self-run slices bemu stems (actual planner input):
- legacy_clamp_v1-pebble-ctest-transpose_i8_16x16_test-baremetal
- legacy_clamp_v1-pebble-ctest-smatmul_1x16x64_test-baremetal
- legacy_clamp_v1-pebble-ctest-im2col_window_test-baremetal
- legacy_clamp_v1-pebble-ctest-quant_f32_to_i8_test-baremetal
- legacy_clamp_v1-pebble-ctest-int2fp_tensor_values_test-baremetal
- legacy_clamp_v1-pebble-ctest-matadd_i32_16row_test-baremetal
- legacy_clamp_v1-pebble-ctest-bdb_counter_start_stop_test-baremetal
- legacy_clamp_v1-pebble-ctest-clamp_test-baremetal

Self-run slices verilator stems (actual planner input):
- legacy_clamp_v1-pebble-ctest-transpose_i8_16x16_test-baremetal
- legacy_clamp_v1-pebble-ctest-smatmul_1x16x64_test-baremetal
- legacy_clamp_v1-pebble-ctest-im2col_window_test-baremetal
- legacy_clamp_v1-pebble-ctest-quant_f32_to_i8_test-baremetal
- legacy_clamp_v1-pebble-ctest-int2fp_tensor_values_test-baremetal
- legacy_clamp_v1-pebble-ctest-matadd_i32_16row_test-baremetal
- legacy_clamp_v1-pebble-ctest-bdb_counter_start_stop_test-baremetal
- legacy_clamp_v1-pebble-ctest-clamp_test-baremetal

Execution organization: use code-mode loops to invoke matching MCP tools in the actual unchanged planner order and poll the same service instance to each terminal, emitting only brief status and trace IDs. Simulation polling may use 3–5 seconds, avoiding fixed 30-second idle waits and repeated fullplan/log expansion. Preserve full raw evidence, self-run slices order, all scopes and acceptance gates; never substitute handwritten PASS.

Round15 adapter repair is committed; this manifest is bound to the frozen source SHA above. Static admission is not functional PASS. Round14 was actively canceled after independent audit found protocol ordering noncompliance, not a product assertion FAIL or full functional PASS. With old slices-gate found=false, the adapter phaseProtocol supplies original-planner selfRunPlans and childPrerequisite, enforces them on real native submissions, and emits the same-service successful boundary before integrate simulations. Complete child c-bemu and BEMU slices before RTL; then complete RTL slices before starting integrate. Shared build traces may be reused in original order, while all integrate sim submissions must occur after this boundary. Preserve the raw phase/session binding and actual gold outputs in the full report.
