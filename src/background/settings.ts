/**
 * Settings and Auto-lock Management
 *
 * This module handles user settings and the auto-lock timer functionality.
 * The auto-lock timer uses chrome.alarms API to survive service worker
 * restarts and automatically lock the wallet after a period of inactivity.
 */

import type { MessageResponse, UserSettings } from '@/types';
import { getWalletState, saveWalletState } from '@/lib/storage';
import { alarms } from '@/lib/browser';
import {
  AUTO_LOCK_ALARM,
  cachedAutoLockMinutes,
  setCachedAutoLockMinutes,
  isUnlocked,
  clearSessionKeys,
  clearInMemoryKeys,
} from './state';

// =============================================================================
// Settings Handlers
// =============================================================================

/**
 * Get user settings.
 *
 * Returns the current user settings including:
 * - autoLockMinutes: How long until wallet auto-locks (0 = disabled)
 * - theme: 'dark' | 'light' | 'system'
 *
 * @returns User settings object
 */
export async function handleGetSettings(): Promise<MessageResponse<{ settings: UserSettings }>> {
  const state = await getWalletState();
  return { success: true, data: { settings: state.settings } };
}

/**
 * Update user settings.
 *
 * Merges the provided settings with existing settings and persists to storage.
 * If auto-lock setting changed, resets the auto-lock timer.
 *
 * @param settings - Partial settings object to merge
 * @returns The updated settings
 */
export async function handleUpdateSettings(
  settings: Partial<UserSettings>
): Promise<MessageResponse<{ settings: UserSettings }>> {
  const state = await getWalletState();
  const updatedSettings = { ...state.settings, ...settings };
  await saveWalletState({ ...state, settings: updatedSettings });

  // Update cached auto-lock minutes
  if (settings.autoLockMinutes !== undefined) {
    setCachedAutoLockMinutes(settings.autoLockMinutes);
    // Restart timer with new setting
    if (isUnlocked) {
      resetAutoLockTimer();
    }
  }

  return { success: true, data: { settings: updatedSettings } };
}

// =============================================================================
// Auto-Lock Timer
// =============================================================================

/**
 * Reset the auto-lock timer.
 *
 * Called on user activity to extend the auto-lock deadline.
 * Uses chrome.alarms API which persists across service worker restarts.
 *
 * @returns Success response
 */
export async function handleResetAutoLockTimer(): Promise<MessageResponse<{ reset: boolean }>> {
  if (!isUnlocked) {
    return { success: true, data: { reset: false } };
  }
  resetAutoLockTimer();
  return { success: true, data: { reset: true } };
}

/**
 * Reset the auto-lock timer with current settings.
 *
 * If auto-lock is enabled (minutes > 0), creates a chrome.alarm that will
 * fire when the timer expires. If auto-lock is disabled, clears any existing
 * alarm.
 *
 * This is called:
 * - On unlock
 * - On user activity (popup interactions)
 * - When auto-lock setting changes
 */
export async function resetAutoLockTimer(): Promise<void> {
  // Get auto-lock setting (use cache if available)
  if (cachedAutoLockMinutes === null) {
    const state = await getWalletState();
    setCachedAutoLockMinutes(state.settings.autoLockMinutes);
  }

  const minutes = cachedAutoLockMinutes;

  if (minutes && minutes > 0) {
    // Create alarm that fires after specified minutes
    await alarms.create(AUTO_LOCK_ALARM, {
      delayInMinutes: minutes,
    });
    console.log(`[AutoLock] Timer reset: ${minutes} minutes`);
  } else {
    // Auto-lock disabled, clear any existing alarm
    await alarms.clear(AUTO_LOCK_ALARM);
    console.log('[AutoLock] Timer disabled');
  }
}

/**
 * Start the auto-lock timer.
 *
 * Called when wallet is unlocked to begin tracking inactivity.
 */
export async function startAutoLockTimer(): Promise<void> {
  await resetAutoLockTimer();
}

/**
 * Stop the auto-lock timer.
 *
 * Called when wallet is locked to prevent the timer from firing.
 */
export async function stopAutoLockTimer(): Promise<void> {
  await alarms.clear(AUTO_LOCK_ALARM);
  console.log('[AutoLock] Timer stopped');
}

/**
 * Handle auto-lock alarm firing.
 *
 * Called when the auto-lock alarm fires (user has been inactive).
 * Locks the wallet by clearing in-memory and session keys.
 */
export async function handleAutoLockAlarm(): Promise<void> {
  console.log('[AutoLock] Timer expired, locking wallet');

  // Clear all keys
  clearInMemoryKeys();
  await clearSessionKeys();

  console.log('[AutoLock] Wallet locked due to inactivity');
}
