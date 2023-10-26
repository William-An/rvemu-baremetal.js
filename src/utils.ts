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

export type Pair<T1, T2> = [T1, T2];
export type StringPair = Pair<string, string>;
export type BigintPair = Pair<bigint, bigint>;