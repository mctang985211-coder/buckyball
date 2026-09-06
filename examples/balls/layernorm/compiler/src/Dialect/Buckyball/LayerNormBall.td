//===-- LayerNormBall.td - LayerNormBall operations -----*- tablegen -*-===//
//
// LayerNormBall operations for fp32 layer normalization.
//
//===----------------------------------------------------------------------===//

#ifndef LAYERNORMBALL_OPS
#define LAYERNORMBALL_OPS

include "Buckyball.td"

def LayerNormOp : Buckyball_Op<"layernorm"> {
  let summary = "fp32 layer normalization of scratchpad rows";
  let description = [{
    Normalizes `rows` rows of `cols` f32 each:
      mean = (1/cols) * sum(x)
      var  = (1/cols) * sum((x - mean)^2)      (biased, torch semantics)
      y    = (x - mean) * rsqrt(var + 1e-12) * gamma + beta
    ISA: bb_layernorm(x_bank, param_bank, out_bank, rows, cols); funct7
    from Core ballISA. Gamma/beta form one dense C-wide param region
    ([0, C) = gamma, [C, 2C) = beta); 16B bank lines hold 4 f32 lanes.
  }];
  let arguments = (ins I64:$inputBankId, I64:$paramBankId,
                       I64:$outputBankId, I64:$rows, I64:$cols);
  let assemblyFormat = "$inputBankId `,` $paramBankId `,` $outputBankId `,` "
                       "$rows `,` $cols attr-dict `:` type($inputBankId)";
}

def BankLayerNormOp : Buckyball_Op<"bank_layernorm"> {
  let summary = "Layer normalization using virtual bank handles";
  let arguments = (ins I64:$inBank, I64:$paramBank, I64:$outBank,
                       I64:$rows, I64:$cols);
  let results = (outs I64:$outBankOut);
  let assemblyFormat =
      "$inBank $paramBank $outBank $rows $cols attr-dict `:` "
      "type($inBank) type($paramBank) type($outBank) type($rows) type($cols)";
}

def LayerNormIntrOp : Buckyball_IntrOpBase<"layernorm">,
  Arguments<(ins LLVM_Type, LLVM_Type)>;

#endif // LAYERNORMBALL_OPS
