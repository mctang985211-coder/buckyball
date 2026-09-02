#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/sigmoid.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* Golden sigmoid: y = 1 / (1 + exp(-x)) in the exact form (reference:
 * torch.sigmoid). Evaluated in IEEE double with a 9-term Taylor exp and an
 * exact 2^k bit-scaled exponent (no libm), mirroring sigmoid_gold() in
 * examples/balls/sigmoid/emu/src/57_sigmoid.rs term for term. */
static double sigmoid_exp_neg(double y) { /* exp(y), y in [-100, 0] */
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

static float sigmoid_ref(float x) {
  double xd = (double)x;
  double a = xd < 0.0 ? -xd : xd;
  int pos = xd >= 0.0;
  if (a > 100.0)
    a = 100.0;
  double e = sigmoid_exp_neg(-a);
  return (float)(pos ? 1.0 / (1.0 + e) : e / (1.0 + e));
}

#define N 16
static float input[N] __attribute__((aligned(64))) = {
    0.0f, -0.0f, 1.4e-45f, 0.0625f, 1.0f,    -1.0f, 2.0f,   -2.0f,
    0.5f, -0.5f, 4.0f,     -4.0f,   9.9375f, 10.0f, -10.0f, 12.0f};
static float output[N] __attribute__((aligned(64)));

int main(void) {
  const uint32_t in_bank = 0;
  const uint32_t out_bank = 1;
  const uint32_t rows = N / 4;

  bb_mem_alloc(in_bank, 1, 1);
  bb_mem_alloc(out_bank, 1, 1);
  bb_mvin((uintptr_t)input, in_bank, rows, 1);
  bb_sigmoid(in_bank, out_bank, N);
  bb_mvout((uintptr_t)output, out_bank, rows, 1);
  bb_fence();

  int failed = 0;
  for (int i = 0; i < N; ++i) {
    float expected = sigmoid_ref(input[i]);
    if (fabsf(output[i] - expected) > 1e-4f) {
      uint32_t got_bits, exp_bits;
      memcpy(&got_bits, &output[i], 4);
      memcpy(&exp_bits, &expected, 4);
      printf("sigmoid mismatch at %d: got 0x%08x expected 0x%08x\n", i,
             got_bits, exp_bits);
      failed = 1;
    }
  }
  bb_mem_release(in_bank);
  bb_mem_release(out_bank);
  printf("sigmoid_test %s\n", failed ? "FAILED" : "PASSED");
  return failed;
}
