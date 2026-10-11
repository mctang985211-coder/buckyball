add_mlir_library(${BB_CORE_TARGET_PREFIX}LowerBuckyballPass
  ${BB_COMPILER_COMMON_DIR}/Conversion/LowerBuckyball/BaseAssignPhysicalBankPatterns.cpp
  ${BB_COMPILER_COMMON_DIR}/Conversion/LowerBuckyball/PhysicalBankState.cpp
  ${BB_COMPILER_COMMON_DIR}/Conversion/LowerBuckyball/ReportBankUsagePass.cpp
  ${BB_COMPILER_COMMON_DIR}/Conversion/LowerBuckyball/AssignPhysicalBanksPass.cpp
  ${BB_COMPILER_COMMON_DIR}/Conversion/LowerBuckyball/ReportCycleEstimatePass.cpp
  ${BB_assign_SOURCES}
  ${BB_REPO_ROOT}/examples/balls/smatmul/compiler/src/Conversion/LowerBuckyball/LowerBuckyballToBankSSAPatterns.cpp
  CoreBankSSALowering.cpp
  LowerBuckyballPass.cpp
  LowerBuckyballToBankSSAPass.cpp
  MegaKernelToBankSSAPatterns.cpp
  ResidentConvRegionToBankSSAPatterns.cpp
  MegaConv2dToBankSSAPatterns.cpp
  MemTransposeToBankSSAPatterns.cpp
  QuantizeTensorToBankSSAPatterns.cpp

  LINK_LIBS PUBLIC
  MLIRControlFlowDialect
  ${BB_CORE_TARGET_PREFIX}BuddyBuckyballTransforms
  ${BB_CORE_TARGET_PREFIX}LowerTileToBuckyballPass
)

# CMake's archive rule appends members, so a chip switch can retain stale
# objects from the previously configured LowerBuckyballPass target.
add_custom_command(TARGET ${BB_CORE_TARGET_PREFIX}LowerBuckyballPass PRE_LINK
  COMMAND ${CMAKE_COMMAND} -E rm -f
    $<TARGET_FILE:${BB_CORE_TARGET_PREFIX}LowerBuckyballPass>)

# Capability flags come from the selected Chip.pb dialect list resolved by the
# parent compiler. No unregistered Ball dialect is pulled into this core.
foreach(_pebble_ball Lut MaxPool Int8Add Int8Mul)
  set(_pebble_has_ball 0)
  foreach(_pebble_dialect_dir IN LISTS BB_BALL_DIALECT_DIRS)
    if(EXISTS "${_pebble_dialect_dir}/${_pebble_ball}Ball.td")
      set(_pebble_has_ball 1)
    endif()
  endforeach()
  string(TOUPPER "${_pebble_ball}" _pebble_ball_upper)
  # AddLLVM can compile sources in obj.<name> and assemble the main library
  # from TARGET_OBJECTS. Main-target PRIVATE definitions do not reach it.
  foreach(_pebble_lower_target
      ${BB_CORE_TARGET_PREFIX}LowerBuckyballPass
      obj.${BB_CORE_TARGET_PREFIX}LowerBuckyballPass)
    if(TARGET ${_pebble_lower_target})
      target_compile_definitions(${_pebble_lower_target} PRIVATE
        "PEBBLE_HAS_${_pebble_ball_upper}_BALL=${_pebble_has_ball}")
    endif()
  endforeach()
endforeach()
