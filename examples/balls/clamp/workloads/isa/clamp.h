#ifndef BB_CLAMP_H
#define BB_CLAMP_H
#include <bbhw/isa/bb_func7.h>
#include <bbhw/isa/isa.h>
#include <stdint.h>
// One allocated single-group input and a distinct output, N INT32 elements.
// See ../contract.md. Bounds preserve their full signed 32-bit bit patterns.
#define bb_clamp(input, output, n, lo, hi)                                     \
  BUCKYBALL_INSTRUCTION_R_R(                                                   \
      BB_BANK0((uint64_t)(input)) | BB_BANK2((uint64_t)(output)) |             \
          BB_ITER((uint64_t)(n)),                                              \
      (uint64_t)(uint32_t)(lo) | ((uint64_t)(uint32_t)(hi) << 32),             \
      BB_FUNC7(CLAMP))
#endif
