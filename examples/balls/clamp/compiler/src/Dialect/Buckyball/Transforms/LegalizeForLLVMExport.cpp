#include "Buckyball/BuckyballOps.h"
#include "Dialect/Buckyball/Transforms/LegalizeForLLVMExportBase.h"
#include "Target/BuckyballTargetRegistry.h"
#include "mlir/Conversion/LLVMCommon/ConversionTarget.h"
#include "mlir/Conversion/LLVMCommon/Pattern.h"
#include "mlir/Dialect/Arith/IR/Arith.h"
#include "mlir/Dialect/LLVMIR/LLVMDialect.h"
#include "mlir/IR/Matchers.h"
#include "mlir/IR/PatternMatch.h"
#include <cstdint>
#include <optional>
using namespace mlir;
using namespace buddy::buckyball;
using namespace buddy::buckyball::legalize;
namespace {
static std::optional<int64_t> constant(Value v) {
  APInt value;
  if (matchPattern(v, m_ConstantInt(&value)))
    return value.getSExtValue();
  if (auto bitAnd = v.getDefiningOp<arith::AndIOp>()) {
    auto lhs = constant(bitAnd.getLhs()), rhs = constant(bitAnd.getRhs());
    if (lhs && rhs)
      return *lhs & *rhs;
  }
  return std::nullopt;
}
// Prove same-block static allocation from the latest preceding MSET.
// Both source ops and already-exported MsetIntrOps are recognized because
// dialect conversion may have rewritten an earlier allocation first.
static LogicalResult allocated(ClampOp op, int64_t bank) {
  for (Operation *prev = op->getPrevNode(); prev; prev = prev->getPrevNode()) {
    // Regions/unknown calls may execute MSET, release or change bank groups.
    // Do not recover an older proof across effects whose target is unknown.
    if (prev->getNumRegions())
      return op.emitError(
          "Clamp cannot prove allocation across region control flow");
    StringRef name = prev->getName().getStringRef();
    if (name == "func.call" || name == "llvm.call") {
      auto callee = prev->getAttrOfType<FlatSymbolRefAttr>("callee");
      if (!callee || (callee.getValue() != "bb_dma_bank_set_cols" &&
                      callee.getValue() != "bb_dma_touch_mvout"))
        return op.emitError(
            "Clamp cannot prove allocation across unknown call");
    }
    if (name == "func.call_indirect" || name == "llvm.call_intrinsic")
      return op.emitError("Clamp cannot prove allocation across indirect call");
    if (name == "buckyball.inst" || name == "buckyball.intr.custom") {
      auto funct = prev->getAttrOfType<IntegerAttr>("funct7");
      if (!funct || funct.getInt() == 32)
        return op.emitError(
            "Clamp allocation must use a provable MSET operation");
    }
    if (auto mset = dyn_cast<MsetOp>(prev)) {
      auto id = constant(mset.getBankId());
      if (!id)
        return op.emitError(
            "Clamp cannot prove allocation across dynamic MSET bank ID");
      if (*id != bank)
        continue;
      if (!mset.getAlloc())
        return op.emitError("Clamp bank is unallocated");
      if (mset.getRow() != 1 || mset.getCol() != 1)
        return op.emitError("Clamp requires an allocated single-group bank");
      return success();
    }
    if (auto mset = dyn_cast<MsetIntrOp>(prev)) {
      auto rs1 = constant(mset->getOperand(0));
      auto rs2 = constant(mset->getOperand(1));
      if (!rs1)
        return op.emitError(
            "Clamp cannot prove allocation across dynamic MSET bank ID");
      if ((*rs1 & 1023) != bank)
        continue;
      if (!rs2)
        return op.emitError(
            "Clamp cannot prove allocation across dynamic MSET configuration");
      if (!(*rs2 & 1024))
        return op.emitError("Clamp bank is unallocated");
      if ((*rs2 & 31) != 1 || ((*rs2 >> 5) & 31) != 1)
        return op.emitError("Clamp requires an allocated single-group bank");
      return success();
    }
  }
  return op.emitError(
      "Clamp bank allocation must be statically provable in the same block");
}
struct ClampLowering : public ConvertOpToLLVMPattern<ClampOp> {
  ClampLowering(LLVMTypeConverter &c, int64_t depth)
      : ConvertOpToLLVMPattern<ClampOp>(c), depth(depth) {}
  LogicalResult
  matchAndRewrite(ClampOp op, OpAdaptor adaptor,
                  ConversionPatternRewriter &rewriter) const override {
    buckyball_target::requireBuckyballBall("ClampBall");
    const auto &target = buckyball_target::getBuckyballTarget();
    if (target.bankWidthBits != 128)
      return op.emitError("Clamp requires 128-bit rows");
    auto input = constant(op.getInputBankId()),
         output = constant(op.getOutputBankId());
    auto n = constant(op.getN()), lo = constant(op.getLo()),
         hi = constant(op.getHi());
    if (!input || !output || *input < 0 || *output < 0 ||
        *input >= target.bankNum || *output >= target.bankNum)
      return op.emitError(
          "Clamp bank IDs must be constants within the target bank range");
    if (*input == *output)
      return op.emitError("Clamp banks must be distinct");
    if (!n || *n <= 0 || *n % 4 || *n / 4 > depth)
      return op.emitError(
          "Clamp N must be a positive constant multiple of 4 within capacity");
    if (!lo || !hi || *lo < INT32_MIN || *lo > INT32_MAX || *hi < INT32_MIN ||
        *hi > INT32_MAX || *lo > *hi)
      return op.emitError(
          "Clamp bounds must be signed INT32 constants with lo <= hi");
    if (failed(allocated(op, *input)) || failed(allocated(op, *output)))
      return failure();
    Location loc = op.getLoc();
    Value rs1 = packRs1BanksIter(rewriter, loc, adaptor.getInputBankId(),
                                 cstI64(rewriter, loc, 0),
                                 adaptor.getOutputBankId(), adaptor.getN());
    uint64_t bounds = uint32_t(*lo) | (uint64_t(uint32_t(*hi)) << 32);
    rewriter.replaceOpWithNewOp<CustomIntrOp>(
        op, rs1, cstI64(rewriter, loc, bounds),
        rewriter.getI32IntegerAttr(
            buckyball_target::getBuckyballFunct7("CLAMP")));
    return success();
  }
  int64_t depth;
};
} // namespace
namespace mlir::buddy::buckyball {
void populateClampBallLegalizeForLLVMExportPatterns(
    LLVMTypeConverter &converter, RewritePatternSet &patterns, bool,
    int64_t bankDepth, bool) {
  patterns.add<ClampLowering>(converter, bankDepth);
}
void configureClampBallLegalizeForExportTarget(LLVMConversionTarget &target,
                                               bool) {
  target.addIllegalOp<ClampOp, BankClampOp>();
}
} // namespace mlir::buddy::buckyball
