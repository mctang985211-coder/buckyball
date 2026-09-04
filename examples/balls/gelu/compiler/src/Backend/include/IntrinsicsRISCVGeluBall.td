//===- IntrinsicsRISCVGeluBall.td - GeluBall intrinsics ------------------===//

let TargetPrefix = "riscv" in
def int_riscv_bb_gelu : Intrinsic<[], [llvm_i64_ty, llvm_i64_ty], []>;
