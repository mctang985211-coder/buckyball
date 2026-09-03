//===- LowerBuckyballToBankSSAPatterns.cpp - TanhBall bank-SSA lowering
//-===//
//
// Lowers the logical FP32 tanh tile to the bank-SSA chain
// alloc -> mvin -> bank_tanh -> mvout -> fence -> release.  Like the GELU and
// Sigmoid precedents this file keeps its bank helpers local instead of
// including "Utils/BankUtils.h": that header instantiates createBankSMatMul,
// which needs the SMatMul dialect ops that are only generated for unions
// mounting SMatMulBall.  TanhBall lives on Toy, whose union does not have
// them.
//
//===----------------------------------------------------------------------===//

#include "Conversion/LowerBuckyball/LowerBuckyball.h"

#include "mlir/Dialect/Arith/IR/Arith.h"
#include "mlir/Dialect/Linalg/IR/Linalg.h"
#include "mlir/Dialect/MemRef/IR/MemRef.h"
#include "mlir/Dialect/SCF/IR/SCF.h"
#include "mlir/IR/BuiltinTypes.h"
#include "mlir/IR/PatternMatch.h"

#include "Buckyball/BuckyballOps.h"
#include "Target/BuckyballTargetRegistry.h"

#include <algorithm>

using namespace mlir;
using namespace ::buddy::buckyball;

namespace mlir::buddy {
void populateTanhBallLowerBuckyballToBankSSAPatterns(
    RewritePatternSet &patterns);
} // namespace mlir::buddy

namespace {

// A 16B toy bank row holds 4 fp32 lanes (bankWidthBits == 128).
constexpr int64_t kValuesPerLine = 4;

Value createI64Const(OpBuilder &b, Location loc, int64_t val) {
  return b.create<arith::ConstantOp>(loc, b.getI64Type(),
                                     b.getI64IntegerAttr(val));
}

Value allocBank(OpBuilder &b, Location loc, int64_t row, int64_t col) {
  auto i64Type = b.getI64Type();
  return b.create<BankAllocOp>(loc, i64Type, b.getI64IntegerAttr(row),
                               b.getI64IntegerAttr(col));
}

void releaseBank(OpBuilder &b, Location loc, Value bank) {
  b.create<BankReleaseOp>(loc, bank);
}

Value mvinBank(OpBuilder &b, Location loc, Value memref, Value bank,
               int64_t depth) {
  Value depthVal = createI64Const(b, loc, depth);
  Value strideVal = createI64Const(b, loc, 1);
  return b.create<BankMvinOp>(loc, bank.getType(), memref, bank, depthVal,
                              strideVal);
}

Value mvoutBank(OpBuilder &b, Location loc, Value memref, Value bank,
                int64_t depth) {
  Value depthVal = createI64Const(b, loc, depth);
  Value strideVal = createI64Const(b, loc, 1);
  return b.create<BankMvoutOp>(loc, bank.getType(), memref, bank, depthVal,
                               strideVal);
}

class TanhMatrixToBankSSAPattern : public OpRewritePattern<TanhMatrixOp> {
public:
  using OpRewritePattern<TanhMatrixOp>::OpRewritePattern;

  LogicalResult matchAndRewrite(TanhMatrixOp op,
                                PatternRewriter &b) const override {
    auto inputType = dyn_cast<MemRefType>(op.getInput().getType());
    auto outputType = dyn_cast<MemRefType>(op.getOutput().getType());
    if (!inputType || !outputType || !inputType.hasStaticShape() ||
        inputType != outputType || !inputType.getElementType().isF32())
      return op.emitError("requires matching static memref<MxNxf32>");

    int64_t rows = inputType.getShape()[0];
    int64_t columns = inputType.getShape()[1];
    if (rows <= 0 || columns <= 0 || rows % 16 || columns % 16)
      return op.emitError("requires positive 16-aligned dimensions");

    const auto &target = buckyball_target::getBuckyballTarget();
    if (target.bankWidthBits != 128 || target.bankDepth <= 0 ||
        target.bankDepth % 16)
      return op.emitError(
          "TanhBall requires a 128-bit bank with 16-aligned depth");

    Location loc = op.getLoc();
    int64_t lines = target.bankDepth;
    int64_t values = lines * kValuesPerLine;
    int64_t total = rows * columns;
    // Tanh is 1rd+1wr with distinct banks: the input bank receives the
    // mvin'ed rows, the output bank the computed rows (never in place).
    Value inBank = allocBank(b, loc, 1, 1);
    Value outBank = allocBank(b, loc, 1, 1);
    Value zero = b.create<arith::ConstantIndexOp>(loc, 0);
    Value one = b.create<arith::ConstantIndexOp>(loc, 1);
    Value four = b.create<arith::ConstantIndexOp>(loc, kValuesPerLine);
    Value columnsValue = b.create<arith::ConstantIndexOp>(loc, columns);
    auto packType = MemRefType::get({lines, kValuesPerLine}, b.getF32Type());

    for (int64_t base = 0; base < total; base += values) {
      int64_t count = std::min(values, total - base);
      Value inputPack = b.create<memref::AllocOp>(loc, packType);
      Value outputPack = b.create<memref::AllocOp>(loc, packType);
      Value zeroValue = b.create<arith::ConstantOp>(loc, b.getF32Type(),
                                                    b.getF32FloatAttr(0.0f));
      b.create<linalg::FillOp>(loc, zeroValue, inputPack);

      Value countValue = b.create<arith::ConstantIndexOp>(loc, count);
      Value baseValue = b.create<arith::ConstantIndexOp>(loc, base);
      auto copyIn = b.create<scf::ForOp>(loc, zero, countValue, one);
      b.setInsertionPointToStart(copyIn.getBody());
      Value index = copyIn.getInductionVar();
      Value source = b.create<arith::AddIOp>(loc, baseValue, index);
      Value row = b.create<arith::DivUIOp>(loc, source, columnsValue);
      Value column = b.create<arith::RemUIOp>(loc, source, columnsValue);
      Value line = b.create<arith::DivUIOp>(loc, index, four);
      Value lane = b.create<arith::RemUIOp>(loc, index, four);
      Value value =
          b.create<memref::LoadOp>(loc, op.getInput(), ValueRange{row, column});
      b.create<memref::StoreOp>(loc, value, inputPack, ValueRange{line, lane});
      b.setInsertionPointAfter(copyIn);

      Value loaded = mvinBank(b, loc, inputPack, inBank, lines);
      // Tanh element count (fp32 lanes), not row count: the ball contract
      // in examples/balls/tanh/emu/src/58_tanh.rs.
      Value result =
          b.create<BankTanhOp>(loc, loaded.getType(), loaded, outBank,
                               createI64Const(b, loc, count));
      inBank = loaded;
      outBank = mvoutBank(b, loc, outputPack, result, lines);
      b.create<FenceOp>(loc);

      auto copyOut = b.create<scf::ForOp>(loc, zero, countValue, one);
      b.setInsertionPointToStart(copyOut.getBody());
      index = copyOut.getInductionVar();
      source = b.create<arith::AddIOp>(loc, baseValue, index);
      row = b.create<arith::DivUIOp>(loc, source, columnsValue);
      column = b.create<arith::RemUIOp>(loc, source, columnsValue);
      line = b.create<arith::DivUIOp>(loc, index, four);
      lane = b.create<arith::RemUIOp>(loc, index, four);
      value = b.create<memref::LoadOp>(loc, outputPack, ValueRange{line, lane});
      b.create<memref::StoreOp>(loc, value, op.getOutput(),
                                ValueRange{row, column});
      b.setInsertionPointAfter(copyOut);
      b.create<memref::DeallocOp>(loc, inputPack);
      b.create<memref::DeallocOp>(loc, outputPack);
    }

    releaseBank(b, loc, inBank);
    releaseBank(b, loc, outBank);
    b.eraseOp(op);
    return success();
  }
};

} // namespace

void mlir::buddy::populateTanhBallLowerBuckyballToBankSSAPatterns(
    RewritePatternSet &patterns) {
  patterns.add<TanhMatrixToBankSSAPattern>(patterns.getContext());
}
