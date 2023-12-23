import { hexify, getNumberBitAt } from "../utils"
import {cloneDeep} from 'lodash';
import { RVError } from "./core";
import { RVDecodeError } from "./decoder";

// For now just 32-bit inst encoding
export type Addr = number | bigint;
export type InstBitWidth = 32;
// export type InstType = "R" | "I" | "S" | "B" | "U" | "J" | undefined;
export type Register = number;
export type Funct = number;
export type Immediate = number;
export type Opcode = number | undefined;
// Mapping number with first two bits ignored (0b11), represent inst[6:2]
export enum BaseOpcode {
    LOAD = 0,
    LOAD_FP,
    CUSTOM_0,
    MISC_MEM,
    OP_IMM,
    AUIPC,
    OP_IMM_32,
    INST_48B_0,
    STORE,
    STORE_FP,
    CUSTOM_1,
    AMO,
    OP,
    LUI,
    OP_32,
    INST_64B,
    MADD,
    MSUB,
    NMSUB,
    NMADD,
    OP_FP,
    RESERVED_0,
    CUSTOM_2,
    INST_48B_1,
    BRANCH,
    JALR,
    RESERVED_1,
    JAL,
    SYSTEM,
    RESERVED_2,
    CUSTOM_3,
    INST_80B,
}

/**
 * Error classes
 */
export class RVIllegalInstError extends RVDecodeError {
    constructor(inst: RVInst) {
        super(`Inst at ${hexify(inst.pc)} with encoding ${hexify(inst.encoding)}`);
        this.name = `RVIllegalInstError`;
    }
}

/**
 * Base RV instruction fields, should cover RV32G and RV64G
 * Where `G` stands for `IMAFDZicsr_Zifencei`
 * Assuming 32-bit encoding
 */
export class RVInst {
    readonly pc: Addr;
    readonly bitWidth: InstBitWidth;
    readonly bytes: Uint8Array;
    readonly encoding: number;
    
    // Shareable fields
    readonly baseOpcode: BaseOpcode;
    readonly rd: Register;
    readonly rs1: Register;
    readonly rs2: Register;
    readonly funct3: Funct;
    readonly funct7: Funct;

    // I-type field
    readonly imm_i: Immediate;

    // S-type field
    readonly imm_s: Immediate;

    // B-type specific field
    readonly imm_b: Immediate;

    // U-type specific field
    readonly imm_u: Immediate;

    // J-type specific field
    readonly imm_j: Immediate;

    constructor(_pc: Addr, _bytes: Uint8Array, _bitWidth: InstBitWidth, littleEndian: boolean=true) {
        this.pc = _pc;
        this.bitWidth = _bitWidth;
        this.bytes = cloneDeep(_bytes);
        this.encoding = (new DataView(this.bytes.buffer)).getUint32(0, littleEndian);
        
        // Decoding
        let widthEncoding = getNumberBitAt(this.encoding, 1, 0);
        if (widthEncoding != 0b11)  // Check if 32-bit encoding inst
            throw new RVIllegalInstError(this);
        this.baseOpcode = getNumberBitAt(this.encoding, 2, 6);
        this.rd = getNumberBitAt(this.encoding, 7, 11);
        this.funct3 = getNumberBitAt(this.encoding, 12, 14);
        this.rs1 = getNumberBitAt(this.encoding, 15, 19);
        this.rs2 = getNumberBitAt(this.encoding, 20, 24);
        this.funct7 = getNumberBitAt(this.encoding, 25, 31);
        // Convert immediate value with signed extension
        // JS convert number to 32-bit integer for bitwise op
        let signBit = getNumberBitAt(this.encoding, 31, 31);
        let signField = signBit != 0 ? 0xFFFFFFFF : 0;
        this.imm_i = (signField << 12) | getNumberBitAt(this.encoding, 20, 31);
        this.imm_s = (signField << 12) | (getNumberBitAt(this.encoding, 7, 11) & (getNumberBitAt(this.encoding, 25, 31) << 5));
        this.imm_b = (signField << 13) | 
                    ((getNumberBitAt(this.encoding, 31, 31) << 12) &
                     (getNumberBitAt(this.encoding, 7, 7) << 11)  &
                     (getNumberBitAt(this.encoding, 25, 30) << 5)  &
                     (getNumberBitAt(this.encoding, 11, 8) << 1));
        this.imm_u = getNumberBitAt(this.encoding, 12, 31) << 12;
        this.imm_j = (signField << 21) | 
                    ((getNumberBitAt(this.encoding, 31, 31) << 20) & 
                     (getNumberBitAt(this.encoding, 12, 19) << 12) & 
                     (getNumberBitAt(this.encoding, 20, 20) << 11) & 
                     (getNumberBitAt(this.encoding, 21, 30) << 1));
    }
}
