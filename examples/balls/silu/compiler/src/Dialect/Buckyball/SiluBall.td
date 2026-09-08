//===-- SiluBall.td - SiluBall operations ---------------*- tablegen -*-===//
//
// SiluBall operations for fp32 SiLU (elementwise activation).
//
//===----------------------------------------------------------------------===//

#ifndef SILUBALL_OPS
#define SILUBALL_OPS

include "Buckyball.td"

def SiluOp : Buckyball_Op<"silu"> {
  let summary = "fp32 SiLU (x * sigmoid(x)) of a single-group bank region";
  let description = [{
    Applies y = x * sigmoid(x) = x / (1 + e^{-x}) (torch.nn.functional.silu)
    to n fp32 elements of one input bank, writing the same row/lane layout to
    one distinct output bank. Single group (cols=1) regions, 16B bank lines
    with 4 fp32 lanes.
    ISA: bb_silu(in_bank, out_bank, n); funct7 from Core ballISA. n is the
    fp32 element count: positive, a multiple of 4, at most 4 * bank lines.
  }];
  let arguments = (ins I64:$inputBankId, I64:$outputBankId, I64:$n);
  let assemblyFormat = "$inputBankId `,` $outputBankId `,` $n attr-dict `:` "
                       "type($inputBankId)";
}

def BankSiluOp : Buckyball_Op<"bank_silu"> {
  let summary = "SiLU using virtual bank handles";
  let arguments = (ins I64:$inBank, I64:$outBank, I64:$n);
  let results = (outs I64:$outBankOut);
  let assemblyFormat =
      "$inBank $outBank $n attr-dict `:` "
      "type($inBank) type($outBank) type($n)";
}

// No LLVM-export op is declared here: an LLVM_IntrOpBase op would emit an
// unconditional llvm::Intrinsic::riscv_bb_<mnemonic> reference from
// `-gen-llvmir-conversions`, and the LLVM fork hardcodes the pebble per-core
// op set, which cannot be extended per ball.  SILU is emitted through
// the generic CustomIntrOp path instead
// (see Transforms/LegalizeForLLVMExport.cpp).

#endif // SILUBALL_OPS
