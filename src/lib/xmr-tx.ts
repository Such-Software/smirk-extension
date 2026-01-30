/**
 * Monero/Wownero transaction construction using smirk-wasm.
 *
 * This module wraps the smirk-wasm WASM library to provide client-side
 * transaction signing. The spend key never leaves the client.
 *
 * Flow:
 * 1. Get unspent outputs from backend (via LWS)
 * 2. Get random outputs for decoys from backend
 * 3. Build and sign transaction locally using smirk-wasm
 * 4. Submit signed transaction to backend for broadcast
 */

import { api } from './api';

// Static import of wasm-bindgen JS module (bundled at build time)
// This avoids dynamic import() which is not allowed in Service Workers
import * as smirkWasm from './smirk-wasm.js';

// Types for WASM module functions
interface SmirkWasmExports {
  test(): string;
  version(): string;
  validate_address(address: string): string;
  estimate_fee(inputs: number, outputs: number, fee_per_byte: bigint, fee_mask: bigint): string;
  sign_transaction(params_json: string): string;
  derive_output_key_image(
    view_key: string,
    spend_key: string,
    tx_pub_key: string,
    output_index: number,
    output_key: string
  ): string;
  // Compute key image without needing output_key (for verifying LWS spent outputs)
  compute_key_image(
    view_key: string,
    spend_key: string,
    tx_pub_key: string,
    output_index: number
  ): string;
  // Sync initialization (for Service Workers)
  initSync(module: WebAssembly.Module): void;
}

// WASM module instance - lazy loaded
let wasmInitialized = false;
let wasmInitPromise: Promise<SmirkWasmExports> | null = null;

// Track locally spent key images (outputs we've used in transactions but LWS hasn't seen yet)
// This prevents double-spend attempts when sending multiple transactions in quick succession
// Key: key_image (hex lowercase), Value: timestamp when spent
const locallySpentKeyImages: Map<string, number> = new Map();

// How long to keep locally spent key images as a safety fallback
// 2 hours handles slow block times (WOW blocks can take 10+ min sometimes)
// Entries are also cleared when LWS confirms the spend (see clearConfirmedSpentKeyImage)
const LOCAL_SPENT_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Mark a key image as spent locally.
 * This is called after successfully sending a transaction.
 */
export function markKeyImageSpent(keyImage: string): void {
  locallySpentKeyImages.set(keyImage.toLowerCase(), Date.now());
  console.log(`[xmr-tx] Marked key image as locally spent: ${keyImage.substring(0, 16)}...`);
}

/**
 * Clear a key image from local tracking when LWS confirms it's spent.
 * This is called when we see the key image in LWS's spend_key_images list.
 */
function clearConfirmedSpentKeyImage(keyImage: string): void {
  const key = keyImage.toLowerCase();
  if (locallySpentKeyImages.has(key)) {
    locallySpentKeyImages.delete(key);
    console.log(`[xmr-tx] Cleared confirmed spent key image from local tracking: ${keyImage.substring(0, 16)}...`);
  }
}

/**
 * Check if a key image is in our local spent list.
 */
function isLocallySpent(keyImage: string): boolean {
  const spentTime = locallySpentKeyImages.get(keyImage.toLowerCase());
  if (!spentTime) return false;

  // Check if expired (safety fallback)
  if (Date.now() - spentTime > LOCAL_SPENT_TTL_MS) {
    locallySpentKeyImages.delete(keyImage.toLowerCase());
    return false;
  }

  return true;
}

/**
 * Clean up expired locally spent key images.
 */
function cleanupLocalSpentKeyImages(): void {
  const now = Date.now();
  for (const [keyImage, spentTime] of locallySpentKeyImages.entries()) {
    if (now - spentTime > LOCAL_SPENT_TTL_MS) {
      locallySpentKeyImages.delete(keyImage);
    }
  }
}

export type XmrAsset = 'xmr' | 'wow';

export interface XmrOutput {
  amount: number;
  public_key: string;
  tx_pub_key: string;
  index: number;
  global_index: number;
  height: number;
  rct: string;
  /** Key images from LWS that might indicate this output is spent */
  spend_key_images?: string[];
}

export interface Decoy {
  global_index: number;
  public_key: string;
  rct: string;
}

export interface XmrDestination {
  address: string;
  amount: number;
}

/**
 * Initialize the smirk-wasm module.
 * Call this once at startup or lazily on first use.
 *
 * Uses static import + fetch/initSync to work in Service Workers
 * (dynamic import() is not allowed in Service Workers per HTML spec).
 */
export async function initWasm(): Promise<SmirkWasmExports> {
  if (wasmInitialized) {
    return smirkWasm as unknown as SmirkWasmExports;
  }

  if (wasmInitPromise) {
    return wasmInitPromise;
  }

  wasmInitPromise = (async () => {
    try {
      // Fetch the WASM binary
      const wasmBinaryUrl = chrome.runtime.getURL('wasm/smirk_wasm_bg.wasm');
      const response = await fetch(wasmBinaryUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status}`);
      }

      // Compile and initialize synchronously (works in Service Workers)
      const wasmBytes = await response.arrayBuffer();
      const wasmModule = await WebAssembly.compile(wasmBytes);
      (smirkWasm as any).initSync({ module: wasmModule });

      wasmInitialized = true;
      const exports = smirkWasm as unknown as SmirkWasmExports;
      console.log('[xmr-tx] WASM initialized:', exports.test(), 'version:', exports.version());
      return exports;
    } catch (err) {
      wasmInitPromise = null;
      console.error('[xmr-tx] Failed to initialize WASM:', err);
      throw err;
    }
  })();

  return wasmInitPromise;
}

/**
 * Check if WASM is ready.
 */
export function isWasmReady(): boolean {
  return wasmInitialized;
}

/**
 * Get WASM version.
 */
export async function getWasmVersion(): Promise<string> {
  const wasm = await initWasm();
  return wasm.version();
}

/**
 * Validate a Monero/Wownero address.
 */
export async function validateAddress(address: string): Promise<{
  valid: boolean;
  network?: 'mainnet' | 'testnet' | 'stagenet';
  is_subaddress?: boolean;
  has_payment_id?: boolean;
  error?: string;
}> {
  const wasm = await initWasm();
  const result = JSON.parse(wasm.validate_address(address));
  if (result.success) {
    return result.data;
  }
  return { valid: false, error: result.error };
}

/**
 * Estimate transaction fee.
 *
 * @param inputCount - Number of inputs
 * @param outputCount - Number of outputs (including change)
 * @param feePerByte - Fee per byte from LWS
 * @param feeMask - Fee rounding mask from LWS
 */
export async function estimateFee(
  inputCount: number,
  outputCount: number,
  feePerByte: number,
  feeMask: number
): Promise<number> {
  const wasm = await initWasm();
  const result = JSON.parse(
    wasm.estimate_fee(inputCount, outputCount, BigInt(feePerByte), BigInt(feeMask))
  );
  if (result.success) {
    return result.data;
  }
  throw new Error(result.error || 'Failed to estimate fee');
}

/**
 * Filter out spent outputs by computing key images and checking against LWS spend_key_images.
 *
 * LWS returns outputs with a list of key images it has seen on-chain that MIGHT
 * correspond to this output being spent. We compute the actual key image using
 * the wallet's spend key and check if it's in that list.
 *
 * @param outputs - Outputs from get_unspent_outs
 * @param viewKey - Private view key (hex)
 * @param spendKey - Private spend key (hex)
 * @returns Only the unspent outputs
 */
export async function filterUnspentOutputs(
  outputs: XmrOutput[],
  viewKey: string,
  spendKey: string
): Promise<XmrOutput[]> {
  const wasm = await initWasm();
  const unspent: XmrOutput[] = [];

  // Clean up expired local spent tracking
  cleanupLocalSpentKeyImages();

  for (const output of outputs) {
    // Compute the actual key image for this output (we need it for both checks)
    const resultJson = wasm.compute_key_image(viewKey, spendKey, output.tx_pub_key, output.index);
    const result = JSON.parse(resultJson);

    if (!result.success) {
      console.error('[xmr-tx] Failed to compute key image:', result.error, output);
      // Skip this output if we can't compute key image (safer than including potentially spent)
      continue;
    }

    const computedKeyImage = result.data.toLowerCase();

    // Check 1: Is this output in our local "recently spent" list?
    // This catches outputs we've spent but LWS hasn't seen yet
    if (isLocallySpent(computedKeyImage)) {
      console.log(
        `[xmr-tx] Filtering out locally spent output: amount=${output.amount}, ` +
          `key_image=${computedKeyImage.substring(0, 16)}...`
      );
      continue;
    }

    // Check 2: Is the computed key image in LWS's spend_key_images list?
    if (output.spend_key_images && output.spend_key_images.length > 0) {
      const isSpentOnChain = output.spend_key_images.some(
        (ki) => ki.toLowerCase() === computedKeyImage
      );

      if (isSpentOnChain) {
        // LWS has confirmed this spend - clear from local tracking if present
        clearConfirmedSpentKeyImage(computedKeyImage);

        console.log(
          `[xmr-tx] Filtering out on-chain spent output: amount=${output.amount}, ` +
            `tx=${output.tx_pub_key.substring(0, 16)}..., key_image=${computedKeyImage.substring(0, 16)}...`
        );
        continue;
      }
    }

    // Output is unspent - include it
    unspent.push(output);
  }

  console.log(
    `[xmr-tx] Filtered outputs: ${outputs.length} total, ${unspent.length} unspent, ` +
      `${outputs.length - unspent.length} spent`
  );

  return unspent;
}

/**
 * Select outputs for a transaction.
 *
 * Uses simple "largest first" strategy.
 *
 * @param outputs - Available unspent outputs
 * @param targetAmount - Amount to send (in atomic units). Use 0 for sweep (send all).
 * @param feePerByte - Fee per byte
 * @param feeMask - Fee rounding mask
 * @param sweep - If true, select all outputs and send max (no change output)
 */
export async function selectOutputs(
  outputs: XmrOutput[],
  targetAmount: number,
  feePerByte: number,
  feeMask: number,
  sweep: boolean = false
): Promise<{ selected: XmrOutput[]; estimatedFee: number; change: number; sweepAmount?: number }> {
  // Sort by amount descending
  const sorted = [...outputs].sort((a, b) => b.amount - a.amount);

  // Sweep mode: use all outputs, no change
  if (sweep) {
    const totalInput = sorted.reduce((sum, o) => sum + o.amount, 0);
    // 1 output (recipient only, no change)
    const baseFee = await estimateFee(sorted.length, 1, feePerByte, feeMask);

    // Add small buffer to fee (0.1% or minimum feeMask amount) to ensure no dust remains
    // This accounts for any variance between estimated and actual tx fee
    const feeBuffer = Math.max(Math.ceil(baseFee * 0.001), feeMask);
    const fee = baseFee + feeBuffer;
    const sweepAmount = totalInput - fee;

    if (sweepAmount <= 0) {
      throw new Error('Balance too low to cover network fee');
    }

    return { selected: sorted, estimatedFee: fee, change: 0, sweepAmount };
  }

  // Normal mode: select enough outputs to cover amount + fee
  const selected: XmrOutput[] = [];
  let totalInput = 0;

  for (const output of sorted) {
    selected.push(output);
    totalInput += output.amount;

    // Estimate fee for current selection (2 outputs: recipient + change)
    const fee = await estimateFee(selected.length, 2, feePerByte, feeMask);

    if (totalInput >= targetAmount + fee) {
      const change = totalInput - targetAmount - fee;
      return { selected, estimatedFee: fee, change };
    }
  }

  throw new Error(
    `Insufficient funds: need ${targetAmount} + fee, have ${totalInput}`
  );
}

/**
 * Build inputs with decoys for transaction signing.
 *
 * Fetches decoys per input to avoid LWS rate limits.
 *
 * @param asset - 'xmr' or 'wow'
 * @param outputs - Selected outputs to spend
 */
async function buildInputsWithDecoys(
  asset: XmrAsset,
  outputs: XmrOutput[]
): Promise<
  Array<{
    output: XmrOutput;
    decoys: Decoy[];
  }>
> {
  // Decoy count depends on coin:
  // - XMR: 15 decoys (ring size 16)
  // - WOW: 21 decoys (ring size 22) - required since HF v9
  const decoyCount = asset === 'wow' ? 21 : 15;

  // Fetch decoys for each input separately to avoid LWS rate limits
  // LWS has a default limit on outputs per request (often 25-50)
  const results: Array<{ output: XmrOutput; decoys: Decoy[] }> = [];

  for (const output of outputs) {
    const response = await api.getRandomOuts(asset, decoyCount);
    if (response.error || !response.data) {
      throw new Error(response.error || 'Failed to get random outputs');
    }

    const decoys = response.data.outputs;
    if (decoys.length < decoyCount) {
      throw new Error(
        `Not enough decoys: got ${decoys.length}, need ${decoyCount}`
      );
    }

    results.push({
      output,
      decoys: decoys.slice(0, decoyCount),
    });
  }

  return results;
}

/**
 * Sign and build a complete transaction.
 *
 * @param asset - 'xmr' or 'wow'
 * @param inputs - Outputs with decoys to spend
 * @param destinations - Where to send funds
 * @param changeAddress - Address for change
 * @param feePerByte - Fee per byte
 * @param feeMask - Fee rounding mask
 * @param viewKey - Private view key (hex)
 * @param spendKey - Private spend key (hex)
 * @param network - Network type
 */
export async function signTransaction(
  asset: XmrAsset,
  inputs: Array<{ output: XmrOutput; decoys: Decoy[] }>,
  destinations: XmrDestination[],
  changeAddress: string,
  feePerByte: number,
  feeMask: number,
  viewKey: string,
  spendKey: string,
  network: 'mainnet' | 'testnet' | 'stagenet' = 'mainnet'
): Promise<{ txHex: string; txHash: string; fee: number }> {
  const wasm = await initWasm();

  const params = {
    inputs: inputs.map(({ output, decoys }) => ({
      output: {
        amount: output.amount,
        public_key: output.public_key,
        tx_pub_key: output.tx_pub_key,
        index: output.index,
        global_index: output.global_index,
        height: output.height,
        rct: output.rct,
      },
      decoys: decoys.map((d) => ({
        global_index: d.global_index,
        public_key: d.public_key,
        rct: d.rct,
      })),
    })),
    destinations,
    change_address: changeAddress,
    fee_per_byte: feePerByte,
    fee_mask: feeMask,
    view_key: viewKey,
    spend_key: spendKey,
    network,
    coin: asset, // Pass asset type for coin-specific RCT type encoding
  };

  const result = JSON.parse(wasm.sign_transaction(JSON.stringify(params)));

  if (!result.success) {
    throw new Error(result.error || 'Failed to sign transaction');
  }

  return {
    txHex: result.data.tx_hex,
    txHash: result.data.tx_hash,
    fee: result.data.fee,
  };
}

/**
 * Create and sign a complete transaction end-to-end.
 *
 * This is the main entry point for sending XMR/WOW.
 *
 * @param asset - 'xmr' or 'wow'
 * @param address - Sender's address
 * @param viewKey - Sender's private view key (hex)
 * @param spendKey - Sender's private spend key (hex)
 * @param recipientAddress - Where to send funds
 * @param amount - Amount in atomic units
 * @param network - Network type
 */
export async function createSignedTransaction(
  asset: XmrAsset,
  address: string,
  viewKey: string,
  spendKey: string,
  recipientAddress: string,
  amount: number,
  network: 'mainnet' | 'testnet' | 'stagenet' = 'mainnet',
  sweep: boolean = false
): Promise<{ txHex: string; txHash: string; fee: number; spentKeyImages: string[]; actualAmount: number }> {
  console.log(`[xmr-tx] createSignedTransaction called: asset=${asset}, address=${address.substring(0, 20)}..., sweep=${sweep}`);

  // 1. Get unspent outputs
  console.log(`[xmr-tx] Step 1: Fetching unspent outputs from LWS...`);
  const unspentResponse = await api.getUnspentOuts(asset, address, viewKey);
  if (unspentResponse.error || !unspentResponse.data) {
    console.error(`[xmr-tx] Failed to get unspent outputs:`, unspentResponse.error);
    throw new Error(unspentResponse.error || 'Failed to get unspent outputs');
  }

  const { outputs: rawOutputs, per_byte_fee, fee_mask } = unspentResponse.data;
  console.log(`[xmr-tx] Got ${rawOutputs.length} raw outputs from LWS, per_byte_fee=${per_byte_fee}, fee_mask=${fee_mask}`);

  if (rawOutputs.length === 0) {
    console.error(`[xmr-tx] No unspent outputs available`);
    throw new Error('No unspent outputs available');
  }

  // 2. Filter out spent outputs using key image verification
  // LWS returns spend_key_images for each output - we compute actual key image
  // and check if it's in that list to know if the output is truly spent
  console.log(`[xmr-tx] Step 2: Filtering spent outputs...`);
  const outputs = await filterUnspentOutputs(rawOutputs, viewKey, spendKey);
  console.log(`[xmr-tx] After filtering: ${outputs.length} unspent outputs remain`);

  if (outputs.length === 0) {
    console.error(`[xmr-tx] All outputs have been spent`);
    throw new Error('No unspent outputs available (all outputs have been spent)');
  }

  // 3. Select outputs for this transaction
  console.log(`[xmr-tx] Step 3: Selecting outputs for transaction...`);
  const { selected, estimatedFee, change, sweepAmount } = await selectOutputs(
    outputs,
    amount,
    per_byte_fee,
    fee_mask,
    sweep
  );

  // In sweep mode, use the calculated sweep amount
  const actualAmount = sweep && sweepAmount ? sweepAmount : amount;

  console.log(
    `[xmr-tx] Selected ${selected.length} outputs, estimated fee: ${estimatedFee}, change: ${change}, sweep: ${sweep}, actualAmount: ${actualAmount}`
  );

  // 4. Compute key images for selected outputs (for local spent tracking)
  console.log(`[xmr-tx] Step 4: Computing key images...`);
  const wasm = await initWasm();
  const spentKeyImages: string[] = [];
  for (const output of selected) {
    const resultJson = wasm.compute_key_image(viewKey, spendKey, output.tx_pub_key, output.index);
    const result = JSON.parse(resultJson);
    if (result.success) {
      spentKeyImages.push(result.data.toLowerCase());
    }
  }
  console.log(`[xmr-tx] Computed ${spentKeyImages.length} key images`);

  // 5. Build inputs with decoys
  console.log(`[xmr-tx] Step 5: Building inputs with decoys...`);
  const inputsWithDecoys = await buildInputsWithDecoys(asset, selected);
  console.log(`[xmr-tx] Built ${inputsWithDecoys.length} inputs with decoys`);

  // 6. Sign transaction
  console.log(`[xmr-tx] Step 6: Signing transaction...`);
  const destinations: XmrDestination[] = [{ address: recipientAddress, amount: actualAmount }];

  const result = await signTransaction(
    asset,
    inputsWithDecoys,
    destinations,
    address, // Change goes back to sender
    per_byte_fee,
    fee_mask,
    viewKey,
    spendKey,
    network
  );

  console.log(`[xmr-tx] Transaction signed: ${result.txHash}, fee: ${result.fee}, actualAmount: ${actualAmount}`);

  return { ...result, spentKeyImages, actualAmount };
}

/**
 * Send a transaction: create, sign, and broadcast.
 *
 * @param asset - 'xmr' or 'wow'
 * @param address - Sender's address
 * @param viewKey - Sender's private view key (hex)
 * @param spendKey - Sender's private spend key (hex)
 * @param recipientAddress - Where to send funds
 * @param amount - Amount in atomic units (ignored if sweep=true)
 * @param network - Network type
 * @param sweep - If true, send entire balance (amount parameter ignored)
 */
export async function sendTransaction(
  asset: XmrAsset,
  address: string,
  viewKey: string,
  spendKey: string,
  recipientAddress: string,
  amount: number,
  network: 'mainnet' | 'testnet' | 'stagenet' = 'mainnet',
  sweep: boolean = false
): Promise<{ txHash: string; fee: number; actualAmount: number }> {
  // Create and sign
  const { txHex, txHash, fee, spentKeyImages, actualAmount } = await createSignedTransaction(
    asset,
    address,
    viewKey,
    spendKey,
    recipientAddress,
    amount,
    network,
    sweep
  );

  // Broadcast
  const broadcastResponse = await api.submitLwsTx(asset, txHex);
  if (broadcastResponse.error || !broadcastResponse.data?.success) {
    throw new Error(
      broadcastResponse.error ||
        broadcastResponse.data?.status ||
        'Failed to broadcast transaction'
    );
  }

  // Mark the used outputs as locally spent to prevent double-spend attempts
  // before LWS catches up and sees the key images on-chain
  for (const keyImage of spentKeyImages) {
    markKeyImageSpent(keyImage);
  }

  console.log(`[xmr-tx] Transaction broadcast: ${txHash}, marked ${spentKeyImages.length} outputs as spent, actualAmount: ${actualAmount}`);

  return { txHash, fee, actualAmount };
}

/**
 * Calculate maximum sendable amount.
 *
 * @param asset - 'xmr' or 'wow'
 * @param address - Sender's address
 * @param viewKey - Sender's private view key (hex)
 * @param spendKey - Sender's private spend key (hex) - needed for key image verification
 */
export async function maxSendable(
  asset: XmrAsset,
  address: string,
  viewKey: string,
  spendKey: string
): Promise<number> {
  const unspentResponse = await api.getUnspentOuts(asset, address, viewKey);
  if (unspentResponse.error || !unspentResponse.data) {
    throw new Error(unspentResponse.error || 'Failed to get unspent outputs');
  }

  const { outputs: rawOutputs, per_byte_fee, fee_mask } = unspentResponse.data;

  if (rawOutputs.length === 0) {
    return 0;
  }

  // Filter out spent outputs using key image verification
  const outputs = await filterUnspentOutputs(rawOutputs, viewKey, spendKey);

  if (outputs.length === 0) {
    return 0;
  }

  const totalValue = outputs.reduce((sum, o) => sum + o.amount, 0);

  // Estimate fee for sending all outputs with 1 output (no change)
  const baseFee = await estimateFee(outputs.length, 1, per_byte_fee, fee_mask);

  // Add small buffer (0.1% or minimum fee_mask amount) to ensure no dust remains
  // This matches the buffer used in selectOutputs() sweep mode
  const feeBuffer = Math.max(Math.ceil(baseFee * 0.001), fee_mask);
  const fee = baseFee + feeBuffer;

  return Math.max(0, totalValue - fee);
}
