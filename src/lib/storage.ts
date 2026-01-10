/**
 * Storage utilities for the extension.
 * Uses chrome.storage.local for persistent storage.
 */

import type { WalletState, AssetType } from '@/types';

const STORAGE_KEYS = {
  WALLET_STATE: 'walletState',
  AUTH_STATE: 'authState',
} as const;

/**
 * Default wallet state.
 */
export const DEFAULT_WALLET_STATE: WalletState = {
  keys: {
    btc: undefined,
    ltc: undefined,
    xmr: undefined,
    wow: undefined,
    grin: undefined,
  },
  settings: {
    autoSweep: true,
    notifyOnTip: true,
    defaultAsset: 'btc',
  },
};

/**
 * Gets the wallet state from storage.
 */
export async function getWalletState(): Promise<WalletState> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.WALLET_STATE);
  return result[STORAGE_KEYS.WALLET_STATE] ?? DEFAULT_WALLET_STATE;
}

/**
 * Saves the wallet state to storage.
 */
export async function saveWalletState(state: WalletState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.WALLET_STATE]: state });
}

/**
 * Updates a specific key in the wallet state.
 */
export async function updateWalletKey(
  asset: AssetType,
  key: WalletState['keys'][AssetType]
): Promise<void> {
  const state = await getWalletState();
  state.keys[asset] = key;
  await saveWalletState(state);
}

/**
 * Auth state for API tokens.
 */
export interface AuthState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
}

/**
 * Gets the auth state from storage.
 */
export async function getAuthState(): Promise<AuthState | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.AUTH_STATE);
  return result[STORAGE_KEYS.AUTH_STATE] ?? null;
}

/**
 * Saves the auth state to storage.
 */
export async function saveAuthState(state: AuthState | null): Promise<void> {
  if (state) {
    await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_STATE]: state });
  } else {
    await chrome.storage.local.remove(STORAGE_KEYS.AUTH_STATE);
  }
}

/**
 * Clears all extension storage.
 */
export async function clearAllStorage(): Promise<void> {
  await chrome.storage.local.clear();
}
