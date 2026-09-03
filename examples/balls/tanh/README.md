# TanhBall

`TanhBall` computes the exact-form hyperbolic tangent over a 1D fp32 vector
held in SRAM banks: `y[i] = tanh(x[i])` (reference: `torch.tanh`, never a
rational or piecewise-linear approximation). It is elementwise unary,
1rd+1wr: one input bank, one **distinct** output bank, no in-place mode.

## Command

`TANH(in_bank, out_bank, n)` encodes the two buffer addresses as virtual
bank ids (`rs1.BB_BANK0` in, `rs1.BB_BANK2` out) and the 1D length as the
element count in `rs1.BB_ITER`. `rs1.BANK1` and `rs2` are reserved and must
be zero. A bank row is 16 bytes = 4 fp32 lanes; `n` must be a positive
multiple of 4 and no larger than `4 * bank lines` (toy: 4096). Output row
`r`, lane `l` is `tanh()` of input row `r`, lane `l` — dense packing into
the separate output bank.

Both banks must be allocated (`bb_mem_alloc(bank, 1, 1)`, single group).

## Numerics

The golden value is evaluated in IEEE double: with `e = exp(-2|x|)` from a
9-term Taylor series in the range-reduced argument scaled by an exact `2^k`
exponent add (no libm anywhere) and `|x|` clamped to 100,
`tanh(x) = sign(x) * (1 - e) / (1 + e)`. The C reference in
`workloads/ctests/` and the model in `emu/src/58_tanh.rs` are term-for-term
identical; ctests compare with absolute tolerance `1e-4`, which also bounds
the RTL contract. On a 24k-point fp32 sweep over `[-12, 12]` plus the
special points (zeros, minimum subnormal, powers of two, the 9.0104 fp32
saturation boundary, the 10.0 clamp step) the golden differs from
`math.tanh` fp32 by at most `1.49e-08` (a fraction of one fp32 ulp).

The RTL computes the same function directly: a 20-segment quartic fit of
`tanh` on `|x| in [0, 10)` (segment width 0.5, Q20 Horner with arithmetic
`>>20` at every step, coefficients from Chebyshev-node interpolation), a
bit-accurate fp32 decode/encode, and the pass-through clamp `|x| >= 10`
returning exactly `+-1.0f` (the golden rounds to bit-exact `+-1.0f` from
`|x| >= 9.0104`, so the clamp step is error-free). Exhaustive over every
fp32 point with exponent field 107..130 — swept as every `xq` bin in
`[0, 10 * 2^20)` with the golden evaluated at the bin's extreme fp32 points
(golden is monotone, hardware depends only on `xq`), both signs (odd
symmetry is exact in golden and datapath) — the worst `|hw - golden|` is
`5.722e-06` (the segment-0 constant offset at `x = 0`), inside the `1e-4`
contract. Tiny inputs (`|x| < 2^-20`) flush to the segment-0 constant, an
absolute error `<= 5.8e-06`.

## Fail-hard

Illegal encodings panic identically in bemu and assert in RTL
(`emu/src/58_tanh.rs` carries the table): reserved field non-zero (`rs2`,
`rs1.BANK1`), `n == 0`, `n` not a multiple of 4 (a buffer whose length does
not align to the 16B bank row), `n` beyond bank capacity, invalid /
unallocated / multi-group bank, and `in_bank == out_bank` (hard block:
same-bank read/write would corrupt the source data). An undeclared funct7
panics at the dispatch chain end. NaN/Inf input bit patterns are outside the
contract: every layer saturates them deterministically (RTL clamp catches
them; the double goldens propagate NaN).

## Compiler

`compiler/src/` is the minimal compiler package that
`compiler/scripts/pb_to_target_registry.py` requires for every registered
ball (exactly one dialect TD + a `LegalizeForLLVMExport.cpp`; the assign /
bank-SSA pattern files are wired through the generated lowering hooks):

- `Dialect/Buckyball/TanhBall.td` — `bucky.tanh_matrix` (logical f32 tile,
  distinct input/output memrefs), `bucky.tanh` (physical two-bank op),
  `bucky.bank_tanh` (bank-SSA handle form whose result chains the output
  bank handle).
- `Dialect/Buckyball/Transforms/LegalizeForLLVMExport.cpp` — lowers
  `bucky.tanh` to `CustomIntrOp` with
  `rs1 = packRs1BanksIter(in, 0, out, n)` (BANK1 and rs2 lower as zero,
  matching the fail-hard reserved fields) and funct7 taken from the target
  registry under mnemonic `TANH`.
- `Conversion/LowerBuckyball/AssignPhysicalBankPatterns.cpp` —
  `bank_tanh` -> `tanh` (compiled into the target `LowerBuckyballPass`
  via the generated `BUCKYBALL_ASSIGN_HOOK`).
- `Conversion/LowerBuckyball/LowerBuckyballToBankSSAPatterns.cpp` —
  `tanh_matrix` -> chunked `alloc/mvin/bank_tanh/mvout/fence` sequences;
  uses local bank helpers instead of `Utils/BankUtils.h`, whose
  `createBankSMatMul` needs the SMatMul ops absent from Toy's union.
- `Backend/include/IntrinsicsRISCVTanhBall.td` — `int_riscv_bb_tanh`.

Core integration: `examples/cores/toy/compiler/src/CMakeLists.txt` lists
the dialect directory in `TOY_BALL_COMPILER_DIALECT_DIRS`.

## Workloads

- `workloads/ctests/tanh_test.c`: small fixed 16-element vector covering
  zero, signed zeros, the minimum subnormal, mid-range, negative pairs, and
  the clamp boundary (`9.9375`, `10.0`, `-10.0`, `12.0`).
- `workloads/ctests/tanh_bank_test.c`: full 1024-row bank (N = 4096),
  deterministic pseudo-random inputs in [-8, 8]; bemu regression only.
