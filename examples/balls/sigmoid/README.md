# SigmoidBall

`SigmoidBall` computes the exact-form sigmoid over a 1D fp32 vector held in
SRAM banks: `y[i] = 1 / (1 + exp(-x[i]))` (reference: `torch.sigmoid`, never
a piecewise-linear or `x / (1 + |x|)` approximation). It is elementwise
unary, 1rd+1wr: one input bank, one **distinct** output bank, no in-place
mode.

## Command

`SIGMOID(in_bank, out_bank, n)` encodes the two buffer addresses as virtual
bank ids (`rs1.BB_BANK0` in, `rs1.BB_BANK2` out) and the 1D length as the
element count in `rs1.BB_ITER`. `rs1.BANK1` and `rs2` are reserved and must
be zero. A bank row is 16 bytes = 4 fp32 lanes; `n` must be a positive
multiple of 4 and no larger than `4 * bank lines` (toy: 4096). Output row
`r`, lane `l` is `sigmoid()` of input row `r`, lane `l` — dense packing into
the separate output bank.

Both banks must be allocated (`bb_mem_alloc(bank, 1, 1)`, single group).

## Numerics

The golden value is evaluated in IEEE double: a 9-term Taylor series in the
range-reduced argument scaled by an exact `2^k` exponent add (no libm
anywhere), `|x|` clamped to 100 (`exp(-100) = 3.7e-44`, far below one fp32
ulp of every affected output), with `y = 1/(1+e)` for `x >= 0` and
`y = e/(1+e)` for `x < 0`. The C reference in `workloads/ctests/` and the
model in `emu/src/57_sigmoid.rs` are term-for-term identical; ctests compare
with absolute tolerance `1e-4`, which also bounds the RTL contract. On a
16M-point fp32 sweep over `[-100, 100]` the golden differs from
`torch.sigmoid` fp32 by at most `5.96e-08` (one fp32 ulp).

The RTL computes the same function through `sigmoid(x) = 0.5 * (1 +
tanh(x / 2))`: a 20-segment quartic fit of `tanh` on `z in [0, 5)` (width
0.25, Q20 Horner with arithmetic `>>20`), a bit-accurate fp32
decode/encode, and the pass-through clamp `|x| >= 10` returning exactly
`1.0f`/`+0.0f`. Exhaustive over every fp32 point with exponent field
107..131 (both signs — the whole region where any lane can disagree) plus
dense segment-boundary and clamp sweeps, the worst `|hw - golden|` is
`4.542e-05` (the clamp step at `|x| = 10` itself), inside the `1e-4`
contract.

## Fail-hard

Illegal encodings panic identically in bemu and assert in RTL
(`emu/src/57_sigmoid.rs` carries the table): reserved field non-zero
(`rs2`, `rs1.BANK1`), `n == 0`, `n` not a multiple of 4 (a buffer whose
length does not align to the 16B bank row), `n` beyond bank capacity,
invalid / unallocated / multi-group bank, and `in_bank == out_bank` (hard
block: same-bank read/write would corrupt the source data). An undeclared
funct7 panics at the dispatch chain end. NaN/Inf input bit patterns are
outside the contract: every layer saturates them deterministically (RTL
clamp catches them; the double goldens propagate NaN).

## Compiler

`compiler/src/` is the minimal compiler package that
`compiler/scripts/pb_to_target_registry.py` requires for every registered
ball (exactly one dialect TD + a `LegalizeForLLVMExport.cpp`; the assign /
bank-SSA pattern files are wired through the generated lowering hooks):

- `Dialect/Buckyball/SigmoidBall.td` — `bucky.sigmoid_matrix` (logical f32
  tile, distinct input/output memrefs), `bucky.sigmoid` (physical two-bank
  op), `bucky.bank_sigmoid` (bank-SSA handle form whose result chains the
  output bank handle).
- `Dialect/Buckyball/Transforms/LegalizeForLLVMExport.cpp` — lowers
  `bucky.sigmoid` to `CustomIntrOp` with
  `rs1 = packRs1BanksIter(in, 0, out, n)` (BANK1 and rs2 lower as zero,
  matching the fail-hard reserved fields) and funct7 taken from the target
  registry under mnemonic `SIGMOID`.
- `Conversion/LowerBuckyball/AssignPhysicalBankPatterns.cpp` —
  `bank_sigmoid` -> `sigmoid` (compiled into the target `LowerBuckyballPass`
  via the generated `BUCKYBALL_ASSIGN_HOOK`).
- `Conversion/LowerBuckyball/LowerBuckyballToBankSSAPatterns.cpp` —
  `sigmoid_matrix` -> chunked `alloc/mvin/bank_sigmoid/mvout/fence`
  sequences; uses local bank helpers instead of `Utils/BankUtils.h`, whose
  `createBankSMatMul` needs the SMatMul ops absent from Toy's union.
- `Backend/include/IntrinsicsRISCVSigmoidBall.td` — `int_riscv_bb_sigmoid`.

Core integration: `examples/cores/toy/compiler/src/CMakeLists.txt` lists
the dialect directory in `TOY_BALL_COMPILER_DIALECT_DIRS`.

## Workloads

- `workloads/ctests/sigmoid_test.c`: small fixed 16-element vector covering
  zero, signed zeros, the minimum subnormal, mid-range, negative pairs, and
  the clamp boundary (`9.9375`, `10.0`, `-10.0`, `12.0`).
- `workloads/ctests/sigmoid_bank_test.c`: full 1024-row bank (N = 4096),
  deterministic pseudo-random inputs in [-8, 8]; bemu regression only.
