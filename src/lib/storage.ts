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
  GRIN_PENDING_RECEIVE: 'grinPendingReceive',
  CONNECTED_SITES: 'connectedSites',
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
    theme: 'dark',
  },
};

/**
 * Gets the wallet state from storage.
 * Merges with defaults to ensure all settings fields exist (handles migrations).
 */
export async function getWalletState(): Promise<WalletState> {
  const result = await storage.local.get<Record<string, WalletState>>(STORAGE_KEYS.WALLET_STATE);
  const stored = result[STORAGE_KEYS.WALLET_STATE];

  if (!stored) {
    return DEFAULT_WALLET_STATE;
  }

  // Deep merge settings to handle new fields added in updates
  return {
    ...stored,
    settings: {
      ...DEFAULT_WALLET_STATE.settings,
      ...stored.settings,
    },
  };
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
  step: 'choice' | 'generate' | 'verify' | 'password' | 'restore' | 'creating';
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

/**
 * Pending Grin receive - stores signed slatepack awaiting sender finalization.
 * This persists across popup closes so user doesn't lose their signed slatepack.
 */
export interface GrinPendingReceive {
  slateId: string;
  inputSlatepack: string;
  signedSlatepack: string;
  amount: number; // nanogrin
  createdAt: number;
}

/**
 * Gets the pending Grin receive state.
 */
export async function getGrinPendingReceive(): Promise<GrinPendingReceive | null> {
  const result = await storage.local.get<Record<string, GrinPendingReceive>>(STORAGE_KEYS.GRIN_PENDING_RECEIVE);
  const state = result[STORAGE_KEYS.GRIN_PENDING_RECEIVE];

  // Expire after 24 hours (matches slatepack expiry)
  if (state && Date.now() - state.createdAt > 24 * 60 * 60 * 1000) {
    await clearGrinPendingReceive();
    return null;
  }

  return state ?? null;
}

/**
 * Saves a pending Grin receive.
 */
export async function saveGrinPendingReceive(state: GrinPendingReceive): Promise<void> {
  await storage.local.set({ [STORAGE_KEYS.GRIN_PENDING_RECEIVE]: state });
}

/**
 * Clears the pending Grin receive.
 */
export async function clearGrinPendingReceive(): Promise<void> {
  await storage.local.remove(STORAGE_KEYS.GRIN_PENDING_RECEIVE);
}

/**
 * Pending Grin invoice (RSR flow) - stores invoice awaiting sender's signed response.
 * The secrets are needed to finalize the transaction when the response arrives.
 * Uses standard slatepack format (BEGINSLATEPACK...ENDSLATEPACK).
 */
export interface GrinPendingInvoice {
  /** Slate ID (UUID) */
  slateId: string;
  /** Invoice slatepack (BEGINSLATEPACK...ENDSLATEPACK format) */
  slatepack: string;
  /** Requested amount in nanogrin */
  amount: number;
  /** Hex-encoded secret key for finalization */
  secretKeyHex: string;
  /** Hex-encoded secret nonce for finalization */
  secretNonceHex: string;
  /** Output info for recording after finalization */
  outputInfo: {
    keyId: string;
    nChild: number;
    commitment: string;
    /** Hex-encoded output proof (needed for finalization) */
    proof: string;
  };
  /** Receiver's public blind excess (hex) */
  publicBlindExcess: string;
  /** Receiver's public nonce (hex) */
  publicNonce: string;
  /** Receiver's slatepack address */
  receiverAddress: string;
  /** Unix timestamp when created */
  createdAt: number;
}

/**
 * Gets the pending Grin invoice state.
 */
export async function getGrinPendingInvoice(): Promise<GrinPendingInvoice | null> {
  const result = await storage.local.get<Record<string, GrinPendingInvoice>>('grinPendingInvoice');
  const state = result['grinPendingInvoice'];
  return state ?? null;
}

/**
 * Saves a pending Grin invoice.
 */
export async function saveGrinPendingInvoice(state: GrinPendingInvoice): Promise<void> {
  await storage.local.set({ grinPendingInvoice: state });
}

/**
 * Clears the pending Grin invoice.
 */
export async function clearGrinPendingInvoice(): Promise<void> {
  await storage.local.remove('grinPendingInvoice');
}

/**
 * Connected site info - tracks which origins user has approved for window.smirk API.
 */
export interface ConnectedSite {
  origin: string; // e.g., "https://smirk.cash"
  name?: string; // Site name from <title> or manifest
  favicon?: string; // Favicon URL
  connectedAt: number; // Unix timestamp
  lastUsed: number; // Unix timestamp of last API call
}

/**
 * Gets all connected sites.
 */
export async function getConnectedSites(): Promise<ConnectedSite[]> {
  const result = await storage.local.get<Record<string, ConnectedSite[]>>(STORAGE_KEYS.CONNECTED_SITES);
  return result[STORAGE_KEYS.CONNECTED_SITES] ?? [];
}

/**
 * Checks if an origin is connected (approved).
 */
export async function isOriginConnected(origin: string): Promise<boolean> {
  const sites = await getConnectedSites();
  return sites.some((site) => site.origin === origin);
}

/**
 * Gets a connected site by origin.
 */
export async function getConnectedSite(origin: string): Promise<ConnectedSite | null> {
  const sites = await getConnectedSites();
  return sites.find((site) => site.origin === origin) ?? null;
}

/**
 * Adds a connected site.
 */
export async function addConnectedSite(site: ConnectedSite): Promise<void> {
  const sites = await getConnectedSites();
  const existing = sites.findIndex((s) => s.origin === site.origin);

  if (existing >= 0) {
    // Update existing
    sites[existing] = site;
  } else {
    // Add new
    sites.push(site);
  }

  await storage.local.set({ [STORAGE_KEYS.CONNECTED_SITES]: sites });
}

/**
 * Updates lastUsed timestamp for a connected site.
 */
export async function touchConnectedSite(origin: string): Promise<void> {
  const sites = await getConnectedSites();
  const site = sites.find((s) => s.origin === origin);

  if (site) {
    site.lastUsed = Date.now();
    await storage.local.set({ [STORAGE_KEYS.CONNECTED_SITES]: sites });
  }
}

/**
 * Removes a connected site (disconnect).
 */
export async function removeConnectedSite(origin: string): Promise<void> {
  const sites = await getConnectedSites();
  const filtered = sites.filter((s) => s.origin !== origin);
  await storage.local.set({ [STORAGE_KEYS.CONNECTED_SITES]: filtered });
}

/**
 * Clears all connected sites.
 */
export async function clearAllConnectedSites(): Promise<void> {
  await storage.local.remove(STORAGE_KEYS.CONNECTED_SITES);
}

// =============================================================================
// Pending Social Tips (for clawback)
// =============================================================================

/**
 * Pending social tip - stores tip info + private key for clawback.
 * The sender stores this so they can recover funds if recipient doesn't claim.
 */
export interface PendingSocialTip {
  /** Backend tip ID (UUID) */
  tipId: string;
  /** Asset type (btc, ltc, xmr, wow) */
  asset: string;
  /** Amount in atomic units */
  amount: number;
  /** Tip address where funds are held */
  tipAddress: string;
  /** Funding transaction ID */
  fundingTxid: string;
  /** Encrypted tip private key (for clawback) - encrypted with wallet password */
  encryptedTipKey: string;
  /** Salt used for encryption */
  encryptedTipKeySalt: string;
  /** Recipient platform (e.g., "telegram") - empty for public tips */
  recipientPlatform: string;
  /** Recipient username - empty for public tips */
  recipientUsername: string;
  /** Unix timestamp when created */
  createdAt: number;
  /** Status: pending, claimed, clawed_back */
  status: 'pending' | 'claimed' | 'clawed_back';
  /** Whether this is a public tip (claimable by anyone with the URL) */
  isPublic?: boolean;
  /** Base64url-encoded URL fragment key for public tips (stored until tip is confirmed) */
  publicFragmentKey?: string;
}

const STORAGE_KEY_PENDING_TIPS = 'pendingSocialTips';

/**
 * Gets all pending social tips.
 */
export async function getPendingSocialTips(): Promise<PendingSocialTip[]> {
  const result = await storage.local.get<Record<string, PendingSocialTip[]>>(STORAGE_KEY_PENDING_TIPS);
  return result[STORAGE_KEY_PENDING_TIPS] ?? [];
}

/**
 * Gets a pending social tip by ID.
 */
export async function getPendingSocialTip(tipId: string): Promise<PendingSocialTip | null> {
  const tips = await getPendingSocialTips();
  return tips.find((t) => t.tipId === tipId) ?? null;
}

/**
 * Adds a pending social tip.
 */
export async function addPendingSocialTip(tip: PendingSocialTip): Promise<void> {
  const tips = await getPendingSocialTips();
  tips.push(tip);
  await storage.local.set({ [STORAGE_KEY_PENDING_TIPS]: tips });
}

/**
 * Updates a pending social tip's status.
 */
export async function updatePendingSocialTipStatus(
  tipId: string,
  status: 'pending' | 'claimed' | 'clawed_back'
): Promise<void> {
  const tips = await getPendingSocialTips();
  const tip = tips.find((t) => t.tipId === tipId);
  if (tip) {
    tip.status = status;
    await storage.local.set({ [STORAGE_KEY_PENDING_TIPS]: tips });
  }
}

/**
 * Removes a pending social tip.
 */
export async function removePendingSocialTip(tipId: string): Promise<void> {
  const tips = await getPendingSocialTips();
  const filtered = tips.filter((t) => t.tipId !== tipId);
  await storage.local.set({ [STORAGE_KEY_PENDING_TIPS]: filtered });
}

/**
 * Clears all pending social tips.
 */
export async function clearAllPendingSocialTips(): Promise<void> {
  await storage.local.remove(STORAGE_KEY_PENDING_TIPS);
}
