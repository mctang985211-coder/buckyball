//===-- TanhBall.td - TanhBall operations -------------------*- tablegen -*-===//
//
// Exact-form hyperbolic tangent over fp32 bank buffers: y[i] = tanh(x[i])
// (reference: torch.tanh). The op contract mirrors
// examples/balls/tanh/emu/src/58_tanh.rs: one input bank, one distinct
// output bank, n = fp32 element count, rs1.BB_BANK1 and rs2 reserved-zero.
//
//===----------------------------------------------------------------------===//

#ifndef TANHBALL_OPS
#define TANHBALL_OPS

include "Buckyball.td"

def TanhMatrixOp : Buckyball_Op<"tanh_matrix"> {
  let summary = "Logical FP32 exact tanh matrix tile";
  let description = [{
    Elementwise y = tanh(x) over two matching static 2-D f32 memrefs.  The
    output memref is a distinct buffer; in-place lowering is not part of
    this operation's contract (mirrors the ball's distinct-bank rule).
  }];
  let arguments = (ins MemRefRankOf<[AnyType], [2]>:$input,
                       MemRefRankOf<[AnyType], [2]>:$output);
  let assemblyFormat = [{$input $output attr-dict `:`
    type($input) type($output)}];
}

def TanhOp : Buckyball_Op<"tanh"> {
  let summary = "FP32 exact tanh between two physical banks";
  let description = [{
    Reads `iter` fp32 elements from `inBankId` and writes the tanh of
    each to the distinct bank `outBankId`.  `iter` is the element count:
    positive, a multiple of the 4 fp32 lanes per 16B bank row, and within
    one bank.  The reserved rs1.BB_BANK1 field and rs2 lower as zeros.
  }];
  let arguments = (ins I64:$inBankId, I64:$outBankId, I64:$iter);
  let assemblyFormat = "$inBankId `,` $outBankId `,` $iter attr-dict `:` "
                       "type($inBankId)";
}

def BankTanhOp : Buckyball_Op<"bank_tanh"> {
  let summary = "FP32 exact tanh with virtual bank handles";
  let description = [{
    Bank-SSA form of TanhOp: consumes the input bank handle after mvin
    and the distinct output bank handle, and returns the updated output bank
    handle for the following mvout.
  }];
  let arguments = (ins I64:$inBank, I64:$outBank, I64:$iter);
  let results = (outs I64:$outBankOut);
  let assemblyFormat = "$inBank $outBank $iter attr-dict `:` "
                       "type($inBank) type($outBank) type($iter)";
}

#endif // TANHBALL_OPS
