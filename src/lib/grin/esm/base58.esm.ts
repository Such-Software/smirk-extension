/**
 * Base58 encoding/decoding wrapper for MWC wallet compatibility.
 *
 * The MWC wallet code expects a global Base58 object with:
 * - encode(data: Uint8Array): string
 * - decode(str: string): Uint8Array
 * - getChecksum(data: Uint8Array): Uint8Array
 * - CHECKSUM_LENGTH: number
 *
 * Grin slatepacks use Base58Check encoding with a 4-byte checksum.
 */

import bs58 from 'bs58';
import { sha256 as sha256Hash } from 'js-sha256';

/**
 * Compute SHA-256 hash synchronously.
 */
function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(sha256Hash.arrayBuffer(data));
}

/**
 * Compute double SHA-256 hash synchronously.
 */
function doubleSha256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data));
}

/**
 * Base58 class compatible with MWC wallet code.
 */
export class Base58 {
  /** Checksum length in bytes (first 4 bytes of double SHA-256) */
  static readonly CHECKSUM_LENGTH = 4;

  /**
   * Encode data as Base58 string.
   */
  static encode(data: Uint8Array): string {
    return bs58.encode(data);
  }

  /**
   * Decode Base58 string to bytes.
   */
  static decode(str: string): Uint8Array {
    return bs58.decode(str);
  }

  /**
   * Calculate Base58Check checksum (first 4 bytes of double SHA-256).
   */
  static getChecksum(data: Uint8Array): Uint8Array {
    const hash = doubleSha256(data);
    return hash.slice(0, Base58.CHECKSUM_LENGTH);
  }
}

export default Base58;
