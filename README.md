# rvemu-baremetal.js

RISCV emulator focusing on baremetal and embedded system.

## Components

### Hart

Hardware thread, entry point to run binary. Responsible for setting initial memory layout, core, and connection.

### Core

RISCV core, holding:

1. Basic arch state registerfile
   1. [x] Integer registerfile
   2. [ ] Control status registerfile
      1. [x] Regfile
      2. [ ] CSR mapping and permission handling
   3. [ ] Floating point registerfile
   4. [ ] Testing files
2. [x] Decoder
3. Execution unit
   1. Each ISA extension execution unit should inherit from `BaseRVInstExecUnit` with additional hardware resource connected like fp register file.
4. Fetch unit
5. LD/ST unit
6. Exception handling
   1. `throw + catch?`
   2. Unify hardware exceptions under the same parent class `RVError`
   3. `RVError`: For exception handling
      1. `RVDecodeError`
         1. `RVIllegalInstError`
      2. `RVExecError`
         1. `RVDivisionByZeroError`
         2. ...
      3. `RVMemError`
   4. Other programming exception/error should still inherit from `Error` class

### Memory

Memory system supporting normal memory and MMIO device.

1. [x] Memory module development
   1. [x] Memory regions
   2. [x] Memory top
2. [x] Memory module test
   1. [x] Memory unit test
   2. [x] Memory property test
   3. [x] Memory model-based test
