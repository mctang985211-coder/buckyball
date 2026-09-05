#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/layernorm.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* Golden row-wise LayerNorm (torch.nn.LayerNorm(C, eps=1e-12), biased
 * variance, two-step mean-subtracted form): per row of C fp32 columns,
 * mu = mean(x), y[j] = (x[j]-mu) * rsqrt(var+eps) * gamma[j] + beta[j].
 * Evaluated in IEEE double with a libm-free dsqrt (bit guess + 3 Newton
 * steps), mirroring layernorm in examples/balls/layernorm/emu/src/
 * 69_layernorm.rs. gamma lives in param[0, C), beta in param[C, 2C). */
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

#define C 8
#define R 5
static float input[R * C] __attribute__((aligned(64))) = {
    /* constant row: var = 0 -> rstd = 1e6, x - mu = 0 -> y = beta */
    2.0f, 2.0f, 2.0f, 2.0f, 2.0f, 2.0f, 2.0f, 2.0f,
    /* signed zero and unit-scale row */
    0.0f, -0.0f, 1.0f, 2.0f, -1.0f, -2.0f, 0.5f, -0.5f,
    /* small-magnitude row: var ~ 1e-8, rstd ~ 1e4 */
    3.0e-5f, -7.0e-5f, 2.0e-4f, -2.0e-4f, 0.0f, 1.0e-4f, -1.0e-4f, 9.0e-5f,
    /* all-zero row: var = 0 -> y = beta */
    0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
    /* wide-dynamic-range row (mean 0) */
    -100.0f, 100.0f, -50.0f, 50.0f, -0.25f, 0.25f, -10.0f, 10.0f};
static float param[2 * C] __attribute__((aligned(64))) = {
    /* gamma: includes a zero scale */
    1.0f, -1.0f, 0.5f, 2.0f, 0.0f, -0.5f, 0.75f, -2.0f,
    /* beta: includes a zero shift */
    0.0f, 1.0f, -1.0f, 0.25f, 2.0f, 0.0f, -0.25f, -1.5f};
static float output[R * C] __attribute__((aligned(64)));
static float expected[R * C];

int main(void) {
  const uint32_t x_bank = 0, p_bank = 1, o_bank = 2;
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
      uint32_t got_bits, exp_bits;
      memcpy(&got_bits, &output[i], 4);
      memcpy(&exp_bits, &expected[i], 4);
      printf("layernorm mismatch at %d: got 0x%08x expected 0x%08x\n", i,
             got_bits, exp_bits);
      failed = 1;
    }
  }
  bb_mem_release(x_bank);
  bb_mem_release(p_bank);
  bb_mem_release(o_bank);
  printf("layernorm_test %s\n", failed ? "FAILED" : "PASSED");
  return failed;
}
