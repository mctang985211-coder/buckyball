if(NOT COMMAND add_mlir_library OR NOT COMMAND add_mlir_dialect)
  message(FATAL_ERROR "MLIR CMake helpers must be loaded. Build as part of buddy-mlir.")
endif()

message(STATUS "Building Pebble compiler Core package")
message(STATUS "  Source: ${CMAKE_CURRENT_SOURCE_DIR}")
message(STATUS "  Binary: ${CMAKE_CURRENT_BINARY_DIR}")

get_filename_component(BB_REPO_ROOT ${CMAKE_CURRENT_LIST_DIR}/../../../../.. ABSOLUTE)
set(BB_COMPILER_COMMON_DIR ${BB_REPO_ROOT}/compiler/src)

if(NOT EXISTS ${BB_COMPILER_COMMON_DIR}/Dialect/Buckyball/Buckyball.td)
  message(FATAL_ERROR "Missing Buckyball compiler common dir: ${BB_COMPILER_COMMON_DIR}")
endif()

include_directories(${BB_COMPILER_COMMON_DIR})
include_directories(${BB_COMPILER_COMMON_DIR}/Dialect)
include_directories(${BB_COMPILER_COMMON_DIR}/Dialect/Buckyball)
include_directories(${CMAKE_CURRENT_SOURCE_DIR})
include_directories(${CMAKE_CURRENT_BINARY_DIR})
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/Dialect)
include_directories(${CMAKE_CURRENT_BINARY_DIR}/Dialect)
include_directories(BEFORE ${CMAKE_CURRENT_BINARY_DIR}/Dialect/Buckyball)

# Use the registered Ball dialect paths resolved by the parent Chip.pb generator.
set(PEBBLE_BALL_COMPILER_DIALECT_DIRS ${BB_BALL_DIALECT_DIRS})

set(BB_CORE_BACKEND_INTRINSICS_DIR
  ${CMAKE_CURRENT_SOURCE_DIR}/Backend/include
  CACHE INTERNAL "Buckyball chip backend intrinsic directory")

set(BB_BALL_BACKEND_INTRINSICS_DIRS)

foreach(PEBBLE_BALL_COMPILER_DIALECT_DIR ${PEBBLE_BALL_COMPILER_DIALECT_DIRS})
  if(NOT EXISTS ${PEBBLE_BALL_COMPILER_DIALECT_DIR})
    message(FATAL_ERROR
      "Missing pebble ball compiler dialect dir: ${PEBBLE_BALL_COMPILER_DIALECT_DIR}")
  endif()
  include_directories(${PEBBLE_BALL_COMPILER_DIALECT_DIR})
  get_filename_component(PEBBLE_BALL_COMPILER_DIR
    ${PEBBLE_BALL_COMPILER_DIALECT_DIR}/../..
    ABSOLUTE)
  list(APPEND BB_BALL_BACKEND_INTRINSICS_DIRS
    ${PEBBLE_BALL_COMPILER_DIR}/Backend/include)
endforeach()

set(BB_BALL_BACKEND_INTRINSICS_DIRS ${BB_BALL_BACKEND_INTRINSICS_DIRS}
  CACHE INTERNAL "Buckyball ball backend intrinsic directories")

execute_process(
  COMMAND "${Python3_EXECUTABLE}" "${BB_TARGET_REGISTRY_GENERATOR}"
    --repo "${BB_REPO_ROOT}" --chip-pb "${BUCKYBALL_CHIP_PB}"
    --print-ball-compiler-paths legalize
  RESULT_VARIABLE BB_PEBBLE_LEGALIZE_RESULT
  OUTPUT_VARIABLE BB_PEBBLE_LEGALIZE_RAW
  ERROR_VARIABLE BB_PEBBLE_LEGALIZE_ERROR)
if(NOT BB_PEBBLE_LEGALIZE_RESULT EQUAL 0)
  message(FATAL_ERROR "failed to resolve Pebble Ball export sources: ${BB_PEBBLE_LEGALIZE_ERROR}")
endif()
string(STRIP "${BB_PEBBLE_LEGALIZE_RAW}" BB_PEBBLE_LEGALIZE_RAW)
string(REPLACE "\n" ";" BB_legalize_SOURCES "${BB_PEBBLE_LEGALIZE_RAW}")

add_subdirectory(Dialect)
add_subdirectory(Conversion)
add_subdirectory(Target)

add_custom_target(buckyball-compiler-${BB_CORE_NAME}
  DEPENDS
  ${BB_CORE_TARGET_PREFIX}BuddyBuckyball
  ${BB_CORE_TARGET_PREFIX}BuddyBuckyballTransforms
  ${BB_CORE_TARGET_PREFIX}BuddyBuckyballToLLVMIRTranslation
  ${BB_CORE_TARGET_PREFIX}LowerBuckyballPass
  ${BB_CORE_TARGET_PREFIX}LowerTileToBuckyballPass
)
