#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
static void fail(void) {
#ifdef BAREMETAL
  *(volatile uint32_t *)0x60000000 = 1;
  while (1) {
  }
#else
  exit(1);
#endif
}
extern "C" void check_result(int32_t *allocated, int32_t *aligned,
                             int64_t offset, int64_t size0, int64_t size1,
                             int64_t stride0, int64_t stride1) {
  (void)allocated;
  if (size0 != 4 || size1 != 4 || stride0 != 4 || stride1 != 1)
    fail();
  for (int r = 0; r < 4; ++r)
    for (int c = 0; c < 4; ++c) {
      int32_t expected = (r * 4 + c) * 7 - 42;
      if (expected < -10)
        expected = -10;
      if (expected > 10)
        expected = 10;
      if (aligned[offset + r * stride0 + c * stride1] != expected) {
        printf("FAILED: clamp MLIR lane %d\n", r * 4 + c);
        fail();
      }
    }
  printf("PASSED: clamp 4x4 i32\n");
}
