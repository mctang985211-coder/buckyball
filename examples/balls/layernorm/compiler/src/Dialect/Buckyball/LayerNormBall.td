//===-- LayerNormBall.td - LayerNormBall operations ------*- tablegen -*-===//
//
// Row-wise fp32 layer normalization over SRAM bank buffers: y[j] =
// (x[j] - mu) * rstd * gamma[j] + beta[j] per row of C columns, with
// mu/var computed per row and eps = 1e-12 fixed in the op (reference:
// torch.nn.LayerNorm(C, eps=1e-12)). The op contract mirrors
// examples/balls/layernorm/emu/src/69_layernorm.rs: x_bank (rs1.BANK0)
// and param_bank (rs1.BANK1, gamma in [0, C), beta in [C, 2C)) are read,
// out_bank (rs1.BANK2) is written, N = R*C fp32 elements in rs1.BB_ITER,
// C in rs2[31:0]; rs2[63:32] reserved-zero.
//
//===----------------------------------------------------------------------===//

#ifndef LAYERNORMBALL_OPS
#define LAYERNORMBALL_OPS

include "Buckyball.td"

def LayerNormOp : Buckyball_Op<"layernorm"> {
  let summary = "FP32 row-wise layer normalization over three physical banks";
  let description = [{
    Reads `iter` fp32 elements arranged as rows of `c` columns from
    `inBankId`, gamma/beta from `paramBankId`, and writes the layer-
    normalized result to the distinct bank `outBankId`.  `iter` is the
    element count (a positive multiple of `c`); `c` is the row width
    (>= 4, a multiple of the 4 fp32 lanes per 16B bank row).  The reserved
    rs2[63:32] field lowers as zero.
  }];
  let arguments = (ins I64:$inBankId, I64:$paramBankId, I64:$outBankId,
                       I64:$iter, I64:$c);
  let assemblyFormat = "$inBankId `,` $paramBankId `,` $outBankId `,` $iter"
                       " `,` $c attr-dict `:` type($inBankId)";
}

#endif // LAYERNORMBALL_OPS
