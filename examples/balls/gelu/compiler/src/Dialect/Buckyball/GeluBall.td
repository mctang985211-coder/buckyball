//===-- GeluBall.td - GeluBall operations ------------------*- tablegen -*-===//
//
// Exact-erf GELU over fp32 bank buffers: y[i] = x[i] * Phi(x[i]) with
// Phi(x) = 0.5 * (1 + erf(x / sqrt(2))) (torch gelu(approximate='none')).
// The op contract mirrors examples/balls/gelu/emu/src/56_gelu.rs: one input
// bank, one distinct output bank, n = fp32 element count, rs1.BB_BANK1 and
// rs2 reserved-zero.
//
//===----------------------------------------------------------------------===//

#ifndef GELUBALL_OPS
#define GELUBALL_OPS

include "Buckyball.td"

def GeluMatrixOp : Buckyball_Op<"gelu_matrix"> {
  let summary = "Logical FP32 exact-erf GELU matrix tile";
  let description = [{
    Elementwise y = gelu(x) over two matching static 2-D f32 memrefs.  The
    output memref is a distinct buffer; in-place lowering is not part of
    this operation's contract (mirrors the ball's distinct-bank rule).
  }];
  let arguments = (ins MemRefRankOf<[AnyType], [2]>:$input,
                       MemRefRankOf<[AnyType], [2]>:$output);
  let assemblyFormat = [{$input $output attr-dict `:`
    type($input) type($output)}];
}

def GeluOp : Buckyball_Op<"gelu"> {
  let summary = "FP32 exact-erf GELU between two physical banks";
  let description = [{
    Reads `iter` fp32 elements from `inBankId` and writes the GELU of each
    to the distinct bank `outBankId`.  `iter` is the element count:
    positive, a multiple of the 4 fp32 lanes per 16B bank row, and within
    one bank.  The reserved rs1.BB_BANK1 field and rs2 lower as zeros.
  }];
  let arguments = (ins I64:$inBankId, I64:$outBankId, I64:$iter);
  let assemblyFormat = "$inBankId `,` $outBankId `,` $iter attr-dict `:` "
                       "type($inBankId)";
}

def BankGeluOp : Buckyball_Op<"bank_gelu"> {
  let summary = "FP32 exact-erf GELU with virtual bank handles";
  let description = [{
    Bank-SSA form of GeluOp: consumes the input bank handle after mvin and
    the distinct output bank handle, and returns the updated output bank
    handle for the following mvout.
  }];
  let arguments = (ins I64:$inBank, I64:$outBank, I64:$iter);
  let results = (outs I64:$outBankOut);
  let assemblyFormat = "$inBank $outBank $iter attr-dict `:` "
                       "type($inBank) type($outBank) type($iter)";
}

#endif // GELUBALL_OPS
