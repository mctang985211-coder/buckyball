#ifndef BB_CLAMP_H
#define BB_CLAMP_H
#include <bbhw/isa/bb_func7.h>
#include <bbhw/isa/isa.h>
#include <params.h>
#include <stdint.h>

// GCC/Clang fold __builtin_constant_p in both C and C++. The sizeof operand
// adds no argument evaluation: unknown values select the positive bound
// through short-circuiting before any parameter-dependent expression.
// Known illegal parameters produce a negative array bound at compilation.
#define BB_CLAMP_STATIC_CHECK(known, legal)                                    \
  ((void)sizeof(char[(!(known) || (legal)) ? 1 : -1]))
#define BB_CLAMP_I32_REPRESENTABLE(value)                                      \
  ((value) >= 0 ? (uint64_t)(value) <= (uint64_t)INT32_MAX                     \
                : (int64_t)(value) >= (int64_t)INT32_MIN)

// One allocated single-group input and a distinct output, N INT32 elements.
// Bounds preserve their full signed 32-bit bit patterns. Static checks use
// the active Chip.pb-generated geometry; dynamic values are checked by the
// BEMU/RTL command path. Each runtime argument is evaluated once in packing.
#define bb_clamp(input, output, n, lo, hi)                                     \
  do {                                                                         \
    BB_CLAMP_STATIC_CHECK(__builtin_constant_p(n),                             \
                          (n) > 0 && (uint64_t)(n) % 4 == 0 &&                 \
                              (uint64_t)(n) <= (uint64_t)BANK_LINES * 4);      \
    BB_CLAMP_STATIC_CHECK(__builtin_constant_p(input),                         \
                          (uint64_t)(input) < (uint64_t)BANK_NUM);             \
    BB_CLAMP_STATIC_CHECK(__builtin_constant_p(output),                        \
                          (uint64_t)(output) < (uint64_t)BANK_NUM);            \
    BB_CLAMP_STATIC_CHECK(__builtin_constant_p(input) &&                       \
                              __builtin_constant_p(output),                    \
                          (input) != (output));                                \
    BB_CLAMP_STATIC_CHECK(__builtin_constant_p(lo),                            \
                          BB_CLAMP_I32_REPRESENTABLE(lo));                     \
    BB_CLAMP_STATIC_CHECK(__builtin_constant_p(hi),                            \
                          BB_CLAMP_I32_REPRESENTABLE(hi));                     \
    BB_CLAMP_STATIC_CHECK(__builtin_constant_p(lo) &&                          \
                              __builtin_constant_p(hi),                        \
                          (int64_t)(lo) <= (int64_t)(hi));                     \
    BUCKYBALL_INSTRUCTION_R_R(                                                 \
        BB_BANK0((uint64_t)(input)) | BB_BANK2((uint64_t)(output)) |           \
            BB_ITER((uint64_t)(n)),                                            \
        (uint64_t)(uint32_t)(lo) | ((uint64_t)(uint32_t)(hi) << 32),           \
        BB_FUNC7(CLAMP));                                                      \
  } while (0)
#endif
