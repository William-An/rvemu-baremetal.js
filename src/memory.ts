/**
 * Memory system for the RISCV emulator
 */

import { hexify, BigintPair } from "./utils"

type Endianness = "big" | "little";

/**
 * Base memory exception class
 */
class BaseMemoryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BaseMemoryError";
    }
}

class MemoryError extends BaseMemoryError {
    constructor(message: string) {
        super(message);
        this.name = "MemoryError";
    }
}

class MemoryRegionError extends BaseMemoryError {
    constructor(message: string) {
        super(message);
        this.name = "MemoryRegionError";
    }
}

class Memory {
    // BaseMemoryRegion list sorted by address in incremental way
    memoryRegions: Array<BaseMemoryRegion>;
    // Default memory region to allocate on a write to location
    // not in the list
    defaultMemRegionSize: bigint = BigInt(2048);
    // Memory start address
    memoryStart: bigint;
    // Maximum memory size in bytes
    memorySize: bigint;

    constructor(_memStart: bigint, _memSize: bigint, _defaultSize: bigint) {
        this.memoryRegions = Array<BaseMemoryRegion>(0);
        this.memoryStart = _memStart;
        this.memorySize = _memSize;
        this.defaultMemRegionSize = _defaultSize;
    }

    /**
     * Add a memory region to the region list.
     * Region has to be aligned to the defaultMemRegionSize, else error will be thrown.
     * If the incoming region collides with existing regions in the list, throw error.
     *      since the incoming region and existing regions might have contents
     *      on overlapping addresses.
     * If no collision and no merging opportunity, we insert the incoming region
     *      at sorted position according to its start address 
     * @param region Incoming region to be added
     * @throws MemoryRegionError
     */
    addMemoryRegion(region: BaseMemoryRegion): void {
        // Check if the region is within bound of memory start and size
        if (!this.isRegionValid(region)) {
            // If invalid region
            let regionEnd = region.regionStart + region.regionSize - BigInt(1);
            throw new MemoryRegionError(`Invalid memory region [${hexify(region.regionStart)}, ${hexify(regionEnd)}] `
                + `for memory [${hexify(this.memoryStart)}, ${hexify(this.memoryStart + this.memorySize - BigInt(1))}]`);
        }

        // Perform insertion 
        if (this.memoryRegions.length == 0) {
            // Empty list, just push it
            this.memoryRegions.push(region);
        } else {
            // Non-empty list, need to insert the region at the correct location
            // also handle collision problem

            // First check if there is any collision
            // If collision, throw error
            // Then check if can merge
            // Finally do the insertion at correct location
            let regionStartAddr = region.regionStart;
            let index;
            for (index = 0; index < this.memoryRegions.length; index++) {
                let currentRegion = this.memoryRegions[index];
                if (currentRegion.isOverlap(region)) {
                    // Overlap occurs, cannot merge, throw error
                    let currRangeStr = currentRegion.getRegionRangeString();
                    let incomingRangeStr = region.getRegionRangeString();
                    throw new MemoryRegionError(`Overlapping regions: existing: ${currRangeStr} `
                        + `incoming: ${incomingRangeStr}`)
                } else if (currentRegion.isAlignLower(region)) {
                    // Two regions align at currentRegion.regionStart, merge
                    // incoming with the currentRegion
                    // 0x0: |--------------------------->
                    //          [region][currentRegion]
                    // No need to check for collision with previous region of currentRegion
                    // as it was done in prior cycle
                    if (region.merge(currentRegion)) {
                        // Successful merge, we are done
                        return;
                    } else {
                        // Unable to merge, we just insert it
                        break;
                    }
                } else if (currentRegion.isHigherThan(region)) {
                    // If currentRegion is of higher memory address than incoming region
                    // we should stop seeking for possible merging opportunity and insert
                    // incoming region directly to memory region list
                    break;
                }
            }

            // No collision, just insert the region to top memory map
            // to the right location
            this.memoryRegions.splice(index, 0, region);
        }
    }

    /**
     * Perform read of memory, expecting the address to be presented
     * in the memory, else will raise error.
     * 
     * Does not support cross region read
     * @param address Read address
     * @param size Read size
     * @returns Read data payload
     * @throws MemoryError
     */
    read(address: bigint, size: number): Uint8Array {
        if (!this.isAccessAligned(address, size))
            throw new MemoryError(`Not aligned read of ${hexify(address)} with width ${size}`);
        let region = this.findRegion(address, size);
        return region.read(address, size);
    }

    /**
     * Perform write of memory.
     * Memory is write-allocated, meaning it will automatically adjust memory
     * region or add new normal memory region to suit a write address
     * 
     * Does not support cross region write
     * @param address Write address
     * @param size Write size
     * @param data Write data payload
     * @throws MemoryError | MemoryRegionError
     */
    write(address: bigint, size: number, data: Uint8Array): void {
        if (!this.isAccessAligned(address, size))
            throw new MemoryError(`Not aligned write of ${hexify(address)} with width ${size}`);
        try {
            let region = this.findRegion(address, size);
            region.write(address, size, data);
        } catch (MemoryRegionError) {
            let regionAlignedAddress = address & (this.defaultMemRegionSize - BigInt(1));
            if (this.memoryRegions.length == 0) {
                // Empty list case, add a new normal region to it
                let region = new NormalMemoryRegion(regionAlignedAddress, this.defaultMemRegionSize);
                region.write(address, size, data);
                this.addMemoryRegion(region);
            } else {
                // Non-empty list, find the closest region
                // and see if we can enlarge it or add a new one instead

                // Find closest region from address to region end address
                let closestRegion: BaseMemoryRegion | undefined = undefined;
                let minDistance = this.defaultMemRegionSize;
                for(const region of this.memoryRegions) {
                    if (region.isAddressHigher(address)) {
                        let regionEnd = region.regionStart + region.regionSize - BigInt(1);
                        let distance = address - regionEnd;
                        if (distance < minDistance) {
                            closestRegion = region;
                            minDistance = distance;
                        }
                    }
                }

                // Check for closest region result
                if (closestRegion == undefined) {
                    // Could not find a region that has it end address
                    // within defaultMemRegionSize distance to the access address
                    // Insert a new region and merge with upper region in case
                    // of collision
                    let newRegionEnd = regionAlignedAddress + this.defaultMemRegionSize;
                    try {
                        // Poke to see if the new region end was in the one of the regions
                        let region = this.findRegion(newRegionEnd, 1);

                        // Create new region at boundary of the found region
                        newRegionEnd = region.regionStart;
                        let newRegionSize = region.regionStart - regionAlignedAddress;
                        let newRegion = new NormalMemoryRegion(regionAlignedAddress, newRegionSize);

                        // Perform data write
                        newRegion.write(address, size, data);
                        if (region.mergeable) {
                            // Found region mergeable, merge with new region
                            newRegion.merge(region);
                            
                            // Replace region with newRegion in the list
                            let index = this.memoryRegions.indexOf(region);
                            this.memoryRegions[index] = newRegion;
                        } else {
                            // Upper region not mergeable, just insert the newRegion
                            this.addMemoryRegion(newRegion);
                        }
                    } catch (MemoryError) {
                        // No mergeable/aligned region found in list, just create a new one
                        let newRegion = new NormalMemoryRegion(regionAlignedAddress, this.defaultMemRegionSize);
                        newRegion.write(address, size, data);
                        this.addMemoryRegion(newRegion);
                    }
                } else {
                    // Has a close region, perform resizing
                    if (closestRegion.resizable) {
                        let newRegionEnd = regionAlignedAddress + this.defaultMemRegionSize;
                        let newRegionSize = newRegionEnd - closestRegion.regionStart;
                        closestRegion.resize(newRegionSize);
                        closestRegion.write(address, size, data);
                    } else {
                        // Unresizable region lies on the boundary,
                        // in order to keep memory regionally aligned, we give up.
                        throw new MemoryError(`A unresizable region(${closestRegion.getRegionRangeString()}) lies on the defaultMemRegionSize`
                            + `(${hexify(this.defaultMemRegionSize)}) boundary, unable to perform write of ${hexify(address)} of size ${size}.`);
                    }
                }
            }
        }
    }

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
     * Return the region corresponding to the access.
     * @param address Address of access
     * @param size Access size
     * @returns memory region of access
     * @throws MemoryError if region cannot be found
     */
    findRegion(address: bigint, size: number): BaseMemoryRegion {
        for(const region of this.memoryRegions) {
            if (region.isValidAccess(address, size)) {
                return region;
            }
        }
        let endAddress = address + BigInt(size - 1);
        throw new MemoryRegionError(`Unable to find ${hexify(address)}-${hexify(endAddress)} in memory`);
    }

    /**
     * Check if a region can be inserted to memory
     * @param region Region to be inserted to memory
     * @returns true if the region can be inserted
     */
    isRegionValid(region: BaseMemoryRegion): boolean {
        let regionAddressRangeValid = !((region.regionStart < this.memorySize) || 
                                        (region.regionSize > this.memorySize));
        let defaultSizeMask = this.defaultMemRegionSize - BigInt(1);
        let regionAlignedDefaultSize = (region.regionStart & defaultSizeMask) === BigInt(0);
        return regionAddressRangeValid && regionAlignedDefaultSize;
    }
    

    /**
     * Check if an access is aligned with access size and access size
     * if of power of 2.
     * @param address Access address
     * @param size Access size
     * @returns true if access is aligned and size if of power of 2
     */
    isAccessAligned(address: bigint, size: number): boolean {
        let isSizePowerOf2 = (size != 0) && !(size & (size - 1))
        let sizeMask = BigInt(size - 1);
        let isAddressAlignedSize = (address & sizeMask) === BigInt(0);
        return isSizePowerOf2 && isAddressAlignedSize;
    }

    /**
     * Print regions and their ranges
     * @returns region string
     */
    printRegions(): string {
        let res = "";
        for (let index = 0; index < this.memoryRegions.length; index++) {
            const region = this.memoryRegions[index];
            res += `[${index}]: ${region.getRegionRangeString()}\n`;
        }
        return res;
    }
}

/**
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
            throw new MemoryRegionError(`Invalid memory region start address (${_start}) or size (${_size})!`);
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
                let thisRangeStr = this.getRegionRangeString();
                let otherRangeStr = other.getRegionRangeString();
                throw new MemoryRegionError(`Unable to merge region1: ${thisRangeStr} `
                                          + `with region2: ${otherRangeStr}`);
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
     * Test if this region is of a lower address than the given other region
     * @param other Other region
     * @returns true if this region starts at lower address than the other region
     */
    isLowerThan(other: BaseMemoryRegion): boolean {
        // This regionEnd is non-inclusive
        let this_regionEnd = this.regionStart + this.regionSize;
        return this_regionEnd <= other.regionStart;
    }

    /**
     * Test if an incoming address is lower than this region
     * @param address incoming address
     * @returns true if incoming address is lower than this region start address
     */
    isAddressLower(address: bigint): boolean {
        return address < this.regionStart;
    }

    /**
     * Test if this region is of a higher address than the given other region
     * @param other Other region
     * @returns true if this region ends at higher address than the other region
     */
    isHigherThan(other: BaseMemoryRegion): boolean {
        let other_regionEnd = other.regionStart + other.regionSize;
        return this.regionStart >= other_regionEnd;
    }

    /**
     * Test if an incoming address is higher than this region
     * @param address incoming address
     * @returns true if incoming address is higher than this region end address
     */
    isAddressHigher(address: bigint): boolean {
        return address >= (this.regionStart + this.regionSize);
    }

    /**
     * Test if two regions align at this.regionStart address
     * @param other Other region
     * @returns true if other region ends right at this region starts
     */
    isAlignLower(other: BaseMemoryRegion): boolean {
        return this.regionStart == (other.regionStart + other.regionSize);
    }

    /**
     * Test if two regions align at other.regionStart address
     * @param other Other region
     * @returns true if other region starts right at this region ends
     */
    isAlignHigher(other: BaseMemoryRegion): boolean {
        return other.isAlignLower(this);
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

    /**
     * Get region range but in hexstring
     * @returns Hexstring for region start and end address
     */
    getRegionRangeString(): string {
        let pair = this.getRegionRange().map(element => {
            return hexify(element);
        });

        return `[${pair[0]}, ${pair[1]}]`
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
            throw new MemoryRegionError(`Read address out of bound, `
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
            throw new MemoryRegionError(`Write address out of bound, `
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