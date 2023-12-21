import { RVIllegalInstError, RVInst } from "./inst";
import { Memory } from "../memory";
import { IntRegFile } from "./registerfile";
import { RVError } from "./core";

class RVExecError extends RVError {
    execUnit: BaseRVExecUnit;
    constructor(message: string, execUnit: BaseRVExecUnit) {
        super(message);
        this.name = `RVExecError`;
        this.execUnit = execUnit;
    }
}

abstract class BaseRVExecUnit {
    intRegFile: IntRegFile;
    memory: Memory;

    constructor(intRegFile: IntRegFile, memory: Memory) {
        this.intRegFile = intRegFile;
        this.memory = memory;
    }

    abstract execute(inst: RVInst): void;
}

export class RV32IExecUnit extends BaseRVExecUnit {
    execute(inst: RVInst): void {
        
    }
}