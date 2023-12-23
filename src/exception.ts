import { RVDecoder } from "./core/decoder";
import { BaseRVExecUnit } from "./core/execution";
import { RVInst } from "./core/inst";
import { Memory } from "./memory";
import { hexify } from "./utils";

// Error due to emulator itself
export class RVEmulatorError extends Error {
    constructor(message: string) {
        super(message);
        this.name = `RVEmulatorError`;
    }
}

export class RVDecoderError extends RVEmulatorError {
    readonly decoder: RVDecoder;
    constructor(message: string, decoder: RVDecoder) {
        super(message);
        this.name = `RVDecoderError`;
        this.decoder = decoder;
    }
}

export class RVExecError extends RVEmulatorError {
    readonly execUnits: BaseRVExecUnit[];
    readonly inst: RVInst;
    constructor(message: string, inst: RVInst, execUnits: BaseRVExecUnit[]) {
        super(message);
        this.name = `RVExecError`;
        this.execUnits = execUnits;
        this.inst = inst;
    }
}

export class RVExecDuplicatedUnitError extends RVExecError {
    constructor(inst: RVInst, execUnits: BaseRVExecUnit[]) {
        // TODO Add string format for rvinst and execuints
        let msg = `Inst ${inst} handled by multiple execUnits in ${execUnits}!`;
        super(msg, inst, execUnits);
    }
}

export class RVExecUnitError extends RVEmulatorError {
    readonly execUnit: BaseRVExecUnit;
    readonly inst: RVInst;
    constructor(message: string, inst: RVInst, execUnit: BaseRVExecUnit) {
        super(message);
        this.name = `RVExecUnitError`;
        this.execUnit = execUnit;
        this.inst = inst;
    }
}

export class RVMemoryError extends RVEmulatorError {
    readonly memory: Memory
    constructor(message: string, memory: Memory) {
        super(message);
        this.name = `RVMemoryError`;
        this.memory = memory;
    }
}

// Exception due to incoming elf binary
export class RVInstError extends Error {
    readonly inst: RVInst;
    constructor(message: string, inst: RVInst) {
        super(message);
        this.name = `RVInstError`;
        this.inst = inst;
    }
}

export class RVInstException extends RVInstError {
    constructor(message: string, inst: RVInst) {
        super(message, inst);
        this.name = `RVInstException`;
    }
}


export class RVIllegalInstException extends RVInstException {
    constructor(inst: RVInst) {
        super(`Inst at ${hexify(inst.pc)} with encoding ${hexify(inst.encoding)}`, inst);
        this.name = `RVIllegalInstException`;
    }
}

// Inst Trap
export class RVInstTrap extends RVInstError {
    constructor(message: string, inst: RVInst) {
        super(message, inst);
        this.name = `RVInstTrap`;
    }
}

export class RVECALLTrap extends RVInstTrap {
    constructor(inst: RVInst) {
        super(`ECALL at ${hexify(inst.pc)}`, inst);
        this.name = `RVECALLTrap`;
    }
}

export class RVEBREAKTrap extends RVInstTrap {
    constructor(inst: RVInst) {
        super(`EBREAK at ${hexify(inst.pc)}`, inst);
        this.name = `RVEBREAKTrap`;
    }
}