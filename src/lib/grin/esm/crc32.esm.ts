/**
 * CRC32 wrapper for MWC wallet compatibility.
 *
 * The MWC wallet code expects a global CRC32 object with:
 * - buf(data: Uint8Array): number
 */

import CRC32Lib from 'crc-32';

/**
 * CRC32 object compatible with MWC wallet code.
 */
export const CRC32 = {
  /**
   * Calculate CRC32 of a buffer.
   */
  buf(data: Uint8Array): number {
    return CRC32Lib.buf(data);
  },
};

export default CRC32;
