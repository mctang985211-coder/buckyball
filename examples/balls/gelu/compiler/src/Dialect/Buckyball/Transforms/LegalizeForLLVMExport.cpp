//===- LegalizeForLLVMExport.cpp - GeluBall LLVM lowering -----------------===//

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
struct GeluLowering : public ConvertOpToLLVMPattern<GeluOp> {
  using ConvertOpToLLVMPattern<GeluOp>::ConvertOpToLLVMPattern;

  LogicalResult
  matchAndRewrite(GeluOp op, OpAdaptor adaptor,
                  ConversionPatternRewriter &rewriter) const override {
    buckyball_target::requireBuckyballBall("GeluBall");
    Location loc = op.getLoc();
    // rs1 = BB_BANK0(in) | BB_BANK2(out) | BB_ITER(n); the rs1.BB_BANK1
    // field and rs2 are reserved and must lower as zero (see
    // examples/balls/gelu/emu/src/56_gelu.rs for the fail-hard table).
    Value rs1 = packRs1BanksIter(rewriter, loc, adaptor.getInBankId(),
                                 cstI64(rewriter, loc, 0),
                                 adaptor.getOutBankId(), adaptor.getIter());
    rewriter.replaceOpWithNewOp<CustomIntrOp>(
        op, rs1, cstI64(rewriter, loc, 0),
        rewriter.getI32IntegerAttr(
            buckyball_target::getBuckyballFunct7("GELU")));
    return success();
  }
};
} // namespace

namespace mlir::buddy::buckyball {
void populateGeluBallLegalizeForLLVMExportPatterns(LLVMTypeConverter &converter,
                                                   RewritePatternSet &patterns,
                                                   bool stable,
                                                   int64_t bankDepth,
                                                   bool rushB) {
  (void)stable;
  (void)bankDepth;
  (void)rushB;
  patterns.add<GeluLowering>(converter);
}

void configureGeluBallLegalizeForExportTarget(LLVMConversionTarget &target,
                                              bool stable) {
  (void)stable;
  target.addIllegalOp<GeluOp, BankGeluOp>();
}
} // namespace mlir::buddy::buckyball
