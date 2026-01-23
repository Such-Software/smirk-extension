/**
 * Send Transaction Module (BTC/LTC)
 *
 * This module handles UTXO-based transactions for Bitcoin and Litecoin:
 * - UTXO selection for transaction inputs
 * - Transaction building and signing
 * - Fee calculation and max sendable amount
 * - Broadcasting to the network
 *
 * Transaction Flow:
 * 1. Fetch UTXOs from Electrum
 * 2. Select UTXOs to cover amount + fee
 * 3. Build transaction with inputs, outputs (recipient + change)
 * 4. Sign inputs with private key
 * 5. Broadcast signed transaction
 *
 * Sweep Mode:
 * When sweep=true, sends all UTXOs with no change output.
 * This empties the wallet completely and is useful for "max send".
 */

import type { MessageResponse, AssetType } from '@/types';
import { getWalletState } from '@/lib/storage';
import { api } from '@/lib/api';
import { createSignedTransaction, maxSendable as maxSendableUtxo, type Utxo } from '@/lib/btc-tx';
import { isUnlocked, unlockedKeys, addPendingTx, getPendingTxs } from './state';
import { getAddressForAsset } from './wallet';

// =============================================================================
// UTXO Queries
// =============================================================================

/**
 * Get UTXOs for a BTC or LTC address.
 *
 * UTXOs (Unspent Transaction Outputs) are the building blocks of
 * Bitcoin-style transactions. Each UTXO represents a discrete amount
 * of coins that can be spent in a future transaction.
 *
 * @param asset - 'btc' or 'ltc'
 * @param address - Wallet address to query
 * @returns Array of unspent outputs
 */
export async function handleGetUtxos(
  asset: 'btc' | 'ltc',
  address: string
): Promise<MessageResponse<{ utxos: Utxo[] }>> {
  const result = await api.getUtxos(asset, address);

  if (result.error) {
    return { success: false, error: result.error };
  }

  return { success: true, data: { utxos: result.data!.utxos } };
}

// =============================================================================
// Max Sendable Calculation
// =============================================================================

/**
 * Calculate maximum sendable amount for BTC/LTC.
 *
 * Fetches all UTXOs and calculates the maximum amount that can be sent
 * after subtracting the estimated transaction fee.
 *
 * Fee calculation assumes a sweep transaction (no change output):
 * - 1 output (recipient only)
 * - N inputs (all available UTXOs)
 *
 * Formula: max = sum(utxo.value) - fee
 * Where: fee = (10 + 148*n_inputs + 34*n_outputs) * feeRate
 *
 * @param asset - 'btc' or 'ltc'
 * @param feeRate - Fee rate in satoshis per virtual byte (sat/vB)
 * @returns Maximum sendable amount in satoshis
 */
export async function handleMaxSendableUtxo(
  asset: 'btc' | 'ltc',
  feeRate: number
): Promise<MessageResponse<{ maxAmount: number }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  const state = await getWalletState();
  const key = state.keys[asset];
  if (!key) {
    return { success: false, error: `No ${asset} key found` };
  }

  const address = getAddressForAsset(asset, key);

  // Fetch UTXOs
  const utxoResult = await api.getUtxos(asset, address);
  if (utxoResult.error || !utxoResult.data) {
    return { success: false, error: utxoResult.error || 'Failed to fetch UTXOs' };
  }

  const utxos = utxoResult.data.utxos;
  if (utxos.length === 0) {
    return { success: true, data: { maxAmount: 0 } };
  }

  // Calculate max sendable using btc-tx helper
  // This accounts for transaction size with all UTXOs as inputs
  const maxAmount = maxSendableUtxo(utxos, feeRate);

  return { success: true, data: { maxAmount } };
}

// =============================================================================
// Send Transaction
// =============================================================================

/**
 * Send BTC or LTC transaction.
 *
 * Builds, signs, and broadcasts a transaction:
 * 1. Fetches available UTXOs
 * 2. Selects UTXOs to cover amount + estimated fee
 * 3. Builds transaction with recipient and change outputs
 * 4. Signs each input with the private key
 * 5. Broadcasts the signed transaction to the network
 *
 * Sweep Mode (sweep=true):
 * - Uses ALL available UTXOs as inputs
 * - Creates only one output (recipient, no change)
 * - Sends the maximum possible amount minus fee
 * - Used for "send max" or wallet emptying
 *
 * Normal Mode (sweep=false):
 * - Selects UTXOs to cover amount + fee
 * - Creates two outputs (recipient + change)
 * - Change goes back to the wallet
 *
 * @param asset - 'btc' or 'ltc'
 * @param recipientAddress - Destination address
 * @param amount - Amount to send in satoshis
 * @param feeRate - Fee rate in satoshis per virtual byte
 * @param sweep - If true, send all UTXOs with no change
 * @returns Transaction ID and actual amounts
 */
export async function handleSendTx(
  asset: 'btc' | 'ltc',
  recipientAddress: string,
  amount: number,
  feeRate: number,
  sweep: boolean = false
): Promise<MessageResponse<{ txid: string; fee: number; actualAmount: number }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  const privateKey = unlockedKeys.get(asset);
  if (!privateKey) {
    return { success: false, error: `No ${asset} key available` };
  }

  const state = await getWalletState();
  const key = state.keys[asset];
  if (!key) {
    return { success: false, error: `No ${asset} key found` };
  }

  // Get our address (for change output)
  const changeAddress = getAddressForAsset(asset, key);

  // Fetch UTXOs
  const utxoResult = await api.getUtxos(asset, changeAddress);
  if (utxoResult.error || !utxoResult.data) {
    return { success: false, error: utxoResult.error || 'Failed to fetch UTXOs' };
  }

  const utxos = utxoResult.data.utxos;
  if (utxos.length === 0) {
    return { success: false, error: 'No UTXOs available' };
  }

  try {
    // Build and sign transaction
    // In sweep mode: uses all UTXOs, no change output
    // In normal mode: selects UTXOs, creates change output
    const { txHex, fee, actualAmount } = createSignedTransaction(
      asset,
      utxos,
      recipientAddress,
      amount,
      changeAddress,
      privateKey,
      feeRate,
      sweep
    );

    // Broadcast transaction
    const broadcastResult = await api.broadcastTx(asset, txHex);
    if (broadcastResult.error) {
      return { success: false, error: broadcastResult.error };
    }

    console.log(`[Send] ${asset.toUpperCase()} tx broadcast:`, broadcastResult.data!.txid, sweep ? '(sweep)' : '');

    return {
      success: true,
      data: {
        txid: broadcastResult.data!.txid,
        fee,
        actualAmount,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create transaction',
    };
  }
}

// =============================================================================
// Pending Transaction Tracking
// =============================================================================

/**
 * Add a pending outgoing transaction to track.
 *
 * Pending transactions are subtracted from displayed balance until
 * they're confirmed. This prevents showing stale balance after sending.
 *
 * @param txHash - Transaction hash
 * @param asset - Asset type
 * @param amount - Amount sent in atomic units
 * @param fee - Transaction fee in atomic units
 * @returns Add status
 */
export async function handleAddPendingTx(
  txHash: string,
  asset: AssetType,
  amount: number,
  fee: number
): Promise<MessageResponse<{ added: boolean }>> {
  await addPendingTx({
    txHash,
    asset,
    amount,
    fee,
    timestamp: Date.now(),
  });
  return { success: true, data: { added: true } };
}

/**
 * Get pending outgoing transactions for an asset.
 *
 * Returns transactions that have been sent but may not yet be
 * reflected in blockchain queries. Used to adjust displayed balance.
 *
 * @param asset - Asset type to filter by
 * @returns Array of pending transactions
 */
export async function handleGetPendingTxs(
  asset: AssetType
): Promise<MessageResponse<{
  pending: Array<{
    txHash: string;
    amount: number;
    fee: number;
    timestamp: number;
  }>;
}>> {
  const pending = await getPendingTxs(asset);
  return {
    success: true,
    data: {
      pending: pending.map(tx => ({
        txHash: tx.txHash,
        amount: tx.amount,
        fee: tx.fee,
        timestamp: tx.timestamp,
      })),
    },
  };
}
