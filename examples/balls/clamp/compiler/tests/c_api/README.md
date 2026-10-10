# C ISA static-parameter fixtures

These are compiler-only fixtures, outside workload regression lists. The
verification agent must compile against the **real experiment generated**
`params.h`, `ballISA.h`, workload `bbhw` headers and Clamp ISA include directory.
No alternate funct7 or bank geometry is defined in these files.

Using GCC or Clang (RISC-V target for object compilation):

- `static_valid.c` must compile as GNU C11 and GNU C++17, at O0 and O2.
- `static_invalid.c` must reject for every `-DCASE=1` through `-DCASE=12`,
  in both language modes and optimization levels. `-fsyntax-only` is sufficient
  to exercise the static constraint; object compilation of the positive fixture
  also validates existing inline assembly compatibility.
- Reject evidence must name the negative array bound/size from
  `BB_CLAMP_STATIC_CHECK`; unrelated missing-header/toolchain failures are INFRA.
- The dynamic and side-effect positive functions must have exactly one runtime
  evaluation of each argument in the macro's packed instruction operands.
  Static constraint operands are beneath unevaluated `sizeof`; they add no
  runtime validation or alternate ISA encoding.

Cases cover zero, misalignment, capacity, input/output bank range, alias,
lo/hi representability, lo>hi, negative bank/N and unsigned UINT64_MAX bounds.
Allocation/group/reserved checks remain runtime raw-instruction negatives and
MLIR allocation proof checks; the C API does not pretend to infer allocation.
