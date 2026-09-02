//===- AssignPhysicalBankPatterns.cpp - GeluBall bank assignment ----------===//

#include "Conversion/LowerBuckyball/LowerBuckyball.h"

#include "mlir/IR/PatternMatch.h"

#include "Buckyball/BuckyballOps.h"

using namespace mlir;
using namespace ::buddy::buckyball;

namespace mlir::buddy {
void populateGeluBallAssignPhysicalBankPatterns(RewritePatternSet &patterns,
                                                PhysicalBankState &state);
} // namespace mlir::buddy

namespace {
class BankGeluPattern : public OpRewritePattern<BankGeluOp> {
public:
  using OpRewritePattern<BankGeluOp>::OpRewritePattern;

  LogicalResult matchAndRewrite(BankGeluOp op,
                                PatternRewriter &rewriter) const override {
    rewriter.create<GeluOp>(op.getLoc(), op.getInBank(), op.getOutBank(),
                            op.getIter());
    rewriter.replaceOp(op, op.getOutBank());
    return success();
  }
};
} // namespace

void mlir::buddy::populateGeluBallAssignPhysicalBankPatterns(
    RewritePatternSet &patterns, mlir::buddy::PhysicalBankState &state) {
  (void)state;
  patterns.add<BankGeluPattern>(patterns.getContext());
}
