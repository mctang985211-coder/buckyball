// Expected rejection of unknown allocation side effect; no older MSET proof.
func.func @main(%dynamic : i64) {
  %input = arith.constant 0 : i64
  %output = arith.constant 1 : i64
  %n = arith.constant 4 : i64
  %lo = arith.constant -10 : i64
  %hi = arith.constant 10 : i64
  buckyball.mset %input : i64
  buckyball.mset %output : i64
  buckyball.intr.mset %input, %dynamic : i64, i64
  buckyball.clamp %input, %output, %n, %lo, %hi : i64
  return
}
