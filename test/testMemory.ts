import { Memory, MemoryRegionError, NormalMemoryRegion } from "../src/memory";
import { assert, expect, should } from "chai";
import fc, { bigInt } from "fast-check";


/**
 * Test helper
 */

// Address: 0x0 - 0xFFFFFFFFFFFF
let AddressArb = fc.bigUintN(48);
let SmallAddressArb = fc.bigUintN(10);
let InvalidAddressArb = fc.bigUintN(48).map((addr) => -addr);

// Size up to 64KB
let RegionSizeArb = fc.bigUintN(16).filter((n) => n > 0);
let InvalidRegionSizeArb = fc.bigUintN(16).map((n) => -n);

// Regular region (> 32 bytes) to speed up testing
let RegularRegionSizeArb = fc.bigUintN(16).filter((n) => n > 32);
// Small regular region
let SmallRegularRegionSizeArb = fc.bigUintN(12).filter((n) => n > 32);

// Proper NormalMemoryRegion arbitrary
let NormalMemoryRegionArb = (addrArb: fc.Arbitrary<bigint>, sizeArb: fc.Arbitrary<bigint>) => fc.tuple(addrArb, sizeArb).map((args) => new NormalMemoryRegion(args[0], args[1]));

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
 * Test suites
 */
// TODO Memory model test? https://fast-check.dev/docs/advanced/model-based-testing/

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
            try {
                regions[1].merge(regions[0]);
            } catch (MemoryRegionError) {
                return true
            }
            return false;
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
        let regionStart = BigInt(0x10000);
        let regionSize = BigInt(0x40000);
        let region = new NormalMemoryRegion(regionStart, regionSize);
        let address = BigInt(0x0);
        let size = 4;
        expect(() => region.read(address, size)).to.throw(MemoryRegionError);
    });

    it("write out of range should raise error", () => {
        let regionStart = BigInt(0x10000);
        let regionSize = BigInt(0x40000);
        let region = new NormalMemoryRegion(regionStart, regionSize);
        let address = BigInt(0x0);
        let size = 4;
        let payload = new Uint8Array([1, 2, 3, 4]);
        expect(() => region.write(address, size, payload)).to.throw(MemoryRegionError);
    });

    it("invalid start address and size should raise error", () => {
        let prop = fc.property(InvalidAddressArb, InvalidRegionSizeArb, (addr, size) => {
            expect(function() {new NormalMemoryRegion(addr, size)}).to.throw();
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
});