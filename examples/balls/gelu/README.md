# GeluBall

`GeluBall` computes the exact-erf GELU over a 1D fp32 vector held in SRAM
banks: `y[i] = x[i] * Phi(x[i])`, `Phi(x) = 0.5 * (1 + erf(x / sqrt(2)))`
(reference: `torch.nn.functional.gelu(approximate='none')`; never the tanh
approximation). It is elementwise unary, 1rd+1wr: one input bank, one
**distinct** output bank, no in-place mode.

## Command

`GELU(in_bank, out_bank, n)` encodes the two buffer addresses as virtual
bank ids (`rs1.BB_BANK0` in, `rs1.BB_BANK2` out) and the 1D length as the
element count in `rs1.BB_ITER`. `rs1.BANK1` and `rs2` are reserved and must
be zero. A bank row is 16 bytes = 4 fp32 lanes; `n` must be a positive
multiple of 4 and no larger than `4 * bank lines` (toy: 4096). Output row
`r`, lane `l` is `gelu()` of input row `r`, lane `l` — dense packing into
the separate output bank.

Both banks must be allocated (`bb_mem_alloc(bank, 1, 1)`, single group).

## Numerics

The golden value is evaluated in IEEE double: Abramowitz-Stegun 7.1.26
erf (`|eps| <= 1.5e-7`), clamped to +/-1 for `|x/sqrt(2)| >= 4.25`
(`erfc(4.25) ~ 2e-9`, far below one fp32 ulp of the affected outputs),
with `exp(-z^2)` computed in pure bit arithmetic so no libm is required on
either side. The C reference in `workloads/ctests/` and the model in
`emu/src/56_gelu.rs` are term-for-term identical; ctests compare with
absolute tolerance `1e-4`, which also bounds the RTL. On a 500k-point
sweep over `[-8, 8]` the golden differs from torch fp32 gelu by at most
`1.2e-6` absolute.

## Fail-hard

Illegal encodings panic identically in bemu and assert in RTL
(`emu/src/56_gelu.rs` carries the table): reserved field non-zero, `n == 0`,
`n` not a multiple of 4 (a buffer whose length does not align to the 16B
bank row), `n` beyond bank capacity, invalid/unallocated/multi-group bank,
and `in_bank == out_bank`. An undeclared funct7 panics at the dispatch
chain end.

## Compiler

`compiler/src/` is the minimal compiler package that
`compiler/scripts/pb_to_target_registry.py` requires for every registered
ball (exactly one dialect TD + a `LegalizeForLLVMExport.cpp`; the assign /
bank-SSA pattern files are wired through the generated lowering hooks):

- `Dialect/Buckyball/GeluBall.td` — `bucky.gelu_matrix` (logical f32 tile,
  distinct input/output memrefs), `bucky.gelu` (physical two-bank op),
  `bucky.bank_gelu` (bank-SSA handle form whose result chains the output
  bank handle).
- `Dialect/Buckyball/Transforms/LegalizeForLLVMExport.cpp` — lowers
  `bucky.gelu` to `CustomIntrOp` with
  `rs1 = packRs1BanksIter(in, 0, out, n)` (BANK1 and rs2 lower as zero,
  matching the fail-hard reserved fields) and funct7 taken from the target
  registry under mnemonic `GELU`.
- `Conversion/LowerBuckyball/AssignPhysicalBankPatterns.cpp` —
  `bank_gelu` -> `gelu` (compiled into the target `LowerBuckyballPass` via
  the generated `BUCKYBALL_ASSIGN_HOOK`).
- `Conversion/LowerBuckyball/LowerBuckyballToBankSSAPatterns.cpp` —
  `gelu_matrix` -> chunked `alloc/mvin/bank_gelu/mvout/fence` sequences;
  uses local bank helpers instead of `Utils/BankUtils.h`, whose
  `createBankSMatMul` needs the SMatMul ops absent from Toy's union.
- `Backend/include/IntrinsicsRISCVGeluBall.td` — `int_riscv_bb_gelu`.

Core integration: `examples/cores/toy/compiler/src/CMakeLists.txt` lists
the dialect directory in `TOY_BALL_COMPILER_DIALECT_DIRS`.

## Workloads

- `workloads/ctests/gelu_test.c`: small fixed 16-element vector covering
  zero, signed zeros, subnormal inputs, the GELU minimum region, positive
  saturation, and the clamp boundary.
- `workloads/ctests/gelu_bank_test.c`: full 1024-row bank (N = 4096),
  deterministic pseudo-random inputs in [-8, 8]; bemu regression only.
