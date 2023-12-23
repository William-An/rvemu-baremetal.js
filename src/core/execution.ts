import { RVInst, BaseOpcode } from "./inst";
import { Memory } from "../memory";
import { IntRegFile } from "./registerfile";
import { getNumberBitAt } from "../utils";
import { RVECALLTrap, RVEBREAKTrap, RVIllegalInstException } from "../exception";

export abstract class BaseRVExecUnit {
    intRegFile: IntRegFile;
    memory: Memory;

    constructor(intRegFile: IntRegFile, memory: Memory) {
        this.intRegFile = intRegFile;
        this.memory = memory;
    }

    /**
     * Try to execute the instruction
     * @param inst Decoded instruction
     * @returns true if execution is performed
     * @throws RVExecError
     */
    abstract execute(inst: RVInst): boolean;
}

export class RV32IExecUnit extends BaseRVExecUnit {
    // Valid base opcode field for this extension
    // OP_IMM funct3 encoding
    static readonly ADDI = 0b000;
    static readonly SLTI = 0b010;
    static readonly SLTIU = 0b011;
    static readonly XORI = 0b100;
    static readonly ORI = 0b110;
    static readonly ANDI = 0b111;
    static readonly SLLI = 0b001;
    static readonly SRLI_SRAI = 0b101;

    // OP funct3 encoding
    static readonly ADD_SUB = 0b000;
    static readonly SLT = 0b010;
    static readonly SLTU = 0b011;
    static readonly AND = 0b111;
    static readonly OR = 0b110;
    static readonly XOR = 0b100;
    static readonly SLL = 0b001;
    static readonly SRL_SRA = 0b101;

    // BRANCH funct3 encoding
    static readonly BEQ = 0b000;
    static readonly BNE = 0b001;
    static readonly BLT = 0b100;
    static readonly BGE = 0b101;
    static readonly BLTU = 0b110;
    static readonly BGEU = 0b111;

    /**
     * 
     * @param inst Incoming inst
     * @returns true if inst is handled by RV32I, false otherwise
     * @throws 
     */
    execute(inst: RVInst): boolean {
        // PC handling, default to PC + 4
        let pc = this.intRegFile.getPCValue() as number;
        let pc_add4 = pc + 4;
        let next_pc = pc_add4;
        switch (inst.baseOpcode) {
            // Immediate ops
            case BaseOpcode.OP_IMM: {
                // Signed src
                let src_val = this.intRegFile.readValue(inst.rs1, true) as number;
                // Unsigned src
                let src_valu = this.intRegFile.readValue(inst.rs1, false) as number;
                if (inst.funct3 == RV32IExecUnit.ADDI) { // ADDI
                    let dst_val = src_val + inst.imm_i;
                    this.intRegFile.writeValue(inst.rd, dst_val, true);
                } else if (inst.funct3 == RV32IExecUnit.SLTI) { // SLTI
                    let dst_val = src_val < inst.imm_i ? 1 : 0;
                    this.intRegFile.writeValue(inst.rd, dst_val, true);
                } else if (inst.funct3 == RV32IExecUnit.SLTIU) { // SLTU for immediate
                    // Use >>> unsigned right shift to convert the number to unsigned
                    // https://stackoverflow.com/questions/60325023/how-can-i-get-usable-unsigned-32-bit-integer-to-work-with
                    let dst_val = src_valu < (inst.imm_i >>> 0) ? 1 : 0;
                    this.intRegFile.writeValue(inst.rd, dst_val, true);
                } else if (inst.funct3 == RV32IExecUnit.XORI) { // XORI
                    let dst_val = src_valu ^ inst.imm_i;
                    this.intRegFile.writeValue(inst.rd, dst_val, false);
                } else if (inst.funct3 == RV32IExecUnit.ORI) { // ORI
                    let dst_val = src_valu | inst.imm_i;
                    this.intRegFile.writeValue(inst.rd, dst_val, false);
                } else if (inst.funct3 == RV32IExecUnit.ANDI) { // ANDI
                    let dst_val = src_valu & inst.imm_i;
                    this.intRegFile.writeValue(inst.rd, dst_val, false);
                } else if (inst.funct3 == RV32IExecUnit.SLLI) { // SLLI
                    let shamt = getNumberBitAt(inst.imm_i, 0, 4);
                    let rest = getNumberBitAt(inst.imm_i, 5, 11);
                    if (rest != 0)
                        throw new RVIllegalInstException(inst)
                    let dst_val = src_valu << shamt;
                    this.intRegFile.writeValue(inst.rd, dst_val, false);
                } else if (inst.funct3 == RV32IExecUnit.SRLI_SRAI) { // SRLI/SRAI
                    let shamt = getNumberBitAt(inst.imm_i, 0, 4);
                    let rest = getNumberBitAt(inst.imm_i, 5, 11);
                    let dst_val;
                    if (rest == 0b0000000) {    // SRLI
                        dst_val = src_val >>> shamt;
                    } else if (rest == 0b0100000) { // SRAI
                        dst_val = src_val >> shamt;
                    } else {
                        throw new RVIllegalInstException(inst);
                    }
                    this.intRegFile.writeValue(inst.rd, dst_val, false);
                } else {
                    return false;
                }
                break;
            }
            case BaseOpcode.LUI: {
                this.intRegFile.writeValue(inst.rd, inst.imm_u, true);
                break;
            }
            case BaseOpcode.AUIPC: {
                let pc = this.intRegFile.getPCValue() as number;
                let dst_val = pc + inst.imm_u;
                this.intRegFile.writeValue(inst.rd, dst_val, true);
                break;
            }
            case BaseOpcode.OP: {
                // Signed src
                let src1_val = this.intRegFile.readValue(inst.rs1, true) as number;
                let src2_val = this.intRegFile.readValue(inst.rs2, true) as number;
                // Unsigned src
                let src1_valu = this.intRegFile.readValue(inst.rs1, false) as number;
                let src2_valu = this.intRegFile.readValue(inst.rs2, false) as number;

                if (inst.funct3 == RV32IExecUnit.ADD_SUB) {
                    if (inst.funct7 == 0b0000000) { // ADD
                        let dst_val = src1_val + src2_val;
                        this.intRegFile.writeValue(inst.rd, dst_val, true);
                    } else if (inst.funct7 == 0b0100000) { // SUB
                        let dst_val = src1_val - src2_val;
                        this.intRegFile.writeValue(inst.rd, dst_val, true);
                    } else
                        throw new RVIllegalInstException(inst);
                } else if (inst.funct3 == RV32IExecUnit.SLT) {
                    if (inst.funct7 != 0b0000000)
                        throw new RVIllegalInstException(inst);
                    let dst_val = src1_val < src2_val ? 1 : 0;
                    this.intRegFile.writeValue(inst.rd, dst_val, true);
                } else if (inst.funct3 == RV32IExecUnit.SLTU) {
                    if (inst.funct7 != 0b0000000)
                        throw new RVIllegalInstException(inst);
                    let dst_val = src1_valu < src2_valu ? 1 : 0;
                    this.intRegFile.writeValue(inst.rd, dst_val, true);
                } else if (inst.funct3 == RV32IExecUnit.AND) {
                    if (inst.funct7 != 0b0000000)
                        throw new RVIllegalInstException(inst);
                    let dst_val = src1_valu & src2_valu;
                    this.intRegFile.writeValue(inst.rd, dst_val, false);
                } else if (inst.funct3 == RV32IExecUnit.OR) {
                    if (inst.funct7 != 0b0000000)
                        throw new RVIllegalInstException(inst);
                    let dst_val = src1_valu | src2_valu;
                    this.intRegFile.writeValue(inst.rd, dst_val, false);
                } else if (inst.funct3 == RV32IExecUnit.XOR) {
                    if (inst.funct7 != 0b0000000)
                        throw new RVIllegalInstException(inst);
                    let dst_val = src1_valu ^ src2_valu;
                    this.intRegFile.writeValue(inst.rd, dst_val, false);
                } else if (inst.funct3 == RV32IExecUnit.SLL) {
                    if (inst.funct7 != 0b0000000)
                        throw new RVIllegalInstException(inst);
                    let shmat = getNumberBitAt(src2_valu, 0, 4);
                    let dst_val = src1_valu << shmat;
                    this.intRegFile.writeValue(inst.rd, dst_val, false);
                } else if (inst.funct3 == RV32IExecUnit.SRL_SRA) {
                    let shmat = getNumberBitAt(src2_valu, 0, 4);
                    if (inst.funct7 == 0b0000000) { // SRL
                        let dst_val = src1_val >>> shmat;
                        this.intRegFile.writeValue(inst.rd, dst_val, false);
                    } else if (inst.funct7 == 0b0100000) { // SRA
                        let dst_val = src1_val >> shmat;
                        this.intRegFile.writeValue(inst.rd, dst_val, true);
                    } else
                        throw new RVIllegalInstException(inst);
                } else {
                    // Impossible to have this case as funct3 only has 3 bits
                    // if we encounter this, it is likely a emulator programming error
                    throw new RVIllegalInstException(inst);
                }
                break;
            }
            case BaseOpcode.JAL: {
                next_pc = pc + inst.imm_j;
                this.intRegFile.writeValue(inst.rd, pc_add4, false);
                break;
            }
            case BaseOpcode.JALR: {
                let src1_val = this.intRegFile.readValue(inst.rs1, true) as number;
                next_pc = src1_val + inst.imm_i;
                next_pc = next_pc & (~0x1);   // clear the least significant bit of jump address
                this.intRegFile.writeValue(inst.rd, pc_add4, false);
                break;
            }
            case BaseOpcode.BRANCH: {
                // Signed src
                let src1_val = this.intRegFile.readValue(inst.rs1, true) as number;
                let src2_val = this.intRegFile.readValue(inst.rs2, true) as number;
                // Unsigned src
                let src1_valu = this.intRegFile.readValue(inst.rs1, false) as number;
                let src2_valu = this.intRegFile.readValue(inst.rs2, false) as number;
                // Branch target pc
                let branch_pc = pc + inst.imm_i;
                
                if (inst.funct3 == RV32IExecUnit.BEQ) {
                    next_pc = src1_val == src2_val ? branch_pc : pc_add4;
                } else if (inst.funct3 == RV32IExecUnit.BNE) {
                    next_pc = src1_val != src2_val ? branch_pc : pc_add4;
                } else if (inst.funct3 == RV32IExecUnit.BLT) {
                    next_pc = src1_val < src2_val ? branch_pc : pc_add4;
                } else if (inst.funct3 == RV32IExecUnit.BLTU) {
                    next_pc = src1_valu < src2_valu ? branch_pc : pc_add4;
                } else if (inst.funct3 == RV32IExecUnit.BGE) {
                    next_pc = src1_val >= src2_val ? branch_pc : pc_add4;
                } else if (inst.funct3 == RV32IExecUnit.BGEU) {
                    next_pc = src1_valu >= src2_valu ? branch_pc : pc_add4;
                } else {
                    throw new RVIllegalInstException(inst);
                }
                break;
            }
            case BaseOpcode.LOAD: {
                let addr = this.intRegFile.readValue(inst.rs1, false) as number + inst.imm_i;
                let log2Width = inst.funct3 & 0x3;
                let signed = (inst.funct3 & 0x4) != 1;
                if (log2Width > 2)
                    throw new RVIllegalInstException(inst)
                let data = this.memory.read(BigInt(addr), 1 << log2Width);
                this.intRegFile.write(inst.rd, data, signed);
                break;
            }
            case BaseOpcode.STORE: {
                let addr = this.intRegFile.readValue(inst.rs1, false) as number + inst.imm_i;
                let log2Width = inst.funct3 & 0x3;
                let signed = (inst.funct3 & 0x4) != 1;
                if (log2Width > 2)
                    throw new RVIllegalInstException(inst)
                let data = this.intRegFile.read(inst.rs2);
                this.memory.write(BigInt(addr), 1 << log2Width, data);
                break;
            }
            case BaseOpcode.MISC_MEM: {
                // FENCE op treated as NOP here
                break;
            }
            case BaseOpcode.SYSTEM: {
                if (inst.imm_i == 0) { // ECALL
                    throw new RVECALLTrap(inst);
                } else if (inst.imm_i == 1) { // EBREAK
                    throw new RVEBREAKTrap(inst);
                } else {
                    return false;
                }
                break;
            }
            default:
                return false;
        }
        // Set next PC here
        this.intRegFile.setPCValue(next_pc);
        return true;
    }
}