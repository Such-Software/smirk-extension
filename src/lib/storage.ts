/**
 * Storage utilities for the extension.
 * Uses browser-agnostic storage API for cross-browser support.
 */

import type { WalletState, AssetType } from '@/types';
import { storage } from './browser';

const STORAGE_KEYS = {
  WALLET_STATE: 'walletState',
  AUTH_STATE: 'authState',
  ONBOARDING_STATE: 'onboardingState',
} as const;

/**
 * Default wallet state.
 */
export const DEFAULT_WALLET_STATE: WalletState = {
  encryptedSeed: undefined,
  seedSalt: undefined,
  backupConfirmed: false,
  walletBirthday: undefined,
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
    autoLockMinutes: 15, // Default: 15 minutes
  },
};

/**
 * Gets the wallet state from storage.
 */
export async function getWalletState(): Promise<WalletState> {
  const result = await storage.local.get<Record<string, WalletState>>(STORAGE_KEYS.WALLET_STATE);
  return result[STORAGE_KEYS.WALLET_STATE] ?? DEFAULT_WALLET_STATE;
}

/**
 * Saves the wallet state to storage.
 */
export async function saveWalletState(state: WalletState): Promise<void> {
  await storage.local.set({ [STORAGE_KEYS.WALLET_STATE]: state });
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
  const result = await storage.local.get<Record<string, AuthState>>(STORAGE_KEYS.AUTH_STATE);
  return result[STORAGE_KEYS.AUTH_STATE] ?? null;
}

/**
 * Saves the auth state to storage.
 */
export async function saveAuthState(state: AuthState | null): Promise<void> {
  if (state) {
    await storage.local.set({ [STORAGE_KEYS.AUTH_STATE]: state });
  } else {
    await storage.local.remove(STORAGE_KEYS.AUTH_STATE);
  }
}

/**
 * Clears all extension storage.
 */
export async function clearAllStorage(): Promise<void> {
  await storage.local.clear();
}

/**
 * Onboarding state - persists wallet creation progress across popup closes.
 */
export interface OnboardingState {
  step: 'choice' | 'generate' | 'verify' | 'password' | 'restore';
  words?: string[];
  verifyIndices?: number[];
  createdAt: number;
}

/**
 * Gets the onboarding state from storage.
 */
export async function getOnboardingState(): Promise<OnboardingState | null> {
  const result = await storage.local.get<Record<string, OnboardingState>>(STORAGE_KEYS.ONBOARDING_STATE);
  const state = result[STORAGE_KEYS.ONBOARDING_STATE];

  // Expire onboarding state after 1 hour for security
  if (state && Date.now() - state.createdAt > 60 * 60 * 1000) {
    await clearOnboardingState();
    return null;
  }

  return state ?? null;
}

/**
 * Saves the onboarding state to storage.
 */
export async function saveOnboardingState(state: OnboardingState): Promise<void> {
  await storage.local.set({ [STORAGE_KEYS.ONBOARDING_STATE]: state });
}

/**
 * Clears the onboarding state.
 */
export async function clearOnboardingState(): Promise<void> {
  await storage.local.remove(STORAGE_KEYS.ONBOARDING_STATE);
}
