#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/clamp.h>
#include <stdint.h>
#include <stdio.h>
// Expected FAIL with a Clamp panic/assert; never part of an all-PASS list.
int main(void) {
  uint64_t input = 0, output = 1, n = 4, reserved = 0;
  uint64_t bounds = (uint32_t)-10 | ((uint64_t)(uint32_t)10 << 32);
  bb_mem_alloc(input, 1, 1);
  bb_mem_alloc(output, 1, 1);
  bb_mem_release(input);
  bb_mem_alloc(input, 1, 2);
  BUCKYBALL_INSTRUCTION_R_R(BB_BANK0(input) | BB_BANK2(output) | BB_ITER(n) |
                                reserved,
                            bounds, BB_FUNC7(CLAMP));
  bb_fence();
  printf("ERROR: invalid clamp was accepted\n");
  return 1;
}
