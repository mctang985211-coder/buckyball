//===- AssignPhysicalBankPatterns.cpp - LayerNorm bank assignment patterns ===//

#include "Conversion/LowerBuckyball/LowerBuckyball.h"

#include "mlir/IR/PatternMatch.h"

#include "Buckyball/BuckyballOps.h"

using namespace mlir;
using namespace ::buddy::buckyball;

namespace mlir::buddy {
void populateLayerNormBallAssignPhysicalBankPatterns(
    RewritePatternSet &patterns, PhysicalBankState &state);
} // namespace mlir::buddy

namespace {

class BankLayerNormPattern : public OpRewritePattern<BankLayerNormOp> {
public:
  using OpRewritePattern<BankLayerNormOp>::OpRewritePattern;

  LogicalResult matchAndRewrite(BankLayerNormOp op,
                                PatternRewriter &rewriter) const override {
    rewriter.create<LayerNormOp>(op.getLoc(), op.getInBank(), op.getParamBank(),
                                 op.getOutBank(), op.getRows(), op.getCols());
    rewriter.replaceOp(op, op.getOutBank());
    return success();
  }
};

} // namespace

void mlir::buddy::populateLayerNormBallAssignPhysicalBankPatterns(
    RewritePatternSet &patterns, mlir::buddy::PhysicalBankState &state) {
  (void)state;
  patterns.add<BankLayerNormPattern>(patterns.getContext());
}
