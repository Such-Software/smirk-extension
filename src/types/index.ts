// Asset types supported by Smirk
export type AssetType = 'btc' | 'ltc' | 'xmr' | 'wow' | 'grin';

// Wallet key pair stored in extension
export interface WalletKey {
  asset: AssetType;
  publicKey: string;      // Hex encoded
  privateKey: string;     // Encrypted with user password
  // For XMR/WOW: additional keys
  viewKey?: string;
  spendKey?: string;
  // Metadata
  createdAt: number;
  label?: string;
}

// Stored wallet state
export interface WalletState {
  // Master seed (encrypted)
  encryptedSeed?: string;
  // Derived keys per asset
  keys: Record<AssetType, WalletKey | undefined>;
  // User settings
  settings: {
    autoSweep: boolean;
    notifyOnTip: boolean;
    defaultAsset: AssetType;
  };
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

// Message types for background <-> popup/content communication
export type MessageType =
  | { type: 'GET_WALLET_STATE' }
  | { type: 'UNLOCK_WALLET'; password: string }
  | { type: 'LOCK_WALLET' }
  | { type: 'CREATE_WALLET'; password: string }
  | { type: 'DECRYPT_TIP'; tipInfo: TipInfo }
  | { type: 'GET_BALANCE'; asset: AssetType }
  | { type: 'SIGN_TRANSACTION'; asset: AssetType; txData: unknown }
  | { type: 'OPEN_CLAIM_POPUP'; linkId: string; fragmentKey?: string }
  | { type: 'GET_TIP_INFO'; linkId: string }
  | { type: 'CLAIM_TIP'; linkId: string; fragmentKey?: string }
  | { type: 'GET_PENDING_CLAIM' }
  | { type: 'CLEAR_PENDING_CLAIM' };

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
