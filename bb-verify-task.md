# Formal legacy experiment round 1
stage: chip
phase: skeleton
round: 1
chip: legacy_clamp_v1

## Changes
- .github/scripts/bb-verify/backstop.sh
- .github/scripts/bb-verify/check-prereqs.sh
- .github/scripts/bb-verify/codex-adapter/README.md
- .github/scripts/bb-verify/codex-adapter/archive-session.py
- .github/scripts/bb-verify/codex-adapter/bbdev-mcp.py
- .github/scripts/bb-verify/codex-adapter/extension.py
- .github/scripts/bb-verify/codex-adapter/legacy-plan.ts
- .github/scripts/bb-verify/codex-adapter/legacy-prompts.md
- .github/scripts/bb-verify/codex-adapter/run-bbdev-mcp.sh
- .github/scripts/bb-verify/codex-adapter/run-codex-verify.sh
- .github/scripts/bb-verify/final-gates.sh
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
- .github/scripts/bb-verify/post-status.sh
- .github/scripts/bb-verify/pre-commit-gate.sh
- .github/scripts/bb-verify/prepare.sh
- .github/scripts/bb-verify/provision.sh
- .github/scripts/bb-verify/run-verify.sh
- .github/scripts/bb-verify/setup-dsh.sh
- .github/scripts/bb-verify/validate-inputs.sh
- .github/scripts/bb-verify/verdict-inputs.sh
- .github/workflows/bb-verify.yml
- examples/balls/clamp/compiler/src/Conversion/LowerBuckyball/AssignPhysicalBankPatterns.cpp
- examples/balls/clamp/compiler/src/Dialect/Buckyball/ClampBall.td
- examples/balls/clamp/compiler/src/Dialect/Buckyball/Transforms/LegalizeForLLVMExport.cpp
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
- examples/chips/legacy_clamp_v1/regression/exclusions.toml
- examples/chips/legacy_clamp_v1/regression/negative-tests.toml
- examples/chips/legacy_clamp_v1/regression/phases/integrate.md
- examples/chips/legacy_clamp_v1/regression/phases/skeleton.md
- examples/chips/legacy_clamp_v1/regression/phases/slices.md
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
- examples/cores/pebble/compiler/src/Dialect/Buckyball/Transforms/CMakeLists.txt
- examples/cores/pebble/configs/balldomains/legacy_clamp_v1.toml
- examples/cores/pebble/configs/legacy_clamp_v1.toml
- experiments/legacy-single-prompt-clamp-v1/README.md
- experiments/legacy-single-prompt-clamp-v1/ball-designer.md
- experiments/legacy-single-prompt-clamp-v1/chip-lead.md
- experiments/legacy-single-prompt-clamp-v1/environment.json
- experiments/legacy-single-prompt-clamp-v1/host-tools.json
- experiments/legacy-single-prompt-clamp-v1/isa-occupancy.json
- experiments/legacy-single-prompt-clamp-v1/original-prompt-v2.md
- experiments/legacy-single-prompt-clamp-v1/ppa-preflight.json
- experiments/legacy-single-prompt-clamp-v1/ppa-preflight.md

## Expected tests
Top-level cumulative effective stage remains chip. Execute the original skeleton plan with its first stem equal to the positive Clamp operator below. This is an actual BEMU smoke plus real compiler/workload build, not RTL evidence. Independently execute every old Ball c-bemu child step in the explicit extension. Positive ordinary stems require exact output comparisons already implemented by each test; include full-capacity BEMU, MatAdd→Clamp composition and raw/bank-SSA MLIR paths. Negative binaries are excluded from ordinary stems and batch PASS lists. Each negative requires the specified actual runtime panic/assert, never a build/network failure. Compiler fixtures require actual buddy-opt rejection and declared diagnostics through buckyball_compiler_expected_failure_check; no guessed exit or hand-written PASS.

skeleton-smoke: legacy_clamp_v1-pebble-ctest-clamp_test-baremetal

```legacy-verification-extension
{
  "version": 1,
  "ballSubphase": {
    "ball": "ClampBall",
    "phase": "c-bemu",
    "chip": "legacy_clamp_v1",
    "stems": [
      "legacy_clamp_v1-pebble-ctest-clamp_test-baremetal",
      "legacy_clamp_v1-pebble-ctest-clamp_capacity_test-baremetal",
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
  ]
}
```

CI report must contain separate identities and terminal evidence for chip/skeleton and Ball/ClampBall/c-bemu, every expected-failure and compiler fixture. No RTL claim is made by this round. Model/provider must come from actual session metadata, requested configuration is not proof.
