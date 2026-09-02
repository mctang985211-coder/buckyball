#ifndef _BB_SIGMOID_H_
#define _BB_SIGMOID_H_

#include <bbhw/isa/bb_func7.h>
#include <bbhw/isa/isa.h>

// SIGMOID(in_bank, out_bank, n): fp32 y = 1 / (1 + exp(-x)) in the exact
// form (reference: torch.sigmoid; never a piecewise-linear or x/(1+|x|)
// approximation). Elementwise 1rd+1wr: one single-group input bank, one
// distinct single-group output bank, dense packing, 4 fp32 lanes per 16B
// bank row.
//
//   rs1 = BB_BANK0(in_bank) | BB_BANK2(out_bank) | BB_ITER(n)
//   rs2 = 0 (reserved, fail-hard)
//
// n is the fp32 element count: positive, a multiple of 4 (a length that is
// not a whole number of 16B rows is treated as a misaligned buffer), and no
// larger than 4 * bank lines. The full fail-hard table lives in
// examples/balls/sigmoid/emu/src/57_sigmoid.rs; the C golden is sigmoid_ref()
// in examples/balls/sigmoid/workloads/ctests/sigmoid_test.c.
#define bb_sigmoid(in_bank, out_bank, n)                                       \
  BUCKYBALL_INSTRUCTION_R_R(                                                   \
      (BB_BANK0(in_bank) | BB_BANK2(out_bank) | BB_ITER(n)), 0,                \
      BB_FUNC7(SIGMOID))

#endif // _BB_SIGMOID_H_
