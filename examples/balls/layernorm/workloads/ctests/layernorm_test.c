#include "buckyball.h"
#include <bbhw/isa/isa.h>
#include <bbhw/mem/mem.h>
#include <isa/layernorm.h>
#include <stdio.h>
#include <string.h>
#define LANES (BANK_WIDTH / 32)
#define FABS(x) ((x) < 0 ? -(x) : (x))
static float xt[512], xb[512], pb[1024], ob[512], pn[1024], g[512], be[512];
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
    const float *r4 = lp < q ? g : be;
    for (int k = 0; k < LANES; ++k)
      pn[lp * LANES + k] = r4[(lp % q) * LANES + k];
  }
  shuffle(pn, pb, cols / 2, gp);
  shuffle(x, xb, lines, gx);
  bb_mem_alloc(0, 1, gx);
  bb_mem_alloc(1, 1, gp);
  bb_mem_alloc(2, 1, gx);
  bb_mvin((uintptr_t)xb, 0, lines < BANK_LINES ? lines : BANK_LINES, 1);
  bb_mvin((uintptr_t)pb, 1, cols / 2 < BANK_LINES ? cols / 2 : BANK_LINES, 1);
  bb_layernorm(0, 1, 2, rows, cols);
  bb_mvout((uintptr_t)ob, 2, lines < BANK_LINES ? lines : BANK_LINES, 1);
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
      double exp = (x[r * cols + j] - mean) * scale * g[j] + be[j];
      double got =
          ob[((l % BANK_LINES) * gx + l / BANK_LINES) * LANES + j % LANES];
      double e2 = FABS(exp);
      if (e2 < 1)
        e2 = 1;
      if (FABS(got - exp) > 1e-5 * e2) {
        printf("layernorm FAIL r=%d c=%d\n", r, j);
        return 0;
      }
    }
  }
  return 1;
}
int main(void) {
  int ok = 1;
  const float x4[4] = {2, -1.5f, 0.25f, 3.75f};
  const float g4[4] = {0.5f, 2, -1, 0.75f};
  const float b4[4] = {0.25f, -0.5f, 1.5f, 0};
  memcpy(g, g4, 16);
  memcpy(be, b4, 16);
  ok &= run(x4, 1, 4);
  for (int j = 0; j < 64; ++j) { /* row0 formula, row1 all-equal (eps) */
    xt[j] = (float)((j * 7) % 50) / 8.0f - 2.0f;
    xt[64 + j] = 2.5f;
    g[j] = 0.75f + 0.05f * (float)(j % 11);
    be[j] = (float)(j % 3) - 1.0f;
  }
  ok &= run(xt, 2, 64);
  for (int j = 0; j < 512; ++j) {
    xt[j] = (float)((j * 13) % 101 - 50) / 4.0f;
    g[j] = 1.0f;
    be[j] = (float)((j * 7) % 5 - 2) / 4.0f;
  }
  ok &= run(xt, 1, 512);
  printf("layernorm_test %s\n", ok ? "PASSED" : "FAILED");
  return ok ? 0 : 1;
}
