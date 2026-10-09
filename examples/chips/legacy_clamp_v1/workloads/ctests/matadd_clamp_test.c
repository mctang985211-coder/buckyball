#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/clamp.h>
#include <isa/matadd.h>
#include <stdint.h>
#include <stdio.h>
#define N 64
#define LINES (N / 4)
static int32_t a[N] __attribute__((aligned(64)));
static int32_t b[N] __attribute__((aligned(64)));
static int32_t output[N] __attribute__((aligned(64)));
int main(void) {
  const int32_t lo = -17, hi = 23;
  int32_t expected[N];
  for (int i = 0; i < N; ++i) {
    a[i] = i * 7 - 220;
    b[i] = 150 - i * 3;
    int64_t sum = (int64_t)a[i] + b[i];
    expected[i] = sum < lo ? lo : sum > hi ? hi : (int32_t)sum;
    output[i] = 0x12345678;
  }
  for (uint32_t bank = 0; bank < 4; ++bank)
    bb_mem_alloc(bank, 1, 1);
  bb_mvin((uintptr_t)a, 0, LINES, 1);
  bb_mvin((uintptr_t)b, 1, LINES, 1);
  bb_matadd(0, 1, 2, LINES);
  bb_fence();
  printf("CLAMP_ACTIVITY_BEGIN\n");
  bb_clamp(2, 3, N, lo, hi);
  bb_fence();
  printf("CLAMP_ACTIVITY_END\n");
  bb_mvout((uintptr_t)output, 3, LINES, 1);
  bb_fence();
  for (uint32_t bank = 0; bank < 4; ++bank)
    bb_mem_release(bank);
  for (int i = 0; i < N; ++i) {
    if (output[i] != expected[i]) {
      printf("MatAdd->Clamp mismatch %d: got=%d expected=%d\n", i, output[i],
             expected[i]);
      return 1;
    }
  }
  printf("matadd_clamp_test PASSED\n");
  return 0;
}
