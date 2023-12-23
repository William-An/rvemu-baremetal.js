/**
 * Some help functions
 */

/**
 * Get hex string of a numebr
 * @param input Input number
 * @returns Hex string
 */
export function hexify(input: bigint | number): string {
    return `0x${input.toString(16)}`;
}

/**
 * Extract a bit slice of a number
 * @param value number
 * @param start start bit pos, inclusive
 * @param end end bit pos, inclusive
 * @returns number slice
 */
export function getNumberBitAt(value: number, start: number, end: number): number {
    let length = end + 1 - start;
    return (value >>> start) & (0xFFFFFFFF >>> (32 - length));
}

/**
 * Types
 */
export type Pair<T1, T2> = [T1, T2];
export type StringPair = Pair<string, string>;
export type BigintPair = Pair<bigint, bigint>;
export type Endianness = "big" | "little";