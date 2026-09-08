#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/silu.h>
#include <stdint.h>
#include <stdio.h>

/* Golden SiLU: y = x / (1 + e^{-x}) (reference: torch.nn.functional.silu).
 * IEEE double with a 9-term Taylor exp and an exact 2^k bit-scaled exponent
 * (no libm), term-for-term identical to silu_gold() in examples/balls/silu/
 * emu/src/59_silu.rs and to the mlir_tests check_result. */
static double silu_exp_neg(double y) { /* exp(y), y in [-100, 0] */
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

static float silu_ref(float x) {
  double xd = (double)x;
  double a = xd < 0.0 ? -xd : xd;
  if (a > 100.0) /* e^{-a} <= 3.7e-44; |x|*e^{-100} < 1e-4 for all fp32 */
    a = 100.0;
  double e = silu_exp_neg(-a);
  double sig = xd >= 0.0 ? 1.0 / (1.0 + e) : e / (1.0 + e);
  return (float)(xd * sig);
}

#define FABS(x) ((x) < 0 ? -(x) : (x))
static float input[256] __attribute__((aligned(64)));
static float output[256] __attribute__((aligned(64)));

static int run(const float *x, int n) {
  const uint32_t in_bank = 0;
  const uint32_t out_bank = 1;
  const int rows = n / 4;
  bb_mem_alloc(in_bank, 1, 1);
  bb_mem_alloc(out_bank, 1, 1);
  bb_mvin((uintptr_t)x, in_bank, rows, 1);
  bb_silu(in_bank, out_bank, n);
  bb_mvout((uintptr_t)output, out_bank, rows, 1);
  bb_fence();
  bb_mem_release(in_bank);
  bb_mem_release(out_bank);
  for (int i = 0; i < n; ++i) {
    if (FABS(output[i] - silu_ref(x[i])) > 1e-4f) {
      union {
        float f;
        uint32_t u;
      } got, exp;
      got.f = output[i];
      exp.f = silu_ref(x[i]);
      printf("silu mismatch at %d: got 0x%08x expected 0x%08x\n", i, got.u,
             exp.u);
      return 0;
    }
  }
  return 1;
}

int main(void) {
  int ok = 1;
  const float min4[4] = {0.0f, -0.0f, 1.4e-45f, -1.4e-45f};
  ok &= run(min4, 4);
  const float vec[16] = {0.0625f, -0.0625f, 1.0f,  -1.0f, 2.0f,  -2.0f,
                         4.0f,    -4.0f,    8.0f,  -8.0f, 16.0f, -16.0f,
                         32.0f,   -32.0f,   88.0f, -88.0f};
  ok &= run(vec, 16);
  const float sat[8] = {90.0f,  -90.0f,  100.0f, -100.0f,
                        745.0f, -745.0f, 1e30f,  -1e30f};
  ok &= run(sat, 8);
  for (int i = 0; i < 256; ++i)
    input[i] = (float)((int)((i * 37) % 2001) - 1000) / 4.0f; /* [-250,250] */
  ok &= run(input, 256);
  printf("silu_test %s\n", ok ? "PASSED" : "FAILED");
  return ok ? 0 : 1;
}
