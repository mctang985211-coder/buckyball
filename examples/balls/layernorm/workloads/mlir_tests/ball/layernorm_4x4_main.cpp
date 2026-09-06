#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void fail(void) {
#ifdef BAREMETAL
  volatile uint32_t *sim_exit = (volatile uint32_t *)0x60000000;
  *sim_exit = 1;
  while (1) {
  }
#else
  exit(1);
#endif
}

static double rsqrt(double v) { /* Newton on 1/sqrt(v); no libm dependency */
  uint64_t u;
  memcpy(&u, &v, 8);
  int e = (int)((u >> 52) & 0x7ff) - 1023;
  u = (uint64_t)(1023 - ((e > 0 ? e + 1 : e) / 2)) << 52;
  double s;
  memcpy(&s, &u, 8);
  for (int i = 0; i < 8; ++i)
    s *= 1.5 - 0.5 * v * s * s;
  return s;
}

#ifdef __cplusplus
extern "C"
#endif
    void check_result(float *allocated, float *aligned, int64_t offset,
                      int64_t size0, int64_t size1, int64_t stride0,
                      int64_t stride1) {
  (void)allocated;
  if (size0 != 4 || size1 != 4 || stride0 != 4 || stride1 != 1) {
    printf("FAILED: layernorm shape %dx%d stride %dx%d\n", (int)size0,
           (int)size1, (int)stride0, (int)stride1);
    fail();
  }
  float *out = aligned + offset;
  for (int r = 0; r < 4; ++r) {
    double sum = 0.0;
    for (int c = 0; c < 4; ++c)
      sum += (double)(r * 4 + c + 1);
    double mean = sum / 4.0, var = 0.0;
    for (int c = 0; c < 4; ++c) {
      double d = (double)(r * 4 + c + 1) - mean;
      var += d * d;
    }
    double scale = rsqrt(var / 4.0 + 1e-12);
    for (int c = 0; c < 4; ++c) {
      double d = (double)(r * 4 + c + 1) - mean;
      double gamma = 0.25 * (c + 1);
      double beta = 0.25 * (c - 1);
      double expected = d * scale * gamma + beta;
      double got = out[r * stride0 + c * stride1];
      double err = got - expected;
      double bound = 1e-5;
      if (expected < 0)
        expected = -expected;
      if (expected > 1)
        bound *= expected;
      if (err < 0)
        err = -err;
      if (err > bound) {
        printf("FAILED: layernorm out[%d][%d] exp=%f got=%f\n", r, c,
               (double)(d * scale * gamma + beta), got);
        fail();
      }
    }
  }
  printf("PASSED: layernorm 4x4 f32\n");
}
