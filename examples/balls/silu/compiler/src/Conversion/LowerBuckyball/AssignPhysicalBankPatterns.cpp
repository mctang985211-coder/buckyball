//===- AssignPhysicalBankPatterns.cpp - SiluBall bank assignment patterns ===//

#include "Conversion/LowerBuckyball/LowerBuckyball.h"

#include "mlir/IR/PatternMatch.h"

#include "Buckyball/BuckyballOps.h"

using namespace mlir;
using namespace ::buddy::buckyball;

namespace mlir::buddy {
void populateSiluBallAssignPhysicalBankPatterns(RewritePatternSet &patterns,
                                                PhysicalBankState &state);
} // namespace mlir::buddy

namespace {

class BankSiluPattern : public OpRewritePattern<BankSiluOp> {
public:
  using OpRewritePattern<BankSiluOp>::OpRewritePattern;

  LogicalResult matchAndRewrite(BankSiluOp op,
                                PatternRewriter &rewriter) const override {
    rewriter.create<SiluOp>(op.getLoc(), op.getInBank(), op.getOutBank(),
                            op.getN());
    rewriter.replaceOp(op, op.getOutBank());
    return success();
  }
};

} // namespace

void mlir::buddy::populateSiluBallAssignPhysicalBankPatterns(
    RewritePatternSet &patterns, mlir::buddy::PhysicalBankState &state) {
  (void)state;
  patterns.add<BankSiluPattern>(patterns.getContext());
}
