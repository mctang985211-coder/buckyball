//===- LegalizeForLLVMExport.cpp - TanhBall LLVM lowering -----------------===//

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
struct TanhLowering : public ConvertOpToLLVMPattern<TanhOp> {
  using ConvertOpToLLVMPattern<TanhOp>::ConvertOpToLLVMPattern;

  LogicalResult
  matchAndRewrite(TanhOp op, OpAdaptor adaptor,
                  ConversionPatternRewriter &rewriter) const override {
    buckyball_target::requireBuckyballBall("TanhBall");
    Location loc = op.getLoc();
    // rs1 = BB_BANK0(in) | BB_BANK2(out) | BB_ITER(n); the rs1.BB_BANK1
    // field and rs2 are reserved and must lower as zero (see
    // examples/balls/tanh/emu/src/58_tanh.rs for the fail-hard table).
    Value rs1 = packRs1BanksIter(rewriter, loc, adaptor.getInBankId(),
                                 cstI64(rewriter, loc, 0),
                                 adaptor.getOutBankId(), adaptor.getIter());
    rewriter.replaceOpWithNewOp<CustomIntrOp>(
        op, rs1, cstI64(rewriter, loc, 0),
        rewriter.getI32IntegerAttr(
            buckyball_target::getBuckyballFunct7("TANH")));
    return success();
  }
};
} // namespace

namespace mlir::buddy::buckyball {
void populateTanhBallLegalizeForLLVMExportPatterns(LLVMTypeConverter &converter,
                                                   RewritePatternSet &patterns,
                                                   bool stable,
                                                   int64_t bankDepth,
                                                   bool rushB) {
  (void)stable;
  (void)bankDepth;
  (void)rushB;
  patterns.add<TanhLowering>(converter);
}

void configureTanhBallLegalizeForExportTarget(LLVMConversionTarget &target,
                                              bool stable) {
  (void)stable;
  target.addIllegalOp<TanhOp, BankTanhOp>();
}
} // namespace mlir::buddy::buckyball
