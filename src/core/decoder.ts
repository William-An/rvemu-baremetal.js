import { RVInst, InstBitWidth, Addr } from "./inst";
import { Endianness } from "../utils";

export class RVDecoder {
    readonly bitWidth: InstBitWidth;
    readonly endianness: Endianness;
    constructor(_bitWidth: InstBitWidth, _endianness: Endianness="little") {
        this.bitWidth = _bitWidth;
        this.endianness = _endianness;
    }

    /**
     * Decode and return an instruction. Throws `RVIllegalInstError` for decode error.
     * @param _pc PC address
     * @param _bytes Inst bytes
     * @returns decoded instruction 
     * @throws RVIllegalInstError
     */
    decode(_pc: Addr, _bytes: Uint8Array): RVInst {
        let inst = new RVInst(_pc, _bytes, this.bitWidth, this.endianness=="little");
        return inst;
    }
}
