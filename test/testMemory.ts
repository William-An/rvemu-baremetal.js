import { describe } from "node:test";
import { Memory, NormalMemoryRegion } from "../src/memory";
import { assert } from "node:console";

describe("Memory", function () {
    describe("write", function() {
        let memory: Memory;
        beforeEach("", function() {
            memory = new Memory(BigInt(0x0), BigInt(0x1000000), BigInt(2048));
        })

        it("should allocated on write when no memory region presents", function() {
            let payload = new Uint8Array([1, 2, 3, 4]);
            memory.write(BigInt(0), payload.length, payload);
            assert(memory.memoryRegions.length === 1);
        });
    });
    describe("read", function() {
        let memory: Memory;
        beforeEach("", function() {
            memory = new Memory(BigInt(0x0), BigInt(0x1000000), BigInt(2048));
            memory.addMemoryRegion(new NormalMemoryRegion(BigInt(0x0), memory.defaultMemRegionSize));
        });

        it("should read correct value from memory", function() {
            let payload = new Uint8Array([1, 2, 3, 4]);
            let address = BigInt(0x0);
            let size = payload.length;
            let expect = (new DataView(payload.buffer)).getInt32(0, true);

            // Perform write
            memory.write(address, size, payload);

            // Perform read
            let readResult = memory.read(address, size);
            let actual = (new DataView(readResult.buffer)).getInt32(0, true);

            assert(expect === actual);
        });
    });
});