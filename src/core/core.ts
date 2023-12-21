/**
 * RISCV core
 */

export class RVError extends Error {
    constructor(message: string) {
        super(message);
        this.name = `RVError`;
    }
}

class Core {
    // TODO Add decoder engine, state regs
    // TODO execution engine here
}