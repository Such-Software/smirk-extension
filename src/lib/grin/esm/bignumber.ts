/**
 * BigNumber ES module wrapper.
 *
 * This wraps the bundled bignumber.js library (v9.1.1) as an ES module
 * and adds the extensions needed by the MWC wallet code.
 *
 * Original: https://github.com/MikeMcl/bignumber.js
 * License: MIT
 */

// The bundled bignumber.js sets globalThis.BigNumber
// We need to load it first, then export it
// @ts-ignore - loading the bundled version
import '../bignumber.js-9.1.1.js';

// Get BigNumber from global scope (set by the bundled file)
const BigNumber = (globalThis as any).BigNumber as BigNumberConstructor;

// Type definitions for BigNumber
export interface BigNumberInstance {
  toString(base?: number): string;
  toNumber(): number;
  toFixed(dp?: number, rm?: number): string;
  isNaN(): boolean;
  isFinite(): boolean;
  isNegative(): boolean;
  isPositive(): boolean;
  isZero(): boolean;
  isInteger(): boolean;
  isGreaterThan(n: BigNumberValue): boolean;
  isGreaterThanOrEqualTo(n: BigNumberValue): boolean;
  isLessThan(n: BigNumberValue): boolean;
  isLessThanOrEqualTo(n: BigNumberValue): boolean;
  isEqualTo(n: BigNumberValue): boolean;
  plus(n: BigNumberValue): BigNumberInstance;
  minus(n: BigNumberValue): BigNumberInstance;
  multipliedBy(n: BigNumberValue): BigNumberInstance;
  dividedBy(n: BigNumberValue): BigNumberInstance;
  dividedToIntegerBy(n: BigNumberValue): BigNumberInstance;
  modulo(n: BigNumberValue): BigNumberInstance;
  negated(): BigNumberInstance;
  absoluteValue(): BigNumberInstance;
  // Extension added by MWC wallet
  toBytes(endianness?: number, length?: number): Uint8Array;
}

export type BigNumberValue = BigNumberInstance | string | number;

export interface BigNumberConstructor {
  new (n: BigNumberValue): BigNumberInstance;
  (n: BigNumberValue): BigNumberInstance;
  BIG_ENDIAN: number;
  LITTLE_ENDIAN: number;
  ANY_LENGTH: number;
  isBigNumber(value: any): value is BigNumberInstance;
}

// Add constants for byte conversion (from common.js)
BigNumber.BIG_ENDIAN = 0;
BigNumber.LITTLE_ENDIAN = 1;
BigNumber.ANY_LENGTH = -1;

// Bits in a byte constant
const BITS_IN_A_BYTE = 8;
const BYTE_MAX_VALUE = Math.pow(2, BITS_IN_A_BYTE) - 1;

/**
 * Convert BigNumber to bytes array.
 * Added to BigNumber.prototype by MWC wallet.
 *
 * @param endianness - BigNumber.BIG_ENDIAN or BigNumber.LITTLE_ENDIAN
 * @param length - Fixed length or BigNumber.ANY_LENGTH
 * @returns Uint8Array of bytes
 */
BigNumber.prototype.toBytes = function(
  endianness: number = BigNumber.LITTLE_ENDIAN,
  length: number = BigNumber.ANY_LENGTH
): Uint8Array {
  // Check if number isn't supported
  if (
    this.isFinite() === false ||
    this.isNaN() === true ||
    this.isNegative() === true ||
    this.isInteger() === false
  ) {
    throw new Error('Unsupported number.');
  }

  // Create bytes array
  const bytes: number[] = new Array(length === BigNumber.ANY_LENGTH ? 1 : length).fill(0);

  // Make number a whole number
  let temp = this.dividedToIntegerBy(1);

  // Go through all bytes in the whole number
  for (let i = 0; temp.isGreaterThan(0); ++i) {
    // Get byte from the whole number
    const byte = temp.modulo(BYTE_MAX_VALUE + 1).toNumber();

    // Remove byte from the whole number
    temp = temp.dividedToIntegerBy(BYTE_MAX_VALUE + 1);

    // Check if space exists in bytes for the byte
    if (i < bytes.length) {
      // Set byte in bytes
      bytes[i] = byte;
    } else if (length !== BigNumber.ANY_LENGTH) {
      // Length is constrained
      throw new Error('Insufficient length.');
    } else {
      // Append byte to bytes
      bytes.push(byte);
    }
  }

  // Check if endianness is big endian
  if (endianness === BigNumber.BIG_ENDIAN) {
    // Reverse bytes order
    bytes.reverse();
  }

  return new Uint8Array(bytes);
};

export { BigNumber };
export default BigNumber;
