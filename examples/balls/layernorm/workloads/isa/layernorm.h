#ifndef _BB_LAYERNORM_H_
#define _BB_LAYERNORM_H_

#include <bbhw/isa/bb_func7.h>
#include <bbhw/isa/isa.h>

// LAYERNORM(x_bank, param_bank, out_bank, n, c): row-wise fp32 layer
// normalization over a dense row-major block of R rows x C columns held in
// SRAM banks. Each row of C consecutive fp32 is one normalization group:
//   mu = mean(row)
//   var = sum((x - mu)^2) / C            (biased variance, two-step form)
//   y[j] = (x[j] - mu) * rsqrt(var + eps) * gamma[j] + beta[j]
// with eps = 1e-12 fixed in the op semantics (reference:
// torch.nn.LayerNorm(normalized_shape=C, eps=1e-12)). 2rd+1wr: x_bank
// (BANK0) and param_bank (BANK1) are read, out_bank (BANK2) is written;
// the three virtual bank ids are pairwise distinct single-group allocated
// banks. gamma occupies param elems [0, C), beta elems [C, 2C), dense
// row-major; every row of x shares gamma[j]/beta[j] of its column j.
//
//   rs1 = BB_BANK0(x_bank) | BB_BANK1(param_bank) | BB_BANK2(out_bank)
//         | BB_ITER(n)
//   rs2 = FIELD(c, 0, 31)   (xs2[63:32] reserved, fail-hard)
//
// n = R*C is the fp32 element count: positive and <= 4 * bank lines. C is
// the row width: >= 4, a multiple of 4 (a width that is not a whole number
// of 16B bank rows is a misaligned buffer), <= 2 * bank lines (2C gamma +
// beta elements must fit the param bank), and a divisor of n (whole rows).
// The full fail-hard table lives in
// examples/balls/layernorm/emu/src/69_layernorm.rs; the C golden is ln_row()
// in examples/balls/layernorm/workloads/ctests/layernorm_test.c.
#define bb_layernorm(x_bank, param_bank, out_bank, n, c)                       \
  BUCKYBALL_INSTRUCTION_R_R((BB_BANK0(x_bank) | BB_BANK1(param_bank) |         \
                             BB_BANK2(out_bank) | BB_ITER(n)),                 \
                            FIELD(c, 0, 31), BB_FUNC7(LAYERNORM))

#endif // _BB_LAYERNORM_H_
