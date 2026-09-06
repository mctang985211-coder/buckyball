//===- IntrinsicsRISCVLayerNormBall.td - LayerNormBall intrinsics --------===//

let TargetPrefix = "riscv" in
def int_riscv_bb_layernorm : Intrinsic<[], [llvm_i64_ty, llvm_i64_ty], []>;
