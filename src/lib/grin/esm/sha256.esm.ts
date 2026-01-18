/**
 * SHA-256 wrapper for MWC wallet compatibility.
 *
 * The MWC wallet code expects a global sha256 object with:
 * - arrayBuffer(data: Uint8Array): ArrayBuffer
 */

import { sha256 as sha256Hash } from 'js-sha256';

/**
 * SHA-256 object compatible with MWC wallet code.
 */
export const sha256 = {
  /**
   * Compute SHA-256 hash and return as ArrayBuffer.
   */
  arrayBuffer(data: Uint8Array | string): ArrayBuffer {
    return sha256Hash.arrayBuffer(data);
  },

  /**
   * Compute SHA-256 hash and return as Uint8Array.
   */
  array(data: Uint8Array | string): Uint8Array {
    return new Uint8Array(sha256Hash.arrayBuffer(data));
  },

  /**
   * Compute SHA-256 hash and return as hex string.
   */
  hex(data: Uint8Array | string): string {
    return sha256Hash.hex(data);
  },
};

export default sha256;
