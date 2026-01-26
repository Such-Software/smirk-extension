/**
 * Grin Voucher Implementation for Social Tips
 *
 * Grin uses Mimblewimble's interactive transaction model where both sender
 * and receiver must participate in building a transaction. This makes
 * traditional "send to address" tips impossible.
 *
 * The voucher model solves this by:
 * 1. Creating a funded output that can be spent by whoever knows the blinding factor
 * 2. Storing the blinding factor encrypted with the recipient's public key
 * 3. Allowing the recipient to sweep the funds using a self-signed transaction
 *
 * Key insight: In Grin, "ownership" of an output is determined by knowing
 * its blinding factor. If you have the blinding factor, you can spend it.
 *
 * Voucher Creation Flow:
 * ======================
 * 1. Sender creates a normal transaction sending to themselves
 *    - Uses existing handleGrinCreateSend flow
 *    - Creates an output with commitment = amount*H + blind*G
 *
 * 2. After tx confirms, extract the output details:
 *    - commitment (public - identifies the UTXO)
 *    - proof (public - range proof)
 *    - amount (public - for verification)
 *    - blinding_factor (SECRET - proves ownership)
 *    - n_child (for derivation reference)
 *
 * 3. Create voucher data structure:
 *    - Encrypt blinding_factor with recipient's BTC public key (ECIES)
 *    - Store all data on backend
 *
 * Voucher Claiming Flow:
 * ======================
 * 1. Recipient decrypts blinding_factor using their BTC private key
 *
 * 2. Build a "voucher sweep" transaction:
 *    - Input: voucher output (commitment, features)
 *      - Blinding contribution: -voucher_blind (spending)
 *    - Output: recipient's new output (their key derivation)
 *      - Blinding contribution: +recipient_blind (receiving)
 *    - Fee deducted from amount
 *
 * 3. Compute kernel excess:
 *    - excess = recipient_blind - voucher_blind
 *    - Note: recipient controls BOTH values!
 *
 * 4. Sign the kernel:
 *    - Since recipient knows both blinding factors, they can
 *      generate the full Schnorr signature themselves
 *    - No interaction with original sender needed
 *
 * 5. Build and broadcast transaction
 *
 * Implementation Requirements:
 * ============================
 * - Need to expose raw blinding factors from Grin WASM library
 * - Need function to build transaction with arbitrary blinding factors
 *   (not derived from wallet keys)
 * - Need to sign kernel with explicit blinding factor inputs
 *
 * The existing grin/* modules derive blinding factors from:
 *   Crypto.deriveSecretKey(extendedPrivateKey, amount, identifier, switchType)
 *
 * For voucher claiming, we need to bypass this and use the stored blinding
 * factor directly.
 */

import type { GrinKeys, GrinSlate } from './types';

/**
 * Grin voucher data structure.
 * Contains everything needed to claim the voucher.
 */
export interface GrinVoucher {
  /** Output commitment (hex) - identifies the UTXO on chain */
  commitment: string;

  /** Range proof (hex) - needed for slate input creation */
  proof: string;

  /** Amount in nanogrin */
  amount: number;

  /** Raw blinding factor (hex, 32 bytes) - ENCRYPTED with recipient's pubkey */
  encryptedBlindingFactor: string;

  /** Ephemeral pubkey used for ECIES encryption */
  ephemeralPubkey: string;

  /** Transaction ID that created this output (for confirmation tracking) */
  txSlateId: string;

  /** Output features (0 = plain, 1 = coinbase) */
  features: number;

  /** Unix timestamp when created */
  createdAt: number;
}

/**
 * Data stored in PendingSocialTip for Grin vouchers.
 */
export interface GrinVoucherPendingTip {
  /** The voucher data (commitment, proof, etc.) */
  voucher: GrinVoucher;

  /** Raw blinding factor (hex) - stored locally for clawback */
  blindingFactorHex: string;
}

/**
 * Create a Grin voucher by sending funds to self and extracting the blinding factor.
 *
 * @param keys - Sender's Grin wallet keys
 * @param amount - Amount in nanogrin
 * @param fee - Transaction fee in nanogrin
 * @param recipientBtcPubkey - Recipient's BTC public key (for encrypting blinding factor)
 * @returns Voucher data and tx info
 */
export async function createGrinVoucher(
  _keys: GrinKeys,
  _amount: bigint,
  _fee: bigint,
  _recipientBtcPubkey: Uint8Array
): Promise<{
  voucher: GrinVoucher;
  blindingFactorHex: string;
  txSlateId: string;
}> {
  // TODO: Implementation requires:
  // 1. Create send transaction to self (use createSendTransaction)
  // 2. Track the change output (or create a dedicated voucher output)
  // 3. Extract the blinding factor that was used
  //    - This is the tricky part: we need to expose the raw blinding factor
  //    - Currently it's derived inside the WASM and not returned
  // 4. Encrypt blinding factor with recipient's BTC pubkey
  // 5. Return voucher data

  throw new Error(
    'Grin voucher creation not yet implemented. ' +
    'Requires exposing raw blinding factors from Grin WASM library.'
  );
}

/**
 * Claim a Grin voucher by sweeping funds to recipient's wallet.
 *
 * @param keys - Claimer's Grin wallet keys
 * @param voucher - The voucher to claim
 * @param blindingFactor - Decrypted blinding factor (32 bytes)
 * @param nextChildIndex - Next n_child for output creation
 * @returns Finalized slate ready for broadcast
 */
export async function claimGrinVoucher(
  _keys: GrinKeys,
  _voucher: GrinVoucher,
  _blindingFactor: Uint8Array,
  _nextChildIndex: number
): Promise<GrinSlate> {
  // TODO: Implementation requires custom transaction building:
  //
  // 1. Create a new slate with voucher amount - fee
  //
  // 2. Add voucher as input:
  //    const input = new SlateInput(features, Common.fromHexString(commitment));
  //    slate.addInputs([input], ...);
  //
  // 3. Create recipient's output:
  //    - Use normal key derivation for recipient
  //    - const outputCommit = await Crypto.commit(keys.extendedPrivateKey, ...);
  //    - const outputProof = await Crypto.proof(...);
  //    - slate.addOutputs([output]);
  //
  // 4. Compute excess:
  //    - recipientBlind = await Crypto.deriveSecretKey(keys.extendedPrivateKey, ...);
  //    - excess = blindSum([recipientBlind], [voucherBlindingFactor]);
  //
  // 5. Build kernel:
  //    - We need to sign with the excess as the secret key
  //    - The kernel signature proves we know the excess
  //
  // 6. The tricky part: WASM's finalize() expects the normal participant model
  //    - We may need to:
  //      a) Add two fake participants with controlled keys, OR
  //      b) Build the kernel manually using lower-level WASM functions
  //
  // 7. Finalize and return

  throw new Error(
    'Grin voucher claiming not yet implemented. ' +
    'Requires custom transaction building with raw blinding factors.'
  );
}

/**
 * Extract the blinding factor for an output.
 *
 * This is needed to create vouchers from existing outputs.
 * The blinding factor is derived from:
 *   Crypto.deriveSecretKey(extendedPrivateKey, amount, identifier, switchType)
 *
 * @param keys - Wallet keys
 * @param keyId - Output's key ID (hex)
 * @param amount - Output amount in nanogrin
 * @returns Raw blinding factor (32 bytes)
 */
export async function extractBlindingFactor(
  _keys: GrinKeys,
  _keyId: string,
  _amount: bigint
): Promise<Uint8Array> {
  // This CAN be implemented using existing WASM functions:
  //
  // const identifier = new Identifier(keyId);
  // const amountBN = new BigNumber(amount.toString());
  // const blindingFactor = await Crypto.deriveSecretKey(
  //   keys.extendedPrivateKey,
  //   amountBN,
  //   identifier,
  //   Crypto.SWITCH_TYPE_REGULAR
  // );
  // return blindingFactor;
  //
  // However, we need to track which output we're creating during voucher
  // creation so we can extract its blinding factor afterward.

  throw new Error(
    'Blinding factor extraction not yet implemented.'
  );
}
