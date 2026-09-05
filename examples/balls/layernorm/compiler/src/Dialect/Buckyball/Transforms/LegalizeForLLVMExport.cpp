//===- LegalizeForLLVMExport.cpp - LayerNormBall LLVM lowering -----------===//

#include "mlir/Conversion/LLVMCommon/ConversionTarget.h"
#include "mlir/Conversion/LLVMCommon/Pattern.h"
#include "mlir/IR/PatternMatch.h"

#include "Buckyball/BuckyballOps.h"
#include "Dialect/Buckyball/Transforms/LegalizeForLLVMExportBase.h"
#include "Target/BuckyballTargetRegistry.h"

using namespace mlir;
using namespace buddy::buckyball;
using namespace buddy::buckyball::legalize;

namespace {
struct LayerNormLowering : public ConvertOpToLLVMPattern<LayerNormOp> {
  using ConvertOpToLLVMPattern<LayerNormOp>::ConvertOpToLLVMPattern;

  LogicalResult
  matchAndRewrite(LayerNormOp op, OpAdaptor adaptor,
                  ConversionPatternRewriter &rewriter) const override {
    buckyball_target::requireBuckyballBall("LayerNormBall");
    Location loc = op.getLoc();
    // rs1 = BB_BANK0(x) | BB_BANK1(param) | BB_BANK2(out) | BB_ITER(N);
    // rs2 = C in xs2[31:0], xs2[63:32] reserved and must lower as zero
    // (see examples/balls/layernorm/emu/src/69_layernorm.rs for the
    // fail-hard table).
    Value rs1 = packRs1BanksIter(rewriter, loc, adaptor.getInBankId(),
                                 adaptor.getParamBankId(),
                                 adaptor.getOutBankId(), adaptor.getIter());
    rewriter.replaceOpWithNewOp<CustomIntrOp>(
        op, rs1, cstI64(rewriter, loc, op.getC()),
        rewriter.getI32IntegerAttr(
            buckyball_target::getBuckyballFunct7("LAYERNORM")));
    return success();
  }
};
} // namespace

namespace mlir::buddy::buckyball {
void populateLayerNormBallLegalizeForLLVMExportPatterns(
    LLVMTypeConverter &converter, RewritePatternSet &patterns, bool stable,
    int64_t bankDepth, bool rushB) {
  (void)stable;
  (void)bankDepth;
  (void)rushB;
  patterns.add<LayerNormLowering>(converter);
}

void configureLayerNormBallLegalizeForExportTarget(LLVMConversionTarget &target,
                                                   bool stable) {
  (void)stable;
  target.addIllegalOp<LayerNormOp>();
}
} // namespace mlir::buddy::buckyball
