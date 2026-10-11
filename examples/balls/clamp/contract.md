# ClampBall frozen contract — legacy-single-prompt-clamp-v1 v2

Source authorization: original-prompt-v2.md sections 3–6. All five legacy stage-0 questions are answered by that brief and the repository facts below; no semantics are inferred from old numeric file prefixes.

1. **Semantics:** signed INT32 `y[i] = min(max(x[i], lo), hi)`, exact integer output. `lo <= hi`, equality allowed, inclusive endpoints and unchanged interior values. No overflow arithmetic is needed.
2. **ISA:** generated registry mnemonic `CLAMP`, funct7 **60** (`0111100`: one read plus one write). `rs1[9:0]` input virtual bank; `rs1[19:10]` reserved zero; `rs1[29:20]` output virtual bank; `rs1[63:30]` N (element count, not rows). `rs2[31:0]` signed lo, `rs2[63:32]` signed hi. C API `bb_clamp(in_bank,out_bank,N,lo,hi)`. Public decoding is unchanged. All original bank-field bits are checked via retained rs1, avoiding narrowed-ID truncation. No rs2 reserved bits.
3. **Footprint:** retained Pebble memory domain: 24 physical banks, 64 rows each, 128 bits/row, 16 byte enables. Four INT32 lanes per row; N/4 rows read from row zero and written to row zero. `inBW=1`, `outBW=1`. N positive, divisible by 4, N<=256. Capacity checks derive from active configuration; no new SRAM or bus.
4. **Illegal inputs:** lo>hi; N zero, nonmultiple-of-four or over capacity; either full ten-bit bank ID out of configured range; unallocated bank; allocation with group count !=1; alias between input/output (including physical alias where observable); nonzero BANK1 reserved bits. The C ISA wrapper rejects known N/bank/bounds violations at compilation using the actual generated params.h geometry; unknown dynamic values retain BEMU/RTL validation. MLIR compiler rejects statically known illegal parameters and uses bank allocation state for bank-SSA handles; BEMU panics; RTL asserts for all observable conditions. Allocation is observed in RTL through op1_col/wr_col (zero means unallocated, one means single group), with original virtual IDs and resolved physical IDs checked for alias. Unknown funct7 fails in framework dispatch. Negative tests issue raw instruction where wrapper validation would otherwise mask runtime checks.
5. **Layout:** dense row-major 4-lane INT32 packing, row r lane l corresponds to element 4*r+l. No truncation, padding, group stride, or zero fill. Only addressed output rows change.

## Registration and occupancy decision

Independent `examples/cores/pebble/configs/legacy_clamp_v1.toml` uses `balldomains/legacy_clamp_v1.toml`, retaining all other Pebble references and geometry. Exactly eight entries: Transpose=0, SMatMul=1, Im2col=2, ToInt8=3, Int2Fp=4, MatAdd=5, Trace=6, Clamp=7. Trace retains its existing one read/one write wrapper port geometry (its instruction has no bank accesses). Existing funct7 meanings are preserved; BDB_COUNTER=4, CLAMP=60. No default registry changes.

The ISA decision has two distinct baselines. Historical investigation base
`83820af2` (evidence/isa-occupancy.json) had maximum original registered
one-read/one-write funct7 59, so the contract froze the next legal value 60.
Actual delivery base `80055d91` (evidence/isa-occupancy-fork-main.json,
source `a8f7257b`) has maximum original value 55 in that class; 56 would be
the minimum next increment there. Frozen 60 remains unoccupied, nonreserved,
within 48–63 and greater than 55, so preserve it without changing any existing
Ball meaning. Do not interpret the historical inventory as the current main
inventory. Framework BALL_INIT=5, FENCE=0, BARRIER=1, memory 16/32/33/35
and analysis-reserved MMIO_SET=34 remain preserved; codes >=80 are unsuitable
for this operator's one-read/one-write access class.

## Stable grounding anchors

- `examples/balls/silu/workloads/isa/silu.h`, `emu/src/59_silu.rs`: full rs1 bank/N and allocated single-group contract.
- `arch/src/main/scala/framework/frontend/decoder/GobalDecoder.scala`: access class from funct7[6:4].
- `arch/src/main/scala/framework/balldomain/decoder/{BallDomainDecoder,BallDecodeCmd}.scala`: bank metadata plus retained raw rs1/rs2, special=rs2, iter=34 bits.
- `examples/cores/pebble/configs/{frontends,memdomains}/default.toml`: bankIdLen=10, iterLen=34, bank geometry.
- `examples/balls/relu/arch/src/main/scala/Relu.scala`, `examples/balls/matadd/arch/src/main/scala/MatAdd.scala`: decoupled read/write response FSM, signed lane operations.
- `arch/src/main/scala/framework/balldomain/isa/BallISA.scala`: reserved initialization.
- Old ball-designer `src/tools/{isa-occupancy,ball-audit}.ts`: claim sources, nine acceptance checks; numeric emu prefixes are not encoding truth.

Stage order remains contract → C/BEMU/compiler → formal c-bemu gate → RTL → formal rtl gate. No local build/simulation is performed by the implementation agent.

## Current delivery baseline adaptation

The initial contract investigation referenced the historical 6e-based isolated
checkout and SiLU there. Delivery was moved to personal fork/main 80055d91 in
`buckyball-fork-main`; no historical default-domain changes are transplanted.
The retained main Pebble geometry remains 24 banks × 64 rows × 128 bits,
with its original frontend robEntries=8, vbankIdUpperBound=23. The same raw
rs1/rs2 and allocation metadata public-decoder contract remains authoritative.
Existing main MatAdd BEMU uses `ctx.config(vbank)` and `pbank_group(ctx,...)`,
and direct `ctx.banks[pbank][byte]`; Clamp follows the corresponding main
`pbank(ctx,...)` path, with fail-hard checks preserved. Compiler source
aggregation uses the parent main compiler's already-resolved registry lists
and existing generated hook aggregator. No old default registry or framework
implementation is copied into this candidate.
