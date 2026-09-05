# LayerNormBall

`LayerNormBall` computes row-wise fp32 layer normalization over a dense
row-major R x C block held in SRAM banks (reference:
`torch.nn.LayerNorm(normalized_shape=C, eps=1e-12)`, biased variance,
two-step mean-subtracted form):

```
mu    = mean(row)
var   = sum((x - mu)^2) / C
rstd  = rsqrt(var + 1e-12)            (eps fixed in the op)
y[j]  = (x[j] - mu) * rstd * gamma[j] + beta[j]
```

It is the first reduction-class fp32 ball (2rd+1wr): two input banks and
one **distinct** output bank, no in-place mode. Every row of C consecutive
fp32 is one normalization group; rows are independent.

## Command

`LAYERNORM(x_bank, param_bank, out_bank, n, c)` encodes the three buffer
addresses as virtual bank ids (`rs1.BB_BANK0` x, `rs1.BB_BANK1` params,
`rs1.BB_BANK2` out), the element count N = R*C in `rs1.BB_ITER`, and the
row width C in `xs2[31:0]` (`xs2[63:32]` reserved, must be zero). A bank
row is 16 bytes = 4 fp32 lanes; C must be >= 4 and a multiple of 4, so
every row and the gamma/beta split are 16B-aligned. `param_bank` holds
gamma in elements `[0, C)` and beta in `[C, 2C)`, dense; every x row
shares the gamma[j]/beta[j] of its column j. N is at most 4 * bank lines
(x bank capacity), C at most 2 * bank lines (2C gamma+beta elements in the
param bank). All three banks must be allocated single-group
(`bb_mem_alloc(bank, 1, 1)`).

## Numerics

The golden value is evaluated in IEEE double in `workloads/ctests/` and
`emu/src/69_layernorm.rs` (identical operation sequence); the ctests
compare with the relative tolerance `|got - golden| <= 1e-4 * (1 +
|golden|)` — the rstd scale term makes the relative component mandatory
(this is the one tolerance difference from the elementwise balls).
The RTL datapath is hardfloat fp32 add/mul with Newton 1/C and rsqrt
(evaluated offline in fp32 emulation: < 0.4% of the tolerance budget on
the ctest vectors).

## Fail-hard

Illegal encodings panic identically in bemu and assert in RTL
(`emu/src/69_layernorm.rs` carries the table): reserved `xs2[63:32]`
non-zero, `N == 0`, `C == 0` or `C` not a multiple of 4 (a row width that
does not align to the 16B bank row), `N` not a multiple of `C` (partial
rows), `C > 2 * bank lines`, `N > 4 * bank lines`, invalid/unallocated/
multi-group banks, and any x/param/out bank collision. An undeclared
funct7 panics at the dispatch chain end. No data-value checks: NaN/Inf
propagate by IEEE semantics (eps > 0 keeps rsqrt finite for constant
rows).

## Compiler

`compiler/src/` is the minimal compiler package that
`compiler/scripts/pb_to_target_registry.py` requires for every registered
ball (exactly one dialect TD + a `LegalizeForLLVMExport.cpp`):

- `Dialect/Buckyball/LayerNormBall.td` — `bucky.layernorm` (physical
  three-bank op: x/param/out bank ids, N, C).
- `Dialect/Buckyball/Transforms/LegalizeForLLVMExport.cpp` — lowers
  `bucky.layernorm` to `CustomIntrOp` with
  `rs1 = packRs1BanksIter(x, param, out, n)` and rs2 = C, funct7 taken
  from the target registry under mnemonic `LAYERNORM`.

The toy layout does not run tile -> buckyball lowering and no tile hook
exists, so like GeluBall on toy this ball is chip-level registered and
tested while model paths are out of scope (see the S2 brief non-goals).

## Workloads

- `workloads/ctests/layernorm_test.c`: small R = 5 x C = 8 block covering
  a constant row (var = 0 -> y = beta), signed zeros, a unit-scale row, a
  small-magnitude row (rstd ~ 1e4), an all-zero row, a wide-dynamic-range
  row, a zero gamma element and a zero beta element.
- `workloads/ctests/layernorm_bank_test.c`: R = 8 x C = 512 (N = 4096 =
  the full x bank), deterministic pseudo-random vectors; bemu regression
  only.

## Registration

Registered on toy (`examples/cores/toy/configs/balldomains/default.toml`)
as ballId 4 / ballClass `examples.balls.layernorm.LayerNormBall` /
`LAYERNORM` funct7 69 (enable `100` = 2rd+1wr, matching inBW 2 / outBW 1;
69 was the first free funct7 of the 64-71 2rd+1wr range — 64-68 are
occupied by MATADD/VECMAT16/SMATMUL/GEMMINI compute and 72+ is the
reserved 101 space). inBW 2/outBW 1 grant two SRAM read ports (x, params)
and one write port (out).
