/**
 * Grin utility functions for transaction handling and address conversion.
 */

import { getCommon, getSlatepack } from './loader';
import type { GrinSlate } from './types';

/**
 * Get the transaction JSON from a finalized slate for broadcasting.
 *
 * @param slate - The finalized slate (S3)
 * @returns The transaction as a JSON object (for push_transaction API)
 */
export function getTransactionJson(slate: GrinSlate): object {
  if (slate.state !== 'S3') {
    throw new Error('Slate must be finalized (S3) to get transaction');
  }

  // Get the finalized transaction from the slate
  // This returns { body: { inputs, kernels, outputs }, offset }
  return slate.raw.getTransaction();
}

/**
 * Get the transaction hex from a finalized slate for broadcasting.
 *
 * @param slate - The finalized slate (S3)
 * @returns The transaction hex
 */
export function getTransactionHex(slate: GrinSlate): string {
  if (slate.state !== 'S3') {
    throw new Error('Slate must be finalized (S3) to get transaction hex');
  }

  const Common = getCommon();

  // Get the finalized transaction from the slate
  const tx = slate.raw.getTransaction();
  return Common.toHexString(tx.serialize());
}

/**
 * Convert a slatepack address to its Ed25519 public key.
 *
 * @param address - The slatepack address (grin1...)
 * @returns The Ed25519 public key (32 bytes)
 */
export function slatepackAddressToPublicKey(address: string): Uint8Array {
  const Slatepack = getSlatepack();
  return Slatepack.slatepackAddressToPublicKey(address);
}

/**
 * Convert an Ed25519 public key to a slatepack address.
 *
 * @param publicKey - The Ed25519 public key (32 bytes)
 * @returns The slatepack address (grin1...)
 */
export function publicKeyToSlatepackAddress(publicKey: Uint8Array): string {
  const Slatepack = getSlatepack();
  return Slatepack.publicKeyToSlatepackAddress(publicKey);
}
