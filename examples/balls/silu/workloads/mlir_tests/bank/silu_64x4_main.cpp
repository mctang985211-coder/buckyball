#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

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

/* Golden SiLU: y = x / (1 + e^{-x}); IEEE double with a 9-term Taylor exp
 * and an exact 2^k bit-scaled exponent (no libm), term-for-term identical
 * to silu_ref() in the ctests and to silu_gold() in 59_silu.rs. */
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

static float silu_ref(double x) {
  double a = x < 0.0 ? -x : x;
  if (a > 100.0) /* e^{-a} <= 3.7e-44; |x|*e^{-100} < 1e-4 for all fp32 */
    a = 100.0;
  double e = silu_exp_neg(-a);
  double sig = x >= 0.0 ? 1.0 / (1.0 + e) : e / (1.0 + e);
  return (float)(x * sig);
}

/* Mirror of the fill loop in silu_64x4.mlir: x(i) = ((i*37)%2001 - 1000)/4,
 * exact in f32 (ints <= 2001, power-of-two divisor). */
static float fill_value(int i) {
  int xi = (i * 37) % 2001 - 1000;
  return (float)((double)xi * 0.25);
}

#ifdef __cplusplus
extern "C"
#endif
    void check_result(float *allocated, float *aligned, int64_t offset,
                      int64_t size0, int64_t size1, int64_t stride0,
                      int64_t stride1) {
  (void)allocated;
  if (size0 != 64 || size1 != 4 || stride0 != 4 || stride1 != 1) {
    printf("FAILED: silu shape %dx%d stride %dx%d\n", (int)size0, (int)size1,
           (int)stride0, (int)stride1);
    fail();
  }
  float *out = aligned + offset;
  for (int r = 0; r < 64; ++r) {
    for (int c = 0; c < 4; ++c) {
      int i = r * 4 + c;
      float exp = silu_ref((double)fill_value(i));
      float got = out[r * stride0 + c * stride1];
      double err = got - exp;
      if (err < 0)
        err = -err;
      if (err > 1e-4) {
        union {
          float f;
          uint32_t u;
        } gb, eb;
        gb.f = got;
        eb.f = exp;
        printf("FAILED: silu out[%d][%d] got 0x%08x exp 0x%08x\n", r, c, gb.u,
               eb.u);
        fail();
      }
    }
  }
  printf("PASSED: silu 64x4 f32\n");
}
