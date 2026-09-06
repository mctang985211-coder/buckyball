#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/layernorm.h>
#include <stdio.h>
#include <string.h>
#define LANES (BANK_WIDTH / 32)
#define FABS(x) ((x) < 0 ? -(x) : (x))
static float xnat[4096], xrg[2048], prg[1024], org[2048];
static float gv[512], bv[512];
static uint32_t rng = 0x51a7e;
static float frand(void) {
  rng = rng * 1664525u + 1013904223u;
  return (float)((rng >> 8) % 2001) / 1000.0f - 1.0f;
}
static double rsqrt(double v) { /* Newton on 1/sqrt(v); no libm in ctests */
  union {
    double d;
    uint64_t u;
  } w;
  w.d = v;
  int e = (int)((w.u >> 52) & 0x7ff) - 1023;
  w.u = (uint64_t)(1023 - ((e > 0 ? e + 1 : e) / 2)) << 52;
  for (int i = 0; i < 8; ++i)
    w.d *= 1.5 - 0.5 * v * w.d * w.d;
  return w.d;
}
static void shuffle(const float *nat, float *rgn, int lines, int g) {
  for (int l = 0; l < lines; ++l)
    for (int k = 0; k < LANES; ++k)
      rgn[((l % BANK_LINES) * g + l / BANK_LINES) * LANES + k] =
          nat[l * LANES + k];
}
static int run(const float *x, int rows, int cols) {
  int lines = rows * cols / LANES;
  int gx = (lines + BANK_LINES - 1) / BANK_LINES;
  int gp = (cols / 2 + BANK_LINES - 1) / BANK_LINES;
  for (int lp = 0, q = cols / LANES; lp < cols / 2; ++lp) {
    const float *r4 = lp < q ? gv : bv;
    for (int k = 0; k < LANES; ++k)
      prg[((lp % BANK_LINES) * gp + lp / BANK_LINES) * LANES + k] =
          r4[(lp % q) * LANES + k];
  }
  shuffle(x, xrg, lines, gx);
  bb_mem_alloc(0, 1, gx);
  bb_mem_alloc(1, 1, gp);
  bb_mem_alloc(2, 1, gx);
  bb_mvin((uintptr_t)xrg, 0, lines < BANK_LINES ? lines : BANK_LINES, 1);
  bb_mvin((uintptr_t)prg, 1, cols / 2 < BANK_LINES ? cols / 2 : BANK_LINES, 1);
  bb_layernorm(0, 1, 2, rows, cols);
  bb_mvout((uintptr_t)org, 2, lines < BANK_LINES ? lines : BANK_LINES, 1);
  bb_fence();
  bb_mem_release(0);
  bb_mem_release(1);
  bb_mem_release(2);
  for (int r = 0; r < rows; ++r) {
    double sum = 0;
    for (int j = 0; j < cols; ++j)
      sum += x[r * cols + j];
    double mean = sum / cols, var = 0;
    for (int j = 0; j < cols; ++j) {
      double d = x[r * cols + j] - mean;
      var += d * d;
    }
    double scale = rsqrt(var / cols + 1e-12);
    for (int j = 0; j < cols; ++j) {
      int l = r * (cols / LANES) + j / LANES;
      double exp = (x[r * cols + j] - mean) * scale * gv[j] + bv[j];
      double got =
          org[((l % BANK_LINES) * gx + l / BANK_LINES) * LANES + j % LANES];
      double e2 = FABS(exp);
      if (e2 < 1)
        e2 = 1;
      if (FABS(got - exp) > 1e-5 * e2) {
        printf("layernorm_bank FAIL r=%d c=%d\n", r, j);
        return 0;
      }
    }
  }
  return 1;
}
int main(void) {
  int ok = 1;
  for (int j = 0; j < 512; ++j) {
    gv[j] = 0.5f + 0.25f * (float)(j % 3);
    bv[j] = frand() * 0.25f;
  }
  /* 8 rows: single 4-row call (20 banks) then two-slice 4+4-row calls */
  for (int j = 0; j < 8 * 512; ++j)
    xnat[j] = frand();
  ok &= run(xnat, 4, 512);
  ok &= run(xnat + 4 * 512, 4, 512);
  printf("layernorm_bank_test %s\n", ok ? "PASSED" : "FAILED");
  return ok ? 0 : 1;
}
