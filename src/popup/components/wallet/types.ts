/**
 * Shared types for wallet components.
 */

import type { AssetType } from '@/types';

/**
 * Transaction history entry (common format for all assets).
 */
export interface TxHistoryEntry {
  txid: string;
  height: number;
  fee?: number;
  // XMR/WOW specific
  is_pending?: boolean;
  total_received?: number;
  total_sent?: number;
  // Grin specific - on-chain tx identifier (like txid for BTC)
  kernel_excess?: string;
  // Grin transaction status and metadata
  is_cancelled?: boolean;
  status?: string;
  direction?: 'send' | 'receive';
  input_ids?: string[]; // For cancelling pending sends
}

/**
 * Pending outgoing transaction (not yet confirmed).
 */
export interface PendingTx {
  txHash: string;
  asset: AssetType;
  amount: number;
  fee: number;
  timestamp: number;
}
