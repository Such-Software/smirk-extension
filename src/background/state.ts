/**
 * Background State Management
 *
 * This module manages the in-memory state of the background service worker:
 * - Decrypted keys (cleared on lock)
 * - Session persistence (survives service worker restarts)
 * - Pending transactions tracking
 * - Approval request management
 *
 * State is stored in memory and optionally persisted to chrome.storage.session
 * for survival across service worker restarts (but clears on browser close).
 */

import type { AssetType } from '@/types';
import { bytesToHex, hexToBytes } from '@/lib/crypto';
import { storage } from '@/lib/browser';
import { initGrinWalletFromExtendedKey, type GrinKeys } from '@/lib/grin';

// =============================================================================
// Constants
// =============================================================================

/** Session storage key for persisting unlock state across service worker restarts */
export const SESSION_KEYS_KEY = 'smirk_session_keys';

/** Storage key for pending outgoing transactions (not yet confirmed) */
export const PENDING_TXS_KEY = 'smirk_pending_txs';

/** Auto-lock alarm name (uses chrome.alarms API for persistence) */
export const AUTO_LOCK_ALARM = 'smirk_auto_lock';

// =============================================================================
// Types
// =============================================================================

/** Data structure for session-persisted keys */
export interface SessionKeysData {
  /** Asset type -> hex-encoded private key */
  unlockedKeys: Record<string, string>;
  /** 'xmr' | 'wow' -> hex-encoded view key */
  unlockedViewKeys: Record<string, string>;
  /** Hex-encoded 64-byte extended private key for Grin WASM operations */
  grinExtendedPrivateKey?: string;
  /** BIP39 mnemonic for Grin init (session storage clears on browser close) */
  mnemonic?: string;
}

/** Pending outgoing transaction record */
export interface PendingTx {
  /** Transaction hash */
  txHash: string;
  /** Asset type */
  asset: AssetType;
  /** Amount sent in atomic units (including fee) */
  amount: number;
  /** Transaction fee in atomic units */
  fee: number;
  /** Timestamp when sent (ms since epoch) */
  timestamp: number;
}

/** Pending approval request from window.smirk API */
export interface PendingApprovalRequest {
  /** Unique request ID */
  id: string;
  /** Request type: connect (for site access) or sign (for message signing) */
  type: 'connect' | 'sign';
  /** Origin of the requesting website */
  origin: string;
  /** Human-readable site name */
  siteName: string;
  /** Site favicon URL */
  favicon?: string;
  /** Message to sign (for sign requests) */
  message?: string;
  /** Promise resolver */
  resolve: (value: unknown) => void;
  /** Promise rejecter */
  reject: (error: Error) => void;
  /** ID of the approval popup window */
  windowId?: number;
}

// =============================================================================
// Global State
// =============================================================================

/** Pending claim data from content script (tip link detection) */
export let pendingClaim: { linkId: string; fragmentKey?: string } | null = null;

/** Temporary mnemonic during wallet creation (cleared after confirmation) */
export let pendingMnemonic: string | null = null;

/** In-memory decrypted private keys (cleared on lock) */
export const unlockedKeys: Map<AssetType, Uint8Array> = new Map();

/** View keys for XMR/WOW (needed for balance queries) */
export const unlockedViewKeys: Map<'xmr' | 'wow', Uint8Array> = new Map();

/** Whether the wallet is currently unlocked */
export let isUnlocked = false;

/** Cached Grin WASM wallet keys (derived from mnemonic when needed) */
export let grinWasmKeys: GrinKeys | null = null;

/** Decrypted BIP39 seed (64 bytes) - kept for backwards compatibility */
export let unlockedSeed: Uint8Array | null = null;

/** Decrypted mnemonic string for Grin WASM operations - cleared on lock */
export let unlockedMnemonic: string | null = null;

/** Map of pending approval requests by ID */
export const pendingApprovals = new Map<string, PendingApprovalRequest>();

/** Counter for generating unique approval request IDs */
export let approvalRequestId = 0;

/** Cached auto-lock minutes setting (avoids reading storage on every activity) */
export let cachedAutoLockMinutes: number | null = null;

/** Promise that resolves when background initialization is complete */
export let initializationPromise: Promise<void> | null = null;

// =============================================================================
// State Setters (for updating module-level variables from other modules)
// =============================================================================

export function setPendingClaim(value: { linkId: string; fragmentKey?: string } | null): void {
  pendingClaim = value;
}

export function setPendingMnemonic(value: string | null): void {
  pendingMnemonic = value;
}

export function setIsUnlocked(value: boolean): void {
  isUnlocked = value;
}

export function setGrinWasmKeys(value: GrinKeys | null): void {
  grinWasmKeys = value;
}

export function setUnlockedSeed(value: Uint8Array | null): void {
  unlockedSeed = value;
}

export function setUnlockedMnemonic(value: string | null): void {
  unlockedMnemonic = value;
}

export function incrementApprovalRequestId(): number {
  return ++approvalRequestId;
}

export function setCachedAutoLockMinutes(value: number | null): void {
  cachedAutoLockMinutes = value;
}

export function setInitializationPromise(value: Promise<void> | null): void {
  initializationPromise = value;
}

// =============================================================================
// Session Key Persistence
// =============================================================================

/**
 * Persist decrypted keys to session storage.
 *
 * Session storage survives service worker restarts but clears on browser close.
 * This allows the wallet to remain unlocked across service worker suspensions
 * without requiring the user to re-enter their password.
 */
export async function persistSessionKeys(): Promise<void> {
  const keysData: Record<string, string> = {};
  const viewKeysData: Record<string, string> = {};

  // Convert Map entries to hex strings
  for (const [asset, key] of unlockedKeys) {
    keysData[asset] = bytesToHex(key);
  }
  for (const [asset, key] of unlockedViewKeys) {
    viewKeysData[asset] = bytesToHex(key);
  }

  const sessionData: SessionKeysData = {
    unlockedKeys: keysData,
    unlockedViewKeys: viewKeysData,
  };

  // Include Grin extended private key if available (for Grin WASM operations after restart)
  if (grinWasmKeys?.extendedPrivateKey) {
    sessionData.grinExtendedPrivateKey = bytesToHex(grinWasmKeys.extendedPrivateKey);
  }

  // Include mnemonic for Grin first-time init after service worker restart
  // Session storage clears on browser close, so this is reasonably safe
  if (unlockedMnemonic) {
    sessionData.mnemonic = unlockedMnemonic;
  }

  await storage.session.set({
    [SESSION_KEYS_KEY]: sessionData,
  });
  console.log('[Session] Persisted keys to session storage');
}

/**
 * Restore decrypted keys from session storage after service worker restart.
 *
 * This is called during initialization to check if the wallet was previously
 * unlocked before the service worker was suspended.
 *
 * @returns True if keys were restored, false otherwise
 */
export async function restoreSessionKeys(): Promise<boolean> {
  const data = await storage.session.get<{ [SESSION_KEYS_KEY]?: SessionKeysData }>([SESSION_KEYS_KEY]);
  const sessionData = data[SESSION_KEYS_KEY];

  if (!sessionData) {
    console.log('[Session] No session keys found');
    return false;
  }

  // Restore unlocked keys
  for (const [asset, hexKey] of Object.entries(sessionData.unlockedKeys)) {
    unlockedKeys.set(asset as AssetType, hexToBytes(hexKey));
  }

  // Restore view keys
  for (const [asset, hexKey] of Object.entries(sessionData.unlockedViewKeys)) {
    unlockedViewKeys.set(asset as 'xmr' | 'wow', hexToBytes(hexKey));
  }

  // Restore mnemonic for Grin first-time init
  if (sessionData.mnemonic) {
    unlockedMnemonic = sessionData.mnemonic;
    console.log('[Session] Restored mnemonic from session storage');
  }

  // Restore Grin extended private key (for Grin WASM operations)
  // This allows Grin wallet to work after service worker restart without re-deriving
  if (sessionData.grinExtendedPrivateKey) {
    try {
      const extendedKey = hexToBytes(sessionData.grinExtendedPrivateKey);
      grinWasmKeys = await initGrinWalletFromExtendedKey(extendedKey);
      console.log('[Session] Restored Grin WASM keys from extended private key');
    } catch (err) {
      console.warn('[Session] Failed to restore Grin WASM keys:', err);
      // Non-fatal - mnemonic is restored, so Grin can be re-initialized
    }
  }

  if (unlockedKeys.size > 0) {
    isUnlocked = true;
    console.log('[Session] Restored keys from session storage, assets:', Array.from(unlockedKeys.keys()));
    return true;
  }

  return false;
}

/**
 * Clear session keys on lock.
 *
 * Called when the user locks the wallet to ensure keys are not
 * persisted in session storage.
 */
export async function clearSessionKeys(): Promise<void> {
  await storage.session.remove([SESSION_KEYS_KEY]);
  console.log('[Session] Cleared session keys');
}

/**
 * Clear all in-memory keys.
 *
 * Called when locking the wallet to ensure no sensitive data remains in memory.
 */
export function clearInMemoryKeys(): void {
  unlockedKeys.clear();
  unlockedViewKeys.clear();
  grinWasmKeys = null;
  unlockedSeed = null;
  unlockedMnemonic = null;
  isUnlocked = false;
}

// =============================================================================
// Pending Transaction Management
// =============================================================================

/**
 * Add a pending outgoing transaction.
 *
 * Pending transactions are subtracted from the displayed balance until they
 * are confirmed. This prevents the UI from showing a stale balance immediately
 * after sending a transaction.
 *
 * @param tx - The pending transaction to add
 */
export async function addPendingTx(tx: PendingTx): Promise<void> {
  const result = await storage.local.get(PENDING_TXS_KEY) as Record<string, PendingTx[] | undefined>;
  const pending: PendingTx[] = result[PENDING_TXS_KEY] || [];
  pending.push(tx);
  await storage.local.set({ [PENDING_TXS_KEY]: pending });
  console.log(`[PendingTx] Added pending tx: ${tx.txHash} (${tx.amount} ${tx.asset})`);
}

/**
 * Clean up old pending transactions.
 *
 * After sufficient time passes for confirmations, the blockchain service
 * (LWS for XMR/WOW) should reflect the spend, so we can remove from our
 * pending list. This prevents stale pending transactions from permanently
 * affecting the displayed balance.
 *
 * Age thresholds:
 * - XMR: 30 minutes (10 confirmations at ~2 min/block with buffer)
 * - WOW: 5 minutes (10 confirmations at ~12s/block with buffer)
 */
export async function cleanupOldPendingTxs(): Promise<void> {
  const now = Date.now();
  const result = await storage.local.get(PENDING_TXS_KEY) as Record<string, PendingTx[] | undefined>;
  const pending: PendingTx[] = result[PENDING_TXS_KEY] || [];

  // Age thresholds in ms (conservative to avoid removing too early)
  const ageThresholds: Record<string, number> = {
    xmr: 30 * 60 * 1000, // 30 minutes for XMR
    wow: 5 * 60 * 1000,  // 5 minutes for WOW
  };

  const updated = pending.filter(tx => {
    const threshold = ageThresholds[tx.asset] || 30 * 60 * 1000;
    const age = now - tx.timestamp;
    if (age > threshold) {
      console.log(`[PendingTx] Removing old pending tx ${tx.txHash} (age: ${Math.round(age / 60000)}min)`);
      return false;
    }
    return true;
  });

  if (updated.length < pending.length) {
    await storage.local.set({ [PENDING_TXS_KEY]: updated });
  }
}

/**
 * Get pending outgoing transactions for an asset.
 *
 * Also cleans up old pending transactions that should be confirmed by now.
 *
 * @param asset - The asset type to filter by
 * @returns Array of pending transactions for the asset
 */
export async function getPendingTxs(asset: AssetType): Promise<PendingTx[]> {
  // Clean up old pending txs first
  await cleanupOldPendingTxs();

  const result = await storage.local.get(PENDING_TXS_KEY) as Record<string, PendingTx[] | undefined>;
  const pending: PendingTx[] = result[PENDING_TXS_KEY] || [];
  return pending.filter(tx => tx.asset === asset);
}

/**
 * Remove a pending transaction by hash (when confirmed).
 *
 * Called when we detect that a previously pending transaction has been
 * confirmed on the blockchain.
 *
 * @param txHash - The transaction hash to remove
 */
export async function removePendingTx(txHash: string): Promise<void> {
  const result = await storage.local.get(PENDING_TXS_KEY) as Record<string, PendingTx[] | undefined>;
  const pending: PendingTx[] = result[PENDING_TXS_KEY] || [];
  const updated = pending.filter(tx => tx.txHash !== txHash);
  await storage.local.set({ [PENDING_TXS_KEY]: updated });
  if (updated.length < pending.length) {
    console.log(`[PendingTx] Removed confirmed tx: ${txHash}`);
  }
}

/**
 * Get total pending outgoing amount for an asset.
 *
 * Used to subtract from displayed balance to show the "real" available balance.
 *
 * @param asset - The asset type
 * @returns Total pending amount in atomic units (amount + fee)
 */
export async function getPendingOutgoingAmount(asset: AssetType): Promise<number> {
  const pending = await getPendingTxs(asset);
  return pending.reduce((sum, tx) => sum + tx.amount + tx.fee, 0);
}
