/**
 * Wallet State Module
 *
 * Handlers for querying wallet and onboarding state.
 */

import type { MessageResponse, AssetType, OnboardingState } from '@/types';
import {
  getWalletState,
  getOnboardingState,
  saveOnboardingState,
  clearOnboardingState,
} from '@/lib/storage';
import { isUnlocked, pendingMnemonic } from '../state';

// =============================================================================
// Wallet State
// =============================================================================

/**
 * Get the current wallet state.
 *
 * Returns information about the wallet including:
 * - Whether it's unlocked
 * - Whether a wallet exists
 * - Which assets are configured
 * - Whether backup has been confirmed
 *
 * @returns Wallet state information
 */
export async function handleGetWalletState(): Promise<MessageResponse<{
  isUnlocked: boolean;
  hasWallet: boolean;
  assets: AssetType[];
  needsBackup: boolean;
}>> {
  const state = await getWalletState();
  const hasWallet = !!state.encryptedSeed;
  const assets = (Object.keys(state.keys) as AssetType[]).filter(
    (k) => state.keys[k] !== undefined
  );

  return {
    success: true,
    data: {
      isUnlocked,
      hasWallet,
      assets,
      needsBackup: hasWallet && !state.backupConfirmed,
    },
  };
}

// =============================================================================
// Onboarding State
// =============================================================================

/**
 * Get current onboarding state.
 *
 * Used to resume onboarding if popup is closed and reopened.
 *
 * @returns Current onboarding state or null
 */
export async function handleGetOnboardingState(): Promise<MessageResponse<{ state: OnboardingState | null }>> {
  const state = await getOnboardingState();
  return { success: true, data: { state } };
}

/**
 * Save onboarding state.
 *
 * Persists onboarding progress so it survives popup close/reopen.
 *
 * @param state - Onboarding state to save
 * @returns Save status
 */
export async function handleSaveOnboardingState(
  state: OnboardingState
): Promise<MessageResponse<{ saved: boolean }>> {
  await saveOnboardingState(state);
  return { success: true, data: { saved: true } };
}

/**
 * Clear onboarding state.
 *
 * Called when onboarding is complete or cancelled.
 *
 * @returns Clear status
 */
export async function handleClearOnboardingState(): Promise<MessageResponse<{ cleared: boolean }>> {
  await clearOnboardingState();
  return { success: true, data: { cleared: true } };
}

/**
 * Get pending mnemonic from service worker memory.
 *
 * Returns the mnemonic words currently held in memory during onboarding.
 * Returns null if service worker restarted (mnemonic lost — user must restart onboarding).
 * This avoids storing plaintext seed phrases in persistent storage.
 */
export function handleGetPendingMnemonic(): MessageResponse<{ words: string[] | null }> {
  const words = pendingMnemonic ? pendingMnemonic.split(' ') : null;
  return { success: true, data: { words } };
}
