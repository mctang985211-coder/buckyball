---
name: ball
description: Create a new Buckyball Ball operator named $ARGUMENTS, covering the full flow from implementation to verification.
---

**Important: all build/simulation operations must go through MCP tools from the project MCP server `buckyball-dev` (`validate`, `bbdev_workload_build`, `bbdev_bemu_sim`, `bbdev_bebop_verilator_run`, etc.). Do not use bbdev CLI or nix develop directly. If `buckyball-dev` is not loaded, stop and report it.**

## Phase 1 - Requirement Collection

1. Inspect registration state and decide `ballId` + `funct7`:
   - active file from `examples/cores/<core>/configs/default.toml` → `balldomain = ...`
   - usually `examples/cores/<core>/configs/balldomains/*.toml`
2. Check for partial existing implementation (incremental mode):
   - existing directory in `examples/balls/`
   - existing ISA macro in `examples/balls/<name>/workloads/isa/` (or base under `bb-tests/workloads/lib/bbhw/isa/`)
   - existing chip/ball ctests under `examples/` or `bb-tests/workloads/`
3. Confirm with user:
   - target chip
   - operator semantics
   - `inBW` / `outBW`
   - whether `op2` is needed
   - meaning of `iter`

## Phase 2 - Implement the Ball

1. Read references:
   - simple example: `examples/balls/relu/arch/src/main/scala/ReluBall.scala`, `Relu.scala`
   - complex example: `examples/balls/gemmini/arch/src/main/scala/GemminiBall.scala`
   - Blink protocol: `arch/src/main/scala/framework/balldomain/blink/blink.scala`, `bank.scala`, `status.scala`
   - SRAM IO: `arch/src/main/scala/framework/memdomain/backend/banks/SramIO.scala`
2. Create files under `examples/balls/<name>/arch/src/main/scala/`, using the reference implementations above as templates.

### Key constraints
- SRAM read latency is 1 cycle (`resp.valid` in the cycle after `req.fire`)
- Latch command fields when `cmdReq.fire`
- Base FSM pattern: `idle -> read -> compute -> write -> complete -> idle`
- `status.idle` and `status.running` must map correctly to FSM states

## Phase 3 - Register the Ball

Edit the core balldomain TOML (the one selected by `examples/cores/<core>/configs/default.toml`, or the variant you are changing):

1. Append a `ballIdMappings` row (`ballId`, `ballName`, `ballClass`, `config`, `inBW`, `outBW`)
2. Update `ballNum`
3. Append a `ballISA` row (`mnemonic`, `funct7`, `bid`)
4. Run MCP `validate(chip=..., balldomain=...)` before continuing

## Phase 4 - Add ISA C Macro

Create `examples/balls/<name>/workloads/isa/<name>.h` (include `<bbhw/isa/isa.h>`),
then `#include <isa/<name>.h>` from the ball's ctests. Do **not** add ball ISA to
central `bb-tests/workloads/lib/bbhw/isa/isa.h` (base mem/frontend only).

## Phase 5 - Add CTest

1. Create `<name>_test.c` under `examples/balls/<name>/workloads/ctests/`
2. Register it in `examples/balls/<name>/workloads/ctests/CMakeLists.txt` via `add_buckyball_ctests(...)`
   (chip-level ctests live under `examples/chips/<chip>/workloads/ctests/`)

## Phase 6 - Validate, Build, and Simulate

1. Run `validate` and ensure all 7 invariants pass
2. Run `bbdev_workload_build(chip="toy")` (or the target chip)
3. Run `bbdev_bemu_sim` for this Ball's CTest binary (functional first)
4. Run `bbdev_bebop_verilator_run` with an explicit config (e.g. `sims.verilator.BuckyballToyVerilatorConfig`)
5. Interpret results:
   - `PASSED` -> done
   - bemu pass / verilator fail -> RTL/timing issue, switch to `/debug`
   - bemu fail -> fix workload / ball semantics first
