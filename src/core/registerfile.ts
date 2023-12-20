import { Endianness } from "../utils"

type RegisterBitWidth = 32 | 64;
// To support different registerfile type: floating point or integer or vector register
type DataViewReadFunction<T> = (byteOffset: number, littleEndian?: boolean | undefined) => T;
type DataViewWriteFunction<T> = (byteOffset: number, value: T, littleEndian?: boolean | undefined) => void

class RegisterFileError extends Error {
    constructor(message: string, rf: BaseRegisterFile) {
        super(message);
        this.name = `RegisterFileError on ${rf.toString()}`;
    }
}

class RegisterError extends Error {
    constructor(message: string, baseRF: BaseRegisterFile, index: number) {
        super(message);
        this.name = `RegisterError on register ${index} of ${baseRF.toString()}`;
    }
}

/**
 * Base register file class
 */
abstract class BaseRegisterFile {
    readonly width: RegisterBitWidth;
    readonly byteWidth: number;
    readonly count: number; 
    readonly endianness: Endianness
    data: Uint8Array;
    view: DataView;
    description: string;
    constructor(_width: RegisterBitWidth, _count: number, 
        _endianness: Endianness="little", _description="regFile") {
        this.width = _width;
        this.count = _count;
        this.endianness = _endianness;
        this.byteWidth = _width / 8;
        this.description = _description;
        if (this.count <= 0 && !Number.isInteger(this.count)) {
            throw new RegisterFileError(`Registerfile size invalid (${this.count})`, this);
        }
        this.data = new Uint8Array(_count * _width / 8);
        this.view = new DataView(this.data.buffer);
    }

    /**
     * Write bytes to a register following 
     * if the value array longer than byteWidth, exception will throw
     * if the value array shorter than byteWidth, the value will be 
     *  extended using signed flag on the MSB based on endianness
     * @param index register index
     * @param value incoming register value in bytes, 
     *              assuming [0] has the lowest byte address in memory
     * @param signed whether to signed extend data
     */
    write(index: number, value: Uint8Array, signed: boolean=false): void {
        let incomingWidth = value.length;
        let offset = index * this.byteWidth;
        // Check index
        if (!this.isValidIndex(index)) {
            throw new RegisterFileError(
                `Incoming write index (${index}) invalid, expecting ${this.getRegRangeString()}`, 
                this);
        }

        // Cases for different incoming byte width
        if (incomingWidth > this.byteWidth) {
            throw new RegisterError(
                `Incoming write width (${incomingWidth}) longer than register width (${this.byteWidth})`,
                this, index);
        } else if (incomingWidth < this.byteWidth) {
            let msb = 0;
            if (this.endianness == "little") {
                msb = (value[value.length - 1] & 0x80) >> 7;
                msb = signed ? msb : 0;
                // Assigning
                let i = 0;
                for (; i < incomingWidth; i++) {
                    this.data[offset + i] = value[i];
                }
                // Extending
                for (; i < this.byteWidth; i++) {
                    this.data[offset + i] = msb == 1 ? 0xFF : 0x0;
                }
            } else {
                msb = (value[0] & 0x80) >> 7;
                msb = signed ? msb : 0;
                // Assigning
                for (let i = 0; i < this.byteWidth - incomingWidth; i++) {
                    this.data[offset + i] = msb == 1 ? 0xFF : 0x0;
                }
                // Extending
                let offset2 = this.byteWidth - incomingWidth;
                for (let i = 0; i < incomingWidth; i++) {
                    this.data[offset + offset2 + i] = value[i];
                }
            }
        } else {
            // Copy into register
            for (let i = 0; i < this.byteWidth; i++) {
                this.data[offset + i] = value[i];
            }
        }
    }

    /**
     * Copy register value within a registerfile, 
     * equivalent of common `mov` instruction
     * 
     * @param dst Destination register index
     * @param src Source register index
     */
    copyRegister(dst: number, src: number): void {
        if (!this.isValidIndex(dst)) {
            throw new RegisterFileError(
                    `Invalid register index (${dst}) on copy dst, expecting ${this.getRegRangeString()}`, this);
        }
        if (!this.isValidIndex(src)) {
            throw new RegisterFileError(
                `Invalid register index (${src}) on copy src, expecting ${this.getRegRangeString()}`, this);
        }
        let dstOffset = dst * this.byteWidth;
        let srcOffset = src * this.byteWidth;
        for (let i = 0; i < this.byteWidth; i++)
            this.data[dstOffset + i] = this.data[srcOffset + i];
    }

    /**
     * Read a register in the registerfile
     * @param index read register index
     * @returns A deep copy of register array
     */
    read(index: number): Uint8Array {
        // Return a deep copy
        if (!this.isValidIndex(index))
            throw new RegisterFileError(
                `Incoming read index (${index}) invalid, expecting ${this.getRegRangeString()}`, 
                this);
        let offset = index * this.byteWidth;
        let arr = new Uint8Array(this.byteWidth);
        for (let i = 0; i < this.byteWidth; i++)
            arr[i] = this.data[offset + i];
        return arr;
    }

    /**
     * Base method to read a register's value
     * 
     * @param T type variable for the read function
     * @param func DataView instance method reading values, for reference, check
     *             https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView 
     * @param index register index
     * @param signed whether to signed extend data
     */
    baseReadValue<T>(func: DataViewReadFunction<T>, index: number): T {
        if (!this.isValidIndex(index))
            throw new RegisterFileError(
                `Incoming read index (${index}) invalid, expecting ${this.getRegRangeString()}`, 
                this);
        let indexOffset = index * this.byteWidth;
        return func.call(this.view, indexOffset, this.endianness == "little");
    }

    /**
     * Base method to write value to a register
     * 
     * @param T type variable for the write function
     * @param func DataView instance method writing values, for reference, check
     *             https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DataView 
     * @param index register index
     * @param value write value
     * @param signed whether to signed extend data
     */
    baseWriteValue<T>(func: DataViewWriteFunction<T>, index: number, value: T): void {
        if (!this.isValidIndex(index))
            throw new RegisterFileError(
                `Incoming writing index (${index}) invalid, expecting ${this.getRegRangeString()}`, 
                this);
        let indexOffset = index * this.byteWidth;
        func.call(this.view, indexOffset, value, this.endianness == "little");
    }

    /**
     * Method to read a register's value, adapt based on registerfile type and bit width
     * 
     * @param index register index
     * @param signed whether to signed extend data
     */
    abstract readValue(index: number, signed: boolean): bigint | number;

    /**
     * Method to write a register's value, adapt based on registerfile type and bit width
     * 
     * @param index register index
     * @param value write value
     * @param signed whether to signed extend data
     */
    abstract writeValue(index: number, value: bigint | number, signed: boolean): void;

    /**
     * Check if an index is valid for this register file
     * @param index Register index
     * @returns true if index is valid
     */
    isValidIndex(index: number): boolean {
        return Number.isInteger(index) && index >= 0 && index < this.count;
    }

    /**
     * Get register range string
     * @returns Register range
     */
    getRegRangeString(): string {
        return `[0, ${this.count - 1}]`;
    }

    toString(): string {
        return `${this.description}${this.getRegRangeString()}`;
    }
}

/**
 * Base integer register file class
 */
class BaseIntRegisterFile extends BaseRegisterFile {
    constructor(_width: RegisterBitWidth, _count: number, 
        _endianness: Endianness="little", _description="BaseIntRegFile") {
        super(_width, _count, _endianness, _description);
    }
    
    writeValue(index: number, value: number | bigint, signed: boolean=false): void {
        if (this.width == 32) {
            if (signed)
                this.baseWriteValue<number>(DataView.prototype.setInt32, index, value as number);
            else
                this.baseWriteValue<number>(DataView.prototype.setUint32, index, value as number);
        } else {
            if (signed)
                this.baseWriteValue<bigint>(DataView.prototype.setBigInt64, index, value as bigint);
            else
                this.baseWriteValue<bigint>(DataView.prototype.setBigUint64, index, value as bigint);
        }
    }

    readValue(index: number, signed: boolean=false): number | bigint {
        let val: number | bigint;
        if (this.width == 32) {
            if (signed)
                val = this.baseReadValue<number>(DataView.prototype.getInt32, index);
            else
                val = this.baseReadValue<number>(DataView.prototype.getUint32, index);
        } else {
            if (signed)
                val = this.baseReadValue<bigint>(DataView.prototype.getBigInt64, index);
            else
                val = this.baseReadValue<bigint>(DataView.prototype.getBigUint64, index);
        }
        return val;
    }
}

class IntRegFile extends BaseIntRegisterFile {
    readonly pcIndex: number;
    constructor(_width: RegisterBitWidth, _count: number, 
        _endianness: Endianness="little", _description="IntRegFile",
        _pcIndex: number=-1) {
        super(_width, _count, _endianness, _description);
        // Default to last register in RF
        if (_pcIndex < 0)
            this.pcIndex = this.count - 1;
        else
            this.pcIndex = _pcIndex;
    }

    /**
     * Set PC by byte array
     * @param value new PC value in bytes
     */
    setPC(value: Uint8Array) {
        this.write(this.pcIndex, value, false);
    }

    /**
     * Get PC in byte array
     * @returns PC value in bytes
     */
    getPC(): Uint8Array {
        return this.read(this.pcIndex);
    }

    /**
     * Set PC value
     * @param value new PC value
     */
    setPCValue(value: bigint) {
        this.writeValue(this.pcIndex, value);
    }

    /**
     * Get PC value
     * @returns PC value
     */
    getPCValue(): number | bigint {
        return this.readValue(this.pcIndex);
    }
}

/**
 * Control status register file
 */
class CSIntRegFile extends BaseIntRegisterFile {
    constructor(_width: RegisterBitWidth, _count: number=4096, 
        _endianness: Endianness="little", _description="CSIntRegFile") {
        super(_width, _count, _endianness, _description);
    }
    // TODO Exception handling
}

/**
 * TODO Floating point register file class
 */