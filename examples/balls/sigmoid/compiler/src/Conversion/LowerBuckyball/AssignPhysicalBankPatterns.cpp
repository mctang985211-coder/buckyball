//===- AssignPhysicalBankPatterns.cpp - SigmoidBall bank assignment -------===//

#include "Conversion/LowerBuckyball/LowerBuckyball.h"

#include "mlir/IR/PatternMatch.h"

#include "Buckyball/BuckyballOps.h"

using namespace mlir;
using namespace ::buddy::buckyball;

namespace mlir::buddy {
void populateSigmoidBallAssignPhysicalBankPatterns(RewritePatternSet &patterns,
                                                   PhysicalBankState &state);
} // namespace mlir::buddy

namespace {
class BankSigmoidPattern : public OpRewritePattern<BankSigmoidOp> {
public:
  using OpRewritePattern<BankSigmoidOp>::OpRewritePattern;

  LogicalResult matchAndRewrite(BankSigmoidOp op,
                                PatternRewriter &rewriter) const override {
    rewriter.create<SigmoidOp>(op.getLoc(), op.getInBank(), op.getOutBank(),
                               op.getIter());
    rewriter.replaceOp(op, op.getOutBank());
    return success();
  }
};
} // namespace

void mlir::buddy::populateSigmoidBallAssignPhysicalBankPatterns(
    RewritePatternSet &patterns, mlir::buddy::PhysicalBankState &state) {
  (void)state;
  patterns.add<BankSigmoidPattern>(patterns.getContext());
}
