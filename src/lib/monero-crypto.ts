/**
 * Monero/Wownero cryptographic utilities.
 *
 * Key image computation is delegated to smirk-wasm which has a correct Rust implementation
 * of Monero's hash_to_point (ge_fromfe_frombytes_vartime) using monero-oxide.
 *
 * This module provides the balance verification API that uses WASM for key image computation.
 */

import { initWasm } from './xmr-tx';

// ============================================================================
// Balance Verification API
// ============================================================================

/**
 * Spent output candidate from the server.
 */
export interface SpentOutputCandidate {
  amount: number;
  key_image: string;
  tx_pub_key: string;
  out_index: number;
}

/**
 * Compute a key image using the WASM module.
 *
 * @param viewKey - Wallet's private view key (hex)
 * @param spendKey - Wallet's private spend key (hex)
 * @param txPubKey - Transaction public key from the original receive tx (hex)
 * @param outIndex - Output index within the transaction
 * @returns The computed key image (hex string)
 */
async function computeKeyImage(
  viewKey: string,
  spendKey: string,
  txPubKey: string,
  outIndex: number
): Promise<string> {
  const wasm = await initWasm();
  const resultJson = wasm.compute_key_image(viewKey, spendKey, txPubKey, outIndex);
  const result = JSON.parse(resultJson);

  if (!result.success) {
    throw new Error(result.error || 'Failed to compute key image');
  }

  return result.data;
}

/**
 * Verify which spent outputs actually belong to this wallet.
 *
 * Computes key images locally using the spend key and compares
 * with the server-provided key images. Only returns outputs where
 * the key images match (i.e., actually spent by this wallet).
 *
 * @param spentOutputs - Candidate spent outputs from server
 * @param privateViewKey - Wallet's private view key (hex)
 * @param publicSpendKey - Wallet's public spend key (hex) - not used, kept for API compat
 * @param privateSpendKey - Wallet's private spend key (hex)
 * @returns Array of verified spent outputs with their amounts
 */
export async function verifySpentOutputs(
  spentOutputs: SpentOutputCandidate[],
  privateViewKey: string,
  _publicSpendKey: string,
  privateSpendKey: string
): Promise<SpentOutputCandidate[]> {
  if (spentOutputs.length === 0) {
    return [];
  }

  const verified: SpentOutputCandidate[] = [];

  for (const output of spentOutputs) {
    try {
      console.log(`[monero-crypto] Verifying spent output:`, {
        amount: output.amount,
        tx_pub_key: output.tx_pub_key,
        out_index: output.out_index,
        server_key_image: output.key_image,
      });

      const computedKeyImage = await computeKeyImage(
        privateViewKey,
        privateSpendKey,
        output.tx_pub_key,
        output.out_index
      );

      // Compare computed key image with server's key image
      if (computedKeyImage.toLowerCase() === output.key_image.toLowerCase()) {
        verified.push(output);
        console.log(
          `[monero-crypto] ✓ Verified spent output: ${output.amount} (key_image matches)`
        );
      } else {
        console.log(
          `[monero-crypto] ✗ Spent output NOT ours: key_image mismatch`,
          { server: output.key_image.substring(0, 16) + '...', computed: computedKeyImage.substring(0, 16) + '...' }
        );
      }
    } catch (err) {
      console.error(`[monero-crypto] Error verifying spent output:`, err, output);
    }
  }

  return verified;
}

/**
 * Calculate the true balance after verifying spent outputs.
 *
 * @param totalReceived - Total received from server (view-only balance)
 * @param spentOutputs - Candidate spent outputs from server
 * @param privateViewKey - Wallet's private view key (hex)
 * @param publicSpendKey - Wallet's public spend key (hex)
 * @param privateSpendKey - Wallet's private spend key (hex)
 * @returns The true balance after subtracting verified spends
 */
export async function calculateVerifiedBalance(
  totalReceived: number,
  spentOutputs: SpentOutputCandidate[],
  privateViewKey: string,
  publicSpendKey: string,
  privateSpendKey: string
): Promise<{
  balance: number;
  verifiedSpentAmount: number;
  verifiedSpentCount: number;
  hashToEcImplemented: boolean;
}> {
  try {
    const verified = await verifySpentOutputs(
      spentOutputs,
      privateViewKey,
      publicSpendKey,
      privateSpendKey
    );

    const verifiedSpentAmount = verified.reduce((sum, o) => sum + o.amount, 0);
    const balance = totalReceived - verifiedSpentAmount;

    return {
      balance: Math.max(0, balance), // Never negative
      verifiedSpentAmount,
      verifiedSpentCount: verified.length,
      hashToEcImplemented: true,
    };
  } catch (err) {
    console.error('[monero-crypto] Error calculating balance:', err);
    // Fall back to view-only balance on error
    return {
      balance: totalReceived,
      verifiedSpentAmount: 0,
      verifiedSpentCount: 0,
      hashToEcImplemented: false,
    };
  }
}
