//===- IntrinsicsRISCVSigmoidBall.td - SigmoidBall intrinsics -------------===//

let TargetPrefix = "riscv" in
def int_riscv_bb_sigmoid : Intrinsic<[], [llvm_i64_ty, llvm_i64_ty], []>;
