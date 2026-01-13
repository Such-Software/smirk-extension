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

// Spent output candidate from LWS (for client-side verification)
export interface SpentOutputCandidate {
  amount: number;
  key_image: string;
  tx_pub_key: string;
  out_index: number;
}

// Balance response from background - UTXO format (BTC/LTC/Grin)
export interface UtxoBalanceResponse {
  asset: AssetType;
  confirmed: number;
  unconfirmed: number;
  total: number;
}

// Balance response from background - LWS raw format (XMR/WOW)
// Requires client-side WASM verification of spent outputs
export interface LwsRawBalanceResponse {
  asset: 'xmr' | 'wow';
  total_received: number;
  locked_balance: number;
  pending_balance: number;
  spent_outputs: SpentOutputCandidate[];
  viewKeyHex: string;
  publicSpendKey: string;
  spendKeyHex: string;
  needsVerification: true;
}

// Union type for balance response
export type BalanceResponse = UtxoBalanceResponse | LwsRawBalanceResponse;

// Type guard for LWS raw response
export function isLwsRawResponse(response: BalanceResponse): response is LwsRawBalanceResponse {
  return 'needsVerification' in response && response.needsVerification === true;
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
  | { type: 'GET_UTXOS'; asset: 'btc' | 'ltc'; address: string }
  | { type: 'SEND_TX'; asset: 'btc' | 'ltc'; recipientAddress: string; amount: number; feeRate: number }
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
  | { type: 'RESET_AUTO_LOCK_TIMER' }
  | { type: 'GET_HISTORY'; asset: 'btc' | 'ltc' }
  | { type: 'ESTIMATE_FEE'; asset: 'btc' | 'ltc' }
  | { type: 'GET_WALLET_KEYS'; asset: 'xmr' | 'wow' }
  | { type: 'ADD_PENDING_TX'; txHash: string; asset: AssetType; amount: number; fee: number }
  | { type: 'GET_PENDING_TXS'; asset: AssetType };

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
