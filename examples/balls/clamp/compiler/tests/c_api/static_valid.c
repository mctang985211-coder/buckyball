#include <isa/clamp.h>
// Compile in both C and C++ modes using the experiment generated headers.
// Unknown dynamic values must compile, including arguments with side effects.
void valid_constants(void) {
  bb_clamp(0, 1, 4, INT32_MIN, INT32_MAX);
  bb_clamp(0, 1, BANK_LINES * 4, 7, 7);
  bb_clamp(0, 1, 16, -10, 10);
}
void valid_dynamic(uint64_t input, uint64_t output, uint64_t n, int32_t lo,
                   int32_t hi) {
  bb_clamp(input, output, n, lo, hi);
}
void valid_side_effects(uint64_t *input, uint64_t *output, uint64_t *n,
                        int32_t *lo, int32_t *hi) {
  bb_clamp((*input)++, (*output)++, (*n)++, (*lo)++, (*hi)++);
}
