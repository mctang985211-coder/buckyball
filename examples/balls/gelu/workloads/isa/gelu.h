#ifndef _BB_GELU_H_
#define _BB_GELU_H_

#include <bbhw/isa/bb_func7.h>
#include <bbhw/isa/isa.h>

// GELU(in_bank, out_bank, n): fp32 y = x * Phi(x) with the exact erf form,
// Phi(x) = 0.5 * (1 + erf(x / sqrt(2))) (reference:
// torch.nn.functional.gelu(approximate='none')). Elementwise 1rd+1wr: one
// single-group input bank, one distinct single-group output bank, dense
// packing, 4 fp32 lanes per 16B bank row.
//
//   rs1 = BB_BANK0(in_bank) | BB_BANK2(out_bank) | BB_ITER(n)
//   rs2 = 0 (reserved, fail-hard)
//
// n is the fp32 element count: positive, a multiple of 4 (a length that is
// not a whole number of 16B rows is treated as a misaligned buffer), and no
// larger than 4 * bank lines. The full fail-hard table lives in
// examples/balls/gelu/emu/src/56_gelu.rs; the C golden is gelu_ref() in
// examples/balls/gelu/workloads/ctests/gelu_test.c.
#define bb_gelu(in_bank, out_bank, n)                                          \
  BUCKYBALL_INSTRUCTION_R_R(                                                   \
      (BB_BANK0(in_bank) | BB_BANK2(out_bank) | BB_ITER(n)), 0,                \
      BB_FUNC7(GELU))

#endif // _BB_GELU_H_
