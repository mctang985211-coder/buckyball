# The legacy local aggregator lists Pebble's default Balls explicitly. This
# target uses the common Chip.pb-generated hook aggregator instead, so omit
# only that local source from LLVM's directory completeness check. Keep the
# check enabled for every other source and for the registered Ball sources.
list(APPEND LLVM_OPTIONAL_SOURCES LegalizeForLLVMExport.cpp)

add_mlir_dialect_library(${BB_CORE_TARGET_PREFIX}BuddyBuckyballTransforms
  ${BB_COMPILER_COMMON_DIR}/Dialect/Buckyball/Transforms/LegalizeForLLVMExportBase.cpp
  ${BB_legalize_SOURCES}
  ${BB_COMPILER_COMMON_DIR}/Dialect/Buckyball/Transforms/LegalizeForLLVMExport.cpp

  LINK_LIBS PUBLIC
  ${BB_CORE_TARGET_PREFIX}BuddyBuckyball
  MLIRIR
  MLIRLLVMCommonConversion
  MLIRLLVMDialect
)
