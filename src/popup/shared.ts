/**
 * Shared constants and utilities for popup components.
 */

import type { AssetType, MessageResponse } from '@/types';
import { runtime, storage } from '@/lib/browser';

// Asset display info with SVG icon paths
export const ASSETS: Record<AssetType, { name: string; symbol: string; iconPath: string }> = {
  btc: { name: 'Bitcoin', symbol: 'BTC', iconPath: 'icons/coins/bitcoin.svg' },
  ltc: { name: 'Litecoin', symbol: 'LTC', iconPath: 'icons/coins/litecoin.svg' },
  xmr: { name: 'Monero', symbol: 'XMR', iconPath: 'icons/coins/monero.svg' },
  wow: { name: 'Wownero', symbol: 'WOW', iconPath: 'icons/coins/wownero.svg' },
  grin: { name: 'Grin', symbol: 'GRIN', iconPath: 'icons/coins/grin.svg' },
};

// Atomic unit divisors per asset
export const ATOMIC_DIVISORS: Record<AssetType, number> = {
  btc: 100_000_000,      // 8 decimals (satoshis)
  ltc: 100_000_000,      // 8 decimals (litoshis)
  xmr: 1_000_000_000_000, // 12 decimals (piconero)
  wow: 100_000_000_000,   // 11 decimals (wowoshi) - NOT 12 like XMR!
  grin: 1_000_000_000,    // 9 decimals (nanogrin)
};

// Display decimals (shortened) - hover shows full
export const DISPLAY_DECIMALS: Record<AssetType, number> = {
  btc: 8,    // Keep full precision for BTC (high value per unit)
  ltc: 4,    // 4 decimals for LTC
  xmr: 4,    // 4 decimals for XMR
  wow: 2,    // 2 decimals for WOW (low value)
  grin: 2,   // 2 decimals for GRIN (low value)
};

// Full precision decimals per asset
export const FULL_DECIMALS: Record<AssetType, number> = {
  btc: 8,
  ltc: 8,
  xmr: 12,
  wow: 11,
  grin: 9,
};

// Format atomic units to display string (shortened decimals)
export function formatBalance(atomicUnits: number, asset: AssetType): string {
  const divisor = ATOMIC_DIVISORS[asset];
  const displayDecimals = DISPLAY_DECIMALS[asset];
  return (atomicUnits / divisor).toFixed(displayDecimals);
}

// Format atomic units to full precision string (for hover/copy)
export function formatBalanceFull(atomicUnits: number, asset: AssetType): string {
  const divisor = ATOMIC_DIVISORS[asset];
  const fullDecimals = FULL_DECIMALS[asset];
  return (atomicUnits / divisor).toFixed(fullDecimals);
}

// Send message to background
export async function sendMessage<T>(message: unknown): Promise<T> {
  const response = await runtime.sendMessage<MessageResponse<T>>(message);
  if (response?.success) {
    return response.data as T;
  }
  throw new Error(response?.error || 'Unknown error');
}

// Address data interface
export interface AddressData {
  asset: AssetType;
  address: string;
  publicKey: string;
}

// Balance data interface
export interface BalanceData {
  confirmed: number;   // Available (unlocked) balance
  unconfirmed: number; // Pending balance (can be negative for outgoing)
  total: number;       // Total including locked
  locked?: number;     // Locked balance (outputs waiting for confirmations)
  error?: string;
}

// Wallet screen types
export type WalletScreen = 'main' | 'receive' | 'send' | 'settings' | 'grinPending';

// Session storage keys for persisting popup state across popup closes
const SCREEN_STATE_KEY = 'smirk_screen_state';

// Screen state interface
interface ScreenState {
  screen: WalletScreen;
  asset: AssetType;
  timestamp: number;
}

// Save current screen state to chrome.storage.session
// This persists across popup closes (unlike DOM sessionStorage)
export async function saveScreenState(screen: WalletScreen, asset: AssetType): Promise<void> {
  const state: ScreenState = { screen, asset, timestamp: Date.now() };
  await storage.session.set({ [SCREEN_STATE_KEY]: state });
}

// Restore screen state from chrome.storage.session
// Returns null if expired (> 5 min) or not found
export async function restoreScreenState(): Promise<ScreenState | null> {
  try {
    const data = await storage.session.get<{ [SCREEN_STATE_KEY]?: ScreenState }>([SCREEN_STATE_KEY]);
    const state = data[SCREEN_STATE_KEY];
    if (!state) return null;

    // Expire after 5 minutes of popup being closed
    if (Date.now() - state.timestamp > 5 * 60 * 1000) {
      await storage.session.remove([SCREEN_STATE_KEY]);
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

// Clear screen state (e.g., when locking)
export async function clearScreenState(): Promise<void> {
  await storage.session.remove([SCREEN_STATE_KEY]);
}
