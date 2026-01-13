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
}

// WASM module instance - lazy loaded
let wasmExports: SmirkWasmExports | null = null;
let wasmInitPromise: Promise<SmirkWasmExports> | null = null;

export type XmrAsset = 'xmr' | 'wow';

export interface XmrOutput {
  amount: number;
  public_key: string;
  tx_pub_key: string;
  index: number;
  global_index: number;
  height: number;
  rct: string;
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
 */
export async function initWasm(): Promise<SmirkWasmExports> {
  if (wasmExports) {
    return wasmExports;
  }

  if (wasmInitPromise) {
    return wasmInitPromise;
  }

  wasmInitPromise = (async () => {
    try {
      // Get the extension's base URL for loading WASM assets
      const wasmJsUrl = chrome.runtime.getURL('wasm/smirk_wasm.js');

      // Dynamically import the WASM JS module
      const wasm = await import(/* @vite-ignore */ wasmJsUrl);

      // Initialize WASM - the init function loads the .wasm file
      // We need to provide the path to the .wasm file
      const wasmBinaryUrl = chrome.runtime.getURL('wasm/smirk_wasm_bg.wasm');
      await wasm.default(wasmBinaryUrl);

      wasmExports = wasm as SmirkWasmExports;
      console.log('[xmr-tx] WASM initialized:', wasmExports.test());
      return wasmExports;
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
  return wasmExports !== null;
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
 * Select outputs for a transaction.
 *
 * Uses simple "largest first" strategy.
 *
 * @param outputs - Available unspent outputs
 * @param targetAmount - Amount to send (in atomic units)
 * @param feePerByte - Fee per byte
 * @param feeMask - Fee rounding mask
 */
export async function selectOutputs(
  outputs: XmrOutput[],
  targetAmount: number,
  feePerByte: number,
  feeMask: number
): Promise<{ selected: XmrOutput[]; estimatedFee: number; change: number }> {
  // Sort by amount descending
  const sorted = [...outputs].sort((a, b) => b.amount - a.amount);

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
  // Get 15 decoys per input (for ring size 16)
  const decoyCount = 15;

  // Fetch decoys from backend
  const response = await api.getRandomOuts(asset, decoyCount * outputs.length);
  if (response.error || !response.data) {
    throw new Error(response.error || 'Failed to get random outputs');
  }

  // Backend returns flat array of decoys
  const decoyPool = response.data.outputs;

  if (decoyPool.length < decoyCount * outputs.length) {
    throw new Error(
      `Not enough decoys: got ${decoyPool.length}, need ${decoyCount * outputs.length}`
    );
  }

  // Distribute decoys to inputs
  return outputs.map((output, i) => ({
    output,
    decoys: decoyPool.slice(i * decoyCount, (i + 1) * decoyCount),
  }));
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
  network: 'mainnet' | 'testnet' | 'stagenet' = 'mainnet'
): Promise<{ txHex: string; txHash: string; fee: number }> {
  // 1. Get unspent outputs
  const unspentResponse = await api.getUnspentOuts(asset, address, viewKey);
  if (unspentResponse.error || !unspentResponse.data) {
    throw new Error(unspentResponse.error || 'Failed to get unspent outputs');
  }

  const { outputs, per_byte_fee, fee_mask } = unspentResponse.data;

  if (outputs.length === 0) {
    throw new Error('No unspent outputs available');
  }

  // 2. Select outputs for this transaction
  const { selected, estimatedFee, change } = await selectOutputs(
    outputs,
    amount,
    per_byte_fee,
    fee_mask
  );

  console.log(
    `[xmr-tx] Selected ${selected.length} outputs, estimated fee: ${estimatedFee}, change: ${change}`
  );

  // 3. Build inputs with decoys
  const inputsWithDecoys = await buildInputsWithDecoys(asset, selected);

  // 4. Sign transaction
  const destinations: XmrDestination[] = [{ address: recipientAddress, amount }];

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

  console.log(`[xmr-tx] Transaction signed: ${result.txHash}, fee: ${result.fee}`);

  return result;
}

/**
 * Send a transaction: create, sign, and broadcast.
 *
 * @param asset - 'xmr' or 'wow'
 * @param address - Sender's address
 * @param viewKey - Sender's private view key (hex)
 * @param spendKey - Sender's private spend key (hex)
 * @param recipientAddress - Where to send funds
 * @param amount - Amount in atomic units
 * @param network - Network type
 */
export async function sendTransaction(
  asset: XmrAsset,
  address: string,
  viewKey: string,
  spendKey: string,
  recipientAddress: string,
  amount: number,
  network: 'mainnet' | 'testnet' | 'stagenet' = 'mainnet'
): Promise<{ txHash: string; fee: number }> {
  // Create and sign
  const { txHex, txHash, fee } = await createSignedTransaction(
    asset,
    address,
    viewKey,
    spendKey,
    recipientAddress,
    amount,
    network
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

  console.log(`[xmr-tx] Transaction broadcast: ${txHash}`);

  return { txHash, fee };
}

/**
 * Calculate maximum sendable amount.
 *
 * @param asset - 'xmr' or 'wow'
 * @param address - Sender's address
 * @param viewKey - Sender's private view key (hex)
 */
export async function maxSendable(
  asset: XmrAsset,
  address: string,
  viewKey: string
): Promise<number> {
  const unspentResponse = await api.getUnspentOuts(asset, address, viewKey);
  if (unspentResponse.error || !unspentResponse.data) {
    throw new Error(unspentResponse.error || 'Failed to get unspent outputs');
  }

  const { outputs, per_byte_fee, fee_mask } = unspentResponse.data;

  if (outputs.length === 0) {
    return 0;
  }

  const totalValue = outputs.reduce((sum, o) => sum + o.amount, 0);

  // Estimate fee for sending all outputs with 1 output (no change)
  const fee = await estimateFee(outputs.length, 1, per_byte_fee, fee_mask);

  return Math.max(0, totalValue - fee);
}
