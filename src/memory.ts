/**
 * Memory system for the RISCV emulator
 */

import { hexify } from "./utils"

class Memory {
    // TODO What data structure to use?
    // TODO Also need to support MMIO
}

type Endianness = "big" | "little";
type Pair<T1, T2> = [T1, T2];
type StringPair = Pair<string, string>;
type BigintPair = Pair<bigint, bigint>;

/**
 * TODO Can have normal memory region and MMIO mem region?
 * TODO Permission flags? Probably don't want to touch as we are on baremetal
 */
abstract class BaseMemoryRegion {
    // Region start address
    regionStart: bigint;
    // Region size
    regionSize: bigint;
    // Whether can resize this region
    resizable: boolean;
    // Whether can relocate the memory region with a different start address
    relocatable: boolean;
    // Whether can be merged with another region
    mergeable: boolean;

    constructor(_start: bigint, _size: bigint, _resizable: boolean, 
                _relocatable: boolean, _mergeable: boolean) {
        if (_start < 0 || _size <= 0) {
            throw new BaseMemoryError(`Invalid memory region start address (${_start}) or size (${_size})!`);
        }
        this.regionStart = _start;
        this.regionSize = _size;
        this.resizable = _resizable;
        this.relocatable = _relocatable;
        this.mergeable = _mergeable;
    }

    /**
     * Read data from the memory region without any sign extension.
     * @param address Address of the data
     * @param size data size
     * @returns A uint8 array with arr[0] at address
     *          arr[1] at address + 1, etc. 
     *          
     *          Memory is endianness agnostic. Core should
     *          Prepare the data according to its endianness.
     */
    abstract read(address: bigint, size: number): Uint8Array;

    /**
     * Write data to the memory region without any sign extension
     * @param address Address to store the data
     * @param size data size
     * @param data data content, with data[0] being written at address
     *             and data[1] at address + 1, etc.
     * 
     *             Memory is endianness agnostic. Core should
     *             Prepare the data according to its endianness.
     */
    abstract write(address: bigint, size: number, data: Uint8Array): void;

    readByte(address: bigint): Uint8Array {
        return this.read(address, 1);
    }

    readHalfWord(address: bigint): Uint8Array {
        return this.read(address, 2);
    }

    readWord(address: bigint): Uint8Array {
        return this.read(address, 4);
    }

    readDoubleWord(address: bigint): Uint8Array {
        return this.read(address, 8);
    }

    writeByte(address: bigint, data: Uint8Array): void {
        this.write(address, 1, data);
    }

    writeHalfWord(address: bigint, data: Uint8Array): void {
        this.write(address, 2, data);
    }

    writeWord(address: bigint, data: Uint8Array): void {
        this.write(address, 4, data);
    }

    writeDoubleWord(address: bigint, data: Uint8Array): void {
        this.write(address, 8, data);
    }

    /**
     * Resize the memory region and preserve the memory content
     * Resize always happens at the end of the region (start address fixed)
     * @param newSize New size to be changed to
     * @returns true if resize is successful
     */
    abstract resize(newSize: bigint): boolean

    /**
     * Increment memory region size
     * @param increment Bytes to increase
     * @returns true if expansion is successful
     */
    expandRegion(increment: bigint): boolean {
        return this.resize(this.regionSize + increment);
    }

    /**
     * Decrement memory region size
     * @param decrement Bytes to decrease
     * @returns true if shrinking is successful
     */
    shrinkRegion(decrement: bigint): boolean {
        return this.resize(this.regionSize - decrement);
    }

    /**
     * Relocate the memory region to a different starting address
     * No checking is performed with other regions
     * @param newStartAddress New memory region start address
     * @returns true if relocation can be done
     */
    relocate(newStartAddress: bigint): boolean {
        if (!this.relocatable)
            return false;
        else {
            this.regionStart = newStartAddress;
            return true;
        }
    }

    /**
     * Try to merge this region with another one.
     * Merging will put `other` right at the end of this region
     *  with resizing if needed.
     * Caller needs to deal with the other region once
     * merge is done (i.e. delete it or free it)
     * @param other Other memory region to be merged
     * @returns true if merged is successful
     */
    merge(other: BaseMemoryRegion): boolean {
        if (!this.mergeable || !other.mergeable)
            return false;
        else {
            let otherData = other.dumpRegion();
            let isSuccessful = this._mergeHelper(otherData);
            if (!isSuccessful) {
                let thisRange = this.getRegionRange();
                let otherRange = other.getRegionRange();
                let thisRangeStr = thisRange.map(element => {
                    return hexify(element);
                });
                let otherRangeStr = otherRange.map(element => {
                    return hexify(element);
                });
                throw new BaseMemoryError(`Unable to merge region1[${thisRangeStr[0]}, ${thisRangeStr[1]}] `
                                        + `with region2[${otherRangeStr[0]}, ${otherRangeStr[1]}]`);
            }
            return true;
        }
    }

    /**
     * Merge with other region data
     * @param otherData Other region data in buffer view
     * @returns true if merge is successful
     */
    abstract _mergeHelper(otherData: Buffer): boolean;

    /**
     * Dump the entire region content as a buffer
     * @returns region content buffer
     */
    abstract dumpRegion(): Buffer;

    /**
     * Test if this region overlaps with another memory region
     * @param other Other memory region
     * @returns true if two regions overlap
     */
    isOverlap(other: BaseMemoryRegion): boolean {
        let this_regionStart = this.regionStart;
        let this_regionEnd = this.regionStart + this.regionSize;
        let other_regionStart = other.regionStart;
        let other_regionEnd = other.regionStart + other.regionSize;
        return ((this_regionStart < other_regionEnd) && (this_regionStart >= other_regionStart)) ||
               ((this_regionEnd <= other_regionEnd) && (this_regionEnd > other_regionStart))     ||
               ((other_regionStart < this_regionEnd) && (other_regionStart >= this_regionStart)) ||
               ((other_regionEnd <= this_regionEnd) && (other_regionEnd > this_regionStart));
    }

    /**
     * Check if an access is within range
     * @param address Access start address
     * @param size Access byte size
     * @returns true if valid
     */
    isValidAccess(address: bigint, size: number): boolean {
        let accessStart = address - this.regionStart;
        let accessEnd = accessStart + BigInt(size);
        let regionEnd = this.regionStart + this.regionSize - BigInt(1);
        return !(accessStart < 0 || accessEnd < 0 || accessEnd >= this.regionSize);
    }

    /**
     * Get region range pair
     * @returns Region start and end address
     */
    getRegionRange(): BigintPair {
        let start = this.regionStart;
        let end = this.regionStart + this.regionSize - BigInt(1);
        return [start, end];
    }
}

/**
 * Base memory exception class
 */
class BaseMemoryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MemoryError";
    }
}

/**
 * Normal memory, just like RAM
 */
class NormalMemoryRegion extends BaseMemoryRegion {
    memBackend: Buffer;
    constructor(_start: bigint, _size: bigint) {
        // Normal memory can extend itself if needed
        // to prevent segmented regions
        // It cannot be relocate
        // It can be merged with other region
        super(_start, _size, true, false, true);
        this.memBackend = Buffer.alloc(Number(_size));
    }

    read(address: bigint, size: number): Uint8Array {
        if (!this.isValidAccess(address, size)) {
            let regionEnd = this.regionStart + this.regionSize - BigInt(1);
            throw new BaseMemoryError(`Read address out of bound, `
                + `expecting within [${hexify(this.regionStart)}, ${hexify(regionEnd)}] `
                + `but got ${hexify(address)}-${hexify(address + BigInt(size))}`);
        }

        // Get a copy of the data
        let arr = new Uint8Array(size);
        let offset = Number(address - this.regionStart);
        this.memBackend.copy(arr, 0, offset, offset + size);

        return arr;
    }

    write(address: bigint, size: number, data: Uint8Array): void {
        if (!this.isValidAccess(address, size)) {
            let regionEnd = this.regionStart + this.regionSize - BigInt(1);
            throw new BaseMemoryError(`Write address out of bound, `
                + `expecting within [${hexify(this.regionStart)}, ${hexify(regionEnd)}] `
                + `but got ${hexify(address)}-${hexify(address + BigInt(size))}`);
        }

        // Store into buffer
        let offset = Number(address - this.regionStart);
        this.memBackend.fill(data, offset, offset + size);
    }


    resize(newSize: bigint): boolean {
        // Can't really shrink memory or go negative
        if (newSize < 0 || newSize < this.regionSize)
            return false;
        else {
            // Enlarge memory region
            let newBuffer = Buffer.alloc(Number(newSize));
            this.memBackend.copy(newBuffer);
            this.memBackend = newBuffer;
            this.regionSize = newSize;
            return true;
        }
    }


    _mergeHelper(otherData: Buffer): boolean {
        this.memBackend = Buffer.concat([this.memBackend, otherData]);
        this.regionSize = BigInt(this.memBackend.length);
        return true;
    }

    dumpRegion(): Buffer {
        // Get a new copy to prevent changes
        return Buffer.from(this.memBackend);
    }
}

/**
 * MMIO Device should inherit this class to implement their read/write
 * behavior
 */
abstract class BaseMMIOMemoryRegion extends BaseMemoryRegion {
    // MMIO Device name
    name: string;

    constructor(_start: bigint, _size: bigint, _name: string) {
        // MMIO device should have fixed memory range
        // as they don't need to grow size dynamically when
        // executing instructions
        super(_start, _size, false, false, false);
        this.name = _name;
    }

    resize(newSize: bigint): boolean {
        return false;
    }

    _mergeHelper(otherData: Buffer): boolean {
        return false;
    }
}