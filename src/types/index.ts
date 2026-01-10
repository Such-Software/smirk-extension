// Asset types supported by Smirk
export type AssetType = 'btc' | 'ltc' | 'xmr' | 'wow' | 'grin';

// Wallet key pair stored in extension
export interface WalletKey {
  asset: AssetType;
  publicKey: string;      // Hex encoded (BTC/LTC: compressed pubkey, XMR/WOW: public spend key)
  privateKey: string;     // Encrypted with user password (BTC/LTC: privkey, XMR/WOW: private spend key)
  privateKeySalt: string; // Salt used for encryption (hex encoded)

  // For XMR/WOW: Cryptonote keys (all hex encoded)
  publicSpendKey?: string;   // Public spend key (part of address)
  publicViewKey?: string;    // Public view key (part of address)
  privateViewKey?: string;   // Private view key (encrypted) - needed for LWS registration
  privateViewKeySalt?: string; // Salt for view key encryption

  // Metadata
  createdAt: number;
  label?: string;
}

// User settings
export interface UserSettings {
  autoSweep: boolean;
  notifyOnTip: boolean;
  defaultAsset: AssetType;
  // Auto-lock timeout in minutes (1-240), 0 = never auto-lock
  autoLockMinutes: number;
}

// Block heights at wallet creation (for efficient LWS sync)
export interface WalletBirthday {
  timestamp: number;  // Unix timestamp (ms)
  heights: {
    btc?: number;
    ltc?: number;
    xmr?: number;
    wow?: number;
  };
}

// Stored wallet state
export interface WalletState {
  // Master seed (encrypted mnemonic)
  encryptedSeed?: string;
  // Salt used for seed encryption
  seedSalt?: string;
  // Whether user has confirmed backup
  backupConfirmed?: boolean;
  // Wallet creation info (timestamp + block heights for efficient sync)
  walletBirthday?: WalletBirthday;
  // Derived keys per asset
  keys: Record<AssetType, WalletKey | undefined>;
  // User settings
  settings: UserSettings;
}

// Tip info from backend
export interface TipInfo {
  id: string;
  linkId: string;
  asset: AssetType;
  amountRaw: number;
  amountDisplay: string;
  status: 'pending' | 'funded' | 'claimed' | 'expired' | 'refunded';
  expiresAt: string;
  createdAt: string;
  ephemeralPubkey?: string;
  encryptedKey: string;
  isEncrypted: boolean;
  recipientHint?: string;
}

// Onboarding state for persisting wallet creation progress
export interface OnboardingState {
  step: 'choice' | 'generate' | 'verify' | 'password' | 'restore' | 'creating';
  words?: string[];
  verifyIndices?: number[];
  createdAt: number;
}

// Address info for display
export interface AddressInfo {
  asset: AssetType;
  address: string;
  publicKey: string;
}

// Balance info for display
export interface BalanceInfo {
  asset: AssetType;
  confirmed: number;      // In atomic units (satoshis, piconero, etc.)
  unconfirmed: number;
  total: number;
  loading?: boolean;
  error?: string;
}

// Message types for background <-> popup/content communication
export type MessageType =
  | { type: 'GET_WALLET_STATE' }
  | { type: 'GENERATE_MNEMONIC' }
  | { type: 'CONFIRM_MNEMONIC'; password: string; verifiedWords: Record<number, string> }
  | { type: 'RESTORE_WALLET'; mnemonic: string; password: string }
  | { type: 'UNLOCK_WALLET'; password: string }
  | { type: 'LOCK_WALLET' }
  | { type: 'CREATE_WALLET'; password: string }
  | { type: 'DECRYPT_TIP'; tipInfo: TipInfo }
  | { type: 'GET_BALANCE'; asset: AssetType }
  | { type: 'GET_ADDRESSES' }
  | { type: 'SIGN_TRANSACTION'; asset: AssetType; txData: unknown }
  | { type: 'OPEN_CLAIM_POPUP'; linkId: string; fragmentKey?: string }
  | { type: 'GET_TIP_INFO'; linkId: string }
  | { type: 'CLAIM_TIP'; linkId: string; fragmentKey?: string }
  | { type: 'GET_PENDING_CLAIM' }
  | { type: 'CLEAR_PENDING_CLAIM' }
  | { type: 'GET_ONBOARDING_STATE' }
  | { type: 'SAVE_ONBOARDING_STATE'; state: OnboardingState }
  | { type: 'CLEAR_ONBOARDING_STATE' }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<UserSettings> }
  | { type: 'RESET_AUTO_LOCK_TIMER' };

export type MessageResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

// Backend API response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface CreateTipResponse {
  id: string;
  linkId: string;
  claimUrl: string;
  expiresAt: string;
  isEncrypted: boolean;
}

export interface UserKeysResponse {
  keys: Array<{
    asset: AssetType;
    publicKey: string;
    publicSpendKey?: string;
  }>;
}
