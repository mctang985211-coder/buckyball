#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/tanh.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

/* Golden tanh, term-for-term identical to tanh_ref() in tanh_test.c and to
 * tanh_gold() in examples/balls/tanh/emu/src/58_tanh.rs.
 * Bank test: full 1024-line bank of fp32 (N = 4096) with a deterministic
 * pseudo-random vector in [-8, 8]. */
static double tanh_exp_neg(double y) { /* exp(y), y in [-200, 0] */
  int k = (int)(y * 1.4426950408889634 - 0.5);
  double f = y - (double)k * 0.6931471805599453;
  double e =
      1.0 +
      f * (1.0 + f * (0.5 + f * (1.0 / 6.0 +
                                 f * (1.0 / 24.0 +
                                      f * (1.0 / 120.0 +
                                           f * (1.0 / 720.0 +
                                                f * (1.0 / 5040.0 +
                                                     f * (1.0 / 40320.0))))))));
  union {
    double d;
    uint64_t u;
  } v;
  v.d = e;
  v.u += (uint64_t)(int64_t)k << 52;
  return v.d;
}

static float tanh_ref(float x) {
  double xd = (double)x;
  double a = xd < 0.0 ? -xd : xd;
  int pos = xd >= 0.0;
  if (a > 100.0)
    a = 100.0;
  double e = tanh_exp_neg(-2.0 * a);
  double y = (1.0 - e) / (1.0 + e);
  return (float)(pos ? y : -y);
}

#define N 4096
static float input[N] __attribute__((aligned(64)));
static float output[N] __attribute__((aligned(64)));

int main(void) {
  const uint32_t in_bank = 0;
  const uint32_t out_bank = 1;
  const uint32_t rows = N / 4;

  srand(42);
  for (int i = 0; i < N; ++i)
    input[i] = (float)((double)rand() / RAND_MAX * 16.0 - 8.0);

  bb_mem_alloc(in_bank, 1, 1);
  bb_mem_alloc(out_bank, 1, 1);
  bb_mvin((uintptr_t)input, in_bank, rows, 1);
  bb_tanh(in_bank, out_bank, N);
  bb_mvout((uintptr_t)output, out_bank, rows, 1);
  bb_fence();

  int failed = 0;
  for (int i = 0; i < N; ++i) {
    if (fabsf(output[i] - tanh_ref(input[i])) > 1e-4f) {
      printf("tanh bank mismatch at %d\n", i);
      failed = 1;
      break;
    }
  }
  bb_mem_release(in_bank);
  bb_mem_release(out_bank);
  printf("tanh_bank_test %s\n", failed ? "FAILED" : "PASSED");
  return failed;
}
