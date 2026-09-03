//===- AssignPhysicalBankPatterns.cpp - TanhBall bank assignment ----------===//

#include "Conversion/LowerBuckyball/LowerBuckyball.h"

#include "mlir/IR/PatternMatch.h"

#include "Buckyball/BuckyballOps.h"

using namespace mlir;
using namespace ::buddy::buckyball;

namespace mlir::buddy {
void populateTanhBallAssignPhysicalBankPatterns(RewritePatternSet &patterns,
                                                PhysicalBankState &state);
} // namespace mlir::buddy

namespace {
class BankTanhPattern : public OpRewritePattern<BankTanhOp> {
public:
  using OpRewritePattern<BankTanhOp>::OpRewritePattern;

  LogicalResult matchAndRewrite(BankTanhOp op,
                                PatternRewriter &rewriter) const override {
    rewriter.create<TanhOp>(op.getLoc(), op.getInBank(), op.getOutBank(),
                            op.getIter());
    rewriter.replaceOp(op, op.getOutBank());
    return success();
  }
};
} // namespace

void mlir::buddy::populateTanhBallAssignPhysicalBankPatterns(
    RewritePatternSet &patterns, mlir::buddy::PhysicalBankState &state) {
  (void)state;
  patterns.add<BankTanhPattern>(patterns.getContext());
}
