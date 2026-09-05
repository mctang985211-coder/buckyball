#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/layernorm.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

/* Golden row-wise LayerNorm, identical to layernorm_test.c and to the
 * model in examples/balls/layernorm/emu/src/69_layernorm.rs. Bank test:
 * R = 8 rows x C = 512 columns (N = 4096 fp32 = the full x bank; param
 * holds 2C = 1024 gamma+beta elements), deterministic pseudo-random
 * vectors in [-8, 8] / [-1, 1]. */
static double dsqrt(double v) {
  union {
    double d;
    uint64_t u;
  } t;
  t.d = v;
  t.u = (t.u >> 1) + 0x1ff8000000000000ull; /* sqrt(v), ~4% relative */
  double y = t.d;
  y = 0.5 * (y + v / y);
  y = 0.5 * (y + v / y);
  return 0.5 * (y + v / y);
}

static void ln_row(const float *x, const float *param, float *y, int c) {
  double sum = 0.0;
  for (int j = 0; j < c; ++j)
    sum += (double)x[j];
  double mu = sum / (double)c;
  double ss = 0.0;
  for (int j = 0; j < c; ++j) {
    double d = (double)x[j] - mu;
    ss += d * d;
  }
  double rstd = 1.0 / dsqrt(ss / (double)c + 1e-12);
  for (int j = 0; j < c; ++j)
    y[j] = (float)(((double)x[j] - mu) * rstd * (double)param[j] +
                   (double)param[c + j]);
}

#define C 512
#define R 8
static float input[R * C] __attribute__((aligned(64)));
static float param[2 * C] __attribute__((aligned(64)));
static float output[R * C] __attribute__((aligned(64)));
static float expected[R * C];

int main(void) {
  const uint32_t x_bank = 0, p_bank = 1, o_bank = 2;
  srand(42);
  for (int i = 0; i < R * C; ++i)
    input[i] = (float)((double)rand() / RAND_MAX * 16.0 - 8.0);
  for (int i = 0; i < 2 * C; ++i)
    param[i] = (float)((double)rand() / RAND_MAX * 2.0 - 1.0);

  bb_mem_alloc(x_bank, 1, 1);
  bb_mem_alloc(p_bank, 1, 1);
  bb_mem_alloc(o_bank, 1, 1);
  bb_mvin((uintptr_t)input, x_bank, R * C / 4, 1);
  bb_mvin((uintptr_t)param, p_bank, C / 2, 1);
  bb_layernorm(x_bank, p_bank, o_bank, R * C, C);
  bb_mvout((uintptr_t)output, o_bank, R * C / 4, 1);
  bb_fence();

  for (int r = 0; r < R; ++r)
    ln_row(input + r * C, param, expected + r * C, C);

  int failed = 0;
  for (int i = 0; i < R * C; ++i) {
    float tol = 1e-4f * (1.0f + fabsf(expected[i]));
    if (fabsf(output[i] - expected[i]) > tol) {
      printf("layernorm bank mismatch at %d\n", i);
      failed = 1;
      break;
    }
  }
  bb_mem_release(x_bank);
  bb_mem_release(p_bank);
  bb_mem_release(o_bank);
  printf("layernorm_bank_test %s\n", failed ? "FAILED" : "PASSED");
  return failed;
}
