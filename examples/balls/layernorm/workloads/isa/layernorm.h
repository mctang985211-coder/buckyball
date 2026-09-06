#ifndef _BB_LAYERNORM_H_
#define _BB_LAYERNORM_H_

#include <bbhw/isa/bb_func7.h>
#include <bbhw/isa/isa.h>

// bb_layernorm(x_bank_id, param_bank_id, out_bank_id, rows, cols)
// rs1 = x_bank | param_bank | out_bank | rows(iter)
// rs2[31:0] = cols (normalized width, f32 per row); rs2[63:32] = 0
#define bb_layernorm(x_bank_id, param_bank_id, out_bank_id, rows, cols)        \
  BUCKYBALL_INSTRUCTION_R_R((BB_BANK0(x_bank_id) | BB_BANK1(param_bank_id) |   \
                             BB_BANK2(out_bank_id) | BB_ITER(rows)),           \
                            (FIELD((uint64_t)(cols), 0, 31)),                  \
                            BB_FUNC7(LAYERNORM))

#endif // _BB_LAYERNORM_H_
