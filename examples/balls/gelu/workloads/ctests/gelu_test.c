#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/gelu.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* Golden GELU: y = x * Phi(x), Phi(x) = 0.5 * (1 + erf(x / sqrt(2))) with
 * the exact erf form (reference: torch.nn.functional.gelu(approximate=
 * 'none')). Evaluated in IEEE double with Abramowitz-Stegun 7.1.26 and a
 * pure bit-arithmetic exp (no libm), mirroring gelu_gold() in
 * examples/balls/gelu/emu/src/56_gelu.rs term for term. */
static double gelu_exp_neg(double y) { /* exp(y), y in [-18.1, 0] */
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

static double gelu_erf(double z) {
  double az = z < 0.0 ? -z : z;
  double s = z < 0.0 ? -1.0 : 1.0;
  if (az >= 4.25)
    return s;
  double t = 1.0 / (1.0 + 0.3275911 * az);
  double p =
      t * (0.254829592 +
           t * (-0.284496736 +
                t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return s * (1.0 - p * gelu_exp_neg(-az * az));
}

float gelu_ref(float x) {
  double xd = (double)x;
  double phi = 0.5 * (1.0 + gelu_erf(xd * 0.7071067811865476));
  return (float)(xd * phi);
}

#define N 16
static float input[N] __attribute__((aligned(64))) = {
    0.0f,       -0.0f, 0.0625f, 1.0f,  -1.0f,      2.0f,  -2.0f, -0.75f,
    3.1415927f, -3.5f, 4.0f,    -6.0f, 6.0115296f, -8.0f, 8.0f,  1e-3f};
static float output[N] __attribute__((aligned(64)));

int main(void) {
  const uint32_t in_bank = 0;
  const uint32_t out_bank = 1;
  const uint32_t rows = N / 4;

  bb_mem_alloc(in_bank, 1, 1);
  bb_mem_alloc(out_bank, 1, 1);
  bb_mvin((uintptr_t)input, in_bank, rows, 1);
  bb_gelu(in_bank, out_bank, N);
  bb_mvout((uintptr_t)output, out_bank, rows, 1);
  bb_fence();

  int failed = 0;
  for (int i = 0; i < N; ++i) {
    float expected = gelu_ref(input[i]);
    if (fabsf(output[i] - expected) > 1e-4f) {
      uint32_t got_bits, exp_bits;
      memcpy(&got_bits, &output[i], 4);
      memcpy(&exp_bits, &expected, 4);
      printf("gelu mismatch at %d: got 0x%08x expected 0x%08x\n", i, got_bits,
             exp_bits);
      failed = 1;
    }
  }
  bb_mem_release(in_bank);
  bb_mem_release(out_bank);
  printf("gelu_test %s\n", failed ? "FAILED" : "PASSED");
  return failed;
}
