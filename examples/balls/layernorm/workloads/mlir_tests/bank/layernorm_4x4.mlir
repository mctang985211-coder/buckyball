// Bank-level Op: buckyball.bank_layernorm (R=4, C=4, single-bank regions).
// Lowering: assign-physical-banks -> bank_layernorm becomes layernorm.

func.func private @check_result(memref<4x4xf32>) -> ()

func.func @main() -> i8 {
  %zero_i8 = arith.constant 0 : i8
  %c0 = arith.constant 0 : index
  %c1 = arith.constant 1 : index
  %n = arith.constant 4 : index
  %c1_i32 = arith.constant 1 : i32
  %c4_i32 = arith.constant 4 : i32
  %c025 = arith.constant 0.25 : f32
  %c05 = arith.constant 0.50 : f32
  %depth = arith.constant 4 : i64
  %p_depth = arith.constant 2 : i64
  %stride = arith.constant 1 : i64
  %rows = arith.constant 4 : i64
  %cols = arith.constant 4 : i64

  %input = memref.alloc() alignment = 64 : memref<4x4xf32>
  %param = memref.alloc() alignment = 64 : memref<2x4xf32>
  %output = memref.alloc() alignment = 64 : memref<4x4xf32>

  // x[r][c] = (r*4 + c + 1), gamma[c] = 0.25*(c+1), beta[c] = 0.25*(c-1)
  scf.for %r = %c0 to %n step %c1 {
    scf.for %c = %c0 to %n step %c1 {
      %ri = arith.index_cast %r : index to i32
      %ci = arith.index_cast %c : index to i32
      %m = arith.muli %ri, %c4_i32 : i32
      %v = arith.addi %m, %ci : i32
      %v1 = arith.addi %v, %c1_i32 : i32
      %f = arith.sitofp %v1 : i32 to f32
      memref.store %f, %input[%r, %c] : memref<4x4xf32>
    }
  }
  scf.for %c = %c0 to %n step %c1 {
    %ci = arith.index_cast %c : index to i32
    %cv1 = arith.addi %ci, %c1_i32 : i32
    %cf = arith.sitofp %cv1 : i32 to f32
    %g = arith.mulf %cf, %c025 : f32
    memref.store %g, %param[%c0, %c] : memref<2x4xf32>
    %cm1 = arith.subi %ci, %c1_i32 : i32
    %cfm = arith.sitofp %cm1 : i32 to f32
    %bf = arith.mulf %cfm, %c025 : f32
    memref.store %bf, %param[%c1, %c] : memref<2x4xf32>
  }

  %bin = buckyball.bank_alloc
  %bparam = buckyball.bank_alloc
  %bout = buckyball.bank_alloc
  %loaded = buckyball.bank_mvin %input %bin %depth %stride
      : memref<4x4xf32> i64 i64 i64
  %pl = buckyball.bank_mvin %param %bparam %p_depth %stride
      : memref<2x4xf32> i64 i64 i64
  %lout = buckyball.bank_layernorm %loaded %pl %bout %rows %cols
      : i64 i64 i64 i64 i64
  %stored = buckyball.bank_mvout %output %lout %depth %stride
      : memref<4x4xf32> i64 i64 i64
  buckyball.fence
  buckyball.bank_release %loaded : i64
  buckyball.bank_release %pl : i64
  buckyball.bank_release %stored : i64

  func.call @check_result(%output) : (memref<4x4xf32>) -> ()
  memref.dealloc %input : memref<4x4xf32>
  memref.dealloc %param : memref<2x4xf32>
  memref.dealloc %output : memref<4x4xf32>
  return %zero_i8 : i8
}
