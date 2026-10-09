#include "Buckyball/BuckyballOps.h"
#include "Conversion/LowerBuckyball/LowerBuckyball.h"
#include "Target/BuckyballTargetRegistry.h"
#include "mlir/IR/PatternMatch.h"
#include <climits>
#include <cstdint>
using namespace mlir;
using namespace ::buddy::buckyball;
namespace {
class BankClampPattern : public OpRewritePattern<BankClampOp> {
public:
  BankClampPattern(MLIRContext *ctx, mlir::buddy::PhysicalBankState &state)
      : OpRewritePattern<BankClampOp>(ctx), state(state) {}
  LogicalResult matchAndRewrite(BankClampOp op,
                                PatternRewriter &rewriter) const override {
    auto input = state.getSlot(op.getInBank());
    auto output = state.getSlot(op.getOutBank());
    if (!input || !output)
      return op.emitError("Clamp banks must be allocated");
    if (input->row != 1 || input->col != 1 || output->row != 1 ||
        output->col != 1)
      return op.emitError("Clamp banks must each occupy one single group");
    if (input->base == output->base)
      return op.emitError("Clamp banks must be distinct");
    auto n = state.getConstI64(op.getN());
    auto lo = state.getConstI64(op.getLo());
    auto hi = state.getConstI64(op.getHi());
    if (!n || *n <= 0 || *n % 4 ||
        *n / 4 > buckyball_target::getBuckyballTarget().bankDepth)
      return op.emitError(
          "Clamp N must be a positive constant multiple of 4 within capacity");
    if (!lo || !hi || *lo < INT32_MIN || *lo > INT32_MAX || *hi < INT32_MIN ||
        *hi > INT32_MAX || *lo > *hi)
      return op.emitError(
          "Clamp bounds must be signed INT32 constants with lo <= hi");
    rewriter.create<ClampOp>(op.getLoc(),
                             state.cstI64(rewriter, op.getLoc(), input->base),
                             state.cstI64(rewriter, op.getLoc(), output->base),
                             op.getN(), op.getLo(), op.getHi());
    rewriter.replaceOp(op, state.cstI64(rewriter, op.getLoc(), output->base));
    return success();
  }

private:
  mlir::buddy::PhysicalBankState &state;
};
} // namespace
namespace mlir::buddy {
void populateClampBallAssignPhysicalBankPatterns(
    RewritePatternSet &patterns, mlir::buddy::PhysicalBankState &state) {
  patterns.add<BankClampPattern>(patterns.getContext(), state);
}
} // namespace mlir::buddy
