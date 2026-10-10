# Chip lead evidence and handoff

Start: 2026-10-09T16:25:21Z (session metadata). Static handoff recorded: 2026-10-09T16:32:51.102122+00:00

Actual model/provider: `gpt-6.1-sol` / `openai`. Source: session
`01a1217b-c1e9-7553-a3ca-592271dc2fc7`, local rollout at
`/home/ROXY/.codex/sessions/2026/10/10/rollout-2026-10-10T00-25-21-01a1217b-c1e9-7553-a3ca-592271dc2fc7.jsonl`
(`session_meta.model_provider`, first `turn_context.model`). No reset credit consumed.
Usage remains available in that session's token_count snapshots; parent must deduplicate final cumulative usage.

## Scope and sources

Only `examples/chips/legacy_clamp_v1/**` edited, plus this experimental evidence file.
No framework/core/Ball edits, builds, simulations, git commits/push or dispatch.
Read original v2 prompt, all four required legacy chip prompts, original Buckyball
chip-designer skill, current `/home/ROXY/code/bb_work/harness/.agents/skills/bb-chip-task/SKILL.md`.
The initially supplied `buckyball/harness/...` location does not exist; actual Harness source used.
No AGENTS.md found by `rg --files -g AGENTS.md` in experimental checkout.
Original request overrides newer reuse-only recommendation: independent chip retained.

## Delivered static implementation

- Own configs, one tile/one Pebble core architecture, independent core path `examples/cores/pebble/configs/legacy_clamp_v1.toml` (core owner delivered).
- Unique `LegacyClampV1` Scala config and Verilator/P2E/tapeout classes, own generated protobuf paths.
- CMake `chip-workloads-build`, existing configured-Ball C and global MLIR aggregation.
- Real MatAdd→Clamp C workload, N=64/four single-group banks, exact independent INT64 CPU reference and every output compared. No sum overflow; output poison detects unwritten elements.
- Three backend expected-PASS lists (41 BEMU/40 RTL/P2E current stems), independent exclusions and negative inventory; phase handoff manifests skeleton/slices/integrate.
- Complete existing configured-Ball registered C and actual MLIR source/stem inventory in `regression/workload-inventory.md`.
- Pebble real DC/PTPX/SMIC180 scripts/contracts copied under chip. Own gate DPI VPI timestamp adapter and measured activity validation. Default fixed activity window removed. PTPX requires real marked+numerically checked Clamp run.

Templates: configs and Scala copied/adapted from Pebble; workload target organization from toy/Pebble and repository bb-tests CMake; tapeout inherited Pebble real flow, with local activity validation added from engineering judgment because existing `gate_dpi.cc` emits no usable instruction activity timing.

## Static audit results

Python TOML parse succeeds for all chip TOML. Include chain resolves to own design and tile then existing independent Pebble config. Domain contains exactly eight contiguous ids 0..7; all mapping configs exist; ISA funct7 unique within domain. Exact mappings: Transpose0, SMatMul1, Im2col2, ToInt83, Int2Fp4, MatAdd5, Trace6, Clamp7. Clamp funct7=60; MatAdd72 and Trace4 retain original encoding. No unrelated default Balls.

Memory is unchanged: 24 banks, 128 bits/row, 64 rows, physical channels13. Read bandwidth sum11; write8. DMA adds one read and write logical slot (12/9). MemMidend dynamically allocates per-Ball channel sets; total19 Ball ports need not all be concurrently resident in 13 physical channels. Selected small workload peak4 banks fits24; Clamp maxN256. Framework untouched.

All LegacyClampV1 Scala class names globally unique across chip sources. All generated pb paths belong to this chip. Normal lists have41 BEMU and40 RTL/P2E distinct stems after Clamp handoff. Generated configs absent intentionally: installation is CI/project-tool responsibility.

Exclusions: fixed M208/CL416 `matadd_after_smatmul_os_test` exceeds64 rows; hardcoded1024-row MLIR `bank_matadd_bank_1024x8_i32` exceeds64. Their source/build targets retained. C names containing1024 use generated BANK_LINES, so remain in ordinary list. Int2Fp relu MLIR is supported built-in flag and included, not wrongly treated as another Ball.

`git diff --check` exit0 on current tracked changes (new untracked chip files not included by git diff). Static audit is equivalent limited checks, not old tool ACCEPT and not functional PASS.

## Tapeout adaptation and remaining validation

100MHz is a target, not achieved timing. Actual runner SMIC180 DB paths, licenses, tool availability, emitted SRAM shapes, DigitalTop gate port shape, VCS VPI integration, netlist correctness and activity coverage remain untested. Power bracket captures real command plus UART/fence overhead; it is not isolated Clamp power. `CLAMP_SIM_TIMEOUT_NS` is only simulation horizon. Standard-cell PTPX remains original flow; process SRAM/DRAM/leakage coverage must be reported honestly.

Real dc-sim `run.env` does not include TARGET_LIBRARY although Pebble power script requires it; chip-local fallback reads its tapeout contract instead. No framework fix needed. Gate completion requires unique BEGIN/END, numerical `matadd_clamp_test PASSED`, valid bounds and no failed SCU exit. Missing/timeout activity fails hard. `power.tcl` reads `<activity>.window.tcl` and refuses missing evidence.

## Outstanding handoff

Clamp exact stems appended after owner handoff: clamp_test, capacity BEMU-only, ball/bank_clamp_4x4. Nine BEMU raw ISA negative stems include required diagnostic and reject the fallback ERROR path. RTL negative diagnostic/observability remains verifier obligation; compiler invalid fixtures are separate expected-compilation failures. No build/sim/PPA has run here. CI master must perform config install, builds, skeleton/slices/integrate, separate negative expectations, gate activity and PPA. New MLIR negative files may make global build fail if not organized by Ball owner; check expected-failure compilation separately.
