/**
 * Monero/Wownero cryptographic utilities using mymonero-monero-client WASM.
 *
 * Used for client-side verification of spent outputs without exposing spend key to server.
 */

// The WABridge type from mymonero-monero-client
interface WABridge {
  generateKeyImage(
    txPublicKey: string,
    privateViewKey: string,
    publicSpendKey: string,
    privateSpendKey: string,
    outputIndex: number
  ): string;
}

// Module state
let wasmBridge: WABridge | null = null;
let initPromise: Promise<WABridge> | null = null;

/**
 * Initialize the WASM crypto module.
 * Safe to call multiple times - will return cached instance.
 */
export async function initMoneroCrypto(): Promise<WABridge> {
  if (wasmBridge) {
    return wasmBridge;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Dynamic import of the WASM module
      const module = await import('@mymonero/mymonero-monero-client');
      // The module exports a factory function that returns the WABridge
      wasmBridge = await module.default({});
      console.log('[monero-crypto] WASM module initialized');
      return wasmBridge;
    } catch (err) {
      console.error('[monero-crypto] Failed to initialize WASM:', err);
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

/**
 * Generate a key image for an output.
 *
 * This is used to verify if a spent_output candidate from the server
 * actually belongs to this wallet. If the computed key_image matches
 * the server's key_image, the output was spent by this wallet.
 *
 * @param txPublicKey - Transaction public key (from spent_output.tx_pub_key)
 * @param privateViewKey - Wallet's private view key (hex)
 * @param publicSpendKey - Wallet's public spend key (hex)
 * @param privateSpendKey - Wallet's private spend key (hex)
 * @param outputIndex - Output index within transaction (from spent_output.out_index)
 * @returns The computed key image (hex string)
 */
export async function generateKeyImage(
  txPublicKey: string,
  privateViewKey: string,
  publicSpendKey: string,
  privateSpendKey: string,
  outputIndex: number
): Promise<string> {
  const bridge = await initMoneroCrypto();
  return bridge.generateKeyImage(
    txPublicKey,
    privateViewKey,
    publicSpendKey,
    privateSpendKey,
    outputIndex
  );
}

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
 * Verify which spent outputs actually belong to this wallet.
 *
 * Computes key images locally using the spend key and compares
 * with the server-provided key images. Only returns outputs where
 * the key images match (i.e., actually spent by this wallet).
 *
 * @param spentOutputs - Candidate spent outputs from server
 * @param privateViewKey - Wallet's private view key (hex)
 * @param publicSpendKey - Wallet's public spend key (hex)
 * @param privateSpendKey - Wallet's private spend key (hex)
 * @returns Array of verified spent outputs with their amounts
 */
export async function verifySpentOutputs(
  spentOutputs: SpentOutputCandidate[],
  privateViewKey: string,
  publicSpendKey: string,
  privateSpendKey: string
): Promise<SpentOutputCandidate[]> {
  if (spentOutputs.length === 0) {
    return [];
  }

  const verified: SpentOutputCandidate[] = [];

  for (const output of spentOutputs) {
    try {
      const computedKeyImage = await generateKeyImage(
        output.tx_pub_key,
        privateViewKey,
        publicSpendKey,
        privateSpendKey,
        output.out_index
      );

      // Compare computed key image with server's key image
      if (computedKeyImage.toLowerCase() === output.key_image.toLowerCase()) {
        verified.push(output);
        console.log(
          `[monero-crypto] Verified spent output: ${output.amount} (key_image matches)`
        );
      } else {
        console.log(
          `[monero-crypto] Spent output NOT ours: key_image mismatch`,
          { server: output.key_image, computed: computedKeyImage }
        );
      }
    } catch (err) {
      console.error(
        `[monero-crypto] Error verifying spent output:`,
        err,
        output
      );
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
}> {
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
  };
}
