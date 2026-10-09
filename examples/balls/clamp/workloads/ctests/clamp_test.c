#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/clamp.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#define N 16
static const int32_t input[N] __attribute__((aligned(64))) = {
    INT32_MIN, INT32_MAX, -11, -10, -9, -1, 0, 1, 9, 10, 11, 42, -42, 7, -7, 2};
static int32_t output[N] __attribute__((aligned(64)));
static int run(int n, int32_t lo, int32_t hi) {
  bb_mem_alloc(0, 1, 1);
  bb_mem_alloc(1, 1, 1);
  bb_mvin((uintptr_t)input, 0, N / 4, 1);
  bb_clamp(0, 1, n, lo, hi);
  bb_mvout((uintptr_t)output, 1, n / 4, 1);
  bb_fence();
  bb_mem_release(0);
  bb_mem_release(1);
  for (int i = 0; i < n; ++i) {
    int32_t expected = input[i];
    if (expected < lo)
      expected = lo;
    if (expected > hi)
      expected = hi;
    if (output[i] != expected) {
      printf("clamp mismatch %d: got %d expected %d\n", i, output[i], expected);
      return 1;
    }
  }
  return 0;
}
int main(void) {
  if (run(4, -10, 10) || run(N, -10, 10) || run(N, 7, 7) ||
      run(N, INT32_MIN, INT32_MAX) || run(N, INT32_MIN, -1) ||
      run(N, 0, INT32_MAX))
    return 1;
  printf("clamp_test PASSED\n");
  return 0;
}
