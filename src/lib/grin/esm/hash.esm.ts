/**
 * Hash wrapper for MWC wallet compatibility.
 *
 * The MWC wallet code expects a global Hash class with:
 * - new Hash(data: Uint8Array[]) - constructs hash from array of byte arrays
 * - serialize(): string - returns hex string of hash
 * - compare(other: Hash): number - compares two hashes (-1, 0, 1)
 */

// Hash length used by Grin (Blake2b 256-bit)
const HASH_LENGTH = 32;

/**
 * Hash class compatible with MWC wallet code.
 * Hashes data using Blake2b and provides comparison methods.
 */
export class Hash {
  /** The hash bytes */
  private hashBytes: Uint8Array;

  /**
   * Create a Hash from an array of byte arrays.
   * Concatenates all arrays and hashes with Blake2b.
   */
  constructor(data: Uint8Array[]) {
    // Concatenate all byte arrays
    const totalLength = data.reduce((sum, arr) => sum + arr.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of data) {
      combined.set(arr, offset);
      offset += arr.length;
    }

    // Hash with Blake2b (32 bytes = 256 bits)
    // Blake2b is available globally from the MWC library
    const result = (globalThis as any).Blake2b.compute(
      HASH_LENGTH,
      combined,
      new Uint8Array([])
    );

    if (result === (globalThis as any).Blake2b.OPERATION_FAILED) {
      throw new Error('Hash computation failed');
    }

    this.hashBytes = result;
  }

  /**
   * Serialize the hash to a hex string.
   */
  serialize(): string {
    return (globalThis as any).Common.toHexString(this.hashBytes);
  }

  /**
   * Get the raw hash bytes.
   */
  getBytes(): Uint8Array {
    return this.hashBytes;
  }

  /**
   * Compare this hash to another hash.
   * Returns:
   *   Common.SORT_LESS_THAN (-1) if this < other
   *   Common.SORT_EQUAL (0) if this == other
   *   Common.SORT_GREATER_THAN (1) if this > other
   */
  compare(other: Hash): number {
    const Common = (globalThis as any).Common;

    // Compare byte by byte
    for (let i = 0; i < this.hashBytes.length; i++) {
      if (this.hashBytes[i] < other.hashBytes[i]) {
        return Common.SORT_LESS_THAN;
      }
      if (this.hashBytes[i] > other.hashBytes[i]) {
        return Common.SORT_GREATER_THAN;
      }
    }

    return Common.SORT_EQUAL;
  }
}

export default Hash;
