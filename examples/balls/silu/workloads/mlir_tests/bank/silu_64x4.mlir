// Bank-level Op: buckyball.bank_silu (N = 256 f32 = 64 lines x 4 lanes,
// the full single-group bank; n=256 = 4 * bank entries on pebble).
// Lowering: assign-physical-banks -> bank_silu becomes silu.

func.func private @check_result(memref<64x4xf32>) -> ()

func.func @main() -> i8 {
  %zero_i8 = arith.constant 0 : i8
  %c0 = arith.constant 0 : index
  %c1 = arith.constant 1 : index
  %c256 = arith.constant 256 : index
  %c4_i32 = arith.constant 4 : i32
  %c37_i32 = arith.constant 37 : i32
  %c2001_i32 = arith.constant 2001 : i32
  %c1000_i32 = arith.constant 1000 : i32
  %c025 = arith.constant 0.25 : f32
  %depth = arith.constant 64 : i64
  %stride = arith.constant 1 : i64
  %n = arith.constant 256 : i64

  %input = memref.alloc() alignment = 64 : memref<64x4xf32>
  %output = memref.alloc() alignment = 64 : memref<64x4xf32>

  // x[i] = ((i * 37 mod 2001) - 1000) * 0.25, fp32, covers [-250, 250]
  scf.for %i = %c0 to %c256 step %c1 {
    %ii = arith.index_cast %i : index to i32
    %m = arith.muli %ii, %c37_i32 : i32
    %mm = arith.remsi %m, %c2001_i32 : i32
    %s = arith.subi %mm, %c1000_i32 : i32
    %f = arith.sitofp %s : i32 to f32
    %v = arith.mulf %f, %c025 : f32
    %row = arith.divsi %ii, %c4_i32 : i32
    %col = arith.remsi %ii, %c4_i32 : i32
    %ri = arith.index_cast %row : i32 to index
    %ci = arith.index_cast %col : i32 to index
    memref.store %v, %input[%ri, %ci] : memref<64x4xf32>
  }

  %bin = buckyball.bank_alloc
  %bout = buckyball.bank_alloc
  %loaded = buckyball.bank_mvin %input %bin %depth %stride
      : memref<64x4xf32> i64 i64 i64
  %lout = buckyball.bank_silu %loaded %bout %n : i64 i64 i64
  %stored = buckyball.bank_mvout %output %lout %depth %stride
      : memref<64x4xf32> i64 i64 i64
  buckyball.fence
  buckyball.bank_release %loaded : i64
  buckyball.bank_release %stored : i64

  func.call @check_result(%output) : (memref<64x4xf32>) -> ()
  memref.dealloc %input : memref<64x4xf32>
  memref.dealloc %output : memref<64x4xf32>
  return %zero_i8 : i8
}
