//===- IntrinsicsRISCVTanhBall.td - TanhBall intrinsics --------------------===//

let TargetPrefix = "riscv" in
def int_riscv_bb_tanh : Intrinsic<[], [llvm_i64_ty, llvm_i64_ty], []>;
