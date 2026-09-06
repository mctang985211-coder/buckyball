#include "mlir/Conversion/LLVMCommon/ConversionTarget.h"
#include "mlir/Conversion/LLVMCommon/Pattern.h"
#include "mlir/Dialect/Arith/IR/Arith.h"
#include "mlir/IR/PatternMatch.h"

#include "Buckyball/BuckyballOps.h"
#include "Dialect/Buckyball/Transforms/LegalizeForLLVMExportBase.h"
#include "Target/BuckyballTargetRegistry.h"

using namespace mlir;
using namespace buddy::buckyball;
using namespace buddy::buckyball::legalize;

namespace {
static LogicalResult validateLayerNorm(Operation *op, Value rows, Value cols,
                                       int64_t bankDepth) {
  auto rowsOp = rows.getDefiningOp<arith::ConstantOp>();
  auto rowsAttr =
      rowsOp ? dyn_cast<IntegerAttr>(rowsOp.getValue()) : IntegerAttr();
  if (!rowsAttr || rowsAttr.getInt() <= 0 || rowsAttr.getInt() > bankDepth)
    return op->emitError(
        "LayerNorm rows must be a positive constant within the bank depth");
  auto colsOp = cols.getDefiningOp<arith::ConstantOp>();
  auto colsAttr =
      colsOp ? dyn_cast<IntegerAttr>(colsOp.getValue()) : IntegerAttr();
  if (!colsAttr || (colsAttr.getInt() != 4 && colsAttr.getInt() != 64 &&
                    colsAttr.getInt() != 256 && colsAttr.getInt() != 512))
    return op->emitError("LayerNorm cols must be constant 4, 64, 256 or 512");
  return success();
}

struct LayerNormLowering : public ConvertOpToLLVMPattern<LayerNormOp> {
  LayerNormLowering(LLVMTypeConverter &converter, bool stable,
                    int64_t bankDepth)
      : ConvertOpToLLVMPattern<LayerNormOp>(converter), stable(stable),
        bankDepth(bankDepth) {}

  LogicalResult
  matchAndRewrite(LayerNormOp op, OpAdaptor adaptor,
                  ConversionPatternRewriter &rewriter) const override {
    buckyball_target::requireBuckyballBall("LayerNormBall");
    Location loc = op.getLoc();
    if (failed(validateLayerNorm(op, op.getRows(), op.getCols(), bankDepth)))
      return failure();
    Value rs1 = packRs1BanksIter(rewriter, loc, adaptor.getInputBankId(),
                                 adaptor.getParamBankId(),
                                 adaptor.getOutputBankId(), adaptor.getRows());
    if (stable) {
      rewriter.replaceOpWithNewOp<LayerNormIntrOp>(op, rs1, adaptor.getCols());
      return success();
    }
    rewriter.replaceOpWithNewOp<CustomIntrOp>(
        op, rs1, adaptor.getCols(),
        rewriter.getI32IntegerAttr(
            buckyball_target::getBuckyballFunct7("LAYERNORM")));
    return success();
  }

private:
  bool stable = false;
  int64_t bankDepth;
};

struct BankLayerNormLowering : public ConvertOpToLLVMPattern<BankLayerNormOp> {
  BankLayerNormLowering(LLVMTypeConverter &converter, bool stable,
                        int64_t bankDepth)
      : ConvertOpToLLVMPattern<BankLayerNormOp>(converter), stable(stable),
        bankDepth(bankDepth) {}

  LogicalResult
  matchAndRewrite(BankLayerNormOp op, OpAdaptor adaptor,
                  ConversionPatternRewriter &rewriter) const override {
    buckyball_target::requireBuckyballBall("LayerNormBall");
    Location loc = op.getLoc();
    if (failed(validateLayerNorm(op, op.getRows(), op.getCols(), bankDepth)))
      return failure();
    Value rs1 = packRs1BanksIter(rewriter, loc, adaptor.getInBank(),
                                 adaptor.getParamBank(), adaptor.getOutBank(),
                                 adaptor.getRows());
    if (stable) {
      rewriter.replaceOpWithNewOp<LayerNormIntrOp>(op, rs1, adaptor.getCols());
      return success();
    }
    rewriter.replaceOpWithNewOp<CustomIntrOp>(
        op, rs1, adaptor.getCols(),
        rewriter.getI32IntegerAttr(
            buckyball_target::getBuckyballFunct7("LAYERNORM")));
    return success();
  }

private:
  bool stable = false;
  int64_t bankDepth;
};
} // namespace

namespace mlir::buddy::buckyball {
void populateLayerNormBallLegalizeForLLVMExportPatterns(
    LLVMTypeConverter &converter, RewritePatternSet &patterns, bool stable,
    int64_t bankDepth, bool) {
  patterns.add<LayerNormLowering>(converter, stable, bankDepth);
  patterns.add<BankLayerNormLowering>(converter, stable, bankDepth);
}

void configureLayerNormBallLegalizeForExportTarget(LLVMConversionTarget &target,
                                                   bool stable) {
  if (stable)
    target.addLegalOp<LayerNormIntrOp>();
  else
    target.addIllegalOp<LayerNormIntrOp>();
  target.addIllegalOp<LayerNormOp, BankLayerNormOp>();
}
} // namespace mlir::buddy::buckyball
