#ifndef CLAMPBALL_OPS
#define CLAMPBALL_OPS
include "Buckyball.td"
def ClampOp : Buckyball_Op<"clamp"> {
  let summary = "Exact signed INT32 clamp into a distinct single-group bank";
  let arguments = (ins I64:$inputBankId, I64:$outputBankId, I64:$n,
                       I64:$lo, I64:$hi);
  let assemblyFormat = "$inputBankId `,` $outputBankId `,` $n `,` $lo `,` $hi attr-dict `:` type($inputBankId)";
}
def BankClampOp : Buckyball_Op<"bank_clamp"> {
  let summary = "INT32 clamp of allocated bank-SSA handles";
  let arguments = (ins I64:$inBank, I64:$outBank, I64:$n, I64:$lo, I64:$hi);
  let results = (outs I64:$outBankOut);
  let assemblyFormat = "$inBank $outBank $n $lo $hi attr-dict `:` type($inBank) type($outBank) type($n) type($lo) type($hi)";
}
#endif
