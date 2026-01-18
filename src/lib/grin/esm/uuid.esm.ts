/**
 * UUID wrapper for MWC wallet compatibility.
 *
 * The MWC wallet code expects a global Uuid class with:
 * - new Uuid(serialized: string)
 * - static randomSerializedUuid(): string
 * - static serializeData(bytes: Uint8Array): string
 * - static BYTE_LENGTH: number (16)
 */

import { v4 as uuidv4, stringify as uuidStringify, parse as uuidParse } from 'uuid';

/**
 * Uuid class compatible with MWC wallet code.
 */
export class Uuid {
  /** UUID byte length */
  static readonly BYTE_LENGTH = 16;

  /** The serialized UUID string */
  private value: string;

  /**
   * Create a UUID from a serialized string.
   */
  constructor(serialized: string) {
    this.value = serialized;
  }

  /**
   * Generate a random UUID and return as serialized string.
   */
  static randomSerializedUuid(): string {
    return uuidv4();
  }

  /**
   * Serialize UUID bytes to string format.
   */
  static serializeData(bytes: Uint8Array): string {
    return uuidStringify(bytes);
  }

  /**
   * Parse a UUID string to bytes.
   */
  static parseData(str: string): Uint8Array {
    return new Uint8Array(uuidParse(str));
  }

  /**
   * Get the UUID as a string.
   */
  toString(): string {
    return this.value;
  }

  /**
   * Get the UUID bytes.
   */
  toBytes(): Uint8Array {
    return Uuid.parseData(this.value);
  }

  /**
   * Get the UUID bytes (alias for MWC wallet compatibility).
   */
  getData(): Uint8Array {
    return Uuid.parseData(this.value);
  }

  /**
   * Get the serialized UUID value.
   */
  getValue(): string {
    return this.value;
  }

  /**
   * Get the serialized UUID value (alias for compatibility).
   */
  serialize(): string {
    return this.value;
  }

  /**
   * Check if this is a random UUID (version 4).
   * UUID version is stored in the 13th character (version nibble).
   * For v4 random UUIDs, this is '4'.
   * Format: xxxxxxxx-xxxx-Vxxx-xxxx-xxxxxxxxxxxx where V is version.
   */
  isRandom(): boolean {
    // UUID format: 8-4-4-4-12 = 36 chars
    // Version is at position 14 (0-indexed), which is the first char after second hyphen
    // e.g., "1b63d29e-a3af-45f0-9037-388ae4f64a7a"
    //                      ^-- version '4' at index 14
    if (this.value.length !== 36) {
      return false;
    }
    const version = this.value.charAt(14);
    return version === '4';
  }
}

export default Uuid;
