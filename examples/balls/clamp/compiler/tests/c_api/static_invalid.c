#include <isa/clamp.h>
// Compile separately for each CASE=1..12, in C and C++ modes. Every case
// must fail at a BB_CLAMP_STATIC_CHECK negative array bound, before assembly.
#ifndef CASE
#error "Select CASE=1..12"
#endif
void invalid(void) {
#if CASE == 1
  bb_clamp(0, 1, 0, -10, 10);
#elif CASE == 2
  bb_clamp(0, 1, 5, -10, 10);
#elif CASE == 3
  bb_clamp(0, 1, BANK_LINES * 4 + 4, -10, 10);
#elif CASE == 4
  bb_clamp(BANK_NUM, 1, 4, -10, 10);
#elif CASE == 5
  bb_clamp(0, BANK_NUM, 4, -10, 10);
#elif CASE == 6
  bb_clamp(0, 0, 4, -10, 10);
#elif CASE == 7
  bb_clamp(0, 1, 4, (int64_t)INT32_MIN - 1, 10);
#elif CASE == 8
  bb_clamp(0, 1, 4, -10, (uint64_t)INT32_MAX + 1);
#elif CASE == 9
  bb_clamp(0, 1, 4, 11, -11);
#elif CASE == 10
  bb_clamp(-1, 1, 4, -10, 10);
#elif CASE == 11
  bb_clamp(0, 1, -4, -10, 10);
#elif CASE == 12
  bb_clamp(0, 1, 4, UINT64_MAX, UINT64_MAX);
#else
#error "Unknown CASE"
#endif
}
