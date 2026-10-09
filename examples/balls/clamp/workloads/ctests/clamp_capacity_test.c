#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/clamp.h>
#include <stdint.h>
#include <stdio.h>
#define N (BANK_LINES * 4)
static int32_t input[N] __attribute__((aligned(64)));
static int32_t output[N] __attribute__((aligned(64)));
int main(void) {
  uint32_t rng = 0x6c616d70;
  for (int i = 0; i < N; ++i) {
    rng = rng * 1664525u + 1013904223u;
    input[i] = (int32_t)rng;
  }
  bb_mem_alloc(0, 1, 1);
  bb_mem_alloc(1, 1, 1);
  bb_mvin((uintptr_t)input, 0, BANK_LINES, 1);
  bb_clamp(0, 1, N, -123456, 654321);
  bb_mvout((uintptr_t)output, 1, BANK_LINES, 1);
  bb_fence();
  bb_mem_release(0);
  bb_mem_release(1);
  for (int i = 0; i < N; ++i) {
    int32_t expected = input[i];
    if (expected < -123456)
      expected = -123456;
    if (expected > 654321)
      expected = 654321;
    if (output[i] != expected) {
      printf("clamp capacity mismatch %d\n", i);
      return 1;
    }
  }
  printf("clamp_capacity_test PASSED\n");
  return 0;
}
