/**
 * Balance Module
 *
 * This module handles balance queries for all supported assets:
 * - BTC/LTC: Query via Electrum servers
 * - XMR/WOW: Query via Light Wallet Server (LWS)
 * - Grin: Query via backend database (tracks outputs/transactions)
 *
 * XMR/WOW Balance Verification:
 * The LWS returns `total_received` and `spent_outputs` (candidate spends).
 * The popup performs client-side verification using WASM to compute key images
 * and confirm which outputs are actually spent. This ensures the server cannot
 * lie about spent outputs - balance is cryptographically verified.
 *
 * Pending Transactions:
 * Recently sent transactions may not yet be reflected in blockchain queries.
 * We track pending outgoing transactions and subtract them from displayed
 * balance until they're confirmed.
 */

import type { MessageResponse, AssetType } from '@/types';
import { bytesToHex } from '@/lib/crypto';
import { getWalletState, getAuthState } from '@/lib/storage';
import { api } from '@/lib/api';
import { isUnlocked, unlockedKeys, unlockedViewKeys } from './state';
import { getAddressForAsset } from './wallet';

// =============================================================================
// Balance Queries
// =============================================================================

/**
 * Get balance for a specific asset.
 *
 * Different assets use different backend services:
 * - BTC/LTC: Electrum servers (fast UTXO-based queries)
 * - XMR/WOW: Light Wallet Server (scans blockchain with view key)
 * - Grin: Backend database (tracks outputs and transactions)
 *
 * For XMR/WOW, returns raw LWS data plus keys so the popup can verify
 * spent outputs client-side using WASM. This prevents the server from
 * lying about spent funds.
 *
 * @param asset - Asset type to query balance for
 * @returns Balance information (format varies by asset type)
 */
export async function handleGetBalance(
  asset: AssetType
): Promise<MessageResponse<
  | { asset: AssetType; confirmed: number; unconfirmed: number; total: number }
  | {
      asset: 'xmr' | 'wow';
      total_received: number;
      locked_balance: number;
      pending_balance: number;
      spent_outputs: Array<{ amount: number; key_image: string; tx_pub_key: string; out_index: number }>;
      viewKeyHex: string;
      publicSpendKey: string;
      spendKeyHex: string;
      needsVerification: true;
    }
>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  const state = await getWalletState();
  const key = state.keys[asset];

  if (!key) {
    return { success: false, error: `No ${asset} key found` };
  }

  try {
    // Get the address for this asset
    const address = getAddressForAsset(asset, key);

    if (asset === 'btc' || asset === 'ltc') {
      return handleUtxoBalance(asset, address);
    } else if (asset === 'xmr' || asset === 'wow') {
      return handleLwsBalance(asset, address, key);
    } else if (asset === 'grin') {
      return handleGrinBalance(asset);
    } else {
      return { success: false, error: `Unknown asset: ${asset}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch balance',
    };
  }
}

/**
 * Get balance for UTXO-based coins (BTC/LTC) via Electrum.
 *
 * Returns confirmed and unconfirmed balances. Unconfirmed balance includes
 * both incoming (pending receive) and outgoing (pending send) transactions.
 *
 * @param asset - 'btc' or 'ltc'
 * @param address - Wallet address to query
 * @returns Balance breakdown
 */
async function handleUtxoBalance(
  asset: 'btc' | 'ltc',
  address: string
): Promise<MessageResponse<{ asset: AssetType; confirmed: number; unconfirmed: number; total: number }>> {
  const result = await api.getUtxoBalance(asset, address);

  if (result.error) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: {
      asset,
      confirmed: result.data!.confirmed,
      unconfirmed: result.data!.unconfirmed,
      total: result.data!.total,
    },
  };
}

/**
 * Get balance for CryptoNote coins (XMR/WOW) via LWS.
 *
 * Returns raw LWS data plus keys for client-side verification.
 * The popup uses WASM to verify spent outputs by computing key images:
 * 1. For each candidate spent output, compute expected key image
 * 2. Only count outputs where computed key image matches server's
 * 3. True balance = total_received - sum(verified_spent_amounts)
 *
 * This cryptographic verification ensures the server cannot lie about
 * which outputs are spent.
 *
 * @param asset - 'xmr' or 'wow'
 * @param address - Wallet address
 * @param key - Key data with public spend key
 * @returns Raw balance data plus keys for verification
 */
async function handleLwsBalance(
  asset: 'xmr' | 'wow',
  address: string,
  key: { publicKey: string; publicSpendKey?: string; publicViewKey?: string }
): Promise<MessageResponse<{
  asset: 'xmr' | 'wow';
  total_received: number;
  locked_balance: number;
  pending_balance: number;
  spent_outputs: Array<{ amount: number; key_image: string; tx_pub_key: string; out_index: number }>;
  viewKeyHex: string;
  publicSpendKey: string;
  spendKeyHex: string;
  needsVerification: true;
}>> {
  const viewKey = unlockedViewKeys.get(asset);
  if (!viewKey) {
    return { success: false, error: `No ${asset} view key available` };
  }

  const spendKey = unlockedKeys.get(asset);
  if (!spendKey) {
    return { success: false, error: `No ${asset} spend key available` };
  }

  const viewKeyHex = bytesToHex(viewKey);
  const spendKeyHex = bytesToHex(spendKey);
  const publicSpendKey = key.publicSpendKey;

  if (!publicSpendKey) {
    return { success: false, error: `No ${asset} public spend key found` };
  }

  const result = await api.getLwsBalance(asset, address, viewKeyHex);

  if (result.error) {
    return { success: false, error: result.error };
  }

  // Return raw LWS data + keys for popup to verify with WASM
  // WASM can't run in service worker, so popup does the verification
  return {
    success: true,
    data: {
      asset,
      // Raw LWS data
      total_received: result.data!.total_received,
      locked_balance: result.data!.locked_balance,
      pending_balance: result.data!.pending_balance,
      spent_outputs: result.data!.spent_outputs,
      // Keys needed for verification (popup will use these with WASM)
      viewKeyHex,
      publicSpendKey,
      spendKeyHex,
      // Flag to indicate this needs client-side verification
      needsVerification: true,
    },
  };
}

/**
 * Get balance for Grin via backend database.
 *
 * Grin balance is tracked in the backend's grin_transactions table:
 * - Confirmed: Sum of finalized/confirmed transactions
 * - Pending: Sum of pending/signed transactions (not yet broadcast)
 *
 * Unlike XMR/WOW, Grin doesn't need client-side verification because
 * the user initiated all transactions through the extension.
 *
 * @param asset - 'grin'
 * @returns Balance breakdown
 */
async function handleGrinBalance(
  asset: 'grin'
): Promise<MessageResponse<{ asset: AssetType; confirmed: number; unconfirmed: number; total: number }>> {
  const authState = await getAuthState();
  if (!authState?.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await api.getGrinUserBalance(authState.userId);

  if (result.error) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: {
      asset,
      confirmed: result.data!.confirmed,
      unconfirmed: result.data!.pending,
      total: result.data!.total,
    },
  };
}

// =============================================================================
// Transaction History
// =============================================================================

/**
 * Get transaction history for any asset.
 *
 * Different assets use different backend services:
 * - BTC/LTC: Electrum servers
 * - XMR/WOW: Light Wallet Server
 * - Grin: Backend database
 *
 * Returns a normalized format with txid, height, amounts, and status.
 * For Grin, also includes kernel_excess for block explorer links.
 *
 * @param asset - Asset type to query history for
 * @returns Array of transactions (newest first)
 */
export async function handleGetHistory(
  asset: AssetType
): Promise<MessageResponse<{
  transactions: Array<{
    txid: string;
    height: number;
    fee?: number;
    is_pending?: boolean;
    is_cancelled?: boolean;
    status?: string;
    direction?: string;
    total_received?: number;
    total_sent?: number;
    kernel_excess?: string;
  }>;
}>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  const state = await getWalletState();
  const key = state.keys[asset];
  if (!key) {
    return { success: false, error: `No ${asset} key found` };
  }

  const address = getAddressForAsset(asset, key);

  if (asset === 'btc' || asset === 'ltc') {
    return handleUtxoHistory(asset, address);
  } else if (asset === 'xmr' || asset === 'wow') {
    return handleLwsHistory(asset, address);
  } else if (asset === 'grin') {
    return handleGrinHistory();
  } else {
    return { success: false, error: `History not supported for ${asset}` };
  }
}

/**
 * Get transaction history for UTXO coins via Electrum.
 *
 * @param asset - 'btc' or 'ltc'
 * @param address - Wallet address
 * @returns Transaction history
 */
async function handleUtxoHistory(
  asset: 'btc' | 'ltc',
  address: string
): Promise<MessageResponse<{ transactions: Array<{ txid: string; height: number; fee?: number; is_pending?: boolean; total_received?: number; total_sent?: number }> }>> {
  const result = await api.getHistory(asset, address);
  if (result.error) {
    return { success: false, error: result.error };
  }
  return { success: true, data: { transactions: result.data!.transactions } };
}

/**
 * Get transaction history for CryptoNote coins via LWS.
 *
 * @param asset - 'xmr' or 'wow'
 * @param address - Wallet address
 * @returns Transaction history
 */
async function handleLwsHistory(
  asset: 'xmr' | 'wow',
  address: string
): Promise<MessageResponse<{ transactions: Array<{ txid: string; height: number; is_pending?: boolean; total_received?: number; total_sent?: number }> }>> {
  const viewKey = unlockedViewKeys.get(asset);
  if (!viewKey) {
    return { success: false, error: `No ${asset} view key available` };
  }

  const result = await api.getLwsHistory(asset, address, bytesToHex(viewKey));
  if (result.error) {
    return { success: false, error: result.error };
  }

  // Map LWS format to common format
  const transactions = result.data!.transactions.map(tx => ({
    txid: tx.txid,
    height: tx.height,
    is_pending: tx.is_pending,
    total_received: tx.total_received,
    total_sent: tx.total_sent,
  }));

  return { success: true, data: { transactions } };
}

/**
 * Get transaction history for Grin via backend database.
 *
 * Includes Grin-specific fields like kernel_excess for block explorer links.
 *
 * @returns Transaction history with Grin-specific data
 */
async function handleGrinHistory(): Promise<MessageResponse<{
  transactions: Array<{
    txid: string;
    height: number;
    is_pending?: boolean;
    is_cancelled?: boolean;
    status?: string;
    direction?: string;
    total_received?: number;
    total_sent?: number;
    kernel_excess?: string;
  }>;
}>> {
  const authState = await getAuthState();
  if (!authState?.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  const result = await api.getGrinUserHistory(authState.userId);
  if (result.error) {
    return { success: false, error: result.error };
  }

  // Map to common format - use slate_id as txid equivalent
  const transactions = result.data!.transactions.map(tx => ({
    txid: tx.slate_id,
    height: tx.status === 'confirmed' ? 1 : 0, // Placeholder - we don't track block height yet
    is_pending: tx.status === 'pending' || tx.status === 'signed',
    is_cancelled: tx.status === 'cancelled',
    status: tx.status,
    direction: tx.direction,
    total_received: tx.direction === 'receive' ? tx.amount : 0,
    total_sent: tx.direction === 'send' ? tx.amount + tx.fee : 0,
    kernel_excess: tx.kernel_excess ?? undefined,
  }));

  return { success: true, data: { transactions } };
}

// =============================================================================
// Fee Estimation
// =============================================================================

/**
 * Estimate fee rates for BTC or LTC.
 *
 * Returns three fee levels:
 * - fast: ~10 minute confirmation (1-2 blocks)
 * - normal: ~30 minute confirmation (3-6 blocks)
 * - slow: ~1 hour confirmation (6+ blocks)
 *
 * Fee rates are in satoshis per byte (sat/vB).
 *
 * @param asset - 'btc' or 'ltc'
 * @returns Fee rate estimates
 */
export async function handleEstimateFee(
  asset: 'btc' | 'ltc'
): Promise<MessageResponse<{ fast: number | null; normal: number | null; slow: number | null }>> {
  const result = await api.estimateFee(asset);

  if (result.error) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: {
      fast: result.data!.fast,
      normal: result.data!.normal,
      slow: result.data!.slow,
    },
  };
}

// =============================================================================
// Wallet Keys (for client-side tx signing)
// =============================================================================

/**
 * Get wallet keys for XMR/WOW (needed for client-side transaction signing).
 *
 * Returns the address plus private view and spend keys.
 * The popup uses these with WASM to:
 * 1. Build transactions locally
 * 2. Sign transactions with spend key
 * 3. Verify key images for balance calculation
 *
 * @param asset - 'xmr' or 'wow'
 * @returns Address and private keys
 */
export async function handleGetWalletKeys(
  asset: 'xmr' | 'wow'
): Promise<MessageResponse<{ address: string; viewKey: string; spendKey: string }>> {
  if (!isUnlocked) {
    return { success: false, error: 'Wallet is locked' };
  }

  const spendKey = unlockedKeys.get(asset);
  const viewKey = unlockedViewKeys.get(asset);

  if (!spendKey || !viewKey) {
    return { success: false, error: `No ${asset} keys available` };
  }

  const state = await getWalletState();
  const key = state.keys[asset];
  if (!key) {
    return { success: false, error: `No ${asset} key found` };
  }

  // Get address
  const address = getAddressForAsset(asset, key);

  return {
    success: true,
    data: {
      address,
      viewKey: bytesToHex(viewKey),
      spendKey: bytesToHex(spendKey),
    },
  };
}
