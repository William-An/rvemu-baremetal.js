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
2. Decoder
3. Execution engine
4. Fetch unit
5. LD/ST unit
6. Exception handling

### Memory

Memory system supporting normal memory and MMIO device.

1. [x] Memory module development
   1. [x] Memory regions
   2. [x] Memory top
2. [x] Memory module test
   1. [x] Memory unit test
   2. [x] Memory property test
   3. [x] Memory model-based test
