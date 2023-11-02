import { Memory, MemoryRegionError, NormalMemoryRegion } from "../src/memory";
import { hexify } from "../src/utils"
import { assert, expect, should } from "chai";
import fc, { bigInt } from "fast-check";


/**
 * Test helper
 */

// Address: 0x0 - 0xFFFFFFFFFFFF
let AddressArb = fc.bigUintN(48);
let SmallAddressArb = fc.bigUintN(10);
let InvalidAddressArb = fc.bigUintN(48).map((addr) => -addr);
// Aligned address arb, alignAddr must be power of 2, generated
// address will be multiple of alignAddr
let AlignedAddressArb = (alignAddr: bigint) => AddressArb.filter((addr) => (addr & (alignAddr - 1n)) === 0n);

// Memory related arbitraries
let MemoryStartArb = AlignedAddressArb;
// Memory size needs to be multiple of region size
let MemorySizeArb = (minRegionSize: bigint) => fc.bigUintN(48).filter((s) => (s % minRegionSize === 0n) && (s > minRegionSize));
// Memory default region size, ranges from 256 bytes to 65536 bytes, guaranteed to be power of 2
let MemoryDefaultRegionSizeArb = fc.integer({ min: 8, max: 16 }).map((b) => 2n ** BigInt(b));
// Memory arb
// memory size lower bound given from default region size arb
let MemoryArb = MemoryDefaultRegionSizeArb.chain((defSize) => {
    return fc.tuple(MemoryStartArb(defSize),
        MemorySizeArb(defSize),
        fc.constant(defSize))
        .map((args) => {
            let startAddr = args[0];
            let size = args[1];
            let defaultSize = args[2];
            return new Memory(startAddr, size, defaultSize);
        });
});

// Size up to 64KB
let RegionSizeArb = fc.bigUintN(16).filter((n) => n > 0);
let InvalidRegionSizeArb = fc.bigUintN(16).map((n) => -n);
let AlignedRegionSizeArb = MemoryDefaultRegionSizeArb;

// Regular region (> 32 bytes) to speed up testing
let RegularRegionSizeArb = fc.bigUintN(16).filter((n) => n > 32);
// Small regular region
let SmallRegularRegionSizeArb = fc.bigUintN(12).filter((n) => n > 32);

// Proper NormalMemoryRegion arbitrary
let NormalMemoryRegionArb = (addrArb: fc.Arbitrary<bigint>, sizeArb: fc.Arbitrary<bigint>) => fc.tuple(addrArb, sizeArb).map((args) => new NormalMemoryRegion(args[0], args[1]));
// NormalMemoryRegion arbitrary within address range
let RangedNormalMemoryRegionArb = (addrArb: fc.Arbitrary<bigint>, sizeArb: fc.Arbitrary<bigint>, startAddr: bigint, endAddr: bigint) => NormalMemoryRegionArb(addrArb, sizeArb).filter((region) => region.regionStart >= startAddr && (region.regionStart + region.regionSize) <= endAddr);
// NormalMemoryRegion out of a certain address range
let OutRangedNormalMemoryRegionArb = (addrArb: fc.Arbitrary<bigint>, sizeArb: fc.Arbitrary<bigint>, startAddr: bigint, endAddr: bigint) => NormalMemoryRegionArb(addrArb, sizeArb).filter((region) => region.regionStart < startAddr || (region.regionStart + region.regionSize) > endAddr);

// Random pair
let NormalMemoryRegionPairArb = fc.tuple(NormalMemoryRegionArb(AddressArb, RegionSizeArb), NormalMemoryRegionArb(AddressArb, RegionSizeArb));

// Consecutive NormalMemoryRegions
let ConsecutiveMemoryRegionArb = fc.tuple(AddressArb, RegionSizeArb, RegionSizeArb).map((args) => {
    let startAddr1 = args[0];
    let regionSize1 = args[1];
    let startAddr2 = startAddr1 + regionSize1;
    let regionSize2 = args[2];
    return [new NormalMemoryRegion(startAddr1, regionSize1), new NormalMemoryRegion(startAddr2, regionSize2)];
});

// Inconsecutive NormalMemoryRegions
let InconsecutiveMemoryRegionArb = NormalMemoryRegionPairArb.filter((regions) => {
    let region1 = regions[0];
    let region2 = regions[1];

    return (region1.regionStart + region1.regionSize) != region2.regionStart;
});

// Access arbitrary
let AccessSizeArb = fc.constantFrom(1, 2, 4, 8);
// Not in range access
let OutOfRangeAccessArb = (regionStart: bigint, regionSize: bigint) => {
    // Get out of range address
    return AccessSizeArb.chain((size) => {
        let regionEnd = regionStart + regionSize - BigInt(size);
        let addressArb = AddressArb.filter((addr) => (addr < regionEnd) || (addr > regionEnd));
        return fc.tuple(addressArb, fc.constant(size));
    });
};
// Get aligned access, guaranteed in range
let AlignedAccessArb = (regionStart: bigint, regionSize: bigint) => {
    // Get aligned address
    return AccessSizeArb.chain((size) => {
        let addressArb = fc.bigUint(regionStart + regionSize - BigInt(size))
            .filter((addr) => addr >= regionStart)  // Within range
            .filter((addr) => ((addr) & BigInt(size - 1)) === BigInt(0));   // Aligned
        return fc.tuple(addressArb, fc.constant(size));
    });
};
// Get unaligned access, guaranteed in range
let UnalignedAccessArb = (regionStart: bigint, regionSize: bigint) => {
    // Get unaligned address
    return AccessSizeArb.chain((size) => {
        let addressArb = fc.bigUint(regionStart + regionSize - BigInt(size)).filter((addr) => ((addr) & BigInt(size - 1)) !== BigInt(0));
        return fc.tuple(addressArb, fc.constant(size));
    });
};
// Get write access with fake data
let PayloadArb = (size: number) => fc.uint8Array({ minLength: size, maxLength: size });
let WriteAccessArb = (accessArb: fc.Arbitrary<[bigint, number]>) => {
    return accessArb.chain((access) => {
        let address = access[0];
        let size = access[1];
        return fc.tuple(fc.constant(address), fc.constant(size), PayloadArb(size));
    });
};
// Get read access
let ReadAccessArb = (accessArb: fc.Arbitrary<[bigint, number]>) => accessArb;

/**
 * Model-based test helper
 */
// Model region range, first is start (inclusive), 
// second is end address (exclusive)
type MemoryTestModelRegionRange = [bigint, bigint];
// The model store the valid regions in the memory
type MemoryTestModel = MemoryTestModelRegionRange[];
class MemoryReadCommand implements fc.Command<MemoryTestModel, Memory> {
    readonly addr;
    readonly size;
    constructor(readAccess: [bigint, number]) {
        this.addr = readAccess[0];
        this.size = readAccess[1];
    }

    check(m: Readonly<MemoryTestModel>): boolean {
        let ready = false;
        let accessStart = this.addr;
        let accessEnd = accessStart + BigInt(this.size);
        for (let range of m) {
            let regionStart = range[0];
            let regionEnd = range[1];
            if (accessStart >= regionStart && 
                accessEnd <= regionEnd) {
                ready = true;
                break;
            }
        }

        return ready
    }

    run(m: MemoryTestModel, r: Memory) {
        // Changed real system
        r.read(this.addr, this.size);
        // No changes to model since we only modify
        // region on write()
    }

    toString(): string {
        // Inclusive end address
        let end = this.addr + BigInt(this.size) - 1n;
        return `read[${hexify(this.addr)}-${hexify(end)}]`
    }
}
class MemoryWriteCommand implements fc.Command<MemoryTestModel, Memory> {
    readonly addr;
    readonly size;
    readonly payload;
    constructor(writeAccess: [bigint, number, Uint8Array]) {
        this.addr = writeAccess[0];
        this.size = writeAccess[1];
        this.payload = writeAccess[2];
    }

    check(m: Readonly<MemoryTestModel>): boolean {
        return true;
    }

    run(m: MemoryTestModel, r: Memory) {
        // Changed real system
        r.write(this.addr, this.size, this.payload);
        // Changed model by push the region range
        // if it is not covered in the range list
        let region = r.findRegion(this.addr, this.size);
        let regionStart = region.regionStart;
        let regionEnd = region.regionStart + region.regionSize;
        let range: MemoryTestModelRegionRange = [region.regionStart, region.regionStart + region.regionSize];
        for (let existingRegion of m) {
            let oldRegionStart = existingRegion[0];
            let oldRegionEnd = existingRegion[1];
            if (oldRegionStart <= regionStart && regionEnd >= regionEnd) {
                // This region covered by an existing region
                // range in the model
                return;
            }
        }

        // Not covered, add to list
        m.push(range);
    }

    toString(): string {
        // Inclusive end address
        let end = this.addr + BigInt(this.size) - 1n;
        return `write[${hexify(this.addr)}-${hexify(end)}]`
    }
}

/**
 * Test suites
 */

// Memory class unit test
describe("MemoryUnittest", function () {
    describe("write", function () {
        let memory: Memory;
        beforeEach("", function () {
            memory = new Memory(BigInt(0x0), BigInt(0x1000000), BigInt(2048));
        })

        it("should allocated on write when no memory region presents", function () {
            let payload = new Uint8Array([1, 2, 3, 4]);
            memory.write(BigInt(0), payload.length, payload);
            assert.lengthOf(memory.memoryRegions, 1);
        });
    });
    describe("read", function () {
        let memory: Memory;
        beforeEach("", function () {
            memory = new Memory(BigInt(0x0), BigInt(0x1000000), BigInt(2048));
            memory.addMemoryRegion(new NormalMemoryRegion(BigInt(0x0), memory.defaultMemRegionSize));
        });

        it("should read correct word from memory", function () {
            let payload = new Uint8Array([1, 2, 3, 4]);
            let address = BigInt(0x0);
            let size = payload.length;
            let expect = (new DataView(payload.buffer)).getInt32(0, true);

            // Perform write
            memory.write(address, size, payload);

            // Perform read
            let readResult = memory.read(address, size);
            let actual = (new DataView(readResult.buffer)).getInt32(0, true);

            assert.equal(expect, actual);
        });

        it("should read correct halfword from memory", function () {
            let payload = new Uint8Array([0xBE, 0xFF]);
            let address = BigInt(0x0);
            let size = payload.length;
            let expect = (new DataView(payload.buffer)).getInt16(0, true);

            // Perform write
            memory.write(address, size, payload);

            // Perform read
            let readResult = memory.read(address, size);
            let actual = (new DataView(readResult.buffer)).getInt16(0, true);

            assert.equal(expect, actual);
        });

        it("should read correct byte from memory", function () {
            let payload = new Uint8Array([0xBE]);
            let address = BigInt(0x0);
            let size = payload.length;
            let expect = (new DataView(payload.buffer)).getInt8(0);

            // Perform write
            memory.write(address, size, payload);

            // Perform read
            let readResult = memory.read(address, size);
            let actual = (new DataView(readResult.buffer)).getInt8(0);

            assert.equal(expect, actual);
        });
    });
});

// Memory property test via fast-check
describe("MemoryPropertyTest", function () {
    it("can add normal memory region if within range", function () {
        let prop = fc.property(MemoryArb, fc.gen(), (memory, gen) => {
            let regionSize = memory.defaultMemRegionSize;
            let maxRegionCount = memory.memorySize / regionSize;
            let multiple = gen(fc.nat, {max: Number(maxRegionCount) - 1});
            let startAddr = memory.memoryStart + regionSize * BigInt(multiple);
            let region = new NormalMemoryRegion(startAddr, regionSize);
            
            memory.addMemoryRegion(region);
        });
        fc.assert(prop);
    });

    it("cannot add normal memory region out of specified range", function () {
        let prop = fc.property(MemoryArb, fc.gen(), (memory, gen) => {
            let prop = fc.property(MemoryArb, fc.gen(), (memory, gen) => {
                let alignedAddr = memory.defaultMemRegionSize;
                let inRangeRegion = gen(OutRangedNormalMemoryRegionArb, AlignedAddressArb(alignedAddr), fc.constant(memory.defaultMemRegionSize), memory.memoryStart, memory.memoryStart + memory.memorySize);
                expect(memory.addMemoryRegion(inRangeRegion)).to.throw(MemoryRegionError);
            });
        });
        fc.assert(prop);
    });

    it("can find address within region if added", function () {
        let prop = fc.property(NormalMemoryRegionArb(AlignedAddressArb(2048n), AlignedRegionSizeArb), fc.gen(), (region, gen) => {
            // An inclusive memory space
            let memory = new Memory(0x0n, 0x1000000000000n, 2048n);

            memory.addMemoryRegion(region);
            let access = gen(AlignedAccessArb, region.regionStart, region.regionSize);
            return memory.findRegion(access[0], access[1]) === region;
        });
        fc.assert(prop);
    });

    it("read should get previous written value", function () {
        let prop = fc.property(NormalMemoryRegionArb(AlignedAddressArb(2048n), AlignedRegionSizeArb), fc.gen(), (region, gen) => {
            // An inclusive memory space
            let memory = new Memory(0x0n, 0x1000000000000n, 2048n);
            
            memory.addMemoryRegion(region);
            let write = gen(WriteAccessArb, AlignedAccessArb(region.regionStart, region.regionSize));
            let addr = write[0];
            let size = write[1];
            let payload = write[2];
            
            memory.write(addr, size, payload);

            let result = memory.read(addr, size);
            expect(result).to.eql(payload);
        });
        fc.assert(prop);
    });

    it("write should overwrite data", function () {
        let prop = fc.property(NormalMemoryRegionArb(AlignedAddressArb(2048n), AlignedRegionSizeArb), fc.gen(), (region, gen) => {
            // An inclusive memory space
            let memory = new Memory(0x0n, 0x1000000000000n, 2048n);
            
            memory.addMemoryRegion(region);
            let write = gen(WriteAccessArb, AlignedAccessArb(region.regionStart, region.regionSize));
            let addr = write[0];
            let size = write[1];
            let payload = write[2];
            
            memory.write(addr, size, payload);

            let payload2 = gen(PayloadArb, size);
            memory.write(addr, size, payload2);

            let result = memory.read(addr, size);
            expect(result).to.eql(payload2);
        });
        fc.assert(prop);
    });
});

// Memory model based test via fast-check
describe("MemoryModelBasedTest", function () {
    let memoryStart = 0x0n;
    let memorySize = 0x1000000000000n;
    let defaultMemRegionSize = 2048n;
    const MemoryCommands = [
        ReadAccessArb(AlignedAccessArb(memoryStart, memorySize)).map((access) => new MemoryReadCommand(access)),
        WriteAccessArb(AlignedAccessArb(memoryStart, memorySize)).map((access) => new MemoryWriteCommand(access)),
    ];

    let rwProp = (_size: fc.SizeForArbitrary) => {
        return fc.property(fc.commands(MemoryCommands, { size: _size }), (cmds) => {
            const s = () => ({model: new Array<MemoryTestModelRegionRange>(), real: new Memory(memoryStart, memorySize, defaultMemRegionSize)});
            fc.modelRun(s, cmds);
        });
    }

    it("can handle random R/W sequence (xsmall)", () => {
        let prop = rwProp("small");
        fc.assert(prop);
    });

    it("can handle random R/W sequence (small)", () => {
        let prop = rwProp("small");
        fc.assert(prop);
    });

    it("can handle random R/W sequence (medium)", () => {
        let prop = rwProp("medium");
        fc.assert(prop);
    });

    it("can handle random R/W sequence (large)", () => {
        let prop = rwProp("large");
        fc.assert(prop);
    });

    // TODO This test need longer time to run
    // it("can handle random R/W sequence (xlarge)", () => {
    //     let prop = rwProp("xlarge");
    //     fc.assert(prop);
    // });
});

// Normal memory region property test via fast-check
describe("NormalMemoryRegionPropertyTest", function () {
    it("cannot relocate", () => {
        fc.assert(fc.property(NormalMemoryRegionArb(AddressArb, RegionSizeArb), AddressArb, (region, address) => !region.relocate(address)));
    });

    it("can merge if two regions are consecutive", () => {
        fc.assert(fc.property(ConsecutiveMemoryRegionArb, (regions) => regions[0].merge(regions[1])));
    });

    it("cannot merge if two regions are not consecutive", () => {
        fc.assert(fc.property(InconsecutiveMemoryRegionArb, (regions) => {
            expect(function () { regions[1].merge(regions[0]); }).to.throw(MemoryRegionError);
        }));
    });

    it("cannot shrink", () => {
        fc.assert(fc.property(NormalMemoryRegionArb(AddressArb, RegionSizeArb), RegionSizeArb, (region, size) => !region.shrinkRegion(size)));
    });

    it("can expand", () => {
        fc.assert(fc.property(NormalMemoryRegionArb(AddressArb, RegionSizeArb), RegionSizeArb, (region, size) => region.expandRegion(size)));
    });

    it("read should get previously written value (fixed region)", () => {
        let start = BigInt(0x10000);
        let size = BigInt(0x40000);
        let region = new NormalMemoryRegion(start, size);
        let prop = fc.property(WriteAccessArb(AlignedAccessArb(start, size)), (writeAccess) => {
            let addr = writeAccess[0];
            let size = writeAccess[1];
            let payload = writeAccess[2];

            region.write(addr, size, payload);
            let readResult = region.read(addr, size);
            expect(readResult).to.eql(payload);
        });

        fc.assert(prop);
    });

    it("invalid start address and size should raise error", () => {
        let prop = fc.property(InvalidAddressArb, InvalidRegionSizeArb, (addr, size) => {
            expect(function () { new NormalMemoryRegion(addr, size) }).to.throw(MemoryRegionError);
        });
        fc.assert(prop);
    });

    it("if overlap, cannot higher than", () => {
        let prop = fc.property(
            NormalMemoryRegionPairArb
                .filter((pair) => pair[0].isOverlap(pair[1])),
            (pair) => !pair[0].isHigherThan(pair[1])
        );
        fc.assert(prop);
    });

    it("if overlap, cannot lower than", () => {
        let prop = fc.property(
            NormalMemoryRegionPairArb
                .filter((pair) => pair[0].isOverlap(pair[1])),
            (pair) => !pair[0].isLowerThan(pair[1])
        );
        fc.assert(prop);
    });

    // TODO Can optimize for test run time to create aligned
    // TODO region arbitrary
    it("if other align lower, has to be higher than other", () => {
        let prop = fc.property(
            NormalMemoryRegionPairArb
                .filter((pair) => pair[0].isAlignLower(pair[1])),
            (pair) => pair[0].isHigherThan(pair[1])
        );
        fc.assert(prop);
    });

    it("if other align higher, has to be lower than other", () => {
        let prop = fc.property(
            NormalMemoryRegionPairArb
                .filter((pair) => pair[0].isAlignHigher(pair[1])),
            (pair) => pair[0].isLowerThan(pair[1])
        );
        fc.assert(prop);
    });

    it("read should get previously written value (random region)", () => {
        let prop = fc.property(fc.gen(), (gen) => {
            let region = gen(NormalMemoryRegionArb, AddressArb, RegularRegionSizeArb);
            let writeAccess = gen(WriteAccessArb, AlignedAccessArb(region.regionStart, region.regionSize));

            let addr = writeAccess[0];
            let size = writeAccess[1];
            let payload = writeAccess[2];
            region.write(addr, size, payload);
            let readResult = region.read(addr, size);
            expect(readResult).to.eql(payload);
        });

        fc.assert(prop);
    });

    it("write should overwrite data", () => {
        let prop = fc.property(fc.gen(), (gen) => {
            let region = gen(NormalMemoryRegionArb, AddressArb, RegularRegionSizeArb);
            let writeAccess = gen(WriteAccessArb, AlignedAccessArb(region.regionStart, region.regionSize));

            let addr = writeAccess[0];
            let size = writeAccess[1];

            // First write
            let payload = writeAccess[2];
            region.write(addr, size, payload);

            // Second write
            let payload2 = gen(PayloadArb, size);
            region.write(addr, size, payload2);

            // Test read
            let readResult = region.read(addr, size);

            expect(readResult).to.eql(payload2);
        });

        fc.assert(prop);
    });

    // Fast-check too long for testing if throw or not
    // use sample instead
    it("read out of range should raise error", () => {
        let prop = fc.property(fc.gen(), (gen) => {
            let regionStart = BigInt(0x10000);
            let regionSize = BigInt(0x40000);
            let region = new NormalMemoryRegion(regionStart, regionSize);
            let readAccess = gen(ReadAccessArb, OutOfRangeAccessArb(regionStart, regionSize));
            expect(() => region.read(readAccess[0], readAccess[1])).to.throw(MemoryRegionError);
        });
        fc.assert(prop);
    });

    it("write out of range should raise error", () => {
        let prop = fc.property(fc.gen(), (gen) => {
            let regionStart = BigInt(0x10000);
            let regionSize = BigInt(0x40000);
            let region = new NormalMemoryRegion(regionStart, regionSize);
            let writeAccess = gen(WriteAccessArb, OutOfRangeAccessArb(regionStart, regionSize));
            expect(() => region.write(writeAccess[0], writeAccess[1], writeAccess[2])).to.throw(MemoryRegionError);
        });
        fc.assert(prop);
    });
});