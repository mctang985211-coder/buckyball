func.func private @check_result(memref<4x4xi32>) -> ()
func.func @main() -> i8 {
  %zero_i8 = arith.constant 0 : i8
  %c0 = arith.constant 0 : index
  %c1 = arith.constant 1 : index
  %c16 = arith.constant 16 : index
  %c4 = arith.constant 4 : index
  %c7_i32 = arith.constant 7 : i32
  %c42_i32 = arith.constant 42 : i32
  %depth = arith.constant 4 : i64
  %stride = arith.constant 1 : i64
  %n = arith.constant 16 : i64
  %lo = arith.constant -10 : i64
  %hi = arith.constant 10 : i64
  %input = memref.alloc() alignment = 64 : memref<4x4xi32>
  %output = memref.alloc() alignment = 64 : memref<4x4xi32>
  scf.for %i = %c0 to %c16 step %c1 {
    %ii = arith.index_cast %i : index to i32
    %mul = arith.muli %ii, %c7_i32 : i32
    %value = arith.subi %mul, %c42_i32 : i32
    %row = arith.divui %i, %c4 : index
    %col = arith.remui %i, %c4 : index
    memref.store %value, %input[%row, %col] : memref<4x4xi32>
  }
  %bin = buckyball.bank_alloc
  %bout = buckyball.bank_alloc
  %loaded = buckyball.bank_mvin %input %bin %depth %stride : memref<4x4xi32> i64 i64 i64
  %clamped = buckyball.bank_clamp %loaded %bout %n %lo %hi : i64 i64 i64 i64 i64
  %stored = buckyball.bank_mvout %output %clamped %depth %stride : memref<4x4xi32> i64 i64 i64
  buckyball.fence
  buckyball.bank_release %loaded : i64
  buckyball.bank_release %stored : i64
  func.call @check_result(%output) : (memref<4x4xi32>) -> ()
  memref.dealloc %input : memref<4x4xi32>
  memref.dealloc %output : memref<4x4xi32>
  return %zero_i8 : i8
}
