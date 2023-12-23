/**
 * RISCV core
 */

import { RVExecDuplicatedUnitError, RVExecError, RVIllegalInstException } from "../exception";
import { Memory } from "../memory";
import { RVDecoder } from "./decoder";
import { BaseRVExecUnit, RV32IExecUnit } from "./execution";
import { Addr, RVInst } from "./inst";
import { IntRegFile } from "./registerfile";
import { Pair } from "../utils"

interface RVCoreInterface {
    memory: Memory;
    execUnits: BaseRVExecUnit[];
    decoder: RVDecoder;

    /**
     * Fetch pc and the inst bytes
     * @returns [PC, inst byte]
     */
    fetch(): Pair<Addr, Uint8Array>;

    /**
     * Decode inst bytes
     * @param pc PC of inst
     * @param bytes inst bytes
     * @returns Decoded instruction
     */
    decode(pc: Addr, bytes: Uint8Array): RVInst;

    /**
     * Execute an instruction
     * @param inst Inst to be executed
     */
    execute(inst: RVInst): void;
}

class RV32ICore implements RVCoreInterface {
    memory: Memory;
    execUnits: BaseRVExecUnit[];
    decoder: RVDecoder;
    intRegFile: IntRegFile;
    constructor(memory: Memory) {
        this.memory = memory;
        this.intRegFile = new IntRegFile(32, 33, "little");
        this.execUnits = [new RV32IExecUnit(this.intRegFile, this.memory)];
        this.decoder = new RVDecoder(32, "little");
    }

    fetch(): Pair<Addr, Uint8Array> {
        let pc = this.intRegFile.getPCValue();
        return [pc, this.memory.readWord(BigInt(pc))];
    }

    decode(pc: Addr, bytes: Uint8Array): RVInst {
        return this.decoder.decode(pc, bytes);
    }
    
    execute(inst: RVInst): void {
        let handled = false;
        this.execUnits.forEach((execUnit) => {
            if (handled)
                throw new RVExecDuplicatedUnitError(inst, this.execUnits);
            handled = handled || execUnit.execute(inst);
        })
        if (!handled)
            throw new RVIllegalInstException(inst);
    }
}
