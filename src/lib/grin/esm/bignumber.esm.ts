/**
 * BigNumber ES module wrapper.
 *
 * Uses the npm bignumber.js package which is CSP-compliant.
 * Adds the toBytes() extension needed by the MWC wallet code.
 */

import BigNumber from 'bignumber.js';

// Type definitions
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
  toBytes(endianness?: number, length?: number): Uint8Array;
}

export type BigNumberValue = BigNumberInstance | string | number | BigNumber;

// Constants for byte conversion
const BIG_ENDIAN = 0;
const LITTLE_ENDIAN = 1;
const ANY_LENGTH = -1;
const BITS_IN_A_BYTE = 8;
const BYTE_MAX_VALUE = Math.pow(2, BITS_IN_A_BYTE) - 1;

// Extend BigNumber prototype with toBytes method
declare module 'bignumber.js' {
  interface BigNumber {
    toBytes(endianness?: number, length?: number): Uint8Array;
  }
}

/**
 * Convert BigNumber to bytes array.
 * Added to BigNumber.prototype for MWC wallet compatibility.
 */
BigNumber.prototype.toBytes = function (
  endianness: number = LITTLE_ENDIAN,
  length: number = ANY_LENGTH
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
  const bytes: number[] = new Array(length === ANY_LENGTH ? 1 : length).fill(0);

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
    } else if (length !== ANY_LENGTH) {
      // Length is constrained
      throw new Error('Insufficient length.');
    } else {
      // Append byte to bytes
      bytes.push(byte);
    }
  }

  // Check if endianness is big endian
  if (endianness === BIG_ENDIAN) {
    // Reverse bytes order
    bytes.reverse();
  }

  return new Uint8Array(bytes);
};

// Add static constants
const ExtendedBigNumber = BigNumber as typeof BigNumber & {
  BIG_ENDIAN: number;
  LITTLE_ENDIAN: number;
  ANY_LENGTH: number;
};

ExtendedBigNumber.BIG_ENDIAN = BIG_ENDIAN;
ExtendedBigNumber.LITTLE_ENDIAN = LITTLE_ENDIAN;
ExtendedBigNumber.ANY_LENGTH = ANY_LENGTH;

export { ExtendedBigNumber as BigNumber };
export default ExtendedBigNumber;
