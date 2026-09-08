#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/silu.h>
#include <stdint.h>
#include <stdio.h>

/* Golden SiLU: term-for-term identical to silu_test.c and to silu_gold() in
 * examples/balls/silu/emu/src/59_silu.rs. Bank test: full single-group bank
 * per call (n = 256 fp32 = 64 lines = pebble bank entries, the D1 equality
 * shape) with a deterministic LCG pseudo-random vector in [-100, 100].
 * bemu-only; never registered in the verilator lists. */
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
  if (a > 100.0)
    a = 100.0;
  double e = silu_exp_neg(-a);
  double sig = xd >= 0.0 ? 1.0 / (1.0 + e) : e / (1.0 + e);
  return (float)(xd * sig);
}

#define FABS(x) ((x) < 0 ? -(x) : (x))
#define N 256
static uint32_t rng = 0x51a7e;
static float input[N] __attribute__((aligned(64)));
static float output[N] __attribute__((aligned(64)));

static float frand(void) {
  rng = rng * 1664525u + 1013904223u;
  return (float)((rng >> 8) % 2001) / 10.0f - 100.0f;
}

static int run(void) {
  const uint32_t in_bank = 0;
  const uint32_t out_bank = 1;
  const int rows = N / 4;
  for (int i = 0; i < N; ++i)
    input[i] = frand();
  bb_mem_alloc(in_bank, 1, 1);
  bb_mem_alloc(out_bank, 1, 1);
  bb_mvin((uintptr_t)input, in_bank, rows, 1);
  bb_silu(in_bank, out_bank, N);
  bb_mvout((uintptr_t)output, out_bank, rows, 1);
  bb_fence();
  bb_mem_release(in_bank);
  bb_mem_release(out_bank);
  for (int i = 0; i < N; ++i) {
    if (FABS(output[i] - silu_ref(input[i])) > 1e-4f) {
      printf("silu bank mismatch at %d\n", i);
      return 0;
    }
  }
  return 1;
}

int main(void) {
  int ok = 1;
  for (int r = 0; r < 8 && ok; ++r)
    ok &= run();
  printf("silu_bank_test %s\n", ok ? "PASSED" : "FAILED");
  return ok ? 0 : 1;
}
