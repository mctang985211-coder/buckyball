// Expected compiler rejection; run lower-buckyball for this chip target.
func.func @main() {
  %input = arith.constant 0 : i64
  %output = arith.constant 1 : i64
  %n = arith.constant 4 : i64
  %lo = arith.constant -2147483649 : i64
  %hi = arith.constant 10 : i64
  buckyball.mset %input {row = 1 : i64, col = 1 : i64} : i64
  buckyball.mset %output : i64
  buckyball.clamp %input, %output, %n, %lo, %hi : i64
  return
}
