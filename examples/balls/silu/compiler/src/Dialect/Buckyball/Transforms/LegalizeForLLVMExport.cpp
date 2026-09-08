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
static LogicalResult validateSilu(Operation *op, Value inBank, Value outBank,
                                  Value n, int64_t bankDepth) {
  auto nOp = n.getDefiningOp<arith::ConstantOp>();
  auto nAttr = nOp ? dyn_cast<IntegerAttr>(nOp.getValue()) : IntegerAttr();
  if (!nAttr || nAttr.getInt() <= 0 || nAttr.getInt() % 4 != 0)
    return op->emitError("Silu N must be a positive constant multiple of 4");
  if (nAttr.getInt() / 4 > bankDepth)
    return op->emitError("Silu N exceeds bank capacity (4 * bank depth)");
  auto inOp = inBank.getDefiningOp<arith::ConstantOp>();
  auto inAttr = inOp ? dyn_cast<IntegerAttr>(inOp.getValue()) : IntegerAttr();
  auto outOp = outBank.getDefiningOp<arith::ConstantOp>();
  auto outAttr =
      outOp ? dyn_cast<IntegerAttr>(outOp.getValue()) : IntegerAttr();
  if (inAttr && outAttr && inAttr.getInt() == outAttr.getInt())
    return op->emitError("Silu in_bank and out_bank must be distinct");
  return success();
}

// SiluBall has no LLVM-export op: the LLVM fork hardcodes the pebble
// per-core op set, so no per-ball op name can be declared for SILU.  Both
// ops lower through the generic CustomIntrOp path - rs2 is zero, funct7 is
// resolved from the ball ISA registry at compile time - exactly like
// MatAddBall/LayerNormBall.  The bank-level op is consumed by the
// assign-physical-banks pass before this stage; keeping it illegal here
// fail-hards any bank op that survived assignment.
struct SiluLowering : public ConvertOpToLLVMPattern<SiluOp> {
  SiluLowering(LLVMTypeConverter &converter, int64_t bankDepth)
      : ConvertOpToLLVMPattern<SiluOp>(converter), bankDepth(bankDepth) {}

  LogicalResult
  matchAndRewrite(SiluOp op, OpAdaptor adaptor,
                  ConversionPatternRewriter &rewriter) const override {
    buckyball_target::requireBuckyballBall("SiluBall");
    Location loc = op.getLoc();
    if (failed(validateSilu(op, op.getInputBankId(), op.getOutputBankId(),
                            op.getN(), bankDepth)))
      return failure();
    Value rs1 = packRs1BanksIter(rewriter, loc, adaptor.getInputBankId(),
                                 cstI64(rewriter, loc, 0),
                                 adaptor.getOutputBankId(), adaptor.getN());
    rewriter.replaceOpWithNewOp<CustomIntrOp>(
        op, rs1, cstI64(rewriter, loc, 0),
        rewriter.getI32IntegerAttr(
            buckyball_target::getBuckyballFunct7("SILU")));
    return success();
  }

private:
  int64_t bankDepth;
};
} // namespace

namespace mlir::buddy::buckyball {
void populateSiluBallLegalizeForLLVMExportPatterns(LLVMTypeConverter &converter,
                                                   RewritePatternSet &patterns,
                                                   bool, int64_t bankDepth,
                                                   bool) {
  patterns.add<SiluLowering>(converter, bankDepth);
}

void configureSiluBallLegalizeForExportTarget(LLVMConversionTarget &target,
                                              bool) {
  target.addIllegalOp<SiluOp, BankSiluOp>();
}
} // namespace mlir::buddy::buckyball
